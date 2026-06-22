const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 4173);
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const LOG_FILE = path.join(DATA_DIR, "usage-log.json");
const STALE_AFTER_MS = 20_000;

const rooms = new Map();
let usageLogs = loadUsageLogs();

function loadUsageLogs() {
  try {
    return JSON.parse(fs.readFileSync(LOG_FILE, "utf8"));
  } catch (error) {
    return [];
  }
}

function saveUsageLogs() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(LOG_FILE, JSON.stringify(usageLogs, null, 2));
}

function appendUsageLog(entry) {
  usageLogs.push(entry);
  saveUsageLogs();
}

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, { users: new Map(), clients: new Set() });
  }
  return rooms.get(roomId);
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

function sanitizeEmail(value) {
  const text = String(value || "").trim().toLowerCase().slice(0, 254);
  return text.includes("@") ? text : "";
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Payload too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
  });
}

function sanitize(value, fallback) {
  const text = String(value || "").trim().slice(0, 48);
  return text || fallback;
}

function normalizeRoomId(value) {
  const text = String(value || "").trim().slice(0, 96);
  return text || "general";
}

function sanitizeUsageStatus(value) {
  const status = String(value || "").trim();
  return ["using", "idle"].includes(status) ? status : "using";
}

function usageTotalMs(user, now = Date.now()) {
  if (user.usageStatus !== "using" || !user.usingStartedAt) {
    return user.totalUsingMs || 0;
  }
  return (user.totalUsingMs || 0) + Math.max(0, now - user.usingStartedAt);
}

function dayKey(value = Date.now()) {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function closeUsingSession(user, now = Date.now(), roomId = "main") {
  if (user.usageStatus === "using" && user.usingStartedAt) {
    const startedAt = user.usingStartedAt;
    const durationMs = Math.max(0, now - startedAt);
    user.totalUsingMs = usageTotalMs(user, now);
    user.usingStartedAt = null;
    if (durationMs > 0) {
      appendUsageLog({
        id: crypto.randomUUID(),
        roomId,
        userId: user.id,
        name: user.name,
        color: user.color,
        startedAt: new Date(startedAt).toISOString(),
        endedAt: new Date(now).toISOString(),
        durationMs,
        day: dayKey(startedAt),
      });
    }
  }
}

function dailySummary(roomId, now = Date.now()) {
  const today = dayKey(now);
  const summary = new Map();

  for (const log of usageLogs) {
    if (log.roomId !== roomId || log.day !== today) continue;
    const item = summary.get(log.userId) || {
      userId: log.userId,
      name: log.name,
      color: log.color,
      totalMs: 0,
      sessions: 0,
      active: false,
    };
    item.name = log.name;
    item.color = log.color;
    item.totalMs += log.durationMs;
    item.sessions += 1;
    summary.set(log.userId, item);
  }

  for (const user of getRoom(roomId).users.values()) {
    const item = summary.get(user.id) || {
      userId: user.id,
      name: user.name,
      color: user.color,
      totalMs: 0,
      sessions: 0,
      active: false,
    };
    item.name = user.name;
    item.color = user.color;
    item.totalMs += user.usageStatus === "using" && user.usingStartedAt ? Math.max(0, now - user.usingStartedAt) : 0;
    item.active = user.usageStatus === "using";
    summary.set(user.id, item);
  }

  return [...summary.values()]
    .sort((a, b) => b.totalMs - a.totalMs)
    .map((item) => ({
      ...item,
      totalSeconds: Math.floor(item.totalMs / 1000),
      totalMinutes: Math.round((item.totalMs / 60_000) * 10) / 10,
    }));
}

function roomSnapshot(roomId) {
  const room = getRoom(roomId);
  const now = Date.now();
  for (const [id, user] of room.users) {
    if (now - user.lastSeen > STALE_AFTER_MS) {
      closeUsingSession(user, now, roomId);
      room.users.delete(id);
    }
  }

  return {
    roomId,
    generatedAt: new Date().toISOString(),
    summary: dailySummary(roomId, now),
    users: [...room.users.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((user) => ({
        id: user.id,
        name: user.name,
        email: user.email,
        color: user.color,
        usageStatus: user.usageStatus,
        totalUsingMs: usageTotalMs(user, now),
        totalUsingSeconds: Math.floor(usageTotalMs(user, now) / 1000),
        isTiming: user.usageStatus === "using",
        lastSeen: user.lastSeen,
        secondsAgo: Math.max(0, Math.round((now - user.lastSeen) / 1000)),
      })),
  };
}

function upsertUser(roomId, nextUser) {
  const now = Date.now();
  const room = getRoom(roomId);
  const current = room.users.get(nextUser.id);
  const usageStatus = sanitizeUsageStatus(nextUser.usageStatus);

  if (!current) {
    room.users.set(nextUser.id, {
      ...nextUser,
      usageStatus,
      totalUsingMs: 0,
      usingStartedAt: usageStatus === "using" ? now : null,
      lastSeen: now,
    });
    return;
  }

  if (current.usageStatus === "using" && usageStatus !== "using") {
    closeUsingSession(current, now, roomId);
  }

  if (current.usageStatus !== "using" && usageStatus === "using") {
    current.usingStartedAt = now;
  }

  Object.assign(current, {
    name: nextUser.name,
    email: nextUser.email,
    color: nextUser.color,
    usageStatus,
    lastSeen: now,
  });
}

function broadcast(roomId) {
  const room = getRoom(roomId);
  const data = `data: ${JSON.stringify(roomSnapshot(roomId))}\n\n`;
  for (const client of room.clients) {
    client.write(data);
  }
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath);
    const type =
      ext === ".html" ? "text/html; charset=utf-8" :
      ext === ".css" ? "text/css; charset=utf-8" :
      ext === ".js" ? "text/javascript; charset=utf-8" :
      "application/octet-stream";

    res.writeHead(200, { "content-type": type });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (req.method === "GET" && url.pathname === "/api/config") {
      sendJson(res, 200, {
        googleClientId: process.env.GOOGLE_CLIENT_ID || "",
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/join") {
      const body = await parseBody(req);
      const roomId = normalizeRoomId(body.roomId);
      const userId = sanitize(body.userId, crypto.randomUUID());
      const name = sanitize(body.name, "เพื่อน");
      const email = sanitizeEmail(body.email);
      const color = sanitize(body.color, "#8b5cf6");
      const usageStatus = sanitizeUsageStatus(body.usageStatus || body.claudeStatus);

      upsertUser(roomId, {
        id: userId,
        name,
        email,
        color,
        usageStatus,
      });
      broadcast(roomId);
      sendJson(res, 200, { roomId, userId });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/leave") {
      const body = await parseBody(req);
      const roomId = normalizeRoomId(body.roomId);
      const userId = sanitize(body.userId, "");
      const room = getRoom(roomId);
      const user = room.users.get(userId);
      if (user) closeUsingSession(user, Date.now(), roomId);
      room.users.delete(userId);
      broadcast(roomId);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/events") {
      const roomId = normalizeRoomId(url.searchParams.get("room"));
      const room = getRoom(roomId);

      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      });
      res.write(`data: ${JSON.stringify(roomSnapshot(roomId))}\n\n`);
      room.clients.add(res);
      req.on("close", () => room.clients.delete(res));
      return;
    }

    serveStatic(req, res);
  } catch (error) {
    sendJson(res, 400, { error: error.message });
  }
});

setInterval(() => {
  for (const roomId of rooms.keys()) {
    broadcast(roomId);
  }
}, 5_000).unref();

server.listen(PORT, () => {
  console.log(`Claude Used is running at http://localhost:${PORT}`);
});
