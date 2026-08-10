// ponytail: vanilla JS, no TS compile step needed for personal app. Add TS build when team joins.
const API = '/api';
let currentPage = 'home';
let txnPage = 1;
let sources = [];

// ===== NAVIGATION =====
function navigate(page) {
    currentPage = page;
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(`page-${page}`).classList.add('active');
    document.querySelectorAll('.nav-tab').forEach(tab => {
        const isActive = tab.dataset.page === page;
        tab.classList.toggle('text-indigo-600', isActive);
        tab.classList.toggle('text-slate-400', !isActive);
    });
    // Show FAB only on home/transactions
    document.getElementById('fab').classList.toggle('hidden', !['home', 'transactions'].includes(page));
    // Load page data
    if (page === 'home') loadDashboard();
    else if (page === 'transactions') { txnPage = 1; loadTransactions(); }
    else if (page === 'cards') loadSources();
    else if (page === 'offers') loadOffers();
    // Update URL without reload
    const paths = { home: '/', transactions: '/transactions/', cards: '/cards/', offers: '/offers/' };
    history.pushState({page}, '', paths[page]);
}

// ===== API HELPERS =====
async function api(path, opts = {}) {
    const url = path.startsWith('http') ? path : `${API}${path}`;
    const config = { headers: { 'Content-Type': 'application/json' }, ...opts };
    if (config.body && typeof config.body === 'object') config.body = JSON.stringify(config.body);
    const res = await fetch(url, config);
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
}

function toast(msg, type = 'success') {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = `fixed top-4 left-4 right-4 px-4 py-3 rounded-xl text-sm font-medium shadow-lg z-50 max-w-lg mx-auto transition-all transform translate-y-0 opacity-100 ${
        type === 'error' ? 'bg-rose-600 text-white' : 'bg-slate-800 text-white'
    }`;
    setTimeout(() => {
        el.classList.add('-translate-y-2', 'opacity-0');
        setTimeout(() => el.classList.add('hidden'), 300);
    }, 2500);
}

// ===== DASHBOARD =====
async function loadDashboard() {
    try {
        const data = await api('/dashboard-stats/');
        document.getElementById('stat-pending').textContent = `₹${Number(data.pending_cashback).toLocaleString('en-IN')}`;
        document.getElementById('stat-sources').textContent = data.active_sources;
        document.getElementById('stat-earned').textContent = `₹${Number(data.earned_this_month).toLocaleString('en-IN')}`;
        document.getElementById('stat-best').textContent = data.best_source || '—';
        const container = document.getElementById('recent-transactions');
        if (data.recent_transactions.length === 0) {
            container.innerHTML = '<p class="text-sm text-slate-400 py-8 text-center">No transactions yet</p>';
            return;
        }
        container.innerHTML = data.recent_transactions.map(txn => txnCard(txn)).join('');
    } catch (e) {
        console.error('Dashboard load failed:', e);
    }
}

// ===== TRANSACTIONS =====
async function loadTransactions(append = false) {
    try {
        let url = `/transactions/?page=${txnPage}`;
        const month = document.getElementById('filter-month').value;
        const status = document.getElementById('filter-status').value;
        const source = document.getElementById('filter-source').value;
        if (month) url += `&statement_month=${month}`;
        if (status) url += `&status=${status}`;
        if (source) url += `&source=${source}`;

        const data = await api(url);
        const container = document.getElementById('transaction-list');
        const html = data.results.map(txn => txnCard(txn, true)).join('');
        if (append) container.innerHTML += html;
        else container.innerHTML = html || '<p class="text-sm text-slate-400 py-8 text-center">No transactions</p>';

        document.getElementById('load-more-txn').classList.toggle('hidden', !data.next);
    } catch (e) {
        console.error('Transactions load failed:', e);
    }
}

function loadMoreTransactions() {
    txnPage++;
    loadTransactions(true);
}

function txnCard(txn, showFull = false) {
    const statusColors = {
        pending: 'bg-amber-100 text-amber-700',
        received: 'bg-emerald-100 text-emerald-700',
        disputed: 'bg-rose-100 text-rose-700',
        na: 'bg-slate-100 text-slate-500'
    };
    const badge = statusColors[txn.status] || statusColors.na;
    return `
    <div class="bg-white rounded-xl p-3 shadow-sm border border-slate-100 flex items-center justify-between" onclick="editTransaction(${txn.id})">
        <div class="flex items-center gap-3 min-w-0">
            <div class="w-3 h-3 rounded-full flex-shrink-0" style="background:${txn.source_color || '#6366f1'}"></div>
            <div class="min-w-0">
                <p class="text-sm font-medium text-slate-800 truncate">${txn.merchant}</p>
                <p class="text-xs text-slate-500">${txn.source_name || ''}${showFull ? ' · ' + txn.transaction_date : ''}</p>
            </div>
        </div>
        <div class="text-right flex-shrink-0 ml-2">
            <p class="text-sm font-semibold text-slate-800">₹${Number(txn.amount).toLocaleString('en-IN')}</p>
            <div class="flex items-center gap-1.5 justify-end mt-0.5">
                ${txn.expected_cashback > 0 ? `<span class="text-[10px] text-emerald-600">₹${txn.expected_cashback}</span>` : ''}
                <span class="text-[10px] font-medium px-1.5 py-0.5 rounded-full ${badge}">${txn.status}</span>
            </div>
        </div>
    </div>`;
}

// ===== SOURCES =====
async function loadSources() {
    try {
        const data = await api('/sources/');
        sources = data.results || data;
        const container = document.getElementById('source-list');
        if (sources.length === 0) {
            container.innerHTML = '<p class="text-sm text-slate-400 py-8 text-center">No payment sources</p>';
            return;
        }
        container.innerHTML = sources.map(src => `
        <div class="bg-white rounded-xl p-4 shadow-sm border border-slate-100 flex items-center justify-between">
            <div class="flex items-center gap-3 min-w-0">
                <div class="w-3 h-3 rounded-full flex-shrink-0" style="background:${src.color}"></div>
                <div class="min-w-0">
                <p class="text-sm font-semibold text-slate-800">${src.name}</p>
                <p class="text-xs text-slate-500">${src.provider} · ${src.source_type.toUpperCase()}${src.network ? ' · ' + src.network : ''}</p>
                <p class="text-xs font-medium text-emerald-600 mt-1">Earned: ₹${Number(src.total_earned || 0).toLocaleString('en-IN')}</p>
                </div>
            </div>
            <div class="flex items-center gap-3 flex-shrink-0">
                <label class="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" ${src.is_active ? 'checked' : ''} onchange="toggleSource(${src.id}, this.checked)" class="sr-only peer">
                    <div class="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:bg-emerald-500 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full"></div>
                </label>
                <button onclick="editSource(${src.id})" class="text-slate-400 hover:text-slate-600">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>
                </button>
            </div>
        </div>`).join('');
        populateSourceDropdowns();
    } catch (e) {
        console.error('Sources load failed:', e);
    }
}

async function toggleSource(id, active) {
    try {
        await api(`/sources/${id}/`, { method: 'PATCH', body: { is_active: active } });
        toast(active ? 'Source activated' : 'Source deactivated');
    } catch (e) {
        toast('Failed to update', 'error');
    }
}

// ===== OFFERS =====
async function loadOffers() {
    try {
        const data = await api('/offers/?is_active=true');
        const offers = data.results || data;
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const expiring = [];
        const active = [];
        offers.forEach(ofr => {
            const until = new Date(ofr.valid_until);
            const daysLeft = Math.ceil((until - today) / 86400000);
            ofr._daysLeft = daysLeft;
            if (daysLeft <= 7 && daysLeft >= 0) expiring.push(ofr);
            else if (daysLeft > 7) active.push(ofr);
        });

        const section = document.getElementById('expiring-section');
        section.classList.toggle('hidden', expiring.length === 0);
        document.getElementById('expiring-offers').innerHTML = expiring.map(ofr => offerCard(ofr, true)).join('');
        const container = document.getElementById('offer-list');
        container.innerHTML = active.length
            ? active.map(ofr => offerCard(ofr)).join('')
            : '<p class="text-sm text-slate-400 py-8 text-center">No active offers</p>';
    } catch (e) {
        console.error('Offers load failed:', e);
    }
}

function offerCard(ofr, urgent = false) {
    const detail = ofr.offer_type === 'percentage'
        ? `${ofr.value}% cashback${ofr.max_cap ? ` (max ₹${ofr.max_cap})` : ''}`
        : `Flat ₹${ofr.value}`;
    const badgeClass = ofr._daysLeft <= 2 ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700';
    return `
    <div class="bg-white rounded-xl p-3 shadow-sm border border-slate-100" onclick="editOffer(${ofr.id})">
        <div class="flex items-start justify-between">
            <div class="min-w-0">
                <div class="flex items-center gap-2 mb-1">
                    <span class="text-xs font-medium bg-primary-50 text-primary-700 px-2 py-0.5 rounded-full">${ofr.category}</span>
                    <span class="text-[10px] font-medium px-1.5 py-0.5 rounded-full ${badgeClass}">${ofr._daysLeft}d left</span>
                </div>
                <p class="text-sm font-semibold text-slate-800">${detail}</p>
                <p class="text-xs text-slate-500 mt-0.5">${ofr.source_name || 'Source'} · ${ofr.valid_from} to ${ofr.valid_until}</p>
            </div>
        </div>
    </div>`;
}

// ===== MODALS =====
function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

function openTransactionModal() {
    document.getElementById('form-transaction').reset();
    document.getElementById('txn-edit-id').value = '';
    document.getElementById('txn-offer-id').value = '';
    document.getElementById('cashback-preview').classList.add('hidden');
    document.getElementById('txn-date').value = new Date().toISOString().split('T')[0];
    populateSourceDropdowns();
    openModal('modal-transaction');
}

function openSourceModal() {
    document.getElementById('form-source').reset();
    document.getElementById('src-edit-id').value = '';
    document.getElementById('src-color').value = '#6366f1';
    openModal('modal-source');
}

function openOfferModal() {
    document.getElementById('form-offer').reset();
    document.getElementById('ofr-edit-id').value = '';
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('ofr-from').value = today;
    populateSourceDropdowns();
    openModal('modal-offer');
}

// ===== POPULATE DROPDOWNS =====
async function populateSourceDropdowns() {
    if (sources.length === 0) {
        try {
            const data = await api('/sources/');
            sources = data.results || data;
        } catch (e) { return; }
    }
    const opts = sources.map(s => `<option value="${s.id}">${s.name} (${s.provider})</option>`).join('');
    ['txn-source', 'ofr-source'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = '<option value="">Select source...</option>' + opts;
    });
    const filterSource = document.getElementById('filter-source');
    if (filterSource) filterSource.innerHTML = '<option value="">All Sources</option>' + opts;
}

// ===== AUTO-CALCULATE CASHBACK =====
let calcTimeout;
function setupCashbackCalc() {
    ['txn-source', 'txn-amount', 'txn-category'].forEach(id => {
        document.getElementById(id).addEventListener('input', () => {
            clearTimeout(calcTimeout);
            calcTimeout = setTimeout(calcCashback, 400);
        });
        document.getElementById(id).addEventListener('change', () => {
            clearTimeout(calcTimeout);
            calcTimeout = setTimeout(calcCashback, 200);
        });
    });
}

async function calcCashback() {
    const sourceId = document.getElementById('txn-source').value;
    const amount = document.getElementById('txn-amount').value;
    const category = document.getElementById('txn-category').value;
    if (!sourceId || !amount) return;

    try {
        const data = await api('/calculate-cashback/', {
            method: 'POST',
            body: { source_id: sourceId, amount: parseFloat(amount), category }
        });
        const preview = document.getElementById('cashback-preview');
        if (data.expected_cashback > 0) {
            preview.classList.remove('hidden');
            document.getElementById('preview-amount').textContent = `₹${data.expected_cashback}`;
            document.getElementById('preview-offer').textContent = data.offer_details
                ? `${data.offer_details.offer_type === 'percentage' ? data.offer_details.value + '%' : '₹' + data.offer_details.value} on ${data.offer_details.category}`
                : '';
            document.getElementById('txn-cashback').value = data.expected_cashback;
            document.getElementById('txn-offer-id').value = data.offer_id || '';
        } else {
            preview.classList.add('hidden');
            document.getElementById('txn-cashback').value = '0';
            document.getElementById('txn-offer-id').value = '';
        }
    } catch (e) { /* silent */ }
}

// ===== SAVE HANDLERS =====
async function saveTransaction(e) {
    e.preventDefault();
    const editId = document.getElementById('txn-edit-id').value;
    const body = {
        source: parseInt(document.getElementById('txn-source').value),
        amount: document.getElementById('txn-amount').value,
        merchant: document.getElementById('txn-merchant').value,
        category: document.getElementById('txn-category').value,
        transaction_date: document.getElementById('txn-date').value,
        expected_cashback: document.getElementById('txn-cashback').value || '0',
        notes: document.getElementById('txn-notes').value,
    };
    const offerId = document.getElementById('txn-offer-id').value;
    if (offerId) body.offer = parseInt(offerId);

    try {
        if (editId) {
            await api(`/transactions/${editId}/`, { method: 'PUT', body });
            toast('Transaction updated');
        } else {
            await api('/transactions/', { method: 'POST', body });
            toast('Transaction added');
        }
        closeModal('modal-transaction');
        if (currentPage === 'home') loadDashboard();
        else if (currentPage === 'transactions') { txnPage = 1; loadTransactions(); }
    } catch (e) {
        toast('Failed to save', 'error');
    }
}

async function saveSource(e) {
    e.preventDefault();
    const editId = document.getElementById('src-edit-id').value;
    const body = {
        name: document.getElementById('src-name').value,
        source_type: document.getElementById('src-type').value,
        provider: document.getElementById('src-provider').value,
        network: document.getElementById('src-network').value,
        color: document.getElementById('src-color').value,
    };
    try {
        if (editId) {
            await api(`/sources/${editId}/`, { method: 'PUT', body });
            toast('Source updated');
        } else {
            await api('/sources/', { method: 'POST', body });
            toast('Source added');
        }
        closeModal('modal-source');
        sources = []; // Force refresh
        loadSources();
    } catch (e) {
        toast('Failed to save', 'error');
    }
}

async function saveOffer(e) {
    e.preventDefault();
    const editId = document.getElementById('ofr-edit-id').value;
    const body = {
        source: parseInt(document.getElementById('ofr-source').value),
        category: document.getElementById('ofr-category').value,
        offer_type: document.getElementById('ofr-type').value,
        value: document.getElementById('ofr-value').value,
        max_cap: document.getElementById('ofr-cap').value || null,
        valid_from: document.getElementById('ofr-from').value,
        valid_until: document.getElementById('ofr-until').value,
        terms: document.getElementById('ofr-terms').value,
    };
    try {
        if (editId) {
            await api(`/offers/${editId}/`, { method: 'PUT', body });
            toast('Offer updated');
        } else {
            await api('/offers/', { method: 'POST', body });
            toast('Offer added');
        }
        closeModal('modal-offer');
        loadOffers();
    } catch (e) {
        toast('Failed to save', 'error');
    }
}

// ===== EDIT HANDLERS =====
async function editTransaction(id) {
    try {
        const txn = await api(`/transactions/${id}/`);
        document.getElementById('txn-edit-id').value = id;
        document.getElementById('txn-source').value = txn.source;
        document.getElementById('txn-amount').value = txn.amount;
        document.getElementById('txn-merchant').value = txn.merchant;
        document.getElementById('txn-category').value = txn.category || '';
        document.getElementById('txn-date').value = txn.transaction_date;
        document.getElementById('txn-cashback').value = txn.expected_cashback;
        document.getElementById('txn-notes').value = txn.notes || '';
        document.getElementById('txn-offer-id').value = txn.offer || '';

        // Add status selector for editing
        const form = document.getElementById('form-transaction');
        let statusDiv = document.getElementById('txn-status-group');
        if (!statusDiv) {
            statusDiv = document.createElement('div');
            statusDiv.id = 'txn-status-group';
            statusDiv.innerHTML = `
                <label class="block text-sm font-medium text-slate-700 mb-1">Status</label>
                <div class="flex gap-2">
                    <button type="button" onclick="setTxnStatus('pending')" class="txn-status-btn flex-1 py-2 rounded-lg text-xs font-medium border border-slate-200">Pending</button>
                    <button type="button" onclick="setTxnStatus('received')" class="txn-status-btn flex-1 py-2 rounded-lg text-xs font-medium border border-slate-200">Received</button>
                    <button type="button" onclick="setTxnStatus('disputed')" class="txn-status-btn flex-1 py-2 rounded-lg text-xs font-medium border border-slate-200">Disputed</button>
                </div>
                <input type="hidden" id="txn-status" value="">
                <div id="actual-cashback-group" class="mt-3 hidden">
                    <label class="block text-sm font-medium text-slate-700 mb-1">Actual Cashback (₹)</label>
                    <input type="number" id="txn-actual" step="0.01" min="0" class="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm">
                </div>`;
            form.querySelector('button[type="submit"]').before(statusDiv);
        }
        statusDiv.classList.remove('hidden');
        setTxnStatus(txn.status);
        if (txn.actual_cashback !== null) document.getElementById('txn-actual').value = txn.actual_cashback;
        populateSourceDropdowns();
        setTimeout(() => document.getElementById('txn-source').value = txn.source, 100);
        openModal('modal-transaction');
    } catch (e) { toast('Failed to load', 'error'); }
}

function setTxnStatus(status) {
    document.getElementById('txn-status').value = status;
    document.querySelectorAll('.txn-status-btn').forEach(btn => {
        btn.classList.remove('bg-amber-100', 'text-amber-700', 'bg-emerald-100', 'text-emerald-700', 'bg-rose-100', 'text-rose-700', 'border-transparent');
        btn.classList.add('border-slate-200', 'text-slate-600');
    });
    const colors = { pending: ['bg-amber-100', 'text-amber-700'], received: ['bg-emerald-100', 'text-emerald-700'], disputed: ['bg-rose-100', 'text-rose-700'] };
    const btns = document.querySelectorAll('.txn-status-btn');
    const idx = ['pending', 'received', 'disputed'].indexOf(status);
    if (idx >= 0 && btns[idx]) {
        btns[idx].classList.add(...colors[status], 'border-transparent');
        btns[idx].classList.remove('border-slate-200', 'text-slate-600');
    }
    document.getElementById('actual-cashback-group').classList.toggle('hidden', status !== 'received');
}

// Override saveTransaction to include status/actual when editing
const _origSaveTxn = saveTransaction;
saveTransaction = async function(e) {
    e.preventDefault();
    const editId = document.getElementById('txn-edit-id').value;
    const body = {
        source: parseInt(document.getElementById('txn-source').value),
        amount: document.getElementById('txn-amount').value,
        merchant: document.getElementById('txn-merchant').value,
        category: document.getElementById('txn-category').value,
        transaction_date: document.getElementById('txn-date').value,
        expected_cashback: document.getElementById('txn-cashback').value || '0',
        notes: document.getElementById('txn-notes').value,
    };
    const offerId = document.getElementById('txn-offer-id').value;
    if (offerId) body.offer = parseInt(offerId);
    if (editId) {
        const statusEl = document.getElementById('txn-status');
        if (statusEl && statusEl.value) body.status = statusEl.value;
        const actualEl = document.getElementById('txn-actual');
        if (actualEl && actualEl.value) body.actual_cashback = actualEl.value;
    }
    try {
        if (editId) {
            await api(`/transactions/${editId}/`, { method: 'PUT', body });
            toast('Transaction updated');
        } else {
            await api('/transactions/', { method: 'POST', body });
            toast('Transaction added');
        }
        closeModal('modal-transaction');
        // Hide status group for next add
        const sg = document.getElementById('txn-status-group');
        if (sg) sg.classList.add('hidden');
        if (currentPage === 'home') loadDashboard();
        else if (currentPage === 'transactions') { txnPage = 1; loadTransactions(); }
    } catch (e) {
        toast('Failed to save', 'error');
    }
};

async function editSource(id) {
    try {
        const src = await api(`/sources/${id}/`);
        document.getElementById('src-edit-id').value = id;
        document.getElementById('src-name').value = src.name;
        document.getElementById('src-type').value = src.source_type;
        document.getElementById('src-provider').value = src.provider;
        document.getElementById('src-network').value = src.network || '';
        document.getElementById('src-color').value = src.color;
        openModal('modal-source');
    } catch (e) { toast('Failed to load', 'error'); }
}

async function editOffer(id) {
    try {
        const ofr = await api(`/offers/${id}/`);
        document.getElementById('ofr-edit-id').value = id;
        document.getElementById('ofr-source').value = ofr.source;
        document.getElementById('ofr-category').value = ofr.category;
        document.getElementById('ofr-type').value = ofr.offer_type;
        document.getElementById('ofr-value').value = ofr.value;
        document.getElementById('ofr-cap').value = ofr.max_cap || '';
        document.getElementById('ofr-from').value = ofr.valid_from;
        document.getElementById('ofr-until').value = ofr.valid_until;
        document.getElementById('ofr-terms').value = ofr.terms || '';
        populateSourceDropdowns();
        setTimeout(() => document.getElementById('ofr-source').value = ofr.source, 100);
        openModal('modal-offer');
    } catch (e) { toast('Failed to load', 'error'); }
}

// ===== INIT =====
function init() {
    // Route based on URL
    const path = window.location.pathname;
    if (path.includes('transactions')) navigate('transactions');
    else if (path.includes('cards')) navigate('cards');
    else if (path.includes('offers')) navigate('offers');
    else navigate('home');

    setupCashbackCalc();

    // Populate month filter
    const monthSelect = document.getElementById('filter-month');
    const now = new Date();
    for (let i = 0; i < 12; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const label = d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
        monthSelect.innerHTML += `<option value="${val}">${label}</option>`;
    }

    // Filter change handlers
    ['filter-month', 'filter-status', 'filter-source'].forEach(id => {
        document.getElementById(id).addEventListener('change', () => { txnPage = 1; loadTransactions(); });
    });

    // Back button support
    window.addEventListener('popstate', (e) => {
        if (e.state && e.state.page) navigate(e.state.page);
    });
}

document.addEventListener('DOMContentLoaded', init);
