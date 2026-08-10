/* Cashback Tracker — Dark Glassmorphism PWA */
// ponytail: vanilla JS, no TS compile step. Add TS build when team joins.

const API = '/api';
let currentPage = 'home';
let statusFilter = '', monthFilter = '', sourceFilter = '';
let allSources = [];
let calcTimer = null;
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
    return res.json();
}

// ──── Navigation ────
function navigate(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(`page-${page}`).classList.add('active');
    currentPage = page;
    history.pushState({ page }, '', page === 'home' ? '/' : `/${page}/`);
    updateTabBar();
    haptic(10);
    if (page === 'home') loadDashboard();
    else if (page === 'todo') loadTodo();
    else if (page === 'cards') loadSources();
    else if (page === 'offers') loadOffers();
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
    document.getElementById(`page-${page}`).classList.add('active');
    currentPage = page;
    updateTabBar();
});

function pathToPage() {
    const p = location.pathname.replace(/\//g, '');
    return ['todo', 'cards', 'offers'].includes(p) ? p : 'home';
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
        animateCounter(document.getElementById('stat-pending'), data.pending_cashback);
        animateCounter(document.getElementById('stat-earned'), data.earned_this_month);
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
        if (currentPage === 'home') loadDashboard();
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

    const inner = `
        <div class="flex items-center px-4 py-3.5 press active:bg-white/10 transition-colors" onclick="editTransaction(${t.id})">
            <div class="w-2 h-2 rounded-full flex-shrink-0 mr-3 glow-dot" style="background:${color};box-shadow:0 0 8px ${color}99;"></div>
            <div class="flex-1 min-w-0">
                <p class="text-[16px] font-semibold text-white truncate">${esc(t.merchant)}</p>
                <p class="text-[13px] text-slate-400 mt-0.5">${esc(t.source_name || '')} · ${date}</p>
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
        else loadTransactions();
    } catch (e) {
        toast('Failed to update', true);
    }
}

// ──── Sources ────
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
    } catch (e) {
        console.error('Sources load failed:', e);
    }
}

function sourceCard(s, idx) {
    const typeLabel = { credit: 'Credit', debit: 'Debit', upi: 'UPI' }[s.source_type] || s.source_type;
    return `
        <div class="stagger glass rounded-3xl p-5 ring-1 ring-white/10 mb-3 press bg-gradient-to-br from-white/10 to-white/5" style="animation-delay:${idx * 50}ms" onclick="editSource(${s.id})">
            <div class="flex items-center justify-between">
                <div class="flex items-center gap-3">
                    <div class="w-3 h-3 rounded-full glow-dot" style="background:${s.color};box-shadow:0 0 10px ${s.color}88;"></div>
                    <div>
                        <p class="text-[18px] font-bold text-white">${esc(s.name)}</p>
                        <p class="text-[13px] text-slate-400 mt-0.5">${esc(s.provider)} · ${typeLabel}${s.network ? ' · ' + s.network : ''}</p>
                    </div>
                </div>
                <button onclick="event.stopPropagation();toggleSource(${s.id},${!s.is_active})"
                    class="w-12 h-7 rounded-full relative transition-colors ${s.is_active ? 'bg-emerald-500' : 'bg-slate-600'}">
                    <div class="absolute top-0.5 w-6 h-6 bg-white rounded-full shadow transition-transform ${s.is_active ? 'left-[22px]' : 'left-0.5'}"></div>
                </button>
            </div>
            <div class="mt-3 flex gap-2">
                <span class="text-[12px] font-semibold px-3 py-1 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/20">Earned ₹${fmt(s.total_earned || 0)}</span>
            </div>
        </div>`;
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
    ['txn-source', 'txn-amount', 'txn-category'].forEach(id => {
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
    const category = document.getElementById('txn-category').value;
    if (!source || !amount) return;

    try {
        const data = await api('calculate-cashback/', {
            method: 'POST',
            body: { source_id: parseInt(source), amount: parseFloat(amount), category }
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

// ──── CRUD: Transaction ────
async function saveTransaction(e) {
    e.preventDefault();
    const editId = document.getElementById('txn-edit-id').value;
    const body = {
        source: parseInt(document.getElementById('txn-source').value),
        amount: parseFloat(document.getElementById('txn-amount').value),
        merchant: document.getElementById('txn-merchant').value,
        category: document.getElementById('txn-category').value,
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
        else loadTransactions();
    } catch (e) {
        haptic([50, 50, 50]);
        toast('Failed to save', true);
    }
}

async function editTransaction(id) {
    try {
        const t = await api(`transactions/${id}/`);
        document.getElementById('txn-edit-id').value = t.id;
        document.getElementById('txn-source').value = t.source;
        document.getElementById('txn-amount').value = t.amount;
        document.getElementById('txn-merchant').value = t.merchant;
        document.getElementById('txn-category').value = t.category || '';
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
