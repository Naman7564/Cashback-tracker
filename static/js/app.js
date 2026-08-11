/* Cashback Tracker — Dark Glassmorphism PWA */
// ponytail: vanilla JS, no TS compile step. Add TS build when team joins.

const API = '/api';
let currentPage = 'home';
let statusFilter = '', monthFilter = '', sourceFilter = '';
let allSources = [];
let calcTimer = null;
let txnDateRange = 'month'; // today|week|month|all
let expandedTxnId = null;
let todoDate = new Date().toISOString().split('T')[0];
let todoSourceData = null; // currently open source in record modal
let todoData = null; // cached todo list response

// ──── API Helper ────
async function api(path, opts = {}) {
    const url = path.startsWith('http') ? path : `${API}/${path}`;
    const config = { headers: { 'Content-Type': 'application/json' }, ...opts };
    if (opts.body && typeof opts.body === 'object') config.body = JSON.stringify(opts.body);
    const res = await fetch(url, config);
    if (!res.ok) {
        let msg = `API ${res.status}`;
        try { const data = await res.json(); msg = data.error || data.detail || JSON.stringify(data); } catch {}
        throw new Error(msg);
    }
    if (res.status === 204) return null;
    return res.json();
}

// ──── Navigation ────
function navigate(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    // ponytail: kill old stagger classes before display:block restarts CSS animations
    const target = document.getElementById(`page-${page}`);
    target.querySelectorAll('.stagger').forEach(el => el.classList.remove('stagger'));
    target.classList.add('active');
    currentPage = page;
    history.pushState({ page }, '', page === 'home' ? '/' : `/${page}/`);
    updateTabBar();
    haptic(10);
    if (page === 'home') loadDashboard();
    else if (page === 'todo') loadTodo();
    else if (page === 'cards') loadSources();
    else if (page === 'offers') loadOffers();
    else if (page === 'transactions') loadTransactions();
    window.scrollTo(0, 0);
}

function updateTabBar() {
    document.querySelectorAll('.nav-tab').forEach(tab => {
        const isActive = tab.dataset.page === currentPage;
        tab.classList.toggle('active', isActive);
    });
}

window.addEventListener('popstate', (e) => {
    const page = e.state?.page || pathToPage();
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const target = document.getElementById(`page-${page}`);
    target.querySelectorAll('.stagger').forEach(el => el.classList.remove('stagger'));
    target.classList.add('active');
    currentPage = page;
    updateTabBar();
});

function pathToPage() {
    const p = location.pathname.replace(/\//g, '');
    return ['todo', 'cards', 'offers', 'transactions'].includes(p) ? p : 'home';
}

// ──── Bottom Sheet System ────
function openSheet(id) {
    const sheet = document.getElementById(id);
    sheet.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    haptic(10);
    requestAnimationFrame(() => {
        sheet.querySelector('.sheet-backdrop').classList.add('open');
        sheet.querySelector('.sheet-panel').classList.add('open');
    });
    if (id === 'sheet-transaction' || id === 'sheet-offer') loadSourceOptions();
    if (id === 'sheet-transaction' && !document.getElementById('txn-edit-id').value) {
        document.getElementById('txn-date').value = new Date().toISOString().split('T')[0];
    }
}

function closeSheet(id) {
    const sheet = document.getElementById(id);
    sheet.querySelector('.sheet-backdrop').classList.remove('open');
    sheet.querySelector('.sheet-panel').classList.remove('open');
    setTimeout(() => {
        sheet.classList.add('hidden');
        document.body.style.overflow = '';
        const form = sheet.querySelector('form');
        if (form) form.reset();
        sheet.querySelectorAll('input[type=hidden]').forEach(h => h.value = '');
        const statusGroup = document.getElementById('txn-status-group');
        if (statusGroup) statusGroup.classList.add('hidden');
        const cashbackPreview = document.getElementById('cashback-preview');
        if (cashbackPreview) cashbackPreview.classList.add('hidden');
        const titleMap = { 'sheet-transaction': 'New Transaction', 'sheet-source': 'Add Source', 'sheet-offer': 'Add Offer', 'sheet-todo-record': 'Record Transaction' };
        const title = sheet.querySelector('h2');
        if (title && titleMap[id]) title.textContent = titleMap[id];
    }, 350);
}

// Drag-to-dismiss
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.sheet-handle').forEach(handle => {
        let startY = 0, currentY = 0;
        const panel = handle.closest('.sheet-panel');
        const sheet = handle.closest('[id^="sheet-"]');

        handle.addEventListener('touchstart', (e) => {
            startY = e.touches[0].clientY;
            panel.style.transition = 'none';
        });
        handle.addEventListener('touchmove', (e) => {
            currentY = e.touches[0].clientY - startY;
            if (currentY > 0) {
                panel.style.transform = `translateY(${currentY}px)`;
                e.preventDefault();
            }
        }, { passive: false });
        handle.addEventListener('touchend', () => {
            panel.style.transition = '';
            if (currentY > 100) {
                closeSheet(sheet.id);
            } else {
                panel.style.transform = '';
                panel.classList.add('open');
            }
            currentY = 0;
        });
    });
});

function submitForm(formId) {
    document.getElementById(formId).requestSubmit();
}

// ──── Number Counter Animation ────
function animateCounter(el, target, prefix = '₹') {
    const duration = 800;
    const start = performance.now();
    const from = 0;
    const to = parseFloat(target) || 0;

    function tick(now) {
        const elapsed = now - start;
        const progress = Math.min(elapsed / duration, 1);
        // ease-out cubic
        const eased = 1 - Math.pow(1 - progress, 3);
        const current = from + (to - from) * eased;
        el.textContent = `${prefix}${fmt(current)}`;
        if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
}

// ──── Dashboard ────
async function loadDashboard() {
    try {
        const data = await api('dashboard-stats/');
        // Animate numbers
        animateCounter(document.getElementById('stat-total'), data.total_cashback);
        const sourcesEl = document.getElementById('stat-sources');
        sourcesEl.textContent = data.active_sources;
        document.getElementById('stat-best').textContent = data.best_source || '—';

        const container = document.getElementById('recent-transactions');
        if (data.recent_transactions?.length) {
            container.innerHTML = data.recent_transactions.map((t, i) =>
                `${i > 0 ? '<div class="glass-sep ml-14"></div>' : ''}` + txnRow(t)
            ).join('');
        } else {
            container.innerHTML = emptyState('clipboard', 'No transactions yet', 'Tap + to add your first one');
        }
    } catch (e) {
        console.error('Dashboard load failed:', e);
    }
}

// ──── To Do ────
function buildDateSelector() {
    const container = document.getElementById('date-selector');
    if (!container) return;
    const today = new Date();
    let pills = '';
    for (let i = 0; i < 7; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const val = d.toISOString().split('T')[0];
        const label = i === 0 ? 'Today' : i === 1 ? 'Yesterday' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
        const active = val === todoDate;
        pills += `<button onclick="selectTodoDate('${val}')" class="flex-shrink-0 px-4 py-2 rounded-full text-[13px] font-semibold transition-all press ${active ? 'bg-indigo-500/80 text-white' : 'bg-white/5 text-slate-400 border border-white/5'}">${label}</button>`;
    }
    container.innerHTML = pills;
}

function selectTodoDate(dateStr) {
    todoDate = dateStr;
    buildDateSelector();
    loadTodo();
    haptic(10);
}

async function loadTodo() {
    buildDateSelector();
    try {
        const data = await api(`todo/?date=${todoDate}`);
        todoData = data;
        // Summary
        animateCounter(document.getElementById('todo-target'), data.total_target);
        animateCounter(document.getElementById('todo-earned'), data.total_earned);
        const pct = data.total_target > 0 ? Math.min(100, Math.round((data.total_earned / data.total_target) * 100)) : 0;
        document.getElementById('todo-progress').style.width = pct + '%';
        document.getElementById('todo-progress-label').textContent = data.total_target > 0 ? `${pct}% complete` : 'No targets set';

        // Source cards
        const container = document.getElementById('todo-source-list');
        if (!data.sources.length) {
            container.innerHTML = `<div class="glass rounded-3xl ring-1 ring-white/10">${emptyState('card', 'No payment sources', 'Add cards and UPI apps to start tracking')}</div>`;
            return;
        }
        container.innerHTML = data.sources.map((s, i) => todoSourceCard(s, i)).join('');
    } catch (e) {
        console.error('Todo load failed:', e);
    }
}

function todoSourceCard(item, idx) {
    const s = item.source;
    const typeLabel = { credit: 'Credit', debit: 'Debit', upi: 'UPI' }[s.source_type] || s.source_type;
    const hasTxns = item.transactions_today.length > 0;
    const earnedPct = item.daily_target > 0 ? Math.min(100, Math.round((item.earned_so_far / item.daily_target) * 100)) : 0;
    const checkmark = hasTxns
        ? `<div class="w-8 h-8 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center">
            <svg class="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>
           </div>`
        : `<div class="px-3 py-1.5 rounded-full bg-indigo-500/15 border border-indigo-500/20">
            <span class="text-[11px] font-semibold text-indigo-300">Record</span>
           </div>`;

    const miniTxns = item.transactions_today.length
        ? `<div class="mt-3 pt-3 border-t border-white/5 space-y-1.5">
            ${item.transactions_today.map(t => `
                <div class="flex justify-between text-[13px]">
                    <span class="text-slate-400">${esc(t.merchant)}</span>
                    <span class="text-emerald-400 font-medium">+₹${fmt(t.actual_cashback || t.expected_cashback)}</span>
                </div>
            `).join('')}
           </div>`
        : '';

    const targetLine = item.daily_target > 0
        ? `<div class="mt-2"><div class="w-full bg-white/5 rounded-full h-1.5 overflow-hidden"><div class="h-full bg-gradient-to-r from-indigo-500 to-violet-500 rounded-full" style="width:${earnedPct}%"></div></div>
           <p class="text-[11px] text-slate-500 mt-1">₹${fmt(item.earned_so_far)} / ₹${fmt(item.daily_target)}</p></div>`
        : '';

    return `
        <div class="stagger glass rounded-2xl p-4 ring-1 ring-white/10 press ${hasTxns ? 'opacity-80' : ''}" style="animation-delay:${idx * 50}ms" onclick="openTodoRecord(${s.id})">
            <div class="flex items-center justify-between">
                <div class="flex items-center gap-3">
                    <div class="w-2 h-2 rounded-full glow-dot flex-shrink-0" style="background:${s.color};box-shadow:0 0 8px ${s.color}99;"></div>
                    <div>
                        <p class="text-[16px] font-semibold text-white">${esc(s.name)}</p>
                        <p class="text-[13px] text-slate-400 mt-0.5">${esc(s.provider)} · ${typeLabel}</p>
                    </div>
                </div>
                ${checkmark}
            </div>
            ${targetLine}
            ${miniTxns}
        </div>`;
}

// ──── To Do Record Modal ────
function openTodoRecord(sourceId) {
    const item = todoData?.sources.find(s => s.source.id === sourceId);
    if (!item) return;
    todoSourceData = item;
    const s = item.source;

    document.getElementById('todo-record-source-name').textContent = s.name;
    document.getElementById('todo-record-dot').style.background = s.color;
    document.getElementById('todo-amount').value = '';
    document.getElementById('todo-merchant').value = '';
    document.getElementById('todo-cashback').value = '0';
    document.getElementById('todo-cashback-preview').classList.add('hidden');

    // UPI section
    const upiSection = document.getElementById('todo-upi-section');
    const cardSection = document.getElementById('todo-card-section');
    if (s.source_type === 'upi') {
        upiSection.classList.remove('hidden');
        cardSection.classList.add('hidden');
        renderUPINumbers(item.upi_numbers);
    } else {
        upiSection.classList.add('hidden');
        cardSection.classList.remove('hidden');
        const typeLabel = s.source_type === 'credit' ? 'Credit Card' : 'Debit Card';
        document.getElementById('todo-card-info').textContent = `${s.name} — ${typeLabel}${s.network ? ' · ' + s.network : ''}`;
    }

    document.getElementById('todo-add-upi-form').classList.add('hidden');
    openSheet('sheet-todo-record');
}

function renderUPINumbers(numbers) {
    const container = document.getElementById('todo-upi-list');
    if (!numbers.length) {
        container.innerHTML = '<p class="px-4 py-3 text-[13px] text-slate-500">No UPI numbers added yet</p>';
        return;
    }
    container.innerHTML = numbers.map(n => `
        <label class="flex items-center gap-3 px-4 py-3 press cursor-pointer border-b border-white/5 last:border-0">
            <div class="relative flex-shrink-0">
                <input type="checkbox" class="peer sr-only" value="${n.id}" data-upi-check>
                <div class="w-5 h-5 rounded border border-white/20 bg-white/5 peer-checked:bg-indigo-500 peer-checked:border-indigo-400 transition-all"></div>
                <svg class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-3 text-white opacity-0 peer-checked:opacity-100 transition-opacity" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>
            </div>
            <div>
                <p class="text-[14px] text-white">${esc(n.upi_id)}</p>
                ${n.label ? `<p class="text-[11px] text-slate-500">${esc(n.label)}</p>` : ''}
            </div>
        </label>
    `).join('');
}

function toggleAddUPI() {
    document.getElementById('todo-add-upi-form').classList.toggle('hidden');
    const input = document.getElementById('todo-new-upi');
    if (!document.getElementById('todo-add-upi-form').classList.contains('hidden')) input.focus();
}

async function addUPINumber() {
    const upiId = document.getElementById('todo-new-upi').value.trim();
    const label = document.getElementById('todo-new-upi-label').value.trim();
    if (!upiId || !todoSourceData) return;
    try {
        await api('upi-numbers/', { method: 'POST', body: {
            source: todoSourceData.source.id, upi_id: upiId, label
        }});
        haptic(10);
        document.getElementById('todo-new-upi').value = '';
        document.getElementById('todo-new-upi-label').value = '';
        document.getElementById('todo-add-upi-form').classList.add('hidden');
        // Refresh UPI numbers
        const nums = await api(`upi-numbers/?source_id=${todoSourceData.source.id}`);
        const upiNums = nums.results || nums;
        todoSourceData.upi_numbers = upiNums;
        renderUPINumbers(upiNums);
        toast('UPI number added');
    } catch (e) {
        toast('Failed to add', true);
    }
}

async function recordTodoTransaction() {
    if (!todoSourceData) return;
    const amount = document.getElementById('todo-amount').value;
    const merchant = document.getElementById('todo-merchant').value;
    const cashback = document.getElementById('todo-cashback').value;
    if (!amount) { toast('Enter amount', true); return; }

    const body = {
        source_id: todoSourceData.source.id,
        amount: parseFloat(amount),
        merchant: merchant || todoSourceData.source.name,
        cashback_amount: parseFloat(cashback) || 0,
        date: todoDate,
    };

    // Collect checked UPI numbers
    if (todoSourceData.source.source_type === 'upi') {
        const checked = [...document.querySelectorAll('[data-upi-check]:checked')].map(c => parseInt(c.value));
        body.upi_number_ids = checked;
    }

    try {
        await api('todo/record/', { method: 'POST', body });
        haptic(20);
        closeSheet('sheet-todo-record');
        toast(`₹${fmt(cashback)} recorded from ${esc(todoSourceData.source.name)}`);
        if (navigator.vibrate) navigator.vibrate(10);
        loadTodo();
        // Always refresh dashboard so Home recent transactions stay current
        loadDashboard();
    } catch (e) {
        haptic([50, 50, 50]);
        toast('Failed to record: ' + e.message, true);
    }
}

function txnRow(t, swipeable = false) {
    const statusStyles = {
        pending: { bg: 'bg-amber-500/15', text: 'text-amber-300', border: 'border-amber-500/20' },
        received: { bg: 'bg-emerald-500/15', text: 'text-emerald-300', border: 'border-emerald-500/20' },
        disputed: { bg: 'bg-rose-500/15', text: 'text-rose-300', border: 'border-rose-500/20' },
        na: { bg: 'bg-white/5', text: 'text-slate-400', border: 'border-white/10' }
    };
    const s = statusStyles[t.status] || statusStyles.na;
    const date = new Date(t.transaction_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    const color = t.source_color || '#6366f1';
    const cashback = t.status === 'received' && t.actual_cashback
        ? `<span class="text-[13px] text-emerald-400 font-medium">+₹${fmt(t.actual_cashback)}</span>`
        : t.expected_cashback > 0
            ? `<span class="text-[13px] text-slate-500">~₹${fmt(t.expected_cashback)}</span>`
            : '';

    const displayName = t.source_name_display || t.source_name || '';
    const displayType = t.source_type || t.transaction_type || 'credit';
    const inner = `
        <div class="flex items-center px-4 py-3.5 press active:bg-white/10 transition-colors" onclick="editTransaction(${t.id})">
            <div class="w-2 h-2 rounded-full flex-shrink-0 mr-3 glow-dot" style="background:${color};box-shadow:0 0 8px ${color}99;"></div>
            <div class="flex-1 min-w-0">
                <p class="text-[16px] font-semibold text-white truncate">${esc(displayName)}</p>
                <p class="text-[13px] text-slate-400 mt-0.5">${esc(displayType)} · ${date}</p>
            </div>
            <div class="text-right ml-3 flex-shrink-0">
                <p class="text-[16px] font-semibold text-white">₹${fmt(t.amount)}</p>
                <div class="flex items-center justify-end gap-1.5 mt-0.5">
                    ${cashback}
                    <span class="text-[11px] font-semibold px-2 py-0.5 rounded-full ${s.bg} ${s.text} border ${s.border}">${t.status}</span>
                </div>
            </div>
            <svg class="w-4 h-4 text-slate-600 ml-1.5 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>
        </div>`;

    if (!swipeable) return inner;

    return `
        <div class="swipe-row" data-id="${t.id}">
            <div class="swipe-actions swipe-actions-right">
                <button onclick="quickStatus(${t.id},'received')" class="bg-emerald-600 text-white px-5 flex items-center text-[13px] font-semibold">Received</button>
                <button onclick="quickStatus(${t.id},'disputed')" class="bg-amber-600 text-white px-5 flex items-center text-[13px] font-semibold">Dispute</button>
            </div>
            <div class="swipe-content bg-void">${inner}</div>
        </div>`;
}

// ──── Swipe Actions (kept for home page recent transactions) ────
document.addEventListener('DOMContentLoaded', () => {
    const txnList = document.getElementById('transaction-list');
    let activeRow = null, startX = 0, currentX = 0;

    txnList.addEventListener('touchstart', (e) => {
        const row = e.target.closest('.swipe-row');
        if (!row) return;
        if (activeRow && activeRow !== row) resetSwipe(activeRow);
        activeRow = row;
        startX = e.touches[0].clientX;
        row.querySelector('.swipe-content').style.transition = 'none';
    });

    txnList.addEventListener('touchmove', (e) => {
        if (!activeRow) return;
        currentX = e.touches[0].clientX - startX;
        if (currentX > 0) currentX = 0;
        const content = activeRow.querySelector('.swipe-content');
        const x = Math.max(currentX, -160);
        content.style.transform = `translateX(${x}px)`;
    });

    txnList.addEventListener('touchend', () => {
        if (!activeRow) return;
        const content = activeRow.querySelector('.swipe-content');
        content.style.transition = '';
        if (currentX < -60) {
            content.style.transform = 'translateX(-160px)';
        } else {
            content.style.transform = '';
        }
        currentX = 0;
    });

    document.addEventListener('touchstart', (e) => {
        if (activeRow && !e.target.closest('.swipe-row')) {
            resetSwipe(activeRow);
            activeRow = null;
        }
    });
});

function resetSwipe(row) {
    const content = row.querySelector('.swipe-content');
    content.style.transition = '';
    content.style.transform = '';
}

async function quickStatus(id, status) {
    try {
        await api(`transactions/${id}/`, { method: 'PATCH', body: { status } });
        haptic(20);
        toast(`Marked as ${status}`);
        if (currentPage === 'home') loadDashboard();
        else if (currentPage === 'transactions') loadTransactions();
    } catch (e) {
        toast('Failed to update', true);
    }
}

// ──── Sources ────
let deletingSourceId = null;
let activeSwipedSourceCard = null;

async function loadSources() {
    try {
        const data = await api('sources/');
        allSources = data.results || data;
        const container = document.getElementById('source-list');
        if (!allSources.length) {
            container.innerHTML = `<div class="glass rounded-3xl ring-1 ring-white/10">${emptyState('card', 'No payment sources', 'Add your cards and UPI apps')}</div>`;
            return;
        }
        container.innerHTML = allSources.map((s, i) => sourceCard(s, i)).join('');
        initSourceSwipeHandlers();
    } catch (e) {
        console.error('Sources load failed:', e);
    }
}

function sourceCard(s, idx) {
    const typeLabel = { credit: 'Credit', debit: 'Debit', upi: 'UPI' }[s.source_type] || s.source_type;
    const txnCount = s.transaction_count || 0;
    return `
        <div class="swipe-source-row relative overflow-hidden rounded-3xl mb-3 stagger" style="animation-delay:${idx * 50}ms" data-source-id="${s.id}">
            <!-- Red Delete Action Layer -->
            <div class="absolute inset-0 bg-rose-600 rounded-3xl flex items-center justify-end pr-6 z-0">
                <button type="button" onclick="openDeleteSourceConfirm(${s.id}, '${esc(s.name)}', ${txnCount})" class="flex items-center gap-1.5 text-white font-semibold text-[15px] h-full pl-6 press">
                    <svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                    Delete
                </button>
            </div>
            <!-- Card Content Layer -->
            <div class="swipe-source-content rounded-3xl p-5 ring-1 ring-white/10 bg-slate-900 active:bg-slate-850 relative z-10 transition-transform duration-200" onclick="handleSourceCardClick(event, ${s.id})">
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-3">
                        <div class="w-3 h-3 rounded-full glow-dot" style="background:${s.color};box-shadow:0 0 10px ${s.color}88;"></div>
                        <div>
                            <p class="text-[18px] font-bold text-white">${esc(s.name)}</p>
                            <p class="text-[13px] text-slate-400 mt-0.5">${esc(s.provider)} · ${typeLabel}${s.network ? ' · ' + s.network : ''}</p>
                        </div>
                    </div>
                    <button onclick="event.stopPropagation();toggleSource(${s.id},${!s.is_active})"
                        class="toggle-switch-btn w-12 h-7 rounded-full relative transition-colors ${s.is_active ? 'bg-emerald-500' : 'bg-slate-600'}">
                        <div class="absolute top-0.5 w-6 h-6 bg-white rounded-full shadow transition-transform ${s.is_active ? 'left-[22px]' : 'left-0.5'}"></div>
                    </button>
                </div>
                <div class="mt-3 flex gap-2">
                    <span class="text-[12px] font-semibold px-3 py-1 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/20">Earned ₹${fmt(s.total_earned || 0)}</span>
                </div>
            </div>
        </div>`;
}

function handleSourceCardClick(e, sourceId) {
    const row = e.currentTarget.closest('.swipe-source-row');
    if (row && row.dataset.isSwiped === 'true') {
        closeSourceSwipe(row);
        return;
    }
    if (e.target.closest('.toggle-switch-btn')) return;
    editSource(sourceId);
}

function closeSourceSwipe(row) {
    if (!row) return;
    const content = row.querySelector('.swipe-source-content');
    if (content) {
        content.style.transition = 'transform 0.35s cubic-bezier(0.32, 0.72, 0, 1)';
        content.style.transform = 'translateX(0px)';
        content.style.boxShadow = '';
    }
    delete row.dataset.isSwiped;
    if (activeSwipedSourceCard === row) activeSwipedSourceCard = null;
}

function initSourceSwipeHandlers() {
    const container = document.getElementById('source-list');
    if (!container) return;

    let startX = 0, startY = 0, currentX = 0, isDragging = false, activeRow = null, isHorizontalSwipe = null;
    const revealWidth = 90;
    const threshold = 80;

    container.addEventListener('touchstart', (e) => {
        const toggleBtn = e.target.closest('.toggle-switch-btn');
        if (toggleBtn) return;

        const row = e.target.closest('.swipe-source-row');
        if (!row) return;

        if (activeSwipedSourceCard && activeSwipedSourceCard !== row) {
            closeSourceSwipe(activeSwipedSourceCard);
        }

        activeRow = row;
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        currentX = 0;
        isDragging = true;
        isHorizontalSwipe = null;

        const content = row.querySelector('.swipe-source-content');
        if (content) content.style.transition = 'none';
    }, { passive: true });

    container.addEventListener('touchmove', (e) => {
        if (!isDragging || !activeRow) return;

        const touchX = e.touches[0].clientX;
        const touchY = e.touches[0].clientY;
        const dx = touchX - startX;
        const dy = touchY - startY;

        if (isHorizontalSwipe === null) {
            if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
                isHorizontalSwipe = Math.abs(dx) > Math.abs(dy);
            }
        }

        if (isHorizontalSwipe === false) {
            isDragging = false;
            return;
        }

        if (!isHorizontalSwipe) return;

        if (e.cancelable) e.preventDefault();

        const alreadySwiped = activeRow.dataset.isSwiped === 'true';
        let rawOffset = (alreadySwiped ? -revealWidth : 0) + dx;

        // Prevent dragging right past 0
        if (rawOffset > 0) rawOffset = 0;

        let finalOffset = rawOffset;
        if (Math.abs(rawOffset) > revealWidth) {
            const extra = Math.abs(rawOffset) - revealWidth;
            // Elastic resistance curve
            const resisted = extra / (1 + extra * 0.015);
            finalOffset = -(revealWidth + resisted);
        }

        currentX = finalOffset;
        const content = activeRow.querySelector('.swipe-source-content');
        if (content) {
            content.style.transform = `translateX(${finalOffset}px)`;
            content.style.boxShadow = finalOffset < 0 ? '0 10px 25px -5px rgba(0,0,0,0.5)' : '';
        }
    }, { passive: false });

    const endSwipe = () => {
        if (!isDragging || !activeRow) return;
        isDragging = false;

        const content = activeRow.querySelector('.swipe-source-content');
        if (content) {
            content.style.transition = 'transform 0.35s cubic-bezier(0.32, 0.72, 0, 1)';
            if (Math.abs(currentX) >= threshold) {
                content.style.transform = `translateX(-${revealWidth}px)`;
                content.style.boxShadow = '0 10px 25px -5px rgba(0,0,0,0.5)';
                activeRow.dataset.isSwiped = 'true';
                activeSwipedSourceCard = activeRow;
            } else {
                content.style.transform = 'translateX(0px)';
                content.style.boxShadow = '';
                delete activeRow.dataset.isSwiped;
                if (activeSwipedSourceCard === activeRow) activeSwipedSourceCard = null;
            }
        }
        activeRow = null;
    };

    container.addEventListener('touchend', endSwipe);
    container.addEventListener('touchcancel', endSwipe);
}

// Close swiped card on outside tap
document.addEventListener('touchstart', (e) => {
    if (activeSwipedSourceCard && !e.target.closest('.swipe-source-row')) {
        closeSourceSwipe(activeSwipedSourceCard);
    }
});

// Delete Confirmation & Execution
function openDeleteSourceConfirm(id, name, txnCount) {
    deletingSourceId = id;
    document.getElementById('delete-source-title').textContent = `Delete ${name}?`;
    const subtitle = txnCount > 0
        ? `This will also remove ${txnCount} transaction${txnCount === 1 ? '' : 's'} linked to this source.`
        : 'No transactions linked.';
    document.getElementById('delete-source-subtitle').textContent = subtitle;
    openSheet('sheet-delete-source');
}

async function confirmDeleteSource() {
    if (!deletingSourceId) return;
    const sourceId = deletingSourceId;
    closeSheet('sheet-delete-source');

    const row = document.querySelector(`.swipe-source-row[data-source-id="${sourceId}"]`);
    try {
        await api(`sources/${sourceId}/`, { method: 'DELETE' });
        haptic(20);
        toast('Payment source deleted');
        allSources = allSources.filter(s => s.id !== sourceId);

        if (row) {
            row.style.transition = 'transform 0.4s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.3s ease-out, margin 0.35s ease-out, max-height 0.35s ease-out';
            row.style.transform = 'translateX(-100%)';
            row.style.opacity = '0';
            row.style.maxHeight = row.offsetHeight + 'px';

            setTimeout(() => {
                row.style.maxHeight = '0px';
                row.style.marginTop = '0px';
                row.style.marginBottom = '0px';
                row.style.paddingTop = '0px';
                row.style.paddingBottom = '0px';
            }, 200);

            setTimeout(() => {
                row.remove();
                if (!document.querySelectorAll('.swipe-source-row').length) {
                    loadSources();
                }
            }, 450);
        } else {
            loadSources();
        }

        if (currentPage === 'home') loadDashboard();
    } catch (e) {
        haptic([50, 50, 50]);
        toast('Failed to delete source', true);
    } finally {
        deletingSourceId = null;
    }
}

async function toggleSource(id, active) {
    try {
        await api(`sources/${id}/`, { method: 'PATCH', body: { is_active: active } });
        haptic(10);
        loadSources();
    } catch (e) {
        toast('Failed to toggle', true);
    }
}

// ──── Offers ────
async function loadOffers() {
    try {
        const data = await api('offers/?is_active=true');
        const offers = data.results || data;
        const today = new Date().toISOString().split('T')[0];
        const sevenDays = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
        const expiring = offers.filter(o => o.valid_until <= sevenDays && o.valid_until >= today);
        const rest = offers.filter(o => o.valid_until > sevenDays);

        const expiringSection = document.getElementById('expiring-section');
        const expiringList = document.getElementById('expiring-offers');
        if (expiring.length) {
            expiringSection.classList.remove('hidden');
            expiringList.innerHTML = expiring.map((o, i) =>
                `${i > 0 ? '<div class="glass-sep ml-4"></div>' : ''}${offerRow(o, true)}`
            ).join('');
        } else {
            expiringSection.classList.add('hidden');
        }

        const offerList = document.getElementById('offer-list');
        if (rest.length) {
            offerList.innerHTML = rest.map((o, i) =>
                `${i > 0 ? '<div class="glass-sep ml-4"></div>' : ''}${offerRow(o)}`
            ).join('');
        } else if (!expiring.length) {
            offerList.innerHTML = emptyState('tag', 'No active offers');
        } else {
            offerList.innerHTML = '';
        }
    } catch (e) {
        console.error('Offers load failed:', e);
    }
}

function offerRow(o, isExpiring = false) {
    const value = o.offer_type === 'percentage' ? `${o.value}%` : `₹${fmt(o.value)}`;
    const cap = o.max_cap ? ` (max ₹${fmt(o.max_cap)})` : '';
    const days = Math.ceil((new Date(o.valid_until) - new Date()) / 86400000);
    const expiry = isExpiring
        ? `<span class="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/20">${days}d left</span>`
        : `<span class="text-[13px] text-slate-500">until ${new Date(o.valid_until).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>`;

    return `
        <div class="flex items-center px-4 py-3.5 press active:bg-white/10 transition-colors" onclick="editOffer(${o.id})">
            <div class="flex-1 min-w-0">
                <p class="text-[16px] font-semibold text-white">${esc(o.category)}</p>
                <p class="text-[13px] text-slate-400 mt-0.5">${esc(o.source_name || '')}</p>
            </div>
            <div class="text-right ml-3 flex-shrink-0">
                <p class="text-[16px] font-semibold text-indigo-400">${value}${cap}</p>
                ${expiry}
            </div>
            <svg class="w-4 h-4 text-slate-600 ml-1.5 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>
        </div>`;
}

// ──── Source Options (for dropdowns) ────
async function loadSourceOptions() {
    if (allSources.length === 0) {
        try {
            const data = await api('sources/?is_active=true');
            allSources = data.results || data;
        } catch (e) { return; }
    }
    ['txn-source', 'ofr-source', 'filter-source'].forEach(id => {
        const sel = document.getElementById(id);
        if (!sel) return;
        const current = sel.value;
        const firstOpt = id === 'filter-source' ? '<option value="">All Sources</option>' : '<option value="">Select...</option>';
        sel.innerHTML = firstOpt + allSources.map(s =>
            `<option value="${s.id}" ${s.id == current ? 'selected' : ''}>${esc(s.name)}</option>`
        ).join('');
    });
}

// ──── Auto Cashback Calc ────
function setupCashbackCalc() {
    ['txn-source', 'txn-amount'].forEach(id => {
        document.getElementById(id).addEventListener('input', debouncedCalc);
        document.getElementById(id).addEventListener('change', debouncedCalc);
    });
}

function debouncedCalc() {
    clearTimeout(calcTimer);
    calcTimer = setTimeout(calcCashback, 400);
}

async function calcCashback() {
    const source = document.getElementById('txn-source').value;
    const amount = document.getElementById('txn-amount').value;
    if (!source || !amount) return;

    try {
        const data = await api('calculate-cashback/', {
            method: 'POST',
            body: { source_id: parseInt(source), amount: parseFloat(amount) }
        });
        const preview = document.getElementById('cashback-preview');
        if (data.cashback > 0) {
            preview.classList.remove('hidden');
            document.getElementById('preview-amount').textContent = `₹${fmt(data.cashback)}`;
            document.getElementById('preview-offer').textContent = data.offer_description || '';
            document.getElementById('txn-cashback').value = data.cashback;
            document.getElementById('txn-offer-id').value = data.offer_id || '';
        } else {
            preview.classList.add('hidden');
        }
    } catch (e) { /* silent */ }
}

function setTxnType(type) {
    document.getElementById('txn-type').value = type;
    document.querySelectorAll('.txn-type-btn').forEach(btn => {
        if (btn.dataset.type === type) {
            btn.classList.add('bg-gradient-to-r', 'from-indigo-600', 'to-violet-600', 'text-white');
            btn.classList.remove('text-slate-400');
        } else {
            btn.classList.remove('bg-gradient-to-r', 'from-indigo-600', 'to-violet-600', 'text-white');
            btn.classList.add('text-slate-400');
        }
    });
}

// ──── CRUD: Transaction ────
async function saveTransaction(e) {
    e.preventDefault();
    const editId = document.getElementById('txn-edit-id').value;
    const body = {
        source_name: document.getElementById('txn-source-name').value,
        transaction_type: document.getElementById('txn-type').value,
        amount: parseFloat(document.getElementById('txn-amount').value),
        transaction_date: document.getElementById('txn-date').value,
        expected_cashback: parseFloat(document.getElementById('txn-cashback').value) || 0,
        notes: document.getElementById('txn-notes').value,
    };
    const offerId = document.getElementById('txn-offer-id').value;
    if (offerId) body.offer = parseInt(offerId);

    const status = document.getElementById('txn-status').value;
    if (status) body.status = status;
    const actual = document.getElementById('txn-actual').value;
    if (actual !== '') body.actual_cashback = parseFloat(actual);

    try {
        if (editId) {
            await api(`transactions/${editId}/`, { method: 'PUT', body });
        } else {
            await api('transactions/', { method: 'POST', body });
        }
        haptic(20);
        closeSheet('sheet-transaction');
        toast(editId ? 'Transaction updated' : 'Transaction added');
        if (currentPage === 'home') loadDashboard();
        else if (currentPage === 'transactions') loadTransactions();
    } catch (e) {
        haptic([50, 50, 50]);
        toast('Failed to save', true);
    }
}

async function editTransaction(id) {
    try {
        const t = await api(`transactions/${id}/`);
        document.getElementById('txn-edit-id').value = t.id;
        document.getElementById('txn-source-name').value = t.source_name || (t.source ? t.source_name_display : '');
        setTxnType(t.transaction_type || 'credit');
        document.getElementById('txn-amount').value = t.amount;
        document.getElementById('txn-date').value = t.transaction_date;
        document.getElementById('txn-cashback').value = t.expected_cashback;
        document.getElementById('txn-notes').value = t.notes || '';
        document.getElementById('txn-offer-id').value = t.offer || '';

        document.getElementById('txn-status-group').classList.remove('hidden');
        setTxnStatus(t.status);
        if (t.actual_cashback != null) {
            document.getElementById('txn-actual').value = t.actual_cashback;
        }

        const title = document.querySelector('#sheet-transaction h2');
        title.textContent = 'Edit Transaction';
        openSheet('sheet-transaction');
    } catch (e) {
        toast('Failed to load transaction', true);
    }
}

function setTxnStatus(status) {
    document.getElementById('txn-status').value = status;
    document.querySelectorAll('.txn-status-btn').forEach(btn => {
        const val = btn.textContent.trim().toLowerCase();
        if (val === status) {
            btn.classList.add('bg-gradient-to-r', 'from-indigo-600', 'to-violet-600', 'text-white');
            btn.classList.remove('text-slate-400');
        } else {
            btn.classList.remove('bg-gradient-to-r', 'from-indigo-600', 'to-violet-600', 'text-white');
            btn.classList.add('text-slate-400');
        }
    });
    document.getElementById('actual-cashback-group').classList.toggle('hidden', status !== 'received');
}

// ──── CRUD: Source ────
async function saveSource(e) {
    e.preventDefault();
    const editId = document.getElementById('src-edit-id').value;
    const body = {
        name: document.getElementById('src-name').value,
        source_type: document.getElementById('src-type').value,
        provider: document.getElementById('src-provider').value,
        network: document.getElementById('src-network').value,
        color: document.getElementById('src-color').value,
        daily_target: parseFloat(document.getElementById('src-daily-target').value) || 0,
    };
    try {
        if (editId) {
            await api(`sources/${editId}/`, { method: 'PUT', body });
        } else {
            await api('sources/', { method: 'POST', body });
        }
        haptic(20);
        closeSheet('sheet-source');
        toast(editId ? 'Source updated' : 'Source added');
        allSources = [];
        loadSources();
    } catch (e) {
        haptic([50, 50, 50]);
        toast('Failed to save', true);
    }
}

async function editSource(id) {
    const s = allSources.find(s => s.id === id);
    if (!s) return;
    document.getElementById('src-edit-id').value = s.id;
    document.getElementById('src-name').value = s.name;
    document.getElementById('src-type').value = s.source_type;
    document.getElementById('src-provider').value = s.provider;
    document.getElementById('src-network').value = s.network || '';
    document.getElementById('src-color').value = s.color;
    document.getElementById('src-daily-target').value = s.daily_target || 0;
    const title = document.querySelector('#sheet-source h2');
    title.textContent = 'Edit Source';
    openSheet('sheet-source');
}

// ──── CRUD: Offer ────
async function saveOffer(e) {
    e.preventDefault();
    const editId = document.getElementById('ofr-edit-id').value;
    const body = {
        source: parseInt(document.getElementById('ofr-source').value),
        category: document.getElementById('ofr-category').value,
        offer_type: document.getElementById('ofr-type').value,
        value: parseFloat(document.getElementById('ofr-value').value),
        valid_from: document.getElementById('ofr-from').value,
        valid_until: document.getElementById('ofr-until').value,
        terms: document.getElementById('ofr-terms').value,
    };
    const cap = document.getElementById('ofr-cap').value;
    if (cap) body.max_cap = parseFloat(cap);

    try {
        if (editId) {
            await api(`offers/${editId}/`, { method: 'PUT', body });
        } else {
            await api('offers/', { method: 'POST', body });
        }
        haptic(20);
        closeSheet('sheet-offer');
        toast(editId ? 'Offer updated' : 'Offer added');
        loadOffers();
    } catch (e) {
        haptic([50, 50, 50]);
        toast('Failed to save', true);
    }
}

async function editOffer(id) {
    try {
        const o = await api(`offers/${id}/`);
        document.getElementById('ofr-edit-id').value = o.id;
        document.getElementById('ofr-source').value = o.source;
        document.getElementById('ofr-category').value = o.category;
        document.getElementById('ofr-type').value = o.offer_type;
        document.getElementById('ofr-value').value = o.value;
        document.getElementById('ofr-cap').value = o.max_cap || '';
        document.getElementById('ofr-from').value = o.valid_from;
        document.getElementById('ofr-until').value = o.valid_until;
        document.getElementById('ofr-terms').value = o.terms || '';
        const title = document.querySelector('#sheet-offer h2');
        title.textContent = 'Edit Offer';
        openSheet('sheet-offer');
    } catch (e) {
        toast('Failed to load offer', true);
    }
}

// ──── Transactions Page ────
function getDateRange(range) {
    const today = new Date();
    const toStr = d => d.toISOString().split('T')[0];
    switch (range) {
        case 'today': return { date_from: toStr(today), date_to: toStr(today) };
        case 'week': {
            const start = new Date(today);
            start.setDate(start.getDate() - start.getDay());
            return { date_from: toStr(start), date_to: toStr(today) };
        }
        case 'month': {
            const start = new Date(today.getFullYear(), today.getMonth(), 1);
            return { date_from: toStr(start), date_to: toStr(today) };
        }
        default: return {};
    }
}

function setTxnDateRange(range) {
    txnDateRange = range;
    document.querySelectorAll('.txn-date-pill').forEach(btn => {
        const isActive = btn.textContent.trim().toLowerCase().replace(/\s+/g, '') ===
            { today: 'today', week: 'thisweek', month: 'thismonth', all: 'alltime' }[range];
        btn.classList.toggle('bg-indigo-500/80', isActive);
        btn.classList.toggle('text-white', isActive);
        btn.classList.toggle('bg-white/5', !isActive);
        btn.classList.toggle('text-slate-400', !isActive);
        btn.classList.toggle('border', !isActive);
        btn.classList.toggle('border-white/5', !isActive);
    });
    haptic(10);
    loadTransactions();
}

async function loadTransactions() {
    loadSourceOptions();
    const params = new URLSearchParams({ ordering: '-transaction_date' });
    const dateRange = getDateRange(txnDateRange);
    if (dateRange.date_from) params.set('date_from', dateRange.date_from);
    if (dateRange.date_to) params.set('date_to', dateRange.date_to);
    const sourceVal = document.getElementById('filter-source')?.value;
    if (sourceVal) params.set('source', sourceVal);
    const statusVal = document.getElementById('filter-status')?.value;
    if (statusVal) params.set('status', statusVal);

    const container = document.getElementById('transaction-list');
    try {
        const data = await api(`transactions/?${params}`);
        const txns = data.results || data;
        if (!txns.length) {
            container.innerHTML = `<div class="glass rounded-3xl ring-1 ring-white/10">${emptyState('clipboard', 'No transactions found', 'Try changing your filters')}</div>`;
            return;
        }
        container.innerHTML = txns.map((t, i) => txnExpandableRow(t, i)).join('');
    } catch (e) {
        console.error('Transactions load failed:', e);
        container.innerHTML = `<div class="glass rounded-3xl ring-1 ring-white/10">${emptyState('clipboard', 'Failed to load', e.message)}</div>`;
    }
}

function txnExpandableRow(t, idx) {
    const statusStyles = {
        pending: { bg: 'bg-amber-500/15', text: 'text-amber-300', border: 'border-amber-500/20' },
        received: { bg: 'bg-emerald-500/15', text: 'text-emerald-300', border: 'border-emerald-500/20' },
        disputed: { bg: 'bg-rose-500/15', text: 'text-rose-300', border: 'border-rose-500/20' },
        na: { bg: 'bg-white/5', text: 'text-slate-400', border: 'border-white/10' }
    };
    const s = statusStyles[t.status] || statusStyles.na;
    const date = new Date(t.transaction_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    const color = t.source_color || '#6366f1';
    const displayName = t.source_name_display || t.source_name || 'Transaction';
    const displayType = t.source_type || t.transaction_type || 'credit';

    const cashback = t.status === 'received' && t.actual_cashback
        ? `<span class="text-[13px] text-emerald-400 font-medium">+₹${fmt(t.actual_cashback)}</span>`
        : t.expected_cashback > 0
            ? `<span class="text-[13px] text-slate-500">~₹${fmt(t.expected_cashback)}</span>`
            : '';

    const upiHtml = displayType === 'upi' && t.upi_numbers_detail?.length
        ? `<div class="flex flex-wrap gap-1.5 mt-2">
            <span class="text-[12px] text-slate-400">UPI IDs:</span>
            ${t.upi_numbers_detail.map(u => `<span class="text-[12px] bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 rounded-lg px-2 py-0.5">${esc(u.upi_id)}</span>`).join('')}
           </div>`
        : '';

    const cashbackLine = (t.actual_cashback > 0)
        ? `<div class="flex gap-4 text-[13px] mt-1">
            <span class="text-emerald-400">Received: <span class="font-medium">₹${fmt(t.actual_cashback)}</span></span>
           </div>`
        : '';

    const notesLine = t.notes ? `<p class="text-[13px] text-slate-400 mt-1">${esc(t.notes)}</p>` : '';

    const actions = t.status === 'pending'
        ? `<div class="flex gap-2 mt-3">
            <button onclick="event.stopPropagation();quickStatus(${t.id},'received')" class="text-[12px] font-semibold px-3 py-1.5 rounded-xl bg-emerald-500/15 text-emerald-300 border border-emerald-500/20 press">Mark Received</button>
            <button onclick="event.stopPropagation();deleteTxn(${t.id})" class="text-[12px] font-semibold px-3 py-1.5 rounded-xl bg-rose-500/15 text-rose-300 border border-rose-500/20 press">Delete</button>
           </div>`
        : `<div class="flex gap-2 mt-3">
            <button onclick="event.stopPropagation();editTransaction(${t.id})" class="text-[12px] font-semibold px-3 py-1.5 rounded-xl bg-white/5 text-slate-300 border border-white/10 press">Edit</button>
            <button onclick="event.stopPropagation();deleteTxn(${t.id})" class="text-[12px] font-semibold px-3 py-1.5 rounded-xl bg-rose-500/15 text-rose-300 border border-rose-500/20 press">Delete</button>
           </div>`;

    return `
        <div class="stagger glass rounded-2xl ring-1 ring-white/10 overflow-hidden" style="animation-delay:${Math.min(idx, 10) * 30}ms">
            <div class="flex items-center px-4 py-3.5 press cursor-pointer" onclick="toggleTxnExpand(${t.id})">
                <div class="w-2 h-2 rounded-full flex-shrink-0 mr-3 glow-dot" style="background:${color};box-shadow:0 0 8px ${color}99;"></div>
                <div class="flex-1 min-w-0">
                    <p class="text-[15px] font-semibold text-white truncate">${esc(displayName)}</p>
                    <p class="text-[13px] text-slate-400 mt-0.5">${esc(displayType)} · ${date}</p>
                </div>
                <div class="text-right ml-3 flex-shrink-0">
                    <p class="text-[16px] font-semibold text-white">₹${fmt(t.amount)}</p>
                    <div class="flex items-center justify-end gap-1.5 mt-0.5">
                        ${cashback}
                        <span class="text-[11px] font-semibold px-2 py-0.5 rounded-full ${s.bg} ${s.text} border ${s.border}">${t.status}</span>
                    </div>
                </div>
                <svg class="w-4 h-4 text-slate-600 ml-2 flex-shrink-0 transition-transform duration-200 txn-chevron-${t.id}" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>
            </div>
            <div id="txn-detail-${t.id}" class="hidden px-4 pb-4 pt-0 border-t border-white/5">
                ${cashbackLine}
                ${upiHtml}
                ${notesLine}
                ${actions}
            </div>
        </div>`;
}

function toggleTxnExpand(id) {
    const detail = document.getElementById(`txn-detail-${id}`);
    const chevron = document.querySelector(`.txn-chevron-${id}`);
    if (!detail) return;
    const isOpen = !detail.classList.contains('hidden');
    // Close previous
    if (expandedTxnId && expandedTxnId !== id) {
        const prev = document.getElementById(`txn-detail-${expandedTxnId}`);
        const prevChev = document.querySelector(`.txn-chevron-${expandedTxnId}`);
        if (prev) prev.classList.add('hidden');
        if (prevChev) prevChev.style.transform = '';
    }
    if (isOpen) {
        detail.classList.add('hidden');
        if (chevron) chevron.style.transform = '';
        expandedTxnId = null;
    } else {
        detail.classList.remove('hidden');
        if (chevron) chevron.style.transform = 'rotate(180deg)';
        expandedTxnId = id;
    }
    haptic(10);
}

async function deleteTxn(id) {
    if (!confirm('Delete this transaction?')) return;
    try {
        await api(`transactions/${id}/`, { method: 'DELETE' });
        haptic(20);
        toast('Transaction deleted');
        loadTransactions();
        if (currentPage === 'home') loadDashboard();
    } catch (e) {
        toast('Failed to delete', true);
    }
}

// ──── Status Filter (for home page quick-status) ────
function setStatusFilter(val) {
    statusFilter = val;
    haptic(10);
}

// ──── Haptic Feedback ────
function haptic(pattern) {
    if ('vibrate' in navigator) navigator.vibrate(pattern);
}

// ──── Toast ────
function toast(msg, isError = false) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    if (isError) {
        el.style.background = 'rgba(244,63,94,0.9)';
        el.style.borderColor = 'rgba(244,63,94,0.3)';
    } else {
        el.style.background = 'rgba(255,255,255,0.08)';
        el.style.borderColor = 'rgba(255,255,255,0.12)';
    }
    el.style.top = `calc(env(safe-area-inset-top, 0px) + 8px)`;
    el.classList.remove('hidden', '-translate-y-2', 'opacity-0');
    setTimeout(() => {
        el.classList.add('-translate-y-2', 'opacity-0');
        setTimeout(() => el.classList.add('hidden'), 300);
    }, 2500);
}

// ──── Utilities ────
function fmt(n) {
    const num = parseFloat(n) || 0;
    return num.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function esc(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}

function emptyState(icon, title, subtitle = '') {
    const icons = {
        clipboard: '<path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>',
        card: '<path d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"/>',
        tag: '<path d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z"/>'
    };
    return `<div class="py-12 text-center">
        <svg class="w-12 h-12 mx-auto text-slate-600 mb-3" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">${icons[icon] || icons.clipboard}</svg>
        <p class="text-[17px] font-semibold text-slate-400">${title}</p>
        ${subtitle ? `<p class="text-[15px] text-slate-500 mt-1">${subtitle}</p>` : ''}
    </div>`;
}

// ──── Standalone Mode ────
function checkStandalone() {
    const isStandalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
    if (!isStandalone && /iPhone|iPad/.test(navigator.userAgent)) {
        if (!localStorage.getItem('a2hs_dismissed')) {
            document.getElementById('a2hs-banner').classList.remove('hidden');
        }
    }
}

function dismissA2HS() {
    document.getElementById('a2hs-banner').classList.add('hidden');
    localStorage.setItem('a2hs_dismissed', '1');
}

// ──── Init ────
document.addEventListener('DOMContentLoaded', () => {
    // ponytail: dark-only, no light mode. Override system preference.
    document.documentElement.classList.add('dark');

    const page = pathToPage();
    navigate(page);
    loadSourceOptions();
    setupCashbackCalc();
    checkStandalone();

    setStatusFilter('');
});
