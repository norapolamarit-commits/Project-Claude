const form = document.querySelector("#joinForm");
const nameInput = document.querySelector("#nameInput");
const onlineList = document.querySelector("#onlineList");
const usageChart = document.querySelector("#usageChart");
const countTitle = document.querySelector("#countTitle");
const connectionStatus = document.querySelector("#connectionStatus");
const copyLinkButton = document.querySelector("#copyLinkButton");
const openClaudeButton = document.querySelector("#openClaudeButton");
const stopClaudeButton = document.querySelector("#stopClaudeButton");
const dailySummary = document.querySelector("#dailySummary");
const pulse = document.querySelector(".pulse");
const statusInputs = [...document.querySelectorAll('input[name="usageStatus"]')];
const loginView = document.querySelector("#loginView");
const appView = document.querySelector("#appView");
const signedInPanel = document.querySelector("#signedInPanel");
const signedInName = document.querySelector("#signedInName");
const signOutButton = document.querySelector("#signOutButton");
const nameGateForm = document.querySelector("#nameGateForm");
const gateNameInput = document.querySelector("#gateNameInput");

const colors = ["#6d28d9", "#2563eb", "#db2777", "#0891b2", "#7c3aed", "#ea580c", "#059669"];
const state = {
  userId: localStorage.getItem("claude-online-user-id") || crypto.randomUUID(),
  color: localStorage.getItem("claude-online-color") || colors[Math.floor(Math.random() * colors.length)],
  roomId: new URLSearchParams(location.search).get("room") || "main",
  displayName: sessionStorage.getItem("claude-used-display-name") || localStorage.getItem("claude-online-name") || "",
  source: null,
  heartbeat: null,
};

localStorage.setItem("claude-online-user-id", state.userId);
localStorage.setItem("claude-online-color", state.color);
gateNameInput.value = state.displayName;
const savedClaudeStatus = localStorage.getItem("claude-online-status") || "using";
const savedStatusInput = statusInputs.find((input) => input.value === savedClaudeStatus);
if (savedStatusInput) savedStatusInput.checked = true;

const statusLabels = {
  using: "กำลังใช้ Claude",
  idle: "ไม่ได้ใช้ตอนนี้",
};

function setConnected(connected) {
  pulse.classList.toggle("online", connected);
  connectionStatus.textContent = connected ? "กำลังเช็กสถานะ" : "ยังไม่ได้อัปเดตสถานะ";
}

function initials(name) {
  return [...name.trim()][0]?.toUpperCase() || "?";
}

function render(snapshot) {
  const activeUsers = snapshot.users.filter((user) => user.usageStatus === "using");
  countTitle.textContent = `${activeUsers.length} คน`;
  renderUsageChart(snapshot.users, snapshot.summary || []);
  renderDailySummary(snapshot.summary || []);

  if (!snapshot.users.length) {
    onlineList.innerHTML = '<li class="empty">ยังไม่มีใครเข้าห้อง</li>';
    return;
  }

  onlineList.innerHTML = snapshot.users.map((user) => `
    <li class="person">
      <span class="avatar" style="background:${user.color}">${initials(user.name)}</span>
      <span>
        <span class="name">${escapeHtml(user.name)}</span>
        <span class="meta">${statusLabels[user.usageStatus] || statusLabels.using} · ใช้ไป ${formatDuration(user.totalUsingSeconds || 0)} · เห็นล่าสุด ${user.secondsAgo} วินาทีที่แล้ว</span>
      </span>
      <span class="badge ${user.usageStatus}">${statusLabels[user.usageStatus] || statusLabels.using}</span>
    </li>
  `).join("");
}

function renderDailySummary(summary) {
  if (!summary.length || summary.every((item) => !item.totalSeconds)) {
    dailySummary.innerHTML = '<p class="empty">ยังไม่มีประวัติวันนี้</p>';
    return;
  }

  dailySummary.innerHTML = summary.map((item) => `
    <div class="summary-row">
      <span class="chart-dot" style="background:${item.color}"></span>
      <strong>${escapeHtml(item.name)}</strong>
      <span>${formatDuration(item.totalSeconds || 0)}</span>
      <small>${item.sessions} ครั้ง${item.active ? " · กำลังใช้" : ""}</small>
    </div>
  `).join("");
}

function renderUsageChart(users, summary) {
  const activeById = new Map(users.map((user) => [user.id, user]));
  const chartItems = summary.length
    ? summary.map((item) => ({
        id: item.userId,
        name: item.name,
        color: item.color,
        totalSeconds: item.totalSeconds || 0,
        isTiming: Boolean(item.active),
      }))
    : users.map((user) => ({
        id: user.id,
        name: user.name,
        color: user.color,
        totalSeconds: user.totalUsingSeconds || 0,
        isTiming: user.isTiming,
      }));

  for (const user of users) {
    if (!activeById.has(user.id)) continue;
    const existing = chartItems.find((item) => item.id === user.id);
    if (existing) existing.isTiming = user.isTiming;
  }

  const sorted = chartItems.sort((a, b) => (b.totalSeconds || 0) - (a.totalSeconds || 0));
  const maxSeconds = Math.max(1, ...sorted.map((user) => user.totalSeconds || 0));

  if (!sorted.length || sorted.every((user) => !user.totalSeconds)) {
    usageChart.innerHTML = '<p class="empty">ยังไม่มีข้อมูลเวลาใช้งาน</p>';
    return;
  }

  usageChart.innerHTML = sorted.map((user) => {
    const seconds = user.totalSeconds || 0;
    const width = Math.max(4, Math.round((seconds / maxSeconds) * 100));
    return `
      <div class="chart-row">
        <div class="chart-label">
          <span class="chart-dot" style="background:${user.color}"></span>
          <strong>${escapeHtml(user.name)}</strong>
        </div>
        <div class="chart-track" aria-label="${escapeHtml(user.name)} ใช้ไป ${formatDuration(seconds)}">
          <span class="chart-bar ${user.isTiming ? "active" : ""}" style="width:${width}%"></span>
        </div>
        <span class="chart-time">${formatDuration(seconds)}</span>
      </div>
    `;
  }).join("");
}

function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = seconds / 60;
  if (minutes < 1) return `${minutes.toFixed(1)} นาที`;
  return `${minutes.toFixed(1)} นาที`;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function enterApp(name) {
  state.displayName = name.trim();
  sessionStorage.setItem("claude-used-display-name", state.displayName);
  localStorage.setItem("claude-online-name", state.displayName);

  nameInput.value = state.displayName;
  signedInName.textContent = state.displayName;
  loginView.hidden = true;
  appView.hidden = false;
  signedInPanel.hidden = false;
  form.classList.remove("locked");
}

function leaveApp() {
  if (state.source) state.source.close();
  clearInterval(state.heartbeat);
  navigator.sendBeacon(
    "/api/leave",
    new Blob([JSON.stringify({ roomId: state.roomId, userId: state.userId })], { type: "application/json" })
  );
  state.displayName = "";
  sessionStorage.removeItem("claude-used-display-name");
  nameInput.value = "";
  loginView.hidden = false;
  appView.hidden = true;
  signedInPanel.hidden = true;
  form.classList.add("locked");
  setConnected(false);
}

function initNameGate() {
  form.classList.add("locked");
  if (state.displayName) {
    enterApp(state.displayName);
  }
}

async function joinRoom() {
  if (!state.displayName) {
    leaveApp();
    return;
  }

  const name = nameInput.value.trim();
  const roomId = state.roomId || "main";
  if (!name) return;

  state.roomId = roomId;
  const usageStatus = document.querySelector('input[name="usageStatus"]:checked')?.value || "using";
  localStorage.setItem("claude-online-name", name);
  localStorage.setItem("claude-online-status", usageStatus);
  history.replaceState(null, "", `?room=${encodeURIComponent(roomId)}`);

  if (state.source) state.source.close();
  clearInterval(state.heartbeat);

  await fetch("/api/join", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      roomId,
      userId: state.userId,
      name,
      color: state.color,
      usageStatus,
    }),
  });

  state.source = new EventSource(`/api/events?room=${encodeURIComponent(roomId)}`);
  state.source.onmessage = (event) => {
    setConnected(true);
    copyLinkButton.disabled = false;
    render(JSON.parse(event.data));
  };
  state.source.onerror = () => setConnected(false);

  state.heartbeat = setInterval(() => {
    fetch("/api/join", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        roomId: state.roomId,
        userId: state.userId,
        name: nameInput.value.trim(),
        color: state.color,
        usageStatus: document.querySelector('input[name="usageStatus"]:checked')?.value || "using",
      }),
    }).catch(() => setConnected(false));
  }, 7_000);
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  joinRoom();
});

nameGateForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = gateNameInput.value.trim();
  if (!name) return;
  enterApp(name);
});

for (const input of statusInputs) {
  input.addEventListener("change", () => {
    if (nameInput.value.trim()) joinRoom();
  });
}

copyLinkButton.addEventListener("click", async () => {
  const url = `${location.origin}${location.pathname}?room=${encodeURIComponent(state.roomId)}`;
  await navigator.clipboard.writeText(url);
  copyLinkButton.textContent = "คัดลอกแล้ว";
  setTimeout(() => {
    copyLinkButton.textContent = "คัดลอกลิงก์ห้อง";
  }, 1400);
});

openClaudeButton.addEventListener("click", async () => {
  const usingInput = document.querySelector('input[name="usageStatus"][value="using"]');
  if (usingInput) usingInput.checked = true;
  await joinRoom();
  window.open("https://claude.ai/", "_blank", "noopener");
});

stopClaudeButton.addEventListener("click", async () => {
  const idleInput = document.querySelector('input[name="usageStatus"][value="idle"]');
  if (idleInput) idleInput.checked = true;
  await joinRoom();
});

signOutButton.addEventListener("click", leaveApp);

window.addEventListener("beforeunload", () => {
  navigator.sendBeacon(
    "/api/leave",
    new Blob([JSON.stringify({ roomId: state.roomId, userId: state.userId })], { type: "application/json" })
  );
});

initNameGate();
