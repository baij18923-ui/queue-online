import {
  callNext,
  callTicket,
  clearWaiting,
  exportState,
  getCurrentCall,
  getWaitingTickets,
  isAdminLoggedIn,
  loginAdmin,
  recallCurrent,
  resetAll,
  skipTicket,
  subscribeToQueue,
  toggleService,
  updateSettings
} from "./queueStore.js";

const elements = {
  loginCard: document.querySelector("#loginCard"),
  adminApp: document.querySelector("#adminApp"),
  passwordInput: document.querySelector("#passwordInput"),
  loginButton: document.querySelector("#loginButton"),
  loginError: document.querySelector("#loginError"),
  adminStatus: document.querySelector("#adminStatus"),
  adminCurrentCall: document.querySelector("#adminCurrentCall"),
  callNext: document.querySelector("#callNext"),
  recallCurrent: document.querySelector("#recallCurrent"),
  toggleService: document.querySelector("#toggleService"),
  clearWaiting: document.querySelector("#clearWaiting"),
  prefixInput: document.querySelector("#prefixInput"),
  digitsInput: document.querySelector("#digitsInput"),
  nextNumberInput: document.querySelector("#nextNumberInput"),
  callTextInput: document.querySelector("#callTextInput"),
  saveSettings: document.querySelector("#saveSettings"),
  resetAll: document.querySelector("#resetAll"),
  adminWaitingCount: document.querySelector("#adminWaitingCount"),
  adminQueue: document.querySelector("#adminQueue"),
  historyList: document.querySelector("#historyList"),
  exportHistory: document.querySelector("#exportHistory")
};

let latestState = null;

elements.loginButton.addEventListener("click", tryLogin);
elements.passwordInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") tryLogin();
});

elements.callNext.addEventListener("click", async () => showResult(await callNext()));
elements.recallCurrent.addEventListener("click", async () => showResult(await recallCurrent()));
elements.toggleService.addEventListener("click", async () => showResult(await toggleService()));
elements.clearWaiting.addEventListener("click", async () => {
  if (confirm("确定清空所有等待号码吗？")) showResult(await clearWaiting());
});
elements.saveSettings.addEventListener("click", async () => {
  showResult(await updateSettings({
    prefix: elements.prefixInput.value,
    digits: elements.digitsInput.value,
    nextNumber: elements.nextNumberInput.value,
    callText: elements.callTextInput.value
  }));
});
elements.resetAll.addEventListener("click", async () => {
  if (confirm("确定全部重置吗？所有号码和记录都会清空。")) showResult(await resetAll());
});
elements.exportHistory.addEventListener("click", exportJson);

if (isAdminLoggedIn()) {
  showAdmin();
}

subscribeToQueue((state) => {
  latestState = state;
  if (isAdminLoggedIn()) render(state);
});

function tryLogin() {
  const ok = loginAdmin(elements.passwordInput.value.trim());
  if (!ok) {
    elements.loginError.textContent = "密码错误，请重新输入。";
    return;
  }
  elements.loginError.textContent = "";
  showAdmin();
  render(latestState);
}

function showAdmin() {
  elements.loginCard.hidden = true;
  elements.adminApp.hidden = false;
}

function render(state) {
  if (!state) return;

  const current = getCurrentCall(state);
  const waiting = getWaitingTickets(state);
  elements.adminStatus.textContent = state.setupError ? "等待配置 Supabase" : (state.settings.isOpen ? "开放取号" : "暂停取号");
  elements.adminCurrentCall.textContent = current?.number || "-";
  elements.toggleService.textContent = state.settings.isOpen ? "暂停取号" : "开放取号";
  elements.adminWaitingCount.textContent = `${waiting.length} 人`;

  elements.prefixInput.value = state.settings.prefix;
  elements.digitsInput.value = state.settings.digits;
  elements.nextNumberInput.value = state.settings.nextNumber;
  elements.callTextInput.value = state.settings.callText || "请 {number} 到窗口办理";

  renderQueue(waiting);
  renderHistory(state.history);
}

function renderQueue(waiting) {
  elements.adminQueue.innerHTML = "";

  if (waiting.length === 0) {
    elements.adminQueue.innerHTML = `<p class="empty-text">暂无等待号码</p>`;
    return;
  }

  waiting.forEach((ticket) => {
    const item = document.createElement("div");
    item.className = "queue-row";
    item.innerHTML = `
      <strong>${ticket.number}</strong>
      <span>${ticket.createdAt}</span>
    `;

    const actions = document.createElement("div");
    actions.className = "row-actions";

    const callButton = document.createElement("button");
    callButton.textContent = "叫号";
    callButton.addEventListener("click", async () => showResult(await callTicket(ticket.id)));

    const skipButton = document.createElement("button");
    skipButton.className = "muted-button";
    skipButton.textContent = "跳过";
    skipButton.addEventListener("click", async () => showResult(await skipTicket(ticket.id)));

    actions.append(callButton, skipButton);
    item.appendChild(actions);
    elements.adminQueue.appendChild(item);
  });
}

function renderHistory(history) {
  elements.historyList.innerHTML = "";

  if (history.length === 0) {
    elements.historyList.innerHTML = `<p class="empty-text">暂无记录</p>`;
    return;
  }

  history.slice(0, 50).forEach((record) => {
    const item = document.createElement("div");
    item.className = "history-row";
    item.innerHTML = `
      <strong>${record.action}</strong>
      <span>${record.detail || "-"}</span>
      <time>${record.time}</time>
    `;
    elements.historyList.appendChild(item);
  });
}

function showResult(result) {
  if (!result.ok) alert(result.message);
}

async function exportJson() {
  const blob = new Blob([JSON.stringify(await exportState(), null, 2)], {
    type: "application/json;charset=utf-8"
  });
  const link = document.createElement("a");
  link.download = `叫号记录_${Date.now()}.json`;
  link.href = URL.createObjectURL(blob);
  document.body.appendChild(link);
  link.click();
  URL.revokeObjectURL(link.href);
  link.remove();
}
