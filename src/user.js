import {
  getCurrentCall,
  getLastTicket,
  getMyTicketId,
  getTicketPosition,
  getWaitingTickets,
  subscribeToQueue,
  takeTicket
} from "./queueStore.js";

const elements = {
  currentCall: document.querySelector("#currentCall"),
  callHint: document.querySelector("#callHint"),
  waitingCount: document.querySelector("#waitingCount"),
  lastTicket: document.querySelector("#lastTicket"),
  serviceStatus: document.querySelector("#serviceStatus"),
  takeTicket: document.querySelector("#takeTicket"),
  myTicketBox: document.querySelector("#myTicketBox"),
  myTicket: document.querySelector("#myTicket"),
  myPosition: document.querySelector("#myPosition"),
  visibleWaitingCount: document.querySelector("#visibleWaitingCount"),
  waitingNumbers: document.querySelector("#waitingNumbers")
};

elements.takeTicket.addEventListener("click", async () => {
  elements.takeTicket.disabled = true;
  const result = await takeTicket();
  if (!result.ok) {
    alert(result.message);
  }
  elements.takeTicket.disabled = false;
});

subscribeToQueue(render);

function render(state) {
  const current = getCurrentCall(state);
  const lastTicket = getLastTicket(state);
  const waiting = getWaitingTickets(state);
  const myTicketId = getMyTicketId();
  const myTicket = state.tickets.find((ticket) => ticket.id === myTicketId);

  if (state.setupError) {
    elements.callHint.textContent = "请先配置 Supabase 后再部署使用";
    elements.takeTicket.disabled = true;
  }

  elements.currentCall.textContent = current?.number || "等待叫号";
  if (!state.setupError) {
    elements.callHint.textContent = current ? formatCallText(state.settings.callText, current.number) : "请留意工作人员叫号";
  }
  elements.waitingCount.textContent = String(waiting.length);
  elements.lastTicket.textContent = lastTicket?.number || "-";
  elements.serviceStatus.textContent = state.settings.isOpen ? "开放" : "暂停";
  elements.takeTicket.disabled = state.setupError || !state.settings.isOpen;
  elements.takeTicket.textContent = state.setupError ? "等待配置" : (state.settings.isOpen ? "立即取号" : "暂停取号");
  elements.visibleWaitingCount.textContent = `${waiting.length} 个`;

  renderMyTicket(state, myTicket);
  renderWaitingNumbers(waiting);
}

function formatCallText(template, number) {
  const text = String(template || "请 {number} 到窗口办理").trim();
  return text.includes("{number}") ? text.replaceAll("{number}", number) : `${text} ${number}`;
}

function renderMyTicket(state, ticket) {
  if (!ticket) {
    elements.myTicketBox.hidden = true;
    return;
  }

  elements.myTicketBox.hidden = false;
  elements.myTicket.textContent = ticket.number;

  if (ticket.status === "waiting") {
    const position = getTicketPosition(state, ticket.id);
    elements.myPosition.textContent = position > 1
      ? `前面还有 ${position - 1} 人等待`
      : "快到您了，请注意叫号";
    return;
  }

  if (ticket.status === "called") {
    elements.myPosition.textContent = "已叫到您的号码，请前往办理";
    return;
  }

  elements.myPosition.textContent = "该号码已跳过，请重新取号";
}

function renderWaitingNumbers(waiting) {
  elements.waitingNumbers.innerHTML = "";

  if (waiting.length === 0) {
    elements.waitingNumbers.innerHTML = `<p class="empty-text">暂无等待号码</p>`;
    return;
  }

  waiting.slice(0, 18).forEach((ticket) => {
    const item = document.createElement("span");
    item.textContent = ticket.number;
    elements.waitingNumbers.appendChild(item);
  });
}
