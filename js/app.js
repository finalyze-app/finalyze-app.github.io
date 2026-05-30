(function () {
  const F = window.Finalyze;
  const { Store, parseQFX, categorize, normalizeMerchant, merchantKeyOf, categoryColor, getCategories, categoryType, analyze, charts } = F;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  // ---- module state ----
  let sortKey = 'date', sortDir = -1;
  let activeCategory = null;          // cross-filter from the category chart
  let activeCardmember = null;        // cross-filter from the cardmember chart
  let dateFrom = '', dateTo = '';      // manual date-range filter (YYYY-MM-DD)
  let amountMin = '', amountMax = '';  // absolute amount range filter
  let flowFilter = 'all';              // 'all' | 'spend' | 'payment' | 'refund'
  let txnQuery = '', txnCatFilter = '';
  let mergeSort = 'alpha';             // 'alpha' | 'spend$' | 'spend#'
  let excludeTagged = false;           // exclude business/reimbursable from spend
  let activeAccount = 'all';           // 'all' | account id
  let cmpA = { from: '', to: '' }, cmpB = { from: '', to: '' }; // comparison ranges
  let cmpInit = false;                 // seed compare ranges once
  let yrSelected = '';                 // selected year for year-in-review
  let settingsTab = 'categories';      // active settings tab
  let categoryViewMode = 'categories'; // 'categories' | 'groups'
  let hmMonth = '';                    // YYYY-MM for heatmap widget
  let viewName = 'dashboard';          // 'dashboard' | 'prefs'
  let filtersHidden = false;           // collapse the header filter bar
  // dated = date-filtered; catScope = dated + cardmember (base for category chart);
  // cardScope = dated + category (base for cardmember chart); view = dated + both.
  let allTxns = [], datedTxns = [], catScopeTxns = [], cardScopeTxns = [], viewTxns = [], ledgerTxns = [];

  // ---- icons ----
  const ICON = {
    spend: '<path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
    refund: '<path d="M3 12a9 9 0 1 0 9-9 9 9 0 0 0-7 3.3"/><path d="M3 4v3.5H6.5"/>',
    payment: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/><path d="M6 15h4"/>',
    net: '<path d="M12 2v20M2 12h20"/>',
    count: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 4v16"/>',
    avg: '<path d="M3 3v18h18"/><path d="m7 14 4-4 3 3 5-6"/>',
    median: '<line x1="4" y1="12" x2="20" y2="12"/><circle cx="12" cy="12" r="3"/>',
    balance: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  };
  const NAV_ICON = {
    overview: '<rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/>',
    category: '<path d="M21 15.9A9 9 0 1 1 8.1 3"/><path d="M21 8.1A9 9 0 0 0 15.9 3V8.1z"/>',
    merchants: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
    trend: '<path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/>',
    cardmember: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    mom: '<path d="M3 3v18h18"/><rect x="7" y="10" width="3" height="8"/><rect x="14" y="6" width="3" height="12"/>',
    recurring: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/>',
    anomalies: '<path d="m10.3 3.3-8 14A2 2 0 0 0 4 20.3h16a2 2 0 0 0 1.7-3l-8-14a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    transactions: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
    patterns: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 17V9"/><path d="M12 17V5"/><path d="M17 17v-7"/>',
    uncategorized: '<circle cx="12" cy="12" r="10"/><path d="M9.5 9a3 3 0 0 1 5 0c0 2-3 2-3 4"/><path d="M12 17h.01"/>',
    compare: '<path d="M12 3v18"/><path d="M3 7h6l-3-3M3 7l3 3"/><path d="M21 17h-6l3 3M21 17l-3-3"/>',
    yearReview: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    heatmap: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18"/><rect x="5" y="6" width="3" height="3" rx=".5"/><rect x="10" y="6" width="3" height="3" rx=".5"/><rect x="15" y="6" width="3" height="3" rx=".5"/><rect x="5" y="11" width="3" height="3" rx=".5"/><rect x="10" y="11" width="3" height="3" rx=".5"/>',
  };
  const GRIP = '<path d="M8 6h.01M8 12h.01M8 18h.01M16 6h.01M16 12h.01M16 18h.01"/>';
  const EYE_OFF = '<path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 8 10 8a13.2 13.2 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.5 13.5 0 0 0 2 12s3 8 10 8a9.12 9.12 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/>';
  const TRASH = '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>';
  const SEARCH = '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>';
  const PENCIL = '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>';
  const BACK = '<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>';
  const COG = '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>';
  const svg = (path) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;

  // ---- formatting / small helpers ----
  let censored = false;
  function fmt(n) {
    if (censored) return Store.currency() + ' ••••';
    return (n < 0 ? '-' : '') + Store.currency() + ' ' +
      Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtPct(p) { return p == null ? '—' : (p >= 0 ? '+' : '') + p.toFixed(1) + '%'; }
  function fmtYMD(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function datePresetRange(preset) {
    const now = new Date();
    switch (preset) {
      case 'this-month':
        return [fmtYMD(new Date(now.getFullYear(), now.getMonth(), 1)), fmtYMD(new Date(now.getFullYear(), now.getMonth() + 1, 0))];
      case 'last-month':
        return [fmtYMD(new Date(now.getFullYear(), now.getMonth() - 1, 1)), fmtYMD(new Date(now.getFullYear(), now.getMonth(), 0))];
      case 'this-quarter': {
        const q = Math.floor(now.getMonth() / 3);
        return [fmtYMD(new Date(now.getFullYear(), q * 3, 1)), fmtYMD(new Date(now.getFullYear(), q * 3 + 3, 0))];
      }
      case 'last-quarter': {
        const thisQ = Math.floor(now.getMonth() / 3);
        const y = thisQ === 0 ? now.getFullYear() - 1 : now.getFullYear();
        const q = thisQ === 0 ? 3 : thisQ - 1;
        return [fmtYMD(new Date(y, q * 3, 1)), fmtYMD(new Date(y, q * 3 + 3, 0))];
      }
      case 'ytd':
        return [fmtYMD(new Date(now.getFullYear(), 0, 1)), fmtYMD(now)];
      case 'last-year':
        return [fmtYMD(new Date(now.getFullYear() - 1, 0, 1)), fmtYMD(new Date(now.getFullYear() - 1, 11, 31))];
      case 'all':
        return ['', ''];
      default:
        return null;
    }
  }
  function detectDatePreset(from, to) {
    for (const preset of ['this-month', 'last-month', 'this-quarter', 'last-quarter', 'ytd', 'last-year', 'all']) {
      const range = datePresetRange(preset);
      if (range[0] === from && range[1] === to) return preset;
    }
    return '';
  }
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 3600);
  }
  function chip(cat) {
    const c = categoryColor(cat);
    return `<span class="chip" style="background:${c}1a;color:${c}"><span class="dot" style="background:${c}"></span>${cat}</span>`;
  }
  // Mask merchant text in censor mode so a demo doesn't reveal where money goes.
  function maskMerch(s) { return censored ? '••••••' : s; }

  function otherCategory() {
    const cats = getCategories();
    return cats[cats.length - 1];
  }

  // Shared filter pipeline. Claude extends excludeTags for business/reimbursable tags.
  function filterTxns(txns, opts) {
    opts = opts || {};
    const {
      dateFrom: from, dateTo: to, amountMin: min, amountMax: max,
      flowFilter: flow, excludeTags,
    } = opts;
    const minN = min !== '' && min != null ? Number(min) : null;
    const maxN = max !== '' && max != null ? Number(max) : null;
    return txns.filter((t) => {
      if (from && t.date < from) return false;
      if (to && t.date > to) return false;
      if (flow && flow !== 'all' && t.flow !== flow) return false;
      const amt = Math.abs(t.amount);
      if (minN != null && !isNaN(minN) && amt < minN) return false;
      if (maxN != null && !isNaN(maxN) && amt > maxN) return false;
      if (excludeTags && typeof excludeTags === 'function' && excludeTags(t)) return false;
      return true;
    });
  }

  function hasTxnFilters() {
    return !!(amountMin || amountMax || (flowFilter && flowFilter !== 'all'));
  }

  function flowFilterLabel(flow) {
    return ({ spend: 'Spend', payment: 'Payments', refund: 'Refunds' })[flow] || flow;
  }

  function getCategoryGroups() { return Store.getCategoryGroups(); }

  function groupForCategory(cat) {
    return getCategoryGroups().find((g) => g.categories.includes(cat));
  }

  function categoriesInGroup(name) {
    const g = getCategoryGroups().find((x) => x.name === name);
    return g ? g.categories.slice() : [name];
  }

  function txnMatchesSlice(t, slice) {
    if (!slice) return true;
    if (categoryViewMode === 'groups') {
      const g = getCategoryGroups().find((x) => x.name === slice);
      if (g) return g.categories.includes(t.category);
    }
    return t.category === slice;
  }

  function sliceColor(name) {
    const g = getCategoryGroups().find((x) => x.name === name);
    return g ? g.color : categoryColor(name);
  }

  function filterChip(label) {
    const c = sliceColor(label);
    return `<span class="chip" style="background:${c}1a;color:${c}"><span class="dot" style="background:${c}"></span>${label}</span>`;
  }

  // ---- Feature 4: transaction tags ----
  function tagsOf(tid) {
    const tags = Store.getTxnTags()[tid];
    return tags ? tags.slice() : [];
  }
  function excludeTaggedFn() {
    return excludeTagged ? (t) => (t.tags && t.tags.length > 0) : null;
  }

  function enriched() {
    const overrides = Store.getOverrides();
    return Store.getTransactions().map((t) => {
      const category = categorize(t.name, overrides);
      const type = categoryType(category);
      const row = { ...t, merchantKey: merchantKeyOf(t.name), category };
      row.tid = t.fitid || (t.date + '|' + t.name + '|' + t.amount);
      // Tags = per-transaction tags ∪ merchant-level tags.
      const mTags = Store.getMerchantTags()[row.merchantKey] || [];
      row.tags = [...new Set([...tagsOf(row.tid), ...mTags])];
      const cmOv = Store.getCardmemberOverrides()[row.tid];
      if (cmOv) row.cardmember = cmOv;
      // Flow drives every total: a category typed 'payment'/'refund' forces the txn
      // into that bucket regardless of sign; otherwise a credit is a refund and a
      // debit is spend.
      let flow;
      if (type === 'payment') flow = 'payment';
      else if (type === 'refund') flow = 'refund';
      else flow = t.amount < 0 ? 'spend' : 'refund';
      const amt = Math.abs(t.amount);
      row.flow = flow;
      row.isSpend = flow === 'spend';
      row.spend = flow === 'spend' ? amt : 0;
      row.payment = flow === 'payment' ? amt : 0;
      row.refund = flow === 'refund' ? amt : 0;
      return row;
    });
  }

  // ============ Widget registry ============
  const WIDGETS = [
    { id: 'overview', nav: 'Overview', eyebrow: 'Summary', title: 'Spending overview',
      body: `<div class="cards" id="summaryCards"></div>`, render: renderSummary },
    { id: 'category', nav: 'By category', eyebrow: 'Breakdown', title: 'Spend by category',
      hint: 'Click a slice to filter', body: `<div class="cat-view-toggle"><label>View <select id="catViewMode"><option value="categories">Categories</option><option value="groups">Groups</option></select></label></div><div class="canvas-wrap"><canvas id="chartCategory"></canvas></div>`, render: renderCategory },
    { id: 'merchants', nav: 'Merchants', eyebrow: 'Merchants', title: 'Top merchants',
      body: `<div class="canvas-wrap"><canvas id="chartMerchant"></canvas></div>`, render: () => charts.merchantBar(analyze.byMerchant(viewTxns)) },
    { id: 'trend', nav: 'Trend', eyebrow: 'Trend', title: 'Spend over time',
      body: `<div class="canvas-wrap"><canvas id="chartTrend"></canvas></div>`, render: () => charts.spendLine(analyze.spendOverTime(viewTxns)) },
    { id: 'cardmember', nav: 'Cardmembers', eyebrow: 'People', title: 'By cardmember',
      hint: 'Click a bar to filter', body: `<div class="canvas-wrap"><canvas id="chartCardmember"></canvas></div>`,
      render: () => charts.cardmemberBar(analyze.byCardmember(cardScopeTxns), activeCardmember) },
    { id: 'mom', nav: 'Month over month', eyebrow: 'Comparison', title: 'Month over month',
      hint: 'Builds up as you import more statements',
      body: `<div class="canvas-wrap tall"><canvas id="chartMoM"></canvas></div>
        <div class="table-wrap"><table id="momTable"></table></div>
        <h3>Biggest category movers (vs previous month)</h3>
        <div class="table-wrap"><table id="moversTable"></table></div>`,
      render: () => renderMoM(viewTxns) },
    { id: 'recurring', nav: 'Recurring', eyebrow: 'Subscriptions', title: 'Recurring charges',
      hint: 'Same merchant & exact amount', body: `<div class="table-wrap"><table id="recurringTable"></table></div>`, render: renderRecurring },
    { id: 'anomalies', nav: 'Anomalies', eyebrow: 'Flags', title: 'Anomalies',
      body: `<div class="table-wrap"><table id="anomalyTable"></table></div>`, render: () => renderAnomalies(viewTxns) },
    { id: 'patterns', nav: 'Patterns', eyebrow: 'Behavior', title: 'Spending patterns',
      hint: 'Spend-only · respects filters', body: `<div class="patterns-grid"><div class="canvas-wrap"><canvas id="chartDow"></canvas></div><div class="canvas-wrap"><canvas id="chartWom"></canvas></div></div>`,
      render: renderPatterns },
    { id: 'heatmap', nav: 'Heatmap', eyebrow: 'Calendar', title: 'Spend heatmap',
      hint: 'Click a day to filter', body: `<div class="hm-head"><select id="hmMonth"></select><div class="hm-legend" id="hmLegend"></div></div><div id="heatmapGrid"></div>`,
      render: renderHeatmap },
    { id: 'uncategorized', nav: 'Uncategorized', eyebrow: 'Review', title: 'Review uncategorized',
      hint: 'Assign a category to clear the backlog', body: `<div class="table-wrap"><table id="uncatTable"></table></div>`, render: renderUncategorized },
    { id: 'compare', nav: 'Compare', eyebrow: 'Periods', title: 'Compare periods',
      hint: 'Pick two date ranges',
      body: `<div class="cmp-ranges">
          <div class="cmp-range"><span class="dr-label">Period A</span><input type="date" id="cmpAFrom"><span class="dr-sep">→</span><input type="date" id="cmpATo"></div>
          <div class="cmp-range"><span class="dr-label">Period B</span><input type="date" id="cmpBFrom"><span class="dr-sep">→</span><input type="date" id="cmpBTo"></div>
        </div>
        <div id="compareOut"></div>`,
      render: renderCompare },
    { id: 'yearReview', nav: 'Year in review', eyebrow: 'Annual', title: 'Year in review',
      hint: 'Needs a full year of data',
      body: `<div class="yr-head"><select id="yrSelect"></select></div><div id="yearReviewOut"></div>`,
      render: renderYearReview },
    { id: 'transactions', nav: 'Transactions', eyebrow: 'Ledger', title: 'Transactions',
      body: `<div class="controls">
          <div class="field">${svg(SEARCH)}<input type="search" id="txnSearch" placeholder="Search merchant…" /></div>
          <select id="txnCategory"><option value="">All categories</option></select>
          <span class="count" id="txnCount"></span>
        </div>
        <div class="bulk-bar">
          <label class="bulk-all"><input type="checkbox" id="txnSelectAll"> Select visible</label>
          <select id="bulkCat"></select>
          <button class="btn" id="bulkApply" disabled>Apply to 0 merchants</button>
          <span class="bulk-sep"></span>
          <input type="text" id="bulkCardholder" list="cardholderList" placeholder="Cardholder…" />
          <datalist id="cardholderList"></datalist>
          <button class="btn" id="bulkCardApply" disabled>Set cardholder on 0</button>
        </div>
        <div class="table-wrap"><table id="txnTable"><thead><tr>
          <th class="chk-cell"></th><th data-sort="date">Date</th><th data-sort="name">Merchant</th><th data-sort="cardmember">Cardmember</th>
          <th data-sort="category">Category</th><th data-sort="amount" class="num">Amount</th><th class="tag-cell">Tags</th><th class="sub-cell">Sub</th>
        </tr></thead><tbody></tbody></table></div>`,
      render: renderTransactions },
  ];
  const WIDGET_MAP = Object.fromEntries(WIDGETS.map((w) => [w.id, w]));
  const DEFAULT_ORDER = WIDGETS.map((w) => w.id);

  function getLayout() {
    const l = Store.getLayout() || {};
    let order = Array.isArray(l.order) ? l.order.filter((id) => WIDGET_MAP[id]) : [];
    DEFAULT_ORDER.forEach((id) => { if (!order.includes(id)) order.push(id); });
    const hidden = (Array.isArray(l.hidden) ? l.hidden : []).filter((id) => WIDGET_MAP[id]);
    const sizes = (l.sizes && typeof l.sizes === 'object') ? l.sizes : {};
    return { order, hidden, sizes };
  }
  function saveLayout(l) {
    const cur = getLayout();
    Store.setLayout({ order: l.order || cur.order, hidden: l.hidden || cur.hidden, sizes: l.sizes || cur.sizes });
  }
  // Some widgets are only meaningful with enough data (e.g. year-in-review needs ≥12 months).
  function widgetAvailable(id) {
    if (id === 'yearReview') return analyze.monthSpan(allTxns) >= 12;
    return true;
  }
  function visibleOrder() {
    const { order, hidden } = getLayout();
    return order.filter((id) => !hidden.includes(id) && widgetAvailable(id));
  }

  // ============ Top-level render ============
  function render() {
    allTxns = enriched();
    const hasData = allTxns.length > 0;
    $('#empty').hidden = hasData || viewName === 'prefs';
    $('#dashboard').hidden = !hasData || viewName === 'prefs';
    $('#prefs').hidden = viewName !== 'prefs';

    const showHead = hasData && viewName !== 'prefs';
    const ftBtn = $('#filtersToggle');
    ftBtn.hidden = !showHead;
    ftBtn.classList.toggle('collapsed', filtersHidden);
    ftBtn.setAttribute('aria-expanded', String(!filtersHidden));
    $('#filtersToggleLabel').textContent = filtersHidden ? 'Show filters' : 'Filters';
    $('#dateControls').hidden = !showHead || filtersHidden;

    document.body.classList.toggle('settings-mode', viewName === 'prefs');
    const h1 = document.querySelector('.page-head h1');
    if (h1) h1.textContent = viewName === 'prefs' ? 'Settings' : 'Spending overview';
    if (viewName === 'prefs') {
      renderPrefs();
      buildSettingsNav();
      showSettingsTab();
      return;
    }
    if (!hasData) { $('#rangeSub').textContent = 'Import a bank statement to begin.'; $('#nav').innerHTML = ''; return; }

    syncDateInputs();
    syncFilterInputs();
    syncAccountFilter();
    const accountTxns = activeAccount === 'all' ? allTxns : allTxns.filter((t) => (t.accountId || 'default') === activeAccount);
    datedTxns = filterTxns(accountTxns, { dateFrom, dateTo, amountMin, amountMax, flowFilter });
    if (activeCategory && !datedTxns.some((t) => txnMatchesSlice(t, activeCategory))) activeCategory = null;
    if (activeCardmember && !datedTxns.some((t) => t.cardmember === activeCardmember)) activeCardmember = null;
    // Analytics base optionally drops tagged (business/reimbursable) txns; the ledger keeps them.
    const anaBase = excludeTagged ? datedTxns.filter((t) => !(t.tags && t.tags.length)) : datedTxns;
    const matchCross = (base) => base.filter((t) =>
      (!activeCategory || txnMatchesSlice(t, activeCategory)) && (!activeCardmember || t.cardmember === activeCardmember));
    // Each chart's base ignores its own filter so you can switch selections.
    catScopeTxns = activeCardmember ? anaBase.filter((t) => t.cardmember === activeCardmember) : anaBase;
    cardScopeTxns = activeCategory ? anaBase.filter((t) => txnMatchesSlice(t, activeCategory)) : anaBase;
    viewTxns = matchCross(anaBase);
    ledgerTxns = matchCross(datedTxns);

    const s = analyze.summary(datedTxns);
    const filterBits = [];
    if (dateFrom || dateTo) filterBits.push(`${dateFrom || '…'} → ${dateTo || '…'}`);
    if (amountMin || amountMax) filterBits.push(`amount ${amountMin || '…'}–${amountMax || '…'}`);
    if (flowFilter !== 'all') filterBits.push(flowFilterLabel(flowFilter).toLowerCase());
    const rangeNote = filterBits.length ? ` · filtered ${filterBits.join(' · ')}` : '';
    $('#rangeSub').textContent = `${s.count} transactions · ${s.dateFrom || '—'} → ${s.dateTo || '—'} · ${Store.currency()}${rangeNote}`;
    buildNav(true);
    buildWidgets();
    renderFilterBanner();
    renderSizeBanner();
  }

  const SIZE_WARN = 4 * 1024 * 1024;

  async function renderSizeBanner() {
    const host = $('#sizeBanner');
    if (!host) return;
    try {
      const bytes = await Store.estimatedBytes();
      if (bytes >= SIZE_WARN) {
        host.hidden = false;
        host.innerHTML = `<span>Data is getting large (~${(bytes / (1024 * 1024)).toFixed(1)} MB). <button class="linkish" id="sizeExportBtn">Export a backup</button> soon.</span>`;
        $('#sizeExportBtn').onclick = exportBackup;
      } else {
        host.hidden = true;
        host.innerHTML = '';
      }
    } catch (e) { host.hidden = true; }
  }

  // Set the date inputs' bounds from the data once; preserve any user-entered values.
  function syncDateInputs() {
    const from = $('#dateFrom'), to = $('#dateTo'), preset = $('#datePreset');
    if (!from || !to) return;
    const dates = allTxns.map((t) => t.date).sort();
    const min = dates[0] || '', max = dates[dates.length - 1] || '';
    from.min = to.min = min; from.max = to.max = max;
    from.value = dateFrom; to.value = dateTo;
    if (preset) preset.value = detectDatePreset(dateFrom, dateTo);
  }

  function syncFilterInputs() {
    const min = $('#amountMin'), max = $('#amountMax'), flow = $('#flowFilter');
    if (min) min.value = amountMin;
    if (max) max.value = amountMax;
    if (flow) flow.value = flowFilter;
    const excl = $('#exclTags');
    if (excl) excl.checked = excludeTagged;
  }

  // Account filter dropdown: only shown once more than the default account exists.
  function syncAccountFilter() {
    const sel = $('#accountFilter');
    if (!sel) return;
    const accounts = Store.getAccounts();
    const multi = accounts.length > 1;
    sel.hidden = !multi;
    if (!multi) { activeAccount = 'all'; return; }
    sel.innerHTML = `<option value="all">All accounts</option>` +
      accounts.map((a) => `<option value="${a.id}">${a.label}</option>`).join('');
    if (!accounts.some((a) => a.id === activeAccount) && activeAccount !== 'all') activeAccount = 'all';
    sel.value = activeAccount;
  }

  function buildNav(hasData) {
    const nav = $('#nav');
    if (!hasData) { nav.innerHTML = ''; return; }
    const ids = visibleOrder();
    nav.innerHTML = ids.map((id) =>
      `<a href="#widget-${id}" data-widget="${id}">${svg(NAV_ICON[id] || '')} ${WIDGET_MAP[id].nav}</a>`).join('');
    $$('#nav a').forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault();
      const goto = () => { const el = document.getElementById('widget-' + a.dataset.widget); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
      if (viewName !== 'dashboard') { viewName = 'dashboard'; render(); requestAnimationFrame(goto); }
      else goto();
      document.body.classList.remove('nav-open');
    }));
  }

  // Settings is organised into tabs; each tab shows a subset of the prefs panels.
  const SETTINGS_TABS = [
    { id: 'categories', label: 'Categories & rules', panels: ['set-categories', 'set-rules', 'set-groups', 'set-merchants'] },
    { id: 'budgets', label: 'Budgets', panels: ['set-budgets'] },
    { id: 'accounts', label: 'Accounts & data', panels: ['set-accounts', 'set-danger'] },
    { id: 'layout', label: 'Layout', panels: ['set-layout'] },
  ];

  // Settings-mode sidebar: a back button + a tab per settings group.
  function buildSettingsNav() {
    const nav = $('#nav');
    nav.innerHTML =
      `<button class="nav-back" id="navBack">${svg(BACK)} Back to dashboard</button>` +
      `<div class="nav-section-label">${svg(COG)} Settings</div>` +
      SETTINGS_TABS.map((t) => `<a href="#" data-tab="${t.id}"${t.id === 'accounts' ? ' class="nav-danger-tab"' : ''}>${t.label}</a>`).join('');
    $('#navBack').onclick = () => { viewName = 'dashboard'; render(); };
    $$('#nav a[data-tab]').forEach((a) => a.onclick = (e) => {
      e.preventDefault();
      settingsTab = a.dataset.tab;
      showSettingsTab();
      document.body.classList.remove('nav-open');
    });
  }

  // Show only the panels belonging to the active tab; highlight its nav link.
  function showSettingsTab() {
    const active = SETTINGS_TABS.find((t) => t.id === settingsTab) || SETTINGS_TABS[0];
    settingsTab = active.id;
    const shown = new Set(active.panels);
    SETTINGS_TABS.forEach((t) => t.panels.forEach((pid) => {
      const el = document.getElementById(pid);
      if (el) el.hidden = !shown.has(pid);
    }));
    $$('#nav a[data-tab]').forEach((a) => a.classList.toggle('active', a.dataset.tab === settingsTab));
    $('#rangeSub').textContent = 'Settings › ' + active.label;
    const main = document.querySelector('main');
    if (main && main.scrollTo) main.scrollTo({ top: 0 });
  }

  function buildWidgets() {
    const container = $('#widgets');
    const ids = visibleOrder();
    const { sizes } = getLayout();
    container.innerHTML = ids.map((id) => {
      const w = WIDGET_MAP[id];
      const half = sizes[id] === 'half' ? ' half' : '';
      return `<section class="panel widget${half}" id="widget-${id}" data-widget="${id}">
        <div class="widget-head">
          <span class="drag-handle" title="Drag to reorder">${svg(GRIP)}</span>
          <div class="titles"><div class="eyebrow">${w.eyebrow}</div><h2>${w.title}</h2></div>
          <div class="widget-tools">${w.hint ? `<span class="hint">${w.hint}</span>` : ''}<button class="icon-btn widget-hide" title="Hide widget">${svg(EYE_OFF)}</button></div>
        </div>
        <div class="widget-body">${w.body}</div>
      </section>`;
    }).join('');

    ids.forEach((id) => WIDGET_MAP[id].render());

    $$('#widgets .widget-hide').forEach((btn) =>
      btn.addEventListener('click', () => hideWidget(btn.closest('.widget').dataset.widget)));

    makeSortable(container, '.widget', onDashboardReorder);
    initScrollSpy();
  }

  // ============ Widget renderers ============
  function card(icon, label, value, cls, deltaHtml) {
    return `<div class="card">
      <div class="top"><span class="ic">${svg(icon)}</span>${deltaHtml || ''}</div>
      <div class="value ${cls || ''}">${value}</div>
      <div class="label">${label}</div>
    </div>`;
  }

  function renderSummary() {
    const txns = viewTxns;
    const s = analyze.summary(txns);
    const mom = analyze.monthOverMonth(txns);
    let spendDelta = '';
    if (mom.length >= 2) {
      const m = mom[mom.length - 1];
      if (m.pctSpend != null) {
        const up = m.deltaSpend > 0;
        spendDelta = `<span class="delta ${up ? 'up' : 'down'}">${svg(up ? '<path d="m6 15 6-6 6 6"/>' : '<path d="m6 9 6 6 6-6"/>')}${fmtPct(m.pctSpend)}</span>`;
      }
    }
    const bal = Store.balance();
    const cards = [
      card(ICON.spend, excludeTagged ? 'True spend' : 'Total spend', fmt(s.totalSpend), '', spendDelta),
      card(ICON.refund, 'Refunds', fmt(s.totalRefunds), 'pos'),
      card(ICON.payment, 'Payments', fmt(s.totalPayments), 'pos'),
      card(ICON.net, 'Net spend', fmt(s.net), ''),
      card(ICON.count, 'Transactions', String(s.count), ''),
      card(ICON.avg, 'Avg / txn', fmt(s.avgSpend), ''),
      card(ICON.median, 'Median / txn', fmt(s.medianSpend), ''),
    ];
    // Tagged totals (computed over the date/account-scoped ledger so they're stable
    // regardless of the exclude toggle).
    const sumSpend = (tag) => ledgerTxns.reduce((a, t) => a + ((t.isSpend && t.tags && t.tags.includes(tag)) ? t.spend : 0), 0);
    const bizTotal = sumSpend('business');
    const reimbTotal = sumSpend('reimbursable');
    if (bizTotal > 0) cards.push(card(ICON.balance, 'Business expenses', fmt(bizTotal), 'small'));
    if (reimbTotal > 0) cards.push(card(ICON.refund, 'Reimbursable', fmt(reimbTotal), 'small'));
    if (!activeCategory && bal != null) cards.push(card(ICON.balance, 'Statement balance', fmt(bal), bal < 0 ? 'neg' : ''));
    if (s.dateFrom) cards.push(card(ICON.calendar, 'Date range', `${s.dateFrom}<br>→ ${s.dateTo}`, 'small'));
    $('#summaryCards').innerHTML = cards.join('');

    renderBudgetAlerts();
  }

  // ---- Feature 3: budget alerts ----
  // Current calendar-month spend per category, scoped to the active account.
  function currentMonthByCategory() {
    const ym = new Date().toISOString().slice(0, 7);
    const base = activeAccount === 'all' ? allTxns : allTxns.filter((t) => (t.accountId || 'default') === activeAccount);
    const byCat = {};
    base.forEach((t) => { if (t.isSpend && t.date.slice(0, 7) === ym) byCat[t.category] = (byCat[t.category] || 0) + t.spend; });
    return byCat;
  }

  function currentMonthGroupSpend() {
    const byCat = currentMonthByCategory();
    const groups = getCategoryGroups();
    const inGroup = new Set();
    const byGroup = {};
    groups.forEach((g) => {
      g.categories.forEach((c) => inGroup.add(c));
      byGroup[g.name] = g.categories.reduce((a, c) => a + (byCat[c] || 0), 0);
    });
    return { byCat, byGroup, inGroup };
  }

  function overBudgetCategories() {
    const budgets = Store.getBudgets();
    const { byCat, byGroup, inGroup } = currentMonthGroupSpend();
    const alerts = [];
    getCategoryGroups().forEach((g) => {
      if (budgets[g.name] == null) return;
      const spent = byGroup[g.name] || 0;
      const budget = budgets[g.name];
      alerts.push({ cat: g.name, spent, budget, pct: budget ? (spent / budget) * 100 : 0, isGroup: true });
    });
    Object.keys(budgets).forEach((c) => {
      if (inGroup.has(c)) return;
      if (getCategoryGroups().some((g) => g.name === c)) return;
      const spent = byCat[c] || 0;
      const budget = budgets[c];
      alerts.push({ cat: c, spent, budget, pct: budget ? (spent / budget) * 100 : 0, isGroup: false });
    });
    return alerts.filter((a) => a.pct >= 80).sort((a, b) => b.pct - a.pct);
  }
  function renderBudgetAlerts() {
    const overview = document.getElementById('widget-overview');
    if (!overview) return;
    let host = overview.querySelector('#budgetAlerts');
    const alerts = overBudgetCategories();
    if (!alerts.length) { if (host) host.remove(); return; }
    if (!host) {
      host = document.createElement('div');
      host.id = 'budgetAlerts';
      host.className = 'budget-alerts';
      const cardsEl = overview.querySelector('#summaryCards');
      cardsEl.parentNode.insertBefore(host, cardsEl.nextSibling);
    }
    const ym = new Date().toISOString().slice(0, 7);
    host.innerHTML = `<div class="ba-head">Budgets · ${ym}</div>` + alerts.map((a) => {
      const over = a.pct >= 100;
      const c = sliceColor(a.cat);
      return `<div class="ba-row ${over ? 'over' : 'near'}">
        <span class="chip" style="background:${c}1a;color:${c}"><span class="dot" style="background:${c}"></span>${a.cat}${a.isGroup ? ' <small>(group)</small>' : ''}</span>
        <div class="ba-bar"><span style="width:${Math.min(100, a.pct).toFixed(0)}%;background:${over ? 'var(--danger,#ef4655)' : c}"></span></div>
        <span class="ba-num">${fmt(a.spent)} / ${fmt(a.budget)} <strong>${a.pct.toFixed(0)}%</strong>${over ? ' ⚠' : ''}</span>
      </div>`;
    }).join('');
  }

  function renderCategory() {
    const sel = $('#catViewMode');
    if (sel) {
      sel.value = categoryViewMode;
      sel.onchange = () => { categoryViewMode = sel.value; activeCategory = null; render(); };
    }
    const data = categoryViewMode === 'groups'
      ? analyze.byCategoryGroup(catScopeTxns, getCategoryGroups())
      : analyze.byCategory(catScopeTxns);
    charts.categoryPie(data, activeCategory);
  }

  function renderMoM(txns) {
    const mom = analyze.monthOverMonth(txns);
    charts.momBar(mom);
    $('#momTable').innerHTML =
      `<thead><tr><th>Month</th><th class="num">Spend</th><th class="num">Refunds</th><th class="num">Payments</th><th class="num">Net</th><th class="num">Δ Spend</th><th class="num">% Δ</th></tr></thead><tbody>` +
      mom.map((m) =>
        `<tr><td>${m.month}</td><td class="num">${fmt(m.spend)}</td><td class="num">${fmt(m.refunds)}</td><td class="num">${fmt(m.payments)}</td><td class="num">${fmt(m.net)}</td>` +
        `<td class="num ${m.deltaSpend > 0 ? 'amt-neg' : m.deltaSpend < 0 ? 'amt-pos' : ''}">${m.deltaSpend == null ? '—' : fmt(m.deltaSpend)}</td>` +
        `<td class="num">${fmtPct(m.pctSpend)}</td></tr>`
      ).join('') + '</tbody>';

    const movers = analyze.categoryMovers(mom).slice(0, 8);
    $('#moversTable').innerHTML = movers.length
      ? `<thead><tr><th>Category</th><th class="num">Previous</th><th class="num">Current</th><th class="num">Δ</th></tr></thead><tbody>` +
        movers.map((m) =>
          `<tr><td>${chip(m.category)}</td><td class="num">${fmt(m.previous)}</td><td class="num">${fmt(m.current)}</td>` +
          `<td class="num ${m.delta > 0 ? 'amt-neg' : 'amt-pos'}">${fmt(m.delta)}</td></tr>`
        ).join('') + '</tbody>'
      : '<tbody><tr><td class="muted-cell">Need at least two months of data.</td></tr></tbody>';
  }

  function renderRecurring() {
    const subs = Store.getSubscriptions();
    const rows = analyze.recurring(viewTxns, subs);
    $('#recurringTable').innerHTML = rows.length
      ? `<thead><tr><th>Merchant</th><th>Category</th><th class="num">Charge</th><th class="num">Times</th><th class="num">Months</th><th>Last seen</th><th></th></tr></thead><tbody>` +
        rows.map((r) =>
          `<tr><td>${maskMerch(r.merchant)}</td><td>${chip(r.category)}</td><td class="num">${fmt(r.amount)}</td>` +
          `<td class="num">${r.count}</td><td class="num">${r.months}</td><td>${r.lastDate}</td>` +
          `<td>${r.marked ? '<span class="tag marked">marked</span>' : ''}</td></tr>`
        ).join('') + '</tbody>'
      : '<tbody><tr><td class="muted-cell">No recurring charges. Tick the “Sub” box on a transaction to track one here.</td></tr></tbody>';
  }

  function renderAnomalies(txns) {
    // Exclude recurring/subscription groups and any merchants the user excluded.
    const subs = Store.getSubscriptions();
    const subKeys = new Set(analyze.recurring(txns, subs).map((r) => r.key));
    const mExcl = Store.getMerchantAnomalyExcludes();
    const isSub = (t) => mExcl[t.merchantKey] || subKeys.has(analyze.subKey(t.merchantKey, t.spend));
    const rows = analyze.anomalies(txns, isSub);
    $('#anomalyTable').innerHTML = rows.length
      ? `<thead><tr><th>Type</th><th>Date</th><th>Merchant</th><th class="num">Amount</th></tr></thead><tbody>` +
        rows.map((r) => {
          const tag = r.type === 'Large outlier' ? 'warn' : 'info';
          return `<tr><td><span class="tag ${tag}">${r.type}</span></td><td>${r.date}</td>` +
            `<td>${maskMerch(r.merchant)}<div class="muted-cell" style="font-size:11px">${censored ? '' : r.reason}</div></td>` +
            `<td class="num amt-neg">${fmt(r.amount)}</td></tr>`;
        }).join('') + '</tbody>'
      : '<tbody><tr><td class="muted-cell">No anomalies detected.</td></tr></tbody>';
  }

  function renderPatterns() {
    charts.spendingPatterns(analyze.byDayOfWeek(viewTxns), analyze.byWeekOfMonth(viewTxns));
  }

  function renderHeatmap() {
    const daily = analyze.dailySpendMap(viewTxns);
    const months = analyze.heatmapMonths(daily, dateFrom, dateTo);
    const sel = $('#hmMonth');
    if (!sel || !months.length) {
      if ($('#heatmapGrid')) $('#heatmapGrid').innerHTML = '<p class="muted-cell">No spend data in the current filters.</p>';
      return;
    }
    if (!hmMonth || !months.some((m) => m.month === hmMonth)) hmMonth = months[months.length - 1].month;
    sel.innerHTML = months.map((m) => `<option value="${m.month}"${m.month === hmMonth ? ' selected' : ''}>${m.label}</option>`).join('');
    sel.onchange = () => { hmMonth = sel.value; renderHeatmap(); };

    const month = months.find((m) => m.month === hmMonth) || months[months.length - 1];
    const monthSpends = [];
    month.weeks.forEach((w) => w.forEach((c) => { if (c && c.spend > 0) monthSpends.push(c.spend); }));
    const maxSpend = monthSpends.length ? Math.max(...monthSpends) : 1;

    const accentRaw = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#5b5bf0';
    const hex = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(accentRaw);
    const rgb = hex
      ? { r: parseInt(hex[1], 16), g: parseInt(hex[2], 16), b: parseInt(hex[3], 16) }
      : { r: 91, g: 91, b: 240 };
    const HM_ALPHA = [0.07, 0.24, 0.4, 0.58, 0.76, 0.92];
    const hmBg = (lvl) => `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${HM_ALPHA[lvl] || 0.07})`;

    function cellLevel(spend) {
      if (!spend) return 0;
      // Sqrt scale spreads mid-range days apart; max is this month only, not global outliers.
      const t = Math.sqrt(spend / maxSpend);
      if (t >= 0.85) return 5;
      if (t >= 0.65) return 4;
      if (t >= 0.45) return 3;
      if (t >= 0.25) return 2;
      return 1;
    }

    const dows = ['', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    let html = '<div class="heatmap-grid"><div class="hm-row hm-labels">' +
      dows.map((d) => `<span class="hm-dow">${d}</span>`).join('') + '</div>';
    month.weeks.forEach((week) => {
      html += '<div class="hm-row">';
      week.forEach((cell) => {
        if (!cell) { html += '<span class="hm-cell empty"></span>'; return; }
        const lvl = cellLevel(cell.spend);
        html += `<button type="button" class="hm-cell" style="background:${hmBg(lvl)}" title="${cell.date}: ${fmt(cell.spend)}" data-date="${cell.date}"></button>`;
      });
      html += '</div>';
    });
    html += '</div>';
    $('#heatmapGrid').innerHTML = html;
    $$('#heatmapGrid .hm-cell[data-date]').forEach((btn) => btn.onclick = () => {
      dateFrom = dateTo = btn.dataset.date;
      render();
      toast(`Filtered to ${btn.dataset.date}`);
    });

    const leg = $('#hmLegend');
    if (leg) {
      leg.innerHTML = '<span class="hm-leg-label">Less</span>' +
        [0, 1, 2, 3, 4, 5].map((i) => `<span class="hm-cell" style="background:${hmBg(i)}"></span>`).join('') +
        '<span class="hm-leg-label">More</span>';
    }
  }

  // ---- Feature 5: comparison view ----
  function renderCompare() {
    // Seed sensible defaults once: A = first month, B = last month.
    if (!cmpInit) {
      const dates = allTxns.map((t) => t.date).sort();
      if (dates.length) {
        const firstMonth = dates[0].slice(0, 7), lastMonth = dates[dates.length - 1].slice(0, 7);
        cmpA = { from: firstMonth + '-01', to: monthEnd(firstMonth) };
        cmpB = { from: lastMonth + '-01', to: monthEnd(lastMonth) };
      }
      cmpInit = true;
    }
    $('#cmpAFrom').value = cmpA.from; $('#cmpATo').value = cmpA.to;
    $('#cmpBFrom').value = cmpB.from; $('#cmpBTo').value = cmpB.to;
    const wire = (id, obj, key) => { $(id).onchange = (e) => { obj[key] = e.target.value; drawCompare(); }; };
    wire('#cmpAFrom', cmpA, 'from'); wire('#cmpATo', cmpA, 'to');
    wire('#cmpBFrom', cmpB, 'from'); wire('#cmpBTo', cmpB, 'to');
    drawCompare();
  }
  function monthEnd(ym) {
    const [y, m] = ym.split('-').map(Number);
    return fmtYMD(new Date(y, m, 0));
  }
  function inRange(t, r) { return (!r.from || t.date >= r.from) && (!r.to || t.date <= r.to); }
  function drawCompare() {
    const base = activeAccount === 'all' ? allTxns : allTxns.filter((t) => (t.accountId || 'default') === activeAccount);
    const txnsA = base.filter((t) => inRange(t, cmpA));
    const txnsB = base.filter((t) => inRange(t, cmpB));
    const cmp = analyze.comparePeriods(txnsA, txnsB);
    const dcell = (d) => `<td class="num ${d > 0 ? 'amt-neg' : d < 0 ? 'amt-pos' : ''}">${d === 0 ? '—' : (d > 0 ? '+' : '') + fmt(d)}</td>`;
    const totalRow = (label, key) => `<tr><td>${label}</td><td class="num">${fmt(cmp.a[key])}</td><td class="num">${fmt(cmp.b[key])}</td>${dcell(cmp.b[key] - cmp.a[key])}</tr>`;
    $('#compareOut').innerHTML =
      `<div class="table-wrap"><table class="cmp-table"><thead><tr><th></th><th class="num">Period A</th><th class="num">Period B</th><th class="num">Δ</th></tr></thead><tbody>` +
        totalRow('Total spend', 'totalSpend') + totalRow('Net spend', 'net') +
        totalRow('Refunds', 'totalRefunds') + totalRow('Payments', 'totalPayments') +
      `</tbody></table></div>
      <h3>By category</h3>
      <div class="table-wrap"><table><thead><tr><th>Category</th><th class="num">A</th><th class="num">B</th><th class="num">Δ</th></tr></thead><tbody>${
        cmp.categories.map((c) => `<tr><td>${chip(c.category)}</td><td class="num">${fmt(c.a)}</td><td class="num">${fmt(c.b)}</td>${dcell(c.delta)}</tr>`).join('')
      }</tbody></table></div>
      <h3>Top merchants</h3>
      <div class="table-wrap"><table><thead><tr><th>Merchant</th><th class="num">A</th><th class="num">B</th><th class="num">Δ</th></tr></thead><tbody>${
        cmp.merchants.map((m) => `<tr><td>${m.merchant}</td><td class="num">${fmt(m.a)}</td><td class="num">${fmt(m.b)}</td>${dcell(m.delta)}</tr>`).join('')
      }</tbody></table></div>`;
  }

  // ---- Feature 6: year in review ----
  function renderYearReview() {
    const years = analyze.yearsPresent(allTxns);
    if (!years.length) return;
    if (!years.includes(yrSelected)) yrSelected = years[years.length - 1];
    const sel = $('#yrSelect');
    sel.innerHTML = years.map((y) => `<option value="${y}"${y === yrSelected ? ' selected' : ''}>${y}</option>`).join('');
    sel.onchange = () => { yrSelected = sel.value; drawYearReview(); };
    drawYearReview();
  }
  function drawYearReview() {
    const base = activeAccount === 'all' ? allTxns : allTxns.filter((t) => (t.accountId || 'default') === activeAccount);
    const yr = analyze.yearInReview(base, yrSelected);
    let yoy = '';
    if (yr.hasPrev && yr.yoyPct != null) {
      const up = yr.yoyDelta > 0;
      yoy = `<span class="delta ${up ? 'up' : 'down'}">${svg(up ? '<path d="m6 15 6-6 6 6"/>' : '<path d="m6 9 6 6 6-6"/>')}${fmtPct(yr.yoyPct)} vs ${Number(yrSelected) - 1}</span>`;
    }
    const bigDayCard = yr.biggestDay
      ? `<div class="card clickable" id="yrBigDay" data-date="${yr.biggestDay.date}" title="Show transactions on this day">
          <div class="top"><span class="ic">${svg(ICON.balance)}</span></div>
          <div class="value small">${fmt(yr.biggestDay.spend)}<br><span class="muted" style="font-size:11px">${yr.biggestDay.date}</span></div>
          <div class="label">Biggest day ›</div>
        </div>`
      : card(ICON.balance, 'Biggest day', '—', 'small');
    $('#yearReviewOut').innerHTML =
      `<div class="cards">
        ${card(ICON.spend, 'Total spend ' + yr.year, fmt(yr.totalSpend), '', yoy)}
        ${card(ICON.count, 'Transactions', String(yr.count), '')}
        ${bigDayCard}
        ${card(ICON.balance, 'Subscriptions', fmt(yr.subsTotal), 'small')}
      </div>
      <h3>Spend by category</h3>
      <div class="table-wrap"><table><thead><tr><th>Category</th><th class="num">Spend</th><th class="num">Txns</th></tr></thead><tbody>${
        yr.categories.map((c) => `<tr><td>${chip(c.category)}</td><td class="num">${fmt(c.spend)}</td><td class="num">${c.count}</td></tr>`).join('')
      }</tbody></table></div>
      <h3>Biggest merchants</h3>
      <div class="table-wrap"><table><thead><tr><th>Merchant</th><th class="num">Spend</th><th class="num">Txns</th></tr></thead><tbody>${
        yr.merchants.map((m) => `<tr><td>${m.merchant}</td><td class="num">${fmt(m.spend)}</td><td class="num">${m.count}</td></tr>`).join('')
      }</tbody></table></div>`;
    const bd = $('#yrBigDay');
    if (bd) bd.onclick = () => filterToDay(bd.dataset.date);
  }

  // Jump to the dashboard transactions for a single day.
  function filterToDay(date) {
    dateFrom = date; dateTo = date;
    activeCategory = null; activeCardmember = null;
    viewName = 'dashboard';
    render();
    requestAnimationFrame(() => {
      const el = document.getElementById('widget-transactions');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    toast(`Showing transactions on ${date}`);
  }

  function renderUncategorized() {
    const table = $('#uncatTable');
    if (!table) return;
    const other = otherCategory();
    const rows = viewTxns.filter((t) => t.category === other && t.isSpend)
      .sort((a, b) => b.spend - a.spend || b.date.localeCompare(a.date));
    const head = document.querySelector('#widget-uncategorized .widget-head h2');
    if (head) head.textContent = rows.length ? `Review uncategorized (${rows.length})` : 'Review uncategorized';

    const opts = getCategories().map((c) => `<option value="${c}">${c}</option>`).join('');
    if (!rows.length) {
      table.innerHTML = '<tbody><tr><td class="muted-cell">Nothing in “Other” for the current filters — you’re caught up.</td></tr></tbody>';
      return;
    }
    table.innerHTML =
      `<thead><tr><th>Date</th><th>Merchant</th><th class="num">Amount</th><th>Category</th></tr></thead><tbody>` +
      rows.map((t) =>
        `<tr><td>${t.date}</td><td>${t.name}</td><td class="num amt-neg">${fmt(t.spend)}</td>` +
        `<td><select class="cat-select" data-merchant="${encodeURIComponent(t.merchantKey)}">${opts}</select></td></tr>`
      ).join('') + '</tbody>';

    table.querySelectorAll('select.cat-select').forEach((sel, i) => {
      sel.value = rows[i].category;
      sel.onchange = () => {
        Store.setOverride(decodeURIComponent(sel.dataset.merchant), sel.value);
        render();
        toast('Category saved for this merchant');
      };
    });
  }

  function renderCategoryFilterOptions() {
    const present = [...new Set(allTxns.map((t) => t.category))].sort();
    const sel = $('#txnCategory');
    sel.innerHTML = '<option value="">All categories</option>' + present.map((c) => `<option value="${c}">${c}</option>`).join('');
    sel.value = txnCatFilter;
  }

  function renderTransactions() {
    $('#txnSearch').value = txnQuery;
    renderCategoryFilterOptions();
    $('#bulkCat').innerHTML = catOptions();
    $('#cardholderList').innerHTML = [...new Set(allTxns.map((t) => t.cardmember))].sort()
      .map((c) => `<option value="${c}"></option>`).join('');
    $('#txnSearch').oninput = () => { txnQuery = $('#txnSearch').value; renderTxnTable(); };
    $('#txnCategory').onchange = () => { txnCatFilter = $('#txnCategory').value; renderTxnTable(); };
    $('#txnSelectAll').onchange = () => {
      const on = $('#txnSelectAll').checked;
      $$('#txnTable .row-check').forEach((cb) => { cb.checked = on; });
      updateBulkButton();
    };
    $('#bulkApply').onclick = applyBulkRecategorize;
    $('#bulkCardApply').onclick = applyBulkCardholder;
    $('#bulkCardholder').oninput = updateBulkButton;
    $$('#txnTable th[data-sort]').forEach((th) => th.onclick = () => {
      const k = th.dataset.sort;
      if (sortKey === k) sortDir *= -1; else { sortKey = k; sortDir = (k === 'date' || k === 'amount') ? -1 : 1; }
      renderTxnTable();
    });
    renderTxnTable();
  }

  function selectedRowChecks() {
    return $$('#txnTable .row-check').filter((cb) => cb.checked);
  }
  function selectedMerchantKeys() {
    return [...new Set(selectedRowChecks().map((cb) => decodeURIComponent(cb.dataset.merchant)))];
  }
  function selectedTids() {
    return selectedRowChecks().map((cb) => decodeURIComponent(cb.dataset.tid));
  }
  function updateBulkButton() {
    const btn = $('#bulkApply');
    if (btn) {
      const n = selectedMerchantKeys().length;
      btn.textContent = `Apply to ${n} merchant${n === 1 ? '' : 's'}`;
      btn.disabled = n === 0;
    }
    const cbtn = $('#bulkCardApply');
    if (cbtn) {
      const r = selectedRowChecks().length;
      cbtn.textContent = `Set cardholder on ${r}`;
      cbtn.disabled = r === 0 || !$('#bulkCardholder').value.trim();
    }
  }
  function applyBulkRecategorize() {
    const keys = selectedMerchantKeys();
    if (!keys.length) return;
    const cat = $('#bulkCat').value;
    keys.forEach((mk) => Store.setOverride(mk, cat));
    toast(`Recategorized ${keys.length} merchant${keys.length === 1 ? '' : 's'} → ${cat}`);
    render();
  }
  function applyBulkCardholder() {
    const tids = selectedTids();
    const name = $('#bulkCardholder').value.trim();
    if (!tids.length || !name) return;
    tids.forEach((tid) => Store.setCardmemberOverride(tid, name));
    toast(`Set cardholder “${name}” on ${tids.length} transaction${tids.length === 1 ? '' : 's'}`);
    render();
  }

  function renderTxnTable() {
    if (!$('#txnTable')) return;
    const subs = Store.getSubscriptions();
    const opts = getCategories().map((c) => `<option value="${c}">${c}</option>`).join('');
    const q = txnQuery.toLowerCase();
    let rows = ledgerTxns.filter((t) =>
      (!q || t.name.toLowerCase().includes(q) || t.merchantKey.toLowerCase().includes(q)) &&
      (!txnCatFilter || t.category === txnCatFilter));
    rows.sort((a, b) => {
      const av = sortKey === 'amount' ? a.amount : a[sortKey];
      const bv = sortKey === 'amount' ? b.amount : b[sortKey];
      if (av < bv) return -sortDir;
      if (av > bv) return sortDir;
      return 0;
    });

    $('#txnCount').textContent = `${rows.length} of ${ledgerTxns.length}`;
    $('#txnTable tbody').innerHTML = rows.map((t) => {
      const amtCls = t.isSpend ? 'amt-neg' : 'amt-pos';
      const key = analyze.subKey(t.merchantKey, t.spend);
      const subCell = t.isSpend
        ? `<input type="checkbox" class="sub-check" data-key="${encodeURIComponent(key)}" ${subs[key] ? 'checked' : ''} title="Mark this merchant + amount as a subscription">`
        : '';
      const has = (tag) => t.tags && t.tags.includes(tag);
      const tagCell =
        `<button class="tag-btn${has('business') ? ' on' : ''}" data-tid="${encodeURIComponent(t.tid)}" data-tag="business" title="Business expense">Biz</button>` +
        `<button class="tag-btn${has('reimbursable') ? ' on' : ''}" data-tid="${encodeURIComponent(t.tid)}" data-tag="reimbursable" title="Reimbursable">Reimb</button>`;
      return `<tr>
        <td class="chk-cell"><input type="checkbox" class="row-check" data-merchant="${encodeURIComponent(t.merchantKey)}" data-tid="${encodeURIComponent(t.tid)}"></td>
        <td>${t.date}</td>
        <td><span class="txn-name" data-merchant="${encodeURIComponent(t.merchantKey)}">${maskMerch(t.name)}</span></td>
        <td>${t.cardmember}</td>
        <td><select class="cat-select" data-merchant="${encodeURIComponent(t.merchantKey)}">${opts}</select></td>
        <td class="num ${amtCls}">${fmt(t.amount)}</td>
        <td class="tag-cell">${tagCell}</td>
        <td class="sub-cell">${subCell}</td>
      </tr>`;
    }).join('');

    const tb = $('#txnTable tbody');
    tb.querySelectorAll('select.cat-select').forEach((sel, i) => {
      sel.value = rows[i].category;
      sel.onchange = () => { Store.setOverride(decodeURIComponent(sel.dataset.merchant), sel.value); render(); };
    });
    tb.querySelectorAll('input.sub-check').forEach((cb) => {
      cb.onchange = () => {
        Store.setSubscription(decodeURIComponent(cb.dataset.key), cb.checked);
        toast(cb.checked ? 'Marked as subscription — all matching charges tracked' : 'Removed from subscriptions');
        render();
      };
    });
    tb.querySelectorAll('input.row-check').forEach((cb) => cb.onchange = updateBulkButton);
    tb.querySelectorAll('.tag-btn').forEach((btn) => btn.onclick = () => {
      const tid = decodeURIComponent(btn.dataset.tid), tag = btn.dataset.tag;
      Store.setTxnTag(tid, tag, !btn.classList.contains('on'));
      render();
    });
    tb.querySelectorAll('.txn-name').forEach((el) => el.onclick = () => openMerchantDrill(decodeURIComponent(el.dataset.merchant)));
    updateBulkButton();
  }

  function renderFilterBanner() {
    const b = $('#filterBanner');
    const hasCross = activeCategory || activeCardmember;
    const hasTxn = hasTxnFilters();
    if (!hasCross && !hasTxn) { b.hidden = true; b.innerHTML = ''; return; }
    b.hidden = false;
    const parts = ['<span>Filtering all widgets by</span>'];
    if (activeCategory) parts.push(`${filterChip(activeCategory)}<button class="clear-filter" id="clearCat">Clear</button>`);
    if (activeCardmember) parts.push(`<span class="chip person"><span class="dot"></span>${activeCardmember}</span><button class="clear-filter" id="clearCard">Clear</button>`);
    if (flowFilter !== 'all') parts.push(`<span class="chip">${flowFilterLabel(flowFilter)}</span><button class="clear-filter" id="clearFlow">Clear</button>`);
    if (amountMin || amountMax) {
      parts.push(`<span class="chip">${amountMin || '…'} – ${amountMax || '…'}</span><button class="clear-filter" id="clearAmount">Clear</button>`);
    }
    b.innerHTML = parts.join('');
    const cc = $('#clearCat'); if (cc) cc.onclick = () => { activeCategory = null; render(); };
    const cm = $('#clearCard'); if (cm) cm.onclick = () => { activeCardmember = null; render(); };
    const cf = $('#clearFlow'); if (cf) cf.onclick = () => { flowFilter = 'all'; render(); };
    const ca = $('#clearAmount'); if (ca) ca.onclick = () => { amountMin = ''; amountMax = ''; render(); };
  }

  // ============ Preferences ============
  function renderPrefs() {
    renderCatManager(); renderRuleManager(); renderGroupManager(); renderBudgetManager();
    renderAccountManager(); renderMergeManager(); renderWidgetManager(); renderAccountSize();
  }

  function catOptions(selected) {
    return getCategories().map((c) => `<option value="${c}"${c === selected ? ' selected' : ''}>${c}</option>`).join('');
  }

  // ---- Feature 1: custom auto-categorization rules ----
  function renderRuleManager() {
    const container = $('#ruleManager');
    if (!container) return;
    const rules = Store.getCustomRules();
    container.innerHTML =
      (rules.length
        ? `<div class="rule-list">` + rules.map((r) =>
            `<div class="rule-row" data-widget="${r.id}">
              <span class="drag-handle" title="Drag to reorder">${svg(GRIP)}</span>
              <code class="rule-pat">/${(r.pattern || '').replace(/</g, '&lt;')}/${r.flags || 'i'}</code>
              <span class="rule-arrow">→</span>
              <select class="rule-cat" data-id="${r.id}">${catOptions(r.category)}</select>
              <button class="icon-btn rule-del" data-id="${r.id}" title="Delete rule">${svg(TRASH)}</button>
            </div>`).join('') + `</div>`
        : `<p class="muted-cell" style="padding:6px 0 12px">No custom rules yet.</p>`) +
      `<div class="rule-add">
        <input type="text" id="rulePattern" placeholder="Regex, e.g. ^STARBUCKS|SBUX">
        <label class="rule-ci" title="Case sensitive"><input type="checkbox" id="ruleCase"> Aa</label>
        <select id="ruleCat">${catOptions()}</select>
        <button class="btn primary" id="ruleAddBtn">Add rule</button>
      </div>
      <div class="rule-test">
        <input type="text" id="ruleTest" placeholder="Test a merchant name…">
        <span class="rule-test-out muted" id="ruleTestOut">→ result</span>
      </div>`;

    $$('.rule-cat', container).forEach((sel) => sel.onchange = () => {
      Store.updateRule(sel.dataset.id, { category: sel.value }); render(); toast('Rule updated');
    });
    $$('.rule-del', container).forEach((btn) => btn.onclick = () => {
      Store.removeRule(btn.dataset.id); render(); toast('Rule removed');
    });
    $('#ruleAddBtn').onclick = () => {
      const pattern = $('#rulePattern').value.trim();
      const flags = $('#ruleCase').checked ? '' : 'i';
      if (!pattern) { toast('Enter a regex pattern'); return; }
      if (Store.addRule(pattern, $('#ruleCat').value, flags)) { render(); toast('Rule added'); }
      else toast('Invalid regular expression');
    };
    const listEl = container.querySelector('.rule-list');
    if (listEl) makeSortable(listEl, '.rule-row', (ids) => { Store.reorderRules(ids); render(); });
    $('#ruleTest').oninput = () => {
      const name = $('#ruleTest').value.trim();
      const out = $('#ruleTestOut');
      if (!name) { out.className = 'rule-test-out muted'; out.textContent = '→ result'; return; }
      const cat = F.previewCategory(name);
      out.className = 'rule-test-out';
      out.innerHTML = '→ ' + chip(cat);
    };
  }

  // ---- Feature 3: monthly category + group budgets ----
  function renderBudgetManager() {
    const container = $('#budgetManager');
    if (!container) return;
    const budgets = Store.getBudgets();
    const spendCats = getCategories().filter((c) => categoryType(c) === 'spend');
    const inGroup = new Set();
    getCategoryGroups().forEach((g) => g.categories.forEach((c) => inGroup.add(c)));
    const ungrouped = spendCats.filter((c) => !inGroup.has(c));
    const groups = getCategoryGroups();

    const row = (label, key, isGroup) =>
      `<div class="budget-row">
        <span class="cat-name">${isGroup ? `<span class="chip" style="background:${sliceColor(label)}1a;color:${sliceColor(label)}"><span class="dot" style="background:${sliceColor(label)}"></span>${label}</span>` : chip(label)}</span>
        <div class="budget-input">
          <span class="bi-cur">${Store.currency()}</span>
          <input type="number" class="budget-amt" data-cat="${encodeURIComponent(key)}" min="0" step="10"
            placeholder="No limit" value="${budgets[key] != null ? budgets[key] : ''}">
        </div>
      </div>`;

    container.innerHTML =
      (groups.length ? `<h3>Group budgets</h3><p class="muted" style="margin:0 0 10px">Limit applies to combined spend across member categories.</p>` +
        groups.map((g) => row(g.name, g.name, true)).join('') : '') +
      (ungrouped.length ? `<h3${groups.length ? ' style="margin-top:18px"' : ''}>Category budgets</h3><p class="muted" style="margin:0 0 10px">Categories not in a group.</p>` +
        ungrouped.map((c) => row(c, c, false)).join('') : '<p class="muted-cell">Add categories or groups first.</p>');

    $$('#budgetManager .budget-amt').forEach((inp) => inp.onchange = () => {
      const cat = decodeURIComponent(inp.dataset.cat);
      Store.setBudget(cat, inp.value);
      toast(inp.value ? `Budget set for ${cat}` : `Budget cleared for ${cat}`);
    });
  }

  function renderGroupManager() {
    const container = $('#groupManager');
    if (!container) return;
    const groups = getCategoryGroups();
    const spendCats = getCategories().filter((c) => categoryType(c) === 'spend');
    const assigned = new Set();
    groups.forEach((g) => g.categories.forEach((c) => assigned.add(c)));

    container.innerHTML =
      (groups.length
        ? groups.map((g) =>
            `<div class="group-row" data-id="${g.id}">
              <input type="color" class="group-color" value="${g.color}" data-id="${g.id}">
              <input type="text" class="group-name" value="${g.name.replace(/"/g, '&quot;')}" data-id="${g.id}">
              <div class="group-cats">${g.categories.map((c) => chip(c)).join(' ') || '<span class="muted">No categories</span>'}</div>
              <button class="icon-btn group-del" data-id="${g.id}" title="Remove group">${svg(TRASH)}</button>
            </div>`).join('')
        : '<p class="muted-cell" style="padding:6px 0 12px">No groups yet.</p>') +
      `<div class="group-add">
        <input type="text" id="newGroupName" placeholder="Group name, e.g. Food">
        <input type="color" id="newGroupColor" value="#5b5bf0">
        <select id="newGroupCats" multiple size="4" title="Hold Ctrl/Cmd to select multiple">${spendCats.map((c) =>
          `<option value="${c}"${assigned.has(c) ? ' disabled' : ''}>${c}${assigned.has(c) ? ' (in group)' : ''}</option>`).join('')}</select>
        <button class="btn primary" id="addGroupBtn">Add group</button>
      </div>`;

    $$('.group-color', container).forEach((inp) => inp.onchange = () => {
      Store.updateCategoryGroup(inp.dataset.id, { color: inp.value }); render();
    });
    $$('.group-name', container).forEach((inp) => inp.onchange = () => {
      if (Store.updateCategoryGroup(inp.dataset.id, { name: inp.value.trim() })) render();
      else toast('Could not rename — name empty or taken');
    });
    $$('.group-del', container).forEach((btn) => btn.onclick = () => {
      Store.removeCategoryGroup(btn.dataset.id); render(); toast('Group removed');
    });
    $('#addGroupBtn').onclick = () => {
      const name = $('#newGroupName').value.trim();
      const cats = [...$('#newGroupCats').selectedOptions].map((o) => o.value);
      if (!name) { toast('Enter a group name'); return; }
      if (!cats.length) { toast('Select at least one category'); return; }
      if (Store.addCategoryGroup(name, $('#newGroupColor').value, cats)) {
        render(); toast(`Group “${name}” added`);
      } else toast('That group name already exists');
    };
  }

  async function renderAccountSize() {
    const el = $('#storageSize');
    if (!el) return;
    try {
      const bytes = await Store.estimatedBytes();
      el.textContent = `Storage used: ~${(bytes / 1024).toFixed(0)} KB` + (bytes >= SIZE_WARN ? ' · consider exporting a backup' : '');
    } catch (e) { el.textContent = ''; }
  }

  // ---- Feature 8: accounts ----
  function renderAccountManager() {
    const container = $('#accountManager');
    if (!container) return;
    const accounts = Store.getAccounts();
    const counts = {};
    allTxns.forEach((t) => { const a = t.accountId || 'default'; counts[a] = (counts[a] || 0) + 1; });
    container.innerHTML =
      `<div class="acct-list">` + accounts.map((a) =>
        `<div class="acct-row"><span class="acct-label">${a.label}</span><span class="mi-meta">${counts[a.id] || 0} txns</span></div>`).join('') + `</div>
      <div class="acct-add">
        <input type="text" id="newAcctName" placeholder="New account label, e.g. Personal Visa">
        <button class="btn primary" id="addAcctBtn">Add account</button>
      </div>`;
    $('#addAcctBtn').onclick = () => {
      const label = $('#newAcctName').value.trim();
      if (!label) { toast('Enter an account label'); return; }
      Store.addAccount(label); $('#newAcctName').value = ''; renderAccountManager(); toast('Account added');
    };
  }

  function renderMergeManager() {
    const container = $('#mergeManager');
    if (!container) return;
    const map = {};
    allTxns.forEach((t) => {
      const m = (map[t.merchantKey] = map[t.merchantKey] || { key: t.merchantKey, spend: 0, count: 0 });
      m.spend += (t.spend || Math.abs(t.amount)); m.count += 1;
    });
    const list = Object.values(map);
    list.sort((a, b) => {
      if (mergeSort === 'spend$') return b.spend - a.spend || a.key.localeCompare(b.key);
      if (mergeSort === 'spend#') return b.count - a.count || a.key.localeCompare(b.key);
      return a.key.localeCompare(b.key);
    });

    // Group current merges by canonical name for the "remembered merges" list.
    const merges = Store.getMerchantMerges();
    const byCanonical = {};
    Object.keys(merges).forEach((alias) => { (byCanonical[merges[alias]] = byCanonical[merges[alias]] || []).push(alias); });
    const canonicals = Object.keys(byCanonical).sort();

    const suggestions = analyze.suggestMerchantMerges(list, merges, Store.getDismissedMergeSuggestions());

    container.innerHTML =
      (suggestions.length
        ? `<div class="merge-suggestions"><h3>Suggested merges</h3><p class="muted" style="margin:0 0 10px">Likely duplicates — merge to roll up spend, or dismiss to hide.</p>` +
          suggestions.map((s) =>
            `<div class="merge-suggest-row">
              <span class="ms-names"><strong>${s.a}</strong> + <strong>${s.b}</strong></span>
              <span class="mi-meta">${fmt(s.combined)} combined</span>
              <button class="btn sm merge-sugg-btn" data-a="${encodeURIComponent(s.a)}" data-b="${encodeURIComponent(s.b)}">Merge</button>
              <button class="btn sm ghost merge-dismiss-btn" data-a="${encodeURIComponent(s.a)}" data-b="${encodeURIComponent(s.b)}">Dismiss</button>
            </div>`).join('') + `</div>`
        : '') +
      `<div class="field merge-search">${svg(SEARCH)}<input type="search" id="mergeSearch" placeholder="Filter merchants…"></div>
      <div class="merge-toolbar">
        <label class="merge-all"><input type="checkbox" id="mergeAll"> Select all</label>
        <label class="merge-sort">Sort
          <select id="mergeSort">
            <option value="alpha"${mergeSort === 'alpha' ? ' selected' : ''}>Alpha A-Z</option>
            <option value="spend$"${mergeSort === 'spend$' ? ' selected' : ''}>Spend by $</option>
            <option value="spend#"${mergeSort === 'spend#' ? ' selected' : ''}>Spend by #</option>
          </select>
        </label>
      </div>
      <div class="merge-list">${list.map((m) =>
        `<label class="merge-item" data-name="${m.key.toLowerCase().replace(/"/g, '&quot;')}">
          <input type="checkbox" class="merge-check" value="${encodeURIComponent(m.key)}">
          <span class="mi-name">${m.key}</span><span class="mi-meta">${m.count}× · ${fmt(m.spend)}</span>
        </label>`).join('')}</div>
      <div class="merge-apply">
        <input type="text" id="mergeName" placeholder="Merge into… (defaults to first ticked)">
        <button class="btn primary" id="mergeBtn">Merge selected</button>
      </div>` +
      (canonicals.length
        ? `<h3>Remembered merges</h3>` + canonicals.map((c) =>
            `<div class="merge-saved"><span class="ms-canon">${c}<button class="icon-btn ms-rename" data-canon="${encodeURIComponent(c)}" title="Rename merged merchant">${svg(PENCIL)}</button></span><span class="ms-aliases">${
              byCanonical[c].map((a) => `<span class="ms-alias">${a}<button class="ms-x" data-alias="${encodeURIComponent(a)}" title="Remove">×</button></span>`).join('')
            }</span></div>`).join('')
        : '');

    const visibleChecks = () => $$('.merge-item', container).filter((it) => !it.hidden).map((it) => it.querySelector('.merge-check'));
    $('#mergeSearch').oninput = () => {
      const q = $('#mergeSearch').value.toLowerCase();
      $$('.merge-item', container).forEach((it) => { it.hidden = !!q && !it.dataset.name.includes(q); });
      $('#mergeAll').checked = false;
    };
    $('#mergeAll').onchange = () => { const on = $('#mergeAll').checked; visibleChecks().forEach((c) => { c.checked = on; }); };
    $('#mergeSort').onchange = () => { mergeSort = $('#mergeSort').value; renderMergeManager(); };
    $$('.merge-sugg-btn', container).forEach((btn) => btn.onclick = () => {
      const a = decodeURIComponent(btn.dataset.a), b = decodeURIComponent(btn.dataset.b);
      const map = Object.fromEntries(list.map((m) => [m.key, m]));
      const canonical = (map[a]?.spend || 0) >= (map[b]?.spend || 0) ? a : b;
      Store.mergeMerchants([a, b], canonical);
      render(); toast(`Merged into “${canonical}”`);
    });
    $$('.merge-dismiss-btn', container).forEach((btn) => btn.onclick = () => {
      Store.dismissMergeSuggestion(decodeURIComponent(btn.dataset.a), decodeURIComponent(btn.dataset.b));
      renderMergeManager(); toast('Suggestion dismissed');
    });
    $$('.ms-rename', container).forEach((btn) => btn.onclick = () => {
      const old = decodeURIComponent(btn.dataset.canon);
      const next = prompt(`Rename merged merchant “${old}” to:`, old);
      if (next == null || !next.trim() || next.trim() === old) return;
      Store.mergeMerchants([old], next.trim()); render(); toast('Merged merchant renamed');
    });
    $('#mergeBtn').onclick = () => {
      const aliases = $$('.merge-check', container).filter((c) => c.checked).map((c) => decodeURIComponent(c.value));
      if (aliases.length < 2) { toast('Tick at least two merchants to merge'); return; }
      const canonical = ($('#mergeName').value.trim()) || aliases[0];
      Store.mergeMerchants(aliases, canonical);
      render(); toast(`Merged ${aliases.length} merchants into “${canonical}”`);
    };
    $$('.ms-x', container).forEach((btn) => btn.onclick = () => {
      Store.removeMerge(decodeURIComponent(btn.dataset.alias)); render(); toast('Merge removed');
    });
  }

  function typeSelect(cls, cat, current) {
    return `<select class="${cls}" ${cat != null ? `data-cat="${encodeURIComponent(cat)}"` : ''}>
      <option value="spend"${current === 'spend' ? ' selected' : ''}>Spending</option>
      <option value="payment"${current === 'payment' ? ' selected' : ''}>Payment</option>
      <option value="refund"${current === 'refund' ? ' selected' : ''}>Refund</option>
    </select>`;
  }

  function renderCatManager() {
    const custom = new Set(Store.getCustomCategories().map((c) => c.name));
    $('#catManager').innerHTML = getCategories().map((c) =>
      `<div class="cat-row">
        <input type="color" class="cat-color" value="${categoryColor(c)}" data-cat="${encodeURIComponent(c)}">
        <span class="cat-name">${chip(c)}</span>
        ${typeSelect('cat-type', c, categoryType(c))}
        <button class="icon-btn cat-rename" data-cat="${encodeURIComponent(c)}" title="Rename category">${svg(PENCIL)}</button>
        ${custom.has(c)
          ? `<button class="icon-btn cat-remove" data-cat="${encodeURIComponent(c)}" title="Remove category">${svg(TRASH)}</button>`
          : '<span class="badge-builtin">built-in</span>'}
      </div>`).join('');
    $$('#catManager .cat-color').forEach((inp) => inp.onchange = () => {
      Store.setCategoryColor(decodeURIComponent(inp.dataset.cat), inp.value); renderCatManager();
    });
    $$('#catManager .cat-rename').forEach((btn) => btn.onclick = () => {
      const old = decodeURIComponent(btn.dataset.cat);
      const next = prompt(`Rename “${old}” to:`, old);
      if (next == null) return;
      if (Store.renameCategory(old, next.trim())) { renderCatManager(); render(); toast('Category renamed'); }
      else toast('Could not rename — name is empty or already in use');
    });
    $$('#catManager .cat-type').forEach((sel) => sel.onchange = () => {
      Store.setCategoryType(decodeURIComponent(sel.dataset.cat), sel.value);
      toast(sel.value === 'payment' ? 'Now treated as Payment/Refund' : 'Now treated as Spending');
    });
    $$('#catManager .cat-remove').forEach((btn) => btn.onclick = () => {
      Store.removeCategory(decodeURIComponent(btn.dataset.cat)); renderCatManager(); toast('Category removed');
    });
  }

  function renderWidgetManager() {
    const { order, hidden, sizes } = getLayout();
    const hiddenSet = new Set(hidden);
    const container = $('#widgetManager');
    container.innerHTML = order.map((id) => {
      const w = WIDGET_MAP[id];
      const half = sizes[id] === 'half';
      return `<div class="wm-row" data-widget="${id}">
        <span class="drag-handle" title="Drag to reorder">${svg(GRIP)}</span>
        <span class="wm-name">${svg(NAV_ICON[id] || '')}${w.title}</span>
        <select class="wm-size" data-widget="${id}" title="Widget width">
          <option value="full"${half ? '' : ' selected'}>Full width</option>
          <option value="half"${half ? ' selected' : ''}>Half width</option>
        </select>
        <label><input type="checkbox" class="wm-vis" data-widget="${id}" ${hiddenSet.has(id) ? '' : 'checked'}> Visible</label>
      </div>`;
    }).join('');
    $$('#widgetManager .wm-vis').forEach((cb) => cb.onchange = () => toggleWidgetHidden(cb.dataset.widget, !cb.checked));
    $$('#widgetManager .wm-size').forEach((sel) => sel.onchange = () => setWidgetSize(sel.dataset.widget, sel.value));
    makeSortable(container, '.wm-row', (ids) => { saveLayout({ order: ids }); });
  }

  // ============ Layout mutations ============
  function hideWidget(id) {
    const { order, hidden } = getLayout();
    if (!hidden.includes(id)) hidden.push(id);
    saveLayout({ order, hidden });
    toast(`Hid “${WIDGET_MAP[id].title}” — re-enable in Settings`);
    render();
  }
  function setWidgetSize(id, size) {
    const { sizes } = getLayout();
    if (size === 'half') sizes[id] = 'half'; else delete sizes[id];
    saveLayout({ sizes });
    toast(`“${WIDGET_MAP[id].title}” set to ${size} width`);
  }
  function toggleWidgetHidden(id, hide) {
    const { order, hidden } = getLayout();
    const set = new Set(hidden);
    if (hide) set.add(id); else set.delete(id);
    saveLayout({ order, hidden: [...set] });
    buildNav(allTxns.length > 0);
  }
  function onDashboardReorder(visibleIds) {
    const { order, hidden } = getLayout();
    const hiddenIds = order.filter((id) => hidden.includes(id));
    saveLayout({ order: [...visibleIds, ...hiddenIds], hidden });
    buildNav(true);
  }

  // ============ Drag-to-sort (handle-gated) ============
  function makeSortable(container, itemSelector, onDrop) {
    let dragEl = null;
    $$(itemSelector, container).forEach((item) => {
      const handle = item.querySelector('.drag-handle');
      if (handle) {
        handle.addEventListener('mousedown', () => item.setAttribute('draggable', 'true'));
        item.addEventListener('mouseup', () => item.removeAttribute('draggable'));
      }
      item.addEventListener('dragstart', (e) => {
        dragEl = item; item.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', item.dataset.widget || '');
      });
      item.addEventListener('dragend', () => {
        item.classList.remove('dragging'); item.removeAttribute('draggable');
        $$(itemSelector, container).forEach((i) => i.classList.remove('drag-over'));
        dragEl = null;
        onDrop($$(itemSelector, container).map((i) => i.dataset.widget));
      });
    });
    container.addEventListener('dragover', (e) => {
      if (!dragEl) return;
      e.preventDefault();
      const after = getDragAfter(container, itemSelector, e.clientY);
      if (after == null) container.appendChild(dragEl);
      else container.insertBefore(dragEl, after);
    });
  }
  function getDragAfter(container, sel, y) {
    const els = $$(sel + ':not(.dragging)', container);
    let closest = { offset: -Infinity, el: null };
    els.forEach((el) => {
      const box = el.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) closest = { offset, el };
    });
    return closest.el;
  }

  // ============ Scrollspy ============
  let spy = null;
  function initScrollSpy() {
    if (spy) spy.disconnect();
    const links = $$('#nav a');
    spy = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) links.forEach((l) => l.classList.toggle('active', l.getAttribute('href') === '#' + en.target.id));
      });
    }, { rootMargin: '-20% 0px -70% 0px' });
    $$('#widgets .widget').forEach((s) => spy.observe(s));
  }

  // ============ Import / backup ============
  function handleFiles(fileList) {
    const files = [...fileList];
    if (!files.length) return;
    openImportModal(files);
  }
  function openImportModal(files) {
    const accounts = Store.getAccounts();
    const body = openModal(
      `<h2>Import ${files.length} file${files.length > 1 ? 's' : ''}</h2>
      <p class="muted">Assign these transactions to an account.</p>
      <div class="import-acct">
        <select id="impAccount">${accounts.map((a) => `<option value="${a.id}">${a.label}</option>`).join('')}<option value="__new">+ New account…</option></select>
        <input type="text" id="impNewName" placeholder="New account label" hidden>
      </div>
      <div class="import-actions"><button class="btn" id="impCancel">Cancel</button><button class="btn primary" id="impGo">Import</button></div>`);
    const selA = body.querySelector('#impAccount'), newName = body.querySelector('#impNewName');
    selA.onchange = () => { newName.hidden = selA.value !== '__new'; if (!newName.hidden) newName.focus(); };
    body.querySelector('#impCancel').onclick = closeModal;
    body.querySelector('#impGo').onclick = () => {
      let accountId = selA.value;
      if (accountId === '__new') {
        accountId = Store.addAccount(newName.value.trim());
        if (!accountId) { toast('Enter an account label'); return; }
      }
      closeModal();
      doImport(files, accountId);
    };
  }
  function doImport(files, accountId) {
    let totalAdded = 0, totalDup = 0, done = 0, emptyFiles = 0;
    const errors = [], sources = new Set();
    const finish = () => {
      render();
      if (errors.length) { toast('Import failed — ' + errors[0]); return; }
      if (totalAdded === 0 && emptyFiles > 0) {
        toast('No transactions found. Expecting an OFX/QFX export, or a CSV with Date, Description & Amount columns.');
        return;
      }
      const fmt = sources.size ? ' · ' + [...sources].join(', ') : '';
      toast(`Imported ${totalAdded} new · ${totalDup} already in history${fmt}`);
    };
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = /\.csv$/i.test(file.name) ? F.parseCSV(reader.result) : parseQFX(reader.result);
          if (parsed.source) sources.add(parsed.source);
          if (!parsed.transactions.length) emptyFiles++;
          const { added, duplicates } = Store.mergeTransactions(parsed, accountId);
          totalAdded += added; totalDup += duplicates;
        } catch (e) { errors.push(file.name + ': ' + e.message); }
        if (++done === files.length) finish();
      };
      reader.onerror = () => { errors.push(file.name + ': could not read file'); if (++done === files.length) finish(); };
      reader.readAsText(file);
    });
  }
  function exportBackup() {
    const blob = new Blob([Store.exportJSON()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `finalyze-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Backup downloaded');
  }
  function importBackup(file) {
    const reader = new FileReader();
    reader.onload = () => { try { Store.importJSON(reader.result); toast('Backup restored'); render(); } catch (e) { toast('Import failed: ' + e.message); } };
    reader.readAsText(file);
  }

  // ============ Modal ============
  function openModal(html) {
    const m = $('#modal');
    $('#modalBody').innerHTML = html;
    m.hidden = false;
    document.body.classList.add('modal-open');
    return $('#modalBody');
  }
  function closeModal() {
    const m = $('#modal');
    m.hidden = true;
    $('#modalBody').innerHTML = '';
    document.body.classList.remove('modal-open');
  }

  // ---- Feature 7: merchant drill-down + management ----
  function openMerchantDrill(merchantKey) {
    const detail = analyze.merchantDetail(allTxns, merchantKey);
    if (!detail || !detail.count) { toast('No transactions for this merchant'); return; }
    const override = Store.getOverrides()[merchantKey];
    const curCat = override || (detail.categories[0] && detail.categories[0].category) || otherCategory();
    const mTags = Store.getMerchantTags()[merchantKey] || [];
    const exclAnom = !!Store.getMerchantAnomalyExcludes()[merchantKey];
    const body = openModal(
      `<div class="drill-head"><div class="eyebrow">Merchant</div><h2>${maskMerch(merchantKey)}</h2>
        <div class="drill-kpis">
          <span><strong>${fmt(detail.total)}</strong> total spend</span>
          <span><strong>${detail.count}</strong> txns</span>
          <span><strong>${fmt(detail.avg)}</strong> avg ticket</span>
        </div></div>
      <div class="drill-manage">
        <div class="dm-row"><label>Category</label><select id="dmCat">${catOptions(curCat)}</select></div>
        <div class="dm-row"><label>Apply to all transactions</label><div class="dm-toggles">
          <button class="tag-btn${mTags.includes('business') ? ' on' : ''}" data-mtag="business">Work / Business</button>
          <button class="tag-btn${mTags.includes('reimbursable') ? ' on' : ''}" data-mtag="reimbursable">Reimbursable</button>
          <button class="tag-btn${exclAnom ? ' on' : ''}" data-mexcl="1">Exclude from anomalies</button>
        </div></div>
      </div>
      <div class="canvas-wrap"><canvas id="drillTrend"></canvas></div>
      ${detail.categories.length > 1
        ? `<h3>Category history</h3><div class="drill-cats">${detail.categories.map((c) => `${chip(c.category)} <span class="muted">${c.count}×</span>`).join(' ')}</div>`
        : ''}
      <h3>Transactions</h3>
      <div class="table-wrap drill-table"><table><thead><tr><th>Date</th><th>Name</th><th>Category</th><th class="num">Amount</th></tr></thead><tbody>${
        detail.txns.map((t) => `<tr><td>${t.date}</td><td>${maskMerch(t.name)}</td><td>${chip(t.category)}</td><td class="num ${t.isSpend ? 'amt-neg' : 'amt-pos'}">${fmt(t.amount)}</td></tr>`).join('')
      }</tbody></table></div>`);
    charts.merchantTrend(detail.monthly, body.querySelector('#drillTrend'));

    body.querySelector('#dmCat').onchange = (e) => {
      Store.setOverride(merchantKey, e.target.value);
      render(); toast(`Category set for ${merchantKey}`); openMerchantDrill(merchantKey);
    };
    body.querySelectorAll('[data-mtag]').forEach((btn) => btn.onclick = () => {
      const tag = btn.dataset.mtag;
      Store.setMerchantTag(merchantKey, tag, !btn.classList.contains('on'));
      render(); openMerchantDrill(merchantKey);
    });
    const exBtn = body.querySelector('[data-mexcl]');
    if (exBtn) exBtn.onclick = () => {
      Store.setMerchantAnomalyExclude(merchantKey, !exBtn.classList.contains('on'));
      render(); toast(exBtn.classList.contains('on') ? 'Merchant included in anomalies' : 'Merchant excluded from anomalies'); openMerchantDrill(merchantKey);
    };
  }

  // ============ Theme ============
  function applyTheme(mode) {
    document.documentElement.dataset.theme = mode;
    const isDark = mode === 'dark';
    $('#themeLabel').textContent = isDark ? 'Light' : 'Dark';
    $('#themeIcon').innerHTML = isDark
      ? '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'
      : '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>';
    if (window.Chart) charts.setTheme();
  }
  function toggleTheme() {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    Store.setTheme(next);
    applyTheme(next);
  }

  // ---- Censor (hide $ amounts) ----
  function applyCensor(on) {
    censored = !!on;
    Store.setCensor(censored);
    const lbl = $('#censorLabel'); if (lbl) lbl.textContent = censored ? 'Show $' : 'Hide $';
    const btn = $('#censorBtn'); if (btn) btn.classList.toggle('active', censored);
    if (window.Chart) charts.setCensor(censored);
    render();
  }

  // ============ Init ============
  // Treat real touch devices (phones/tablets) as "mobile" so the dashboard can
  // pack widgets two-up to fit narrow screens. UA + coarse-pointer, not just a
  // small desktop window.
  function detectMobile() {
    const ua = /Mobi|Android|iPhone|iPad|iPod|Windows Phone|BlackBerry/i.test(navigator.userAgent);
    const touch = matchMedia('(pointer:coarse)').matches;
    const narrow = matchMedia('(max-width:1024px)').matches;
    document.body.classList.toggle('is-mobile', ua || (touch && narrow));
  }

  async function init() {
    Store.onSaveError((e) => toast('Could not save: ' + (e.message || 'storage error')));
    detectMobile();
    addEventListener('resize', detectMobile);
    // Filter bar starts collapsed on mobile (it's cramped); remembers your choice.
    const storedFilters = localStorage.getItem('finalyze.filtersHidden');
    filtersHidden = storedFilters == null ? document.body.classList.contains('is-mobile') : storedFilters === '1';
    await Store.init();
    censored = await Store.getCensor();
    const theme = (await Store.getTheme()) || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    applyTheme(theme);
    // Sync censor mode (chart defaults + button label) before the first render.
    if ($('#censorLabel')) $('#censorLabel').textContent = censored ? 'Show $' : 'Hide $';
    if ($('#censorBtn')) $('#censorBtn').classList.toggle('active', censored);
    if (window.Chart) charts.setCensor(censored);
    charts.setCategoryClickHandler((cat) => { activeCategory = activeCategory === cat ? null : cat; render(); });
    charts.setCardmemberClickHandler((cm) => { activeCardmember = activeCardmember === cm ? null : cm; render(); });
    charts.setMerchantClickHandler((mk) => openMerchantDrill(mk));

    [$('#fileInput'), $('#fileInput2')].forEach((inp) => inp && inp.addEventListener('change', (e) => handleFiles(e.target.files)));
    $('#importInput').addEventListener('change', (e) => { if (e.target.files[0]) importBackup(e.target.files[0]); });
    $('#exportBtn').addEventListener('click', exportBackup);
    $('#themeBtn').addEventListener('click', toggleTheme);
    $('#censorBtn').addEventListener('click', () => applyCensor(!censored));
    $('#menuBtn').addEventListener('click', () => document.body.classList.toggle('nav-open'));
    $('#filtersToggle').addEventListener('click', () => {
      filtersHidden = !filtersHidden;
      localStorage.setItem('finalyze.filtersHidden', filtersHidden ? '1' : '0');
      const btn = $('#filtersToggle');
      btn.classList.toggle('collapsed', filtersHidden);
      btn.setAttribute('aria-expanded', String(!filtersHidden));
      $('#filtersToggleLabel').textContent = filtersHidden ? 'Show filters' : 'Filters';
      $('#dateControls').hidden = filtersHidden;
    });
    $('#settingsBtn').addEventListener('click', () => { viewName = viewName === 'prefs' ? 'dashboard' : 'prefs'; render(); });
    $('#datePreset').addEventListener('change', (e) => {
      const range = datePresetRange(e.target.value);
      if (!range) return;
      [dateFrom, dateTo] = range;
      render();
    });
    $('#dateFrom').addEventListener('change', (e) => { dateFrom = e.target.value; render(); });
    $('#dateTo').addEventListener('change', (e) => { dateTo = e.target.value; render(); });
    $('#dateClear').addEventListener('click', () => { dateFrom = ''; dateTo = ''; render(); });
    $('#amountMin').addEventListener('change', (e) => { amountMin = e.target.value; render(); });
    $('#amountMax').addEventListener('change', (e) => { amountMax = e.target.value; render(); });
    $('#flowFilter').addEventListener('change', (e) => { flowFilter = e.target.value; render(); });
    $('#accountFilter').addEventListener('change', (e) => { activeAccount = e.target.value; render(); });
    $('#exclTags').addEventListener('change', (e) => { excludeTagged = e.target.checked; render(); });
    $('#txnFilterClear').addEventListener('click', () => { amountMin = ''; amountMax = ''; flowFilter = 'all'; render(); });
    $('#modalClose').addEventListener('click', closeModal);
    $('#modalBackdrop').addEventListener('click', closeModal);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modal').hidden) closeModal(); });
    $('#clearBtn').addEventListener('click', () => {
      if (confirm('Clear ALL data and settings on this device? This cannot be undone. Export a backup first if unsure.')) {
        Store.clearAll(); activeCategory = null; activeCardmember = null;
        amountMin = ''; amountMax = ''; flowFilter = 'all';
        excludeTagged = false; activeAccount = 'all'; cmpInit = false; yrSelected = '';
        render(); toast('All data cleared');
      }
    });
    $('#addCatBtn').addEventListener('click', () => {
      const name = $('#newCatName').value.trim();
      if (!name) { toast('Enter a category name'); return; }
      if (Store.addCategory(name, $('#newCatColor').value, $('#newCatType').value)) { $('#newCatName').value = ''; renderCatManager(); toast('Category added'); }
      else toast('That category already exists');
    });

    // File drag & drop (only reacts to file drags, so it won't fight widget reordering).
    ['dragenter', 'dragover'].forEach((ev) => document.addEventListener(ev, (e) => {
      if (![...e.dataTransfer.types].includes('Files')) return;
      e.preventDefault(); document.body.classList.add('dragging');
    }));
    document.addEventListener('dragleave', (e) => { if (e.target === document || !e.relatedTarget) document.body.classList.remove('dragging'); });
    document.addEventListener('drop', (e) => {
      if (![...e.dataTransfer.types].includes('Files')) return;
      e.preventDefault(); document.body.classList.remove('dragging');
      if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
    });

    render();
  }

  F.filterTxns = filterTxns;
  F.render = render;            // let optional modules (AI) refresh after writes
  F.toast = toast;
  F.enriched = enriched;       // categorized + flow-typed rows for AI context
  F.openMerchantDrill = openMerchantDrill;

  document.addEventListener('DOMContentLoaded', init);
})();
