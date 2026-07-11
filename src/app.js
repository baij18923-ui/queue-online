
(function () {
  'use strict';

  const cfg = window.METEOR_CONFIG || {};
  const STATUS_LABELS = {
    waiting: '等待中',
    in_progress: '制作中',
    done: '已完成',
    cancelled: '已作废'
  };
  const ADMIN_SESSION_KEY = 'meteor_design_queue_admin_authed';

  let client = null;
  let appMode = 'user';
  let designers = [];
  let tickets = [];
  let manualMonthStats = [];
  let channel = null;

  function requireConfig() {
    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
      showFatal('Supabase 配置为空，请先填写 src/config.js。');
      return false;
    }
    if (!window.supabase) {
      showFatal('Supabase JS 加载失败，请检查网络或 CDN。');
      return false;
    }
    client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    return true;
  }

  function showFatal(message) {
    document.body.insertAdjacentHTML('afterbegin', `<div class="page"><div class="error">${message}</div></div>`);
  }

  function dayKey(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function monthKey(date = new Date()) {
    return dayKey(date).slice(0, 7);
  }

  function todayTickets() {
    const today = dayKey();
    return tickets
      .filter(t => t.date_key === today)
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  }

  function monthTickets() {
    const month = monthKey();
    return tickets
      .filter(t => t.month_key === month)
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  }

  function calcStats(list) {
    const total = list.length;
    const waiting = list.filter(t => t.status === 'waiting').length;
    const inProgress = list.filter(t => t.status === 'in_progress').length;
    const done = list.filter(t => t.status === 'done').length;
    const cancelled = list.filter(t => t.status === 'cancelled').length;
    const active = waiting + inProgress;
    const percent = total ? Math.round(done / total * 100) : 0;
    return { total, waiting, inProgress, done, cancelled, active, percent };
  }

  function designerTickets(designerId, scope = 'today') {
    const list = scope === 'month' ? monthTickets() : todayTickets();
    return list.filter(t => t.designer_id === designerId);
  }

  function getDesigner(id) {
    return designers.find(d => d.id === id) || designers[0];
  }

  function statusForDesigner(designer, stats) {
    if (!designer.is_accepting) return { label: '暂停接单', cls: 'pause', desc: '该设计师暂时不接新任务，请选择另一位设计师。' };
    if (stats.active >= 6) return { label: '忙碌', cls: 'busy', desc: '当前任务较多，建议优先考虑另一位设计师。' };
    if (stats.active > 0) return { label: '可安排', cls: 'warn', desc: '当前已有任务，但仍可继续安排新设计。' };
    return { label: '空闲', cls: '', desc: '当前压力较低，可优先安排新任务。' };
  }

  async function loadData() {
    if (!client) return;
    const [
      { data: designerData, error: designerError },
      { data: ticketData, error: ticketError },
      { data: monthStatsData, error: monthStatsError }
    ] = await Promise.all([
      client.from('meteor_designers').select('*').order('sort_order'),
      client.from('meteor_design_tickets').select('*').order('created_at', { ascending: true }).limit(1000),
      client.from('meteor_month_manual_stats').select('*').eq('month_key', monthKey())
    ]);
    if (designerError) throw designerError;
    if (ticketError) throw ticketError;
    if (monthStatsError) throw monthStatsError;
    designers = designerData || [];
    tickets = ticketData || [];
    manualMonthStats = monthStatsData || [];
    render();
  }

  function subscribeRealtime() {
    if (!client) return;
    if (channel) client.removeChannel(channel);
    channel = client
      .channel('meteor-design-queue-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meteor_designers' }, loadData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meteor_design_tickets' }, loadData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meteor_month_manual_stats' }, loadData)
      .subscribe();
  }

  async function rpc(name, args = {}) {
    const { data, error } = await client.rpc(name, args);
    if (error) {
      showToast(error.message || '操作失败');
      throw error;
    }
    await loadData();
    return data;
  }

  async function takeTicket(designerId) {
    await rpc('meteor_take_ticket', { p_designer_id: designerId });
    const designer = getDesigner(designerId);
    showToast(`取号成功，负责设计师：${designer.name}`);
  }

  async function callNext(designerId) {
    await rpc('meteor_call_next_ticket', { p_designer_id: designerId });
    showToast('已叫下一个');
  }

  async function updateStatus(ticketId, status) {
    await rpc('meteor_update_ticket_status', { p_ticket_id: ticketId, p_status: status });
    showToast(`状态已更新为 ${STATUS_LABELS[status]}`);
  }

  async function transferTicket(ticketId, designerId) {
    await rpc('meteor_transfer_ticket', { p_ticket_id: ticketId, p_designer_id: designerId });
    const designer = getDesigner(designerId);
    showToast(`已转给 ${designer.name}`);
  }

  async function setAccepting(designerId, accepting) {
    await rpc('meteor_set_designer_accepting', { p_designer_id: designerId, p_is_accepting: accepting });
    showToast(accepting ? '已恢复接单' : '已暂停接单');
  }

  async function resetNumber() {
    if (!confirm('确定把今日下一个号码重置为 01号 吗？已有号码不会删除。')) return;
    await rpc('meteor_reset_today_number');
    showToast('今日号码已重置');
  }

  async function clearToday() {
    if (!confirm('确定清空今日测试数据吗？这只适合测试使用。')) return;
    await rpc('meteor_clear_today_data');
    showToast('今日测试数据已清空');
  }

  async function saveNames() {
    const a = document.getElementById('designerNameA').value.trim() || '设计A';
    const b = document.getElementById('designerNameB').value.trim() || '设计B';
    await rpc('meteor_update_designer_names', { p_name_a: a, p_name_b: b });
    showToast('设计师名称已保存');
  }


  async function saveManualMonthStats() {
    const rows = Array.from(document.querySelectorAll('[data-month-row]'));
    if (!rows.length) return;

    for (const row of rows) {
      const designerId = row.dataset.monthRow;
      const value = field => Number(row.querySelector(`[data-month-field="${field}"]`)?.value || 0);
      await rpc('meteor_upsert_month_stats', {
        p_designer_id: designerId,
        p_month_key: monthKey(),
        p_total: value('total'),
        p_waiting: value('waiting'),
        p_in_progress: value('in_progress'),
        p_done: value('done'),
        p_cancelled: value('cancelled')
      });
    }

    showToast('本月统计已保存，完成率已自动计算');
  }

  function getManualMonthStat(designerId) {
    const saved = manualMonthStats.find(item => item.designer_id === designerId && item.month_key === monthKey());
    if (saved) {
      const total = Number(saved.total_count || 0);
      const waiting = Number(saved.waiting_count || 0);
      const inProgress = Number(saved.in_progress_count || 0);
      const done = Number(saved.done_count || 0);
      const cancelled = Number(saved.cancelled_count || 0);
      const percent = total ? Math.round(done / total * 100) : 0;
      return { total, waiting, inProgress, done, cancelled, percent, manual: true };
    }

    const auto = calcStats(designerTickets(designerId, 'month'));
    return { ...auto, manual: false };
  }

  function render() {
    if (appMode === 'admin') renderAdmin();
    else renderUser();
  }

  function renderUser() {
    const activeTotal = document.getElementById('activeTotal');
    const list = todayTickets();
    const active = list.filter(t => t.status === 'waiting' || t.status === 'in_progress');
    if (activeTotal) activeTotal.textContent = active.length;

    const cards = document.getElementById('designerCards');
    if (!cards) return;

    cards.innerHTML = designers.map((designer, index) => {
      const dList = designerTickets(designer.id, 'today');
      const stats = calcStats(dList);
      const meta = statusForDesigner(designer, stats);
      const pressure = Math.min(100, Math.round((stats.active / 8) * 100));
      return `
        <article class="card">
          <div class="card-head">
            <div class="identity">
              <div class="avatar">${index === 0 ? 'A' : 'B'}</div>
              <div>
                <div class="name">${designer.name}</div>
                <p class="small">今日完成 ${stats.done} 单</p>
              </div>
            </div>
            <span class="badge ${meta.cls}">${meta.label}</span>
          </div>

          <div class="work-count">
            <strong>${stats.active}</strong>
            <span>个设计待处理</span>
          </div>

          <div class="pressure"><span style="width:${pressure}%"></span></div>
          <p class="desc">${meta.desc}</p>
          <button class="inline-take" data-take="${designer.id}" ${designer.is_accepting ? '' : 'disabled'}>
            ${designer.is_accepting ? `选择${designer.name}取号` : '暂停接单中'}
          </button>
        </article>
      `;
    }).join('');

    cards.querySelectorAll('[data-take]').forEach(btn => {
      btn.addEventListener('click', () => takeTicket(btn.dataset.take));
    });
  }

  function renderAdmin() {
    const loginBox = document.getElementById('loginBox');
    const adminPanel = document.getElementById('adminPanel');
    const authed = sessionStorage.getItem(ADMIN_SESSION_KEY) === 'yes';
    if (loginBox) loginBox.style.display = authed ? 'none' : 'block';
    if (adminPanel) adminPanel.style.display = authed ? 'block' : 'none';
    if (!authed) return;

    const today = todayTickets();
    const stats = calcStats(today);
    const adminStats = document.getElementById('adminStats');
    if (adminStats) {
      adminStats.innerHTML = [
        ['今日取号', stats.total],
        ['等待中', stats.waiting],
        ['制作中', stats.inProgress],
        ['已完成', stats.done]
      ].map(([label, value]) => `<div class="stat"><strong>${value}</strong><span>${label}</span></div>`).join('');
    }

    if (designers[0]) document.getElementById('designerNameA').value = designers[0].name;
    if (designers[1]) document.getElementById('designerNameB').value = designers[1].name;

    const panels = document.getElementById('adminDesignerPanels');
    if (panels) {
      panels.innerHTML = designers.map((designer, index) => {
        const dList = designerTickets(designer.id, 'today');
        const stats = calcStats(dList);
        const monthStats = calcStats(designerTickets(designer.id, 'month'));
        const meta = statusForDesigner(designer, stats);
        const other = designers.find(d => d.id !== designer.id);
        const working = dList.filter(t => t.status === 'in_progress');
        const waiting = dList.filter(t => t.status === 'waiting');
        return `
          <article class="card admin-designer">
            <div class="admin-designer-head">
              <div>
                <div class="admin-designer-title">${designer.name}</div>
                <p class="small">今日待处理 ${stats.active} 单，今日完成 ${stats.done} 单，本月接单 ${monthStats.total} 单</p>
              </div>
              <div class="admin-actions">
                <span class="badge ${meta.cls}">${meta.label}</span>
                <button class="btn-main" data-call="${designer.id}">叫下一个</button>
                <button class="${designer.is_accepting ? 'btn-warn' : 'btn-main'}" data-accept="${designer.id}" data-value="${designer.is_accepting ? 'false' : 'true'}">
                  ${designer.is_accepting ? '暂停接单' : '恢复接单'}
                </button>
              </div>
            </div>

            <div class="admin-columns">
              <div class="ticket-box">
                <h3>制作中</h3>
                ${renderTicketList(working, other)}
              </div>
              <div class="ticket-box">
                <h3>等待中</h3>
                ${renderTicketList(waiting, other)}
              </div>
            </div>
          </article>
        `;
      }).join('');

      panels.querySelectorAll('[data-call]').forEach(btn => btn.addEventListener('click', () => callNext(btn.dataset.call)));
      panels.querySelectorAll('[data-accept]').forEach(btn => btn.addEventListener('click', () => setAccepting(btn.dataset.accept, btn.dataset.value === 'true')));
      panels.querySelectorAll('[data-start]').forEach(btn => btn.addEventListener('click', () => updateStatus(btn.dataset.start, 'in_progress')));
      panels.querySelectorAll('[data-done]').forEach(btn => btn.addEventListener('click', () => updateStatus(btn.dataset.done, 'done')));
      panels.querySelectorAll('[data-cancel]').forEach(btn => btn.addEventListener('click', () => updateStatus(btn.dataset.cancel, 'cancelled')));
      panels.querySelectorAll('[data-wait]').forEach(btn => btn.addEventListener('click', () => updateStatus(btn.dataset.wait, 'waiting')));
      panels.querySelectorAll('[data-transfer]').forEach(btn => btn.addEventListener('click', () => transferTicket(btn.dataset.transfer, btn.dataset.to)));
    }

    renderMonthStats();
  }

  function renderTicketList(list, otherDesigner) {
    if (!list.length) return '<p class="empty">暂无号码</p>';
    return list.map(t => {
      const startBtn = t.status === 'waiting' ? `<button class="btn-main" data-start="${t.id}">叫号</button>` : '';
      const waitBtn = t.status === 'in_progress' ? `<button class="btn-warn" data-wait="${t.id}">改回等待</button>` : '';
      const doneBtn = t.status !== 'done' ? `<button class="btn-light" data-done="${t.id}">完成</button>` : '';
      const cancelBtn = t.status !== 'cancelled' ? `<button class="btn-danger" data-cancel="${t.id}">作废</button>` : '';
      const transferBtn = otherDesigner ? `<button class="btn-muted" data-transfer="${t.id}" data-to="${otherDesigner.id}">转给${otherDesigner.name}</button>` : '';
      const time = new Date(t.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
      return `
        <div class="ticket">
          <div class="ticket-number">${t.number}</div>
          <div>
            <span class="status ${t.status}">${STATUS_LABELS[t.status]}</span>
            <p class="small">取号：${time}</p>
          </div>
          <div class="ticket-actions">${startBtn}${waitBtn}${doneBtn}${cancelBtn}${transferBtn}</div>
        </div>
      `;
    }).join('');
  }

  function renderMonthStats() {
    const el = document.getElementById('monthStats');
    if (!el) return;
    const rows = designers.map(d => {
      const s = getManualMonthStat(d.id);
      return `<tr data-month-row="${d.id}">
        <td><strong>${d.name}</strong></td>
        <td><input class="month-input" type="number" min="0" data-month-field="total" value="${s.total}"></td>
        <td><input class="month-input" type="number" min="0" data-month-field="waiting" value="${s.waiting}"></td>
        <td><input class="month-input" type="number" min="0" data-month-field="in_progress" value="${s.inProgress}"></td>
        <td><input class="month-input" type="number" min="0" data-month-field="done" value="${s.done}"></td>
        <td><input class="month-input" type="number" min="0" data-month-field="cancelled" value="${s.cancelled}"></td>
        <td><strong data-month-rate>${s.percent}%</strong></td>
      </tr>`;
    }).join('');
    el.innerHTML = `<table class="table"><thead><tr><th>设计师</th><th>本月接单</th><th>等待中</th><th>制作中</th><th>已完成</th><th>已作废</th><th>完成率</th></tr></thead><tbody>${rows}</tbody></table>`;

    el.querySelectorAll('.month-input').forEach(input => {
      input.addEventListener('input', () => {
        const row = input.closest('[data-month-row]');
        const total = Number(row.querySelector('[data-month-field="total"]').value || 0);
        const done = Number(row.querySelector('[data-month-field="done"]').value || 0);
        const rate = total ? Math.round(done / total * 100) : 0;
        row.querySelector('[data-month-rate]').textContent = `${rate}%`;
      });
    });
  }

  function bindAdminEvents() {
    const loginBtn = document.getElementById('loginBtn');
    const input = document.getElementById('passwordInput');
    if (loginBtn) {
      loginBtn.addEventListener('click', () => {
        const msg = document.getElementById('loginMsg');
        if (input.value === String(cfg.ADMIN_PASSWORD || '123456')) {
          sessionStorage.setItem(ADMIN_SESSION_KEY, 'yes');
          if (msg) msg.textContent = '';
          renderAdmin();
        } else if (msg) {
          msg.textContent = '密码错误，请重试。';
        }
      });
      input && input.addEventListener('keydown', e => { if (e.key === 'Enter') loginBtn.click(); });
    }
    document.getElementById('logoutBtn')?.addEventListener('click', () => {
      sessionStorage.removeItem(ADMIN_SESSION_KEY);
      renderAdmin();
    });
    document.getElementById('refreshBtn')?.addEventListener('click', loadData);
    document.getElementById('resetNumberBtn')?.addEventListener('click', resetNumber);
    document.getElementById('clearTodayBtn')?.addEventListener('click', clearToday);
    document.getElementById('saveNamesBtn')?.addEventListener('click', saveNames);
    document.getElementById('saveMonthStatsBtn')?.addEventListener('click', saveManualMonthStats);
  }

  function showToast(text) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = text;
    toast.classList.add('show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove('show'), 1800);
  }

  async function start(mode) {
    appMode = mode;
    if (!requireConfig()) return;
    if (mode === 'admin') bindAdminEvents();
    try {
      await loadData();
      subscribeRealtime();
    } catch (error) {
      console.error(error);
      showFatal(`加载失败：${error.message || error}`);
    }
  }

  window.MeteorApp = {
    startUser() { start('user'); },
    startAdmin() { start('admin'); }
  };
})();
