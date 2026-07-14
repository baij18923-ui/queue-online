
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
  const OWNED_TICKETS_KEY = 'meteor_design_queue_owned_tickets';
  const TOAST_DURATION = 5000;

  let client = null;
  let appMode = 'user';
  let designers = [];
  let tickets = [];
  let manualMonthStats = [];
  let channel = null;
  let toastQueue = [];
  let toastBusy = false;
  let audioContext = null;
  let audioReady = false;

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


  function getOwnedTicketStates() {
    try {
      const parsed = JSON.parse(localStorage.getItem(OWNED_TICKETS_KEY) || '[]');
      if (!Array.isArray(parsed)) return [];
      return parsed.map(item => {
        if (typeof item === 'string') return { id: item, status: null, designer_id: null, number: '' };
        return item && item.id ? item : null;
      }).filter(Boolean);
    } catch (error) {
      return [];
    }
  }

  function saveOwnedTicketStates(states) {
    try {
      localStorage.setItem(OWNED_TICKETS_KEY, JSON.stringify(states.slice(-100)));
    } catch (error) {
      console.warn('保存用户号码失败', error);
    }
  }

  function rememberOwnedTicket(ticket) {
    if (!ticket || !ticket.id) return;
    const states = getOwnedTicketStates();
    const next = states.filter(item => item.id !== ticket.id);
    next.push({
      id: ticket.id,
      status: ticket.status || 'waiting',
      designer_id: ticket.designer_id || null,
      number: ticket.number || ''
    });
    saveOwnedTicketStates(next);
  }

  function normalizeRpcTicket(data) {
    if (Array.isArray(data)) return data[0] || null;
    return data || null;
  }

  function getAudioContext() {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return null;
      if (!audioContext) {
        audioContext = new AudioContextClass({ latencyHint: 'interactive' });
      }
      return audioContext;
    } catch (error) {
      return null;
    }
  }

  function unlockAudio() {
    const audio = getAudioContext();
    if (!audio) return;

    const resumePromise = audio.state === 'suspended' ? audio.resume() : Promise.resolve();
    resumePromise.then(() => {
      if (audioReady) return;
      const buffer = audio.createBuffer(1, 1, 22050);
      const source = audio.createBufferSource();
      source.buffer = buffer;
      source.connect(audio.destination);
      source.start(0);
      source.stop(0);
      audioReady = true;
    }).catch(() => {
      // 某些浏览器需要用户继续点击后才能真正解锁声音。
    });
  }

  function installAudioUnlock() {
    ['pointerdown', 'touchstart', 'keydown'].forEach(eventName => {
      document.addEventListener(eventName, unlockAudio, { passive: true });
    });
  }

  function playNoticeSound() {
    try {
      const audio = getAudioContext();
      if (!audio) return;
      if (audio.state === 'suspended') {
        audio.resume().catch(() => {});
      }
      const now = audio.currentTime + 0.01;
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(880, now);
      oscillator.connect(gain);
      gain.connect(audio.destination);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.08, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
      oscillator.start(now);
      oscillator.stop(now + 0.24);
    } catch (error) {
      // 浏览器可能在用户尚未点击页面时禁止声音，不影响通知栏。
    }
  }

  function notifyOwnedTicketChanges(nextTickets) {
    if (appMode !== 'user') return;
    const states = getOwnedTicketStates();
    if (!states.length) return;

    const ticketMap = new Map(nextTickets.map(ticket => [ticket.id, ticket]));
    const updatedStates = states.map(saved => {
      const current = ticketMap.get(saved.id);
      if (!current) return saved;

      const designer = designers.find(item => item.id === current.designer_id);
      const designerName = designer ? designer.name : '设计师';
      const number = current.number || saved.number || '您的号码';

      if (saved.designer_id && saved.designer_id !== current.designer_id) {
        showToast(`${number} 已转单\n现负责设计师：${designerName}`, 'info', true);
      } else if (saved.status && saved.status !== current.status) {
        const messages = {
          waiting: `${number} 已返回等待\n负责设计师：${designerName}`,
          in_progress: `${number} 已开始制作\n负责设计师：${designerName}`,
          done: `${number} 已完成\n请联系 ${designerName} 确认文件`,
          cancelled: `${number} 已作废\n如有疑问，请联系 ${designerName}`
        };
        showToast(messages[current.status] || `${number} 状态已更新`, current.status === 'cancelled' ? 'danger' : 'success', true);
      }

      return {
        id: current.id,
        status: current.status,
        designer_id: current.designer_id,
        number: current.number
      };
    });

    saveOwnedTicketStates(updatedStates);
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
    notifyOwnedTicketChanges(tickets);
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
    const result = await rpc('meteor_take_ticket', { p_designer_id: designerId });
    const ticket = normalizeRpcTicket(result);
    const designer = getDesigner(designerId);
    if (ticket) rememberOwnedTicket(ticket);
    showToast(`取号成功${ticket?.number ? `：${ticket.number}` : ''}\n负责设计师：${designer.name}`, 'success', true);
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

  async function clearAllData() {
    if (!confirm('确定清空全部数据吗？会删除所有号码、本月统计和历史日志，并重置今日号码。')) return;
    await rpc('meteor_clear_all_data');
    localStorage.removeItem(OWNED_TICKETS_KEY);
    showToast('全部数据已清空，可重新开始', 'success');
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

  function getAutoMonthStat(designerId) {
    return calcStats(designerTickets(designerId, 'month'));
  }

  function getMergedMonthStat(designerId) {
    const auto = getAutoMonthStat(designerId);
    const saved = manualMonthStats.find(item => item.designer_id === designerId && item.month_key === monthKey());
    if (!saved) {
      return { ...auto, manual: false };
    }

    const base = {
      total: Number(saved.total_count || 0),
      waiting: Number(saved.waiting_count || 0),
      inProgress: Number(saved.in_progress_count || 0),
      done: Number(saved.done_count || 0),
      cancelled: Number(saved.cancelled_count || 0)
    };

    const snapshot = {
      total: Number(saved.auto_total_snapshot || 0),
      waiting: Number(saved.auto_waiting_snapshot || 0),
      inProgress: Number(saved.auto_in_progress_snapshot || 0),
      done: Number(saved.auto_done_snapshot || 0),
      cancelled: Number(saved.auto_cancelled_snapshot || 0)
    };

    const merged = {
      total: Math.max(0, base.total + (auto.total - snapshot.total)),
      waiting: Math.max(0, base.waiting + (auto.waiting - snapshot.waiting)),
      inProgress: Math.max(0, base.inProgress + (auto.inProgress - snapshot.inProgress)),
      done: Math.max(0, base.done + (auto.done - snapshot.done)),
      cancelled: Math.max(0, base.cancelled + (auto.cancelled - snapshot.cancelled))
    };

    const percent = merged.total ? Math.round(merged.done / merged.total * 100) : 0;
    return { ...merged, percent, manual: true };
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
        const monthStats = getMergedMonthStat(designer.id);
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
      const s = getMergedMonthStat(d.id);
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
    document.getElementById('clearAllBtn')?.addEventListener('click', clearAllData);
    document.getElementById('saveNamesBtn')?.addEventListener('click', saveNames);
    document.getElementById('saveMonthStatsBtn')?.addEventListener('click', saveManualMonthStats);
  }

  function showToast(text, type = 'info', sound = false) {
    toastQueue.push({ text, type, sound });
    runToastQueue();
  }

  function runToastQueue() {
    const toast = document.getElementById('toast');
    if (!toast || toastBusy || !toastQueue.length) return;

    toastBusy = true;
    const item = toastQueue.shift();
    toast.textContent = item.text;
    toast.dataset.type = item.type;
    toast.classList.add('show');
    if (item.sound) playNoticeSound();

    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => {
        toastBusy = false;
        runToastQueue();
      }, 220);
    }, TOAST_DURATION);
  }

  async function start(mode) {
    appMode = mode;
    installAudioUnlock();
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
