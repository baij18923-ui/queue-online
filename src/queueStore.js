import { ADMIN_PASSWORD } from "./config.js";
import { isSupabaseConfigured, isUsingLocalTestStore, supabase } from "./supabaseClient.js";

const ADMIN_SESSION_KEY = "online-queue-admin-ok";
const USER_TICKET_KEY = "online-queue-my-ticket-id";
const LOCAL_STATE_KEY = "online-queue-local-state";
const LOCAL_CHANNEL_NAME = "online-queue-local-sync";
const DEFAULT_CALL_TEXT = "请 {number} 到窗口办理";

const localListeners = new Set();
const localChannel = typeof BroadcastChannel !== "undefined"
  ? new BroadcastChannel(LOCAL_CHANNEL_NAME)
  : null;

function defaultState(setupError = false) {
  return {
    settings: {
      id: 1,
      prefix: "A",
      digits: 3,
      nextNumber: 1,
      callText: DEFAULT_CALL_TEXT,
      isOpen: true,
      currentCallId: "",
      lastTicketId: ""
    },
    tickets: [],
    currentCallId: "",
    lastTicketId: "",
    history: [],
    setupError,
    isLocalTestStore: isUsingLocalTestStore
  };
}

export async function loadState() {
  if (!isSupabaseConfigured) return loadLocalState();

  const [{ data: settings, error: settingsError }, { data: tickets, error: ticketsError }, { data: history, error: historyError }] = await Promise.all([
    supabase.from("queue_settings").select("*").eq("id", 1).single(),
    supabase.from("queue_tickets").select("*").order("created_at", { ascending: true }),
    supabase.from("queue_logs").select("*").order("created_at", { ascending: false }).limit(80)
  ]);

  if (settingsError || ticketsError || historyError) {
    return { ...defaultState(true), isLocalTestStore: false };
  }

  const mappedSettings = mapSettings(settings);
  return {
    settings: mappedSettings,
    tickets: (tickets || []).map(mapTicket),
    currentCallId: mappedSettings.currentCallId,
    lastTicketId: mappedSettings.lastTicketId,
    history: (history || []).map(mapHistory),
    setupError: false,
    isLocalTestStore: false
  };
}

export function subscribeToQueue(callback) {
  let active = true;
  let refreshTimer = null;

  async function refresh() {
    if (!active) return;
    callback(await loadState());
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, 80);
  }

  refresh();

  if (!isSupabaseConfigured) {
    const listener = () => scheduleRefresh();
    localListeners.add(callback);
    window.addEventListener("storage", listener);
    localChannel?.addEventListener("message", listener);
    return () => {
      active = false;
      clearTimeout(refreshTimer);
      localListeners.delete(callback);
      window.removeEventListener("storage", listener);
      localChannel?.removeEventListener("message", listener);
    };
  }

  const channel = supabase
    .channel("queue-system-db-changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "queue_settings" }, scheduleRefresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "queue_tickets" }, scheduleRefresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "queue_logs" }, scheduleRefresh)
    .subscribe();

  return () => {
    active = false;
    clearTimeout(refreshTimer);
    supabase.removeChannel(channel);
  };
}

export function isAdminLoggedIn() {
  return sessionStorage.getItem(ADMIN_SESSION_KEY) === "1";
}

export function loginAdmin(password) {
  if (password !== ADMIN_PASSWORD) return false;
  sessionStorage.setItem(ADMIN_SESSION_KEY, "1");
  return true;
}

export function getMyTicketId() {
  return localStorage.getItem(USER_TICKET_KEY) || "";
}

function setMyTicketId(ticketId) {
  localStorage.setItem(USER_TICKET_KEY, ticketId);
}

export async function takeTicket() {
  if (!isSupabaseConfigured) return takeLocalTicket();

  const { data, error } = await supabase.rpc("take_queue_ticket");
  if (error) return { ok: false, message: error.message || "取号失败。" };

  const ticket = mapTicket(Array.isArray(data) ? data[0] : data);
  setMyTicketId(ticket.id);
  return { ok: true, ticket };
}

export async function callNext() {
  if (!isSupabaseConfigured) return callNextLocal();

  const { data, error } = await supabase
    .from("queue_tickets")
    .select("*")
    .eq("status", "waiting")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) return { ok: false, message: error.message };
  if (!data) return { ok: false, message: "当前没有等待号码。" };

  return callTicket(data.id);
}

export async function callTicket(ticketId) {
  if (!isSupabaseConfigured) return callLocalTicket(ticketId);

  const { data, error } = await supabase.rpc("call_queue_ticket", { ticket_id: ticketId });
  if (error) return { ok: false, message: error.message || "叫号失败。" };
  return { ok: true, ticket: mapTicket(Array.isArray(data) ? data[0] : data) };
}

export async function recallCurrent() {
  if (!isSupabaseConfigured) return recallLocalCurrent();

  const state = await loadState();
  const ticket = getCurrentCall(state);
  if (!ticket) return { ok: false, message: "当前还没有叫号。" };

  await addLog("重叫", ticket.number);
  return { ok: true, ticket };
}

export async function skipTicket(ticketId) {
  if (!isSupabaseConfigured) return skipLocalTicket(ticketId);

  const { data, error } = await supabase.rpc("skip_queue_ticket", { ticket_id: ticketId });
  if (error) return { ok: false, message: error.message || "跳过失败。" };
  return { ok: true, ticket: mapTicket(Array.isArray(data) ? data[0] : data) };
}

export async function clearWaiting() {
  if (!isSupabaseConfigured) return clearLocalWaiting();

  const { error } = await supabase.rpc("clear_waiting_queue");
  if (error) return { ok: false, message: error.message || "清空失败。" };
  return { ok: true };
}

export async function resetAll() {
  if (!isSupabaseConfigured) return resetLocalAll();

  const { error } = await supabase.rpc("reset_queue_system");
  localStorage.removeItem(USER_TICKET_KEY);
  if (error) return { ok: false, message: error.message || "重置失败。" };
  return { ok: true };
}

export async function updateSettings(settings) {
  if (!isSupabaseConfigured) return updateLocalSettings(settings);

  const payload = {
    prefix: String(settings.prefix || "").trim().toUpperCase(),
    digits: clamp(Number(settings.digits || 3), 1, 6),
    next_number: Math.max(1, Number(settings.nextNumber || 1)),
    call_text: String(settings.callText || DEFAULT_CALL_TEXT).trim(),
    updated_at: new Date().toISOString()
  };

  const { error } = await supabase.from("queue_settings").update(payload).eq("id", 1);
  if (error) return { ok: false, message: error.message || "保存设置失败。" };

  await addLog("修改设置", "号码规则已更新");
  return { ok: true };
}

export async function toggleService() {
  if (!isSupabaseConfigured) return toggleLocalService();

  const state = await loadState();
  const nextOpen = !state.settings.isOpen;
  const { error } = await supabase
    .from("queue_settings")
    .update({ is_open: nextOpen, updated_at: new Date().toISOString() })
    .eq("id", 1);

  if (error) return { ok: false, message: error.message || "切换状态失败。" };
  await addLog(nextOpen ? "开放取号" : "暂停取号", "");
  return { ok: true, isOpen: nextOpen };
}

export function getWaitingTickets(state) {
  return state.tickets.filter((ticket) => ticket.status === "waiting");
}

export function getCurrentCall(state) {
  return state.tickets.find((ticket) => ticket.id === state.currentCallId) || null;
}

export function getLastTicket(state) {
  return state.tickets.find((ticket) => ticket.id === state.lastTicketId) || null;
}

export function getTicketPosition(state, ticketId) {
  const waiting = getWaitingTickets(state);
  const index = waiting.findIndex((ticket) => ticket.id === ticketId);
  return index >= 0 ? index + 1 : 0;
}

export async function exportState() {
  return {
    exportedAt: timestamp(),
    ...(await loadState())
  };
}

async function addLog(action, detail) {
  if (!isSupabaseConfigured) return;
  await supabase.from("queue_logs").insert({ action, detail });
}

function loadLocalState() {
  try {
    const stored = JSON.parse(localStorage.getItem(LOCAL_STATE_KEY) || "");
    if (stored?.settings && Array.isArray(stored.tickets)) {
      return normalizeLocalState(stored);
    }
  } catch {
    // Fall through to a fresh local state.
  }
  const fresh = defaultState(false);
  saveLocalState(fresh, false);
  return fresh;
}

function saveLocalState(state, notify = true) {
  const normalized = normalizeLocalState(state);
  localStorage.setItem(LOCAL_STATE_KEY, JSON.stringify(normalized));
  if (notify) publishLocalState();
  return normalized;
}

function normalizeLocalState(state) {
  const settings = {
    ...defaultState(false).settings,
    ...(state.settings || {})
  };
  settings.currentCallId = settings.currentCallId || state.currentCallId || "";
  settings.lastTicketId = settings.lastTicketId || state.lastTicketId || "";

  return {
    ...defaultState(false),
    ...state,
    settings,
    tickets: Array.isArray(state.tickets) ? state.tickets : [],
    currentCallId: settings.currentCallId,
    lastTicketId: settings.lastTicketId,
    history: Array.isArray(state.history) ? state.history : [],
    setupError: false,
    isLocalTestStore: true
  };
}

function publishLocalState() {
  queueMicrotask(async () => {
    const state = await loadState();
    localListeners.forEach((listener) => listener(state));
  });
  localChannel?.postMessage({ type: "queue-updated", at: Date.now() });
}

function takeLocalTicket() {
  const state = loadLocalState();
  if (!state.settings.isOpen) {
    return { ok: false, message: "当前暂停取号，请稍后再试。" };
  }

  const ticket = {
    id: createId(),
    number: state.settings.prefix + String(state.settings.nextNumber).padStart(state.settings.digits, "0"),
    status: "waiting",
    createdAt: timestamp(),
    calledAt: "",
    skippedAt: ""
  };

  state.tickets.push(ticket);
  state.settings.nextNumber += 1;
  state.settings.lastTicketId = ticket.id;
  state.lastTicketId = ticket.id;
  state.history.unshift(createLog("取号", ticket.number));
  saveLocalState(state);
  setMyTicketId(ticket.id);
  return { ok: true, ticket };
}

function callNextLocal() {
  const state = loadLocalState();
  const ticket = getWaitingTickets(state)[0];
  if (!ticket) return { ok: false, message: "当前没有等待号码。" };
  return callLocalTicket(ticket.id);
}

function callLocalTicket(ticketId) {
  const state = loadLocalState();
  const ticket = state.tickets.find((item) => item.id === ticketId);
  if (!ticket) return { ok: false, message: "找不到该号码。" };

  ticket.status = "called";
  ticket.calledAt = timestamp();
  state.settings.currentCallId = ticket.id;
  state.currentCallId = ticket.id;
  state.history.unshift(createLog("叫号", ticket.number));
  saveLocalState(state);
  return { ok: true, ticket };
}

function recallLocalCurrent() {
  const state = loadLocalState();
  const ticket = getCurrentCall(state);
  if (!ticket) return { ok: false, message: "当前还没有叫号。" };

  state.history.unshift(createLog("重叫", ticket.number));
  saveLocalState(state);
  return { ok: true, ticket };
}

function skipLocalTicket(ticketId) {
  const state = loadLocalState();
  const ticket = state.tickets.find((item) => item.id === ticketId);
  if (!ticket) return { ok: false, message: "找不到该号码。" };

  ticket.status = "skipped";
  ticket.skippedAt = timestamp();
  state.history.unshift(createLog("跳过", ticket.number));
  saveLocalState(state);
  return { ok: true, ticket };
}

function clearLocalWaiting() {
  const state = loadLocalState();
  let skippedCount = 0;
  state.tickets.forEach((ticket) => {
    if (ticket.status === "waiting") {
      ticket.status = "skipped";
      ticket.skippedAt = timestamp();
      skippedCount += 1;
    }
  });
  state.history.unshift(createLog("清空等待", `${skippedCount} 个号码`));
  saveLocalState(state);
  return { ok: true };
}

function resetLocalAll() {
  localStorage.removeItem(USER_TICKET_KEY);
  const state = defaultState(false);
  state.history.unshift(createLog("全部重置", "系统已重置"));
  saveLocalState(state);
  return { ok: true };
}

function updateLocalSettings(settings) {
  const state = loadLocalState();
  state.settings.prefix = String(settings.prefix || "A").trim().toUpperCase();
  state.settings.digits = clamp(Number(settings.digits || 3), 1, 6);
  state.settings.nextNumber = Math.max(1, Number(settings.nextNumber || 1));
  state.settings.callText = String(settings.callText || DEFAULT_CALL_TEXT).trim();
  state.history.unshift(createLog("修改设置", "号码规则已更新"));
  saveLocalState(state);
  return { ok: true };
}

function toggleLocalService() {
  const state = loadLocalState();
  state.settings.isOpen = !state.settings.isOpen;
  state.history.unshift(createLog(state.settings.isOpen ? "开放取号" : "暂停取号", ""));
  saveLocalState(state);
  return { ok: true, isOpen: state.settings.isOpen };
}

function createLog(action, detail) {
  return {
    id: createId(),
    action,
    detail,
    time: timestamp()
  };
}

function mapSettings(row) {
  return {
    id: row.id,
    prefix: row.prefix || "",
    digits: row.digits || 3,
    nextNumber: row.next_number || 1,
    callText: row.call_text || DEFAULT_CALL_TEXT,
    isOpen: Boolean(row.is_open),
    currentCallId: row.current_call_id || "",
    lastTicketId: row.last_ticket_id || ""
  };
}

function mapTicket(row) {
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    createdAt: toLocalTime(row.created_at),
    calledAt: row.called_at ? toLocalTime(row.called_at) : "",
    skippedAt: row.skipped_at ? toLocalTime(row.skipped_at) : ""
  };
}

function mapHistory(row) {
  return {
    id: row.id,
    action: row.action,
    detail: row.detail,
    time: toLocalTime(row.created_at)
  };
}

function toLocalTime(value) {
  if (!value) return "";
  const date = new Date(value);
  const pad = (part) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function timestamp() {
  return toLocalTime(new Date().toISOString());
}

function createId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
