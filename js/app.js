(function () {
  const F = window.Finalyze;
  const { Store, parseQFX, categorize, normalizeMerchant, merchantKeyOf, categoryColor, getCategories, categoryType, analyze, charts } = F;
  const esc = (s) => F.escapeHtml(s);

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  // ---- module state ----
  let sortKey = 'date', sortDir = -1;
  let activeCategory = null;          // cross-filter from the category chart
  let activeCardmember = null;        // cross-filter from the cardmember chart
  let dateFrom = '', dateTo = '';      // manual date-range filter (YYYY-MM-DD)
  let dateRangeInit = false;           // seed default period once per session
  let demoDefaultApplied = false;      // track that we applied the demo's preferred default (quarter) so user choices are respected after
  let amountMin = '', amountMax = '';  // absolute amount range filter
  let flowFilter = 'all';              // 'all' | 'spend' | 'payment' | 'refund'
  let txnQuery = '', txnCatFilter = '', txnPage = 0;
  const TXN_PAGE_MIN = 1;
  const TXN_PAGE_MAX = 200;
  const TXN_PAGE_FALLBACK = 25;
  let txnPageSize = TXN_PAGE_FALLBACK;
  let txnResizeObs = null;
  let mergeSort = 'alpha';             // 'alpha' | 'spend$' | 'spend#'
  let cmMergeSort = 'alpha';           // cardmember merge list sort
  let excludeTagged = false;           // subtract business + reimbursable portions from spend totals/charts
  let activeAccount = 'all';           // 'all' | account id
  let cmpA = { from: '', to: '' }, cmpB = { from: '', to: '' }; // comparison ranges
  let cmpInit = false;                 // seed compare ranges once
  let yrSelected = '';                 // selected year for year-in-review
  let settingsTab = 'categories';      // active settings tab
  let categoryViewMode = 'categories'; // 'categories' | 'groups'
  let hmMonth = '';                    // YYYY-MM for heatmap widget
  let trendMode = 'time';              // 'time' | 'merchants' | 'categories'
  let trendTopN = 5;                   // top-N when trendMode is merchants or categories
  let viewName = 'dashboard';          // 'dashboard' | 'prefs' | 'analysis-*'
  let momPeriod = '12';                // '3' | '6' | '12' | 'all'
  let budgetActualPreset = 'this-month';
  let budgetActualCustom = { from: '', to: '' };
  let budgetActualCustomInit = false;
  let filtersHidden = false;           // collapse the header filter bar
  let userLicense = localStorage.getItem('finalyze.license') || 'free'; // cached so Pro survives offline
  const STRIPE_MONTHLY = 'https://buy.stripe.com/7sY4gyaww7Yl7RI0NI3Nm00';
  const STRIPE_ANNUAL = 'https://buy.stripe.com/eVq14m4880vTdc2dAu3Nm01';
  const FREE_MONTHS = 2;               // free plan: visible history window
  // dated = date-filtered; catScope = dated + cardmember (base for category chart);
  // cardScope = dated + category (base for cardmember chart); view = dated + both.
  let allTxns = [], datedTxns = [], catScopeTxns = [], cardScopeTxns = [], viewTxns = [], ledgerTxns = [];
  let periodTxns = [];                 // account + date-range scoped only (for custom cards)

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
    custom: '<path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/>',
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
    budgetActual: '<path d="M12 2v20"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7H14a3.5 3.5 0 0 1 0 7H6"/>',
    heatmap: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18"/><rect x="5" y="6" width="3" height="3" rx=".5"/><rect x="10" y="6" width="3" height="3" rx=".5"/><rect x="15" y="6" width="3" height="3" rx=".5"/><rect x="5" y="11" width="3" height="3" rx=".5"/><rect x="10" y="11" width="3" height="3" rx=".5"/>',
  };
  const GRIP = '<path d="M8 6h.01M8 12h.01M8 18h.01M16 6h.01M16 12h.01M16 18h.01"/>';
  const EYE_OFF = '<path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 8 10 8a13.2 13.2 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.5 13.5 0 0 0 2 12s3 8 10 8a9.12 9.12 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/>';
  const DOWNLOAD = '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>';
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
  function fmtPct(p) { return p == null ? '-' : (p >= 0 ? '+' : '') + p.toFixed(1) + '%'; }
  function fmtYMD(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function ymOfDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  function latestTxnMonth(txns) {
    if (!txns.length) return '';
    const max = txns.reduce((mx, t) => (t.date > mx ? t.date : mx), txns[0].date);
    return max.slice(0, 7);
  }
  // Month used for budget alerts - local calendar month, aligned with filters/demo data.
  function budgetMonthYm() {
    const now = ymOfDate(new Date());
    const demo = !!(F.Demo && F.Demo.active && F.Demo.active());
    if (demo) return latestTxnMonth(allTxns) || now;
    if (dateFrom && dateTo) {
      const fromYm = dateFrom.slice(0, 7);
      const toYm = dateTo.slice(0, 7);
      if (fromYm === toYm) return fromYm;
    }
    const budgets = Store.getBudgets();
    if (Object.keys(budgets).length && allTxns.length) {
      const { byCat, byGroup } = monthGroupSpend(now);
      const groups = getCategoryGroups();
      const inGroup = new Set();
      groups.forEach((g) => g.categories.forEach((c) => inGroup.add(c)));
      const spentFor = (key) => {
        if (groups.some((g) => g.name === key)) return byGroup[key] || 0;
        if (inGroup.has(key)) return 0;
        return byCat[key] || 0;
      };
      if (!Object.keys(budgets).some((key) => spentFor(key) > 0)) {
        const latest = latestTxnMonth(allTxns);
        if (latest && latest !== now) return latest;
      }
    }
    return now;
  }
  function monthBounds(year, month) {
    return [fmtYMD(new Date(year, month, 1)), fmtYMD(new Date(year, month + 1, 0))];
  }
  function shiftMonth(year, month, delta) {
    const d = new Date(year, month + delta, 1);
    return [d.getFullYear(), d.getMonth()];
  }
  function quarterBounds(year, qIndex) {
    return [fmtYMD(new Date(year, qIndex * 3, 1)), fmtYMD(new Date(year, qIndex * 3 + 3, 0))];
  }
  function shiftQuarter(year, qIndex, delta) {
    let q = qIndex + delta;
    let y = year;
    while (q < 0) { q += 4; y--; }
    while (q > 3) { q -= 4; y++; }
    return [y, q];
  }
  function rollingDays(n) {
    const end = fmtYMD(new Date());
    const start = new Date();
    start.setDate(start.getDate() - (n - 1));
    return [fmtYMD(start), end];
  }

  const DATE_PRESET_GROUPS = [
    { label: 'Month', presets: [
      { id: 'this-month', label: 'This month' },
      { id: 'last-month', label: 'Last month' },
      { id: 'month-before-last', label: 'Month before last' },
      { id: 'same-month-last-year', label: 'Same month last year' },
    ]},
    { label: 'Quarter', presets: [
      { id: 'this-quarter', label: 'This quarter' },
      { id: 'last-quarter', label: 'Last quarter' },
      { id: 'quarter-before-last', label: 'Quarter before last' },
      { id: 'same-quarter-last-year', label: 'Same quarter last year' },
    ]},
    { label: 'Year', presets: [
      { id: 'this-year', label: 'This year' },
      { id: 'last-year', label: 'Last year' },
      { id: 'year-before-last', label: 'Year before last' },
    ]},
    { label: 'Rolling', presets: [
      { id: 'last-7-days', label: 'Last 7 days' },
      { id: 'last-30-days', label: 'Last 30 days' },
      { id: 'last-90-days', label: 'Last 90 days' },
      { id: 'last-12-months', label: 'Last 12 months' },
    ]},
    { label: 'All data', presets: [
      { id: 'all', label: 'All time' },
    ]},
  ];
  const PRESET_LABEL = Object.fromEntries(
    DATE_PRESET_GROUPS.flatMap((g) => g.presets.map((p) => [p.id, p.label]))
  );
  PRESET_LABEL.ytd = 'This year';

  function allPresetIds() {
    return DATE_PRESET_GROUPS.flatMap((g) => g.presets.map((p) => p.id));
  }

  const FREE_DATE_PRESETS = ['this-month', 'last-month', 'all'];

  function allowedPresetIds() {
    return isFreeGated() ? FREE_DATE_PRESETS : allPresetIds();
  }

  function populateDatePresetSelect() {
    const sel = $('#datePreset');
    if (!sel) return;
    if (isFreeGated()) {
      const allowed = new Set(FREE_DATE_PRESETS);
      const presets = DATE_PRESET_GROUPS.flatMap((g) => g.presets).filter((p) => allowed.has(p.id));
      sel.innerHTML = '<option value="">Custom range</option>' +
        presets.map((p) => `<option value="${esc(p.id)}">${esc(p.label)}</option>`).join('');
      return;
    }
    sel.innerHTML = '<option value="">Custom range</option>' +
      DATE_PRESET_GROUPS.map((g) =>
        `<optgroup label="${esc(g.label)}">` +
        g.presets.map((p) => `<option value="${esc(p.id)}">${esc(p.label)}</option>`).join('') +
        '</optgroup>'
      ).join('');
  }

  function enforceFreeDatePresets() {
    if (!isFreeGated()) return;
    const allowed = new Set(FREE_DATE_PRESETS);
    const preset = detectDatePreset(dateFrom, dateTo);
    if (preset && !allowed.has(preset)) {
      [dateFrom, dateTo] = datePresetRange('this-month');
    }
  }

  function ensureDefaultDateRange() {
    const isDemo = !!(F.Demo && F.Demo.active && F.Demo.active());
    if (isDemo) {
      if (demoDefaultApplied) {
        // Demo has already received its preferred initial default (this quarter) this time.
        // From here on, respect whatever the user chose (other preset, manual dates, or clear).
        dateRangeInit = true;
        return;
      }
      // First ensure while demo is active in this session: force the quarter default.
      // This gives the full sample data (Apr–Jun 2026) a sensible overview instead of a single month.
      // Also overrides any range carried from a real account session before entering demo.
      dateFrom = '';
      dateTo = '';
      [dateFrom, dateTo] = datePresetRange('this-quarter');
      dateRangeInit = true;
      demoDefaultApplied = true;
      return;
    }
    // Regular accounts (including free): restore the last-set period if one was
    // saved, otherwise default to this month. Relative presets (e.g. last month)
    // are recomputed against today so reopening keeps the *period*, not the dates.
    if (dateRangeInit) return;
    if (dateFrom || dateTo) { dateRangeInit = true; return; }
    if (applyStoredDatePeriod()) { dateRangeInit = true; return; }
    [dateFrom, dateTo] = datePresetRange('this-month');
    dateRangeInit = true;
  }

  function applyStoredDatePeriod() {
    let stored = null;
    try { stored = Store.getDatePeriod(); } catch (e) {}
    if (!stored || typeof stored !== 'object') return false;
    if (stored.preset) {
      const range = datePresetRange(stored.preset);
      if (range) { [dateFrom, dateTo] = range; return true; }
      return false;
    }
    if ('from' in stored || 'to' in stored) {
      dateFrom = stored.from || '';
      dateTo = stored.to || '';
      return true;
    }
    return false;
  }

  function persistDatePeriod() {
    try {
      const preset = detectDatePreset(dateFrom, dateTo);
      Store.setDatePeriod(preset ? { preset } : { preset: '', from: dateFrom, to: dateTo });
    } catch (e) {}
  }

  function datePresetRange(preset, refDate) {
    const now = refDate || new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const q = Math.floor(m / 3);
    switch (preset) {
      case 'this-month':
        return monthBounds(y, m);
      case 'last-month': {
        const [ly, lm] = shiftMonth(y, m, -1);
        return monthBounds(ly, lm);
      }
      case 'month-before-last': {
        const [ly, lm] = shiftMonth(y, m, -2);
        return monthBounds(ly, lm);
      }
      case 'same-month-last-year':
        return monthBounds(y - 1, m);
      case 'this-quarter':
        return quarterBounds(y, q);
      case 'last-quarter': {
        const [ly, lq] = shiftQuarter(y, q, -1);
        return quarterBounds(ly, lq);
      }
      case 'quarter-before-last': {
        const [ly, lq] = shiftQuarter(y, q, -2);
        return quarterBounds(ly, lq);
      }
      case 'same-quarter-last-year':
        return quarterBounds(y - 1, q);
      case 'ytd':
      case 'this-year':
        return [fmtYMD(new Date(y, 0, 1)), fmtYMD(now)];
      case 'last-year':
        return [fmtYMD(new Date(y - 1, 0, 1)), fmtYMD(new Date(y - 1, 11, 31))];
      case 'year-before-last':
        return [fmtYMD(new Date(y - 2, 0, 1)), fmtYMD(new Date(y - 2, 11, 31))];
      case 'last-7-days':
        return rollingDays(7);
      case 'last-30-days':
        return rollingDays(30);
      case 'last-90-days':
        return rollingDays(90);
      case 'last-12-months': {
        const end = fmtYMD(now);
        const start = new Date(y, m - 11, now.getDate());
        return [fmtYMD(start), end];
      }
      case 'all':
        return ['', ''];
      default:
        return null;
    }
  }
  function detectDatePreset(from, to) {
    for (const preset of allowedPresetIds()) {
      const range = datePresetRange(preset);
      if (range && range[0] === from && range[1] === to) return preset;
    }
    return '';
  }
  // Human label for the active period, appended to custom card names.
  function periodLabel() {
    if (!dateFrom && !dateTo) return 'All Time';
    const preset = detectDatePreset(dateFrom, dateTo);
    if (preset) return PRESET_LABEL[preset];
    return `${dateFrom || '…'} → ${dateTo || '…'}`;
  }
  // Does an (enriched) transaction satisfy a custom-card rule?
  function cardMatch(t, card) {
    const conds = (card.conditions || []).filter((c) => c && c.field);
    if (!conds.length) return false;
    const test = (c) => {
      const v = (c.value == null ? '' : String(c.value)).trim();
      switch (c.field) {
        case 'category': return t.category === c.value;
        case 'type': return t.flow === c.value;
        case 'cardmember':
          return c.op === 'contains'
            ? (t.cardmember || '').toLowerCase().includes(v.toLowerCase())
            : (t.cardmember || '') === c.value;
        case 'description': {
          const hay = ((t.name || '') + ' ' + (t.merchantKey || '')).toLowerCase();
          if (c.op === 'not-contains') return !hay.includes(v.toLowerCase());
          if (c.op === 'matches') { try { return new RegExp(v, 'i').test(hay); } catch (e) { return false; } }
          return hay.includes(v.toLowerCase());
        }
        case 'amount': {
          const amt = Math.abs(t.amount); const n = Number(v);
          if (isNaN(n)) return false;
          if (c.op === 'lt') return amt < n;
          if (c.op === 'gte') return amt >= n;
          if (c.op === 'lte') return amt <= n;
          if (c.op === 'eq') return Math.abs(amt - n) < 0.005;
          return amt > n; // gt
        }
        default: return false;
      }
    };
    return card.match === 'any' ? conds.some(test) : conds.every(test);
  }
  function toast(msg, opts) {
    const t = $('#toast');
    const check = !!(opts && (opts.check === true || opts === true));
    if (check) {
      t.innerHTML = `<span class="toast-check">✓</span>${esc(msg)}`;
      t.classList.add('with-check');
    } else {
      t.textContent = msg;
      t.classList.remove('with-check');
    }
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => {
      t.classList.remove('show');
      t.classList.remove('with-check');
    }, 3600);
  }
  function chip(cat) {
    const c = categoryColor(cat);
    return `<span class="chip" style="background:${c}1a;color:${c}"><span class="dot" style="background:${c}"></span>${esc(cat)}</span>`;
  }
  // Mask merchant text in censor mode so a demo doesn't reveal where money goes.
  function maskMerch(s) { return esc(censored ? '••••••' : s); }

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
    return categoryMatchesSlice(t.category, slice);
  }

  function categoryMatchesSlice(cat, slice) {
    if (!slice) return true;
    if (categoryViewMode === 'groups') {
      const g = getCategoryGroups().find((x) => x.name === slice);
      if (g) return g.categories.includes(cat);
    }
    return cat === slice;
  }

  function sliceColor(name) {
    const g = getCategoryGroups().find((x) => x.name === name);
    return g ? g.color : categoryColor(name);
  }

  function filterChip(label) {
    const c = sliceColor(label);
    return `<span class="chip" style="background:${c}1a;color:${c}"><span class="dot" style="background:${c}"></span>${esc(label)}</span>`;
  }

  // ---- Feature 4: transaction tags ----
  function tagsOf(tid) {
    const tags = Store.getTxnTags()[tid];
    return tags ? tags.slice() : [];
  }

  function reimbMetaForTxn(t) {
    if (!t.tags || !t.tags.includes('reimbursable')) return null;
    return Store.getTxnReimburse()[t.tid] || Store.getMerchantReimburse()[t.merchantKey] || { mode: 'percent', value: 100 };
  }

  function reimbursableAmount(t) {
    if (!t.isSpend || !t.tags || !t.tags.includes('reimbursable')) return 0;
    const meta = reimbMetaForTxn(t);
    const spend = t.spend;
    if (meta.mode === 'amount') return Math.min(meta.value, spend);
    return Math.min(spend, spend * meta.value / 100);
  }

  function excludedTaggedSpend(t) {
    if (!t.isSpend || !t.tags || !t.tags.length) return 0;
    if (t.tags.includes('business')) return t.spend;
    return reimbursableAmount(t);
  }

  // When exclude tagged is on, keep all rows but reduce spend by tagged portions.
  function txnsForAnalysis(txns) {
    if (!excludeTagged) return txns;
    return txns.map((t) => {
      if (!t.isSpend) return t;
      const deduct = excludedTaggedSpend(t);
      if (!deduct) return t;
      return { ...t, spend: Math.max(0, t.spend - deduct) };
    });
  }

  function reimbFieldHtml(meta, opts) {
    const mode = meta && meta.mode === 'amount' ? 'amount' : 'percent';
    const val = meta != null && meta.value != null ? meta.value : (mode === 'percent' ? 100 : '');
    const merchantAttr = opts.merchantKey ? ` data-merchant="${encodeURIComponent(opts.merchantKey)}"` : '';
    const attrs = opts.scope === 'txn'
      ? `data-reimb-scope="txn" data-tid="${encodeURIComponent(opts.tid)}"${merchantAttr}`
      : `data-reimb-scope="merchant" data-merchant="${encodeURIComponent(opts.merchantKey)}"`;
    return `<div class="reimb-field" ${attrs}>
      <div class="reimb-mode-toggle" role="group" aria-label="Reimbursable units">
        <button type="button" class="reimb-mode${mode === 'percent' ? ' on' : ''}" data-mode="percent">%</button>
        <button type="button" class="reimb-mode${mode === 'amount' ? ' on' : ''}" data-mode="amount">$</button>
      </div>
      <input type="number" class="reimb-val" min="0" step="${mode === 'percent' ? '1' : '0.01'}"${mode === 'percent' ? ' max="100"' : ''} value="${esc(String(val))}" placeholder="${mode === 'percent' ? '100' : '0'}" />
    </div>`;
  }

  function bindReimbFields(root) {
    if (!root) return;
    root.querySelectorAll('.reimb-field').forEach((field) => {
      const scope = field.dataset.reimbScope;
      const tid = field.dataset.tid ? decodeURIComponent(field.dataset.tid) : null;
      const merchantKey = field.dataset.merchant ? decodeURIComponent(field.dataset.merchant) : null;
      const save = () => {
        const mode = field.querySelector('.reimb-mode.on')?.dataset.mode || 'percent';
        const input = field.querySelector('.reimb-val');
        let value = parseFloat(input.value);
        if (!isFinite(value) || value < 0) value = mode === 'percent' ? 100 : 0;
        if (mode === 'percent') value = Math.min(100, value);
        const meta = { mode, value };
        if (scope === 'txn') Store.setTxnReimburse(tid, meta);
        else Store.setMerchantReimburse(merchantKey, meta);
        refreshAfterDataChange();
        const drillMerchant = merchantKey || (field.dataset.merchant ? decodeURIComponent(field.dataset.merchant) : null);
        if (drillMerchant && !$('#modal').hidden) openMerchantDrill(drillMerchant);
      };
      field.querySelectorAll('.reimb-mode').forEach((b) => {
        b.onclick = (e) => {
          e.preventDefault();
          field.querySelectorAll('.reimb-mode').forEach((x) => x.classList.toggle('on', x === b));
          const input = field.querySelector('.reimb-val');
          const m = b.dataset.mode;
          input.step = m === 'percent' ? '1' : '0.01';
          if (m === 'percent') { input.max = '100'; input.placeholder = '100'; }
          else { input.removeAttribute('max'); input.placeholder = '0'; }
          save();
        };
      });
      const input = field.querySelector('.reimb-val');
      input.onchange = save;
    });
  }

  function txnTagCellHtml(t, opts = {}) {
    const txnTags = opts.txnOnly ? tagsOf(t.tid) : (t.tags || []);
    const has = (tag) => txnTags.includes(tag);
    const reimbOn = has('reimbursable');
    const reimbMeta = reimbOn
      ? (Store.getTxnReimburse()[t.tid]
        || (!opts.txnOnly && Store.getMerchantReimburse()[t.merchantKey])
        || { mode: 'percent', value: 100 })
      : null;
    const reimbOpts = { scope: 'txn', tid: t.tid, merchantKey: t.merchantKey };
    return `<div class="tag-cell-inner">
      <button class="tag-btn${has('business') ? ' on' : ''}" data-tid="${encodeURIComponent(t.tid)}" data-tag="business" title="Business expense">Biz</button>
      <div class="tag-reimb-group">
        <button class="tag-btn${reimbOn ? ' on' : ''}" data-tid="${encodeURIComponent(t.tid)}" data-tag="reimbursable" title="Reimbursable">Reimb</button>
        ${reimbOn ? reimbFieldHtml(reimbMeta, reimbOpts) : ''}
      </div>
    </div>`;
  }

  function resolveCardmember(name) {
    const merges = Store.getCardmemberMerges();
    let k = name || 'Unknown';
    const seen = new Set();
    while (merges[k] && !seen.has(k)) { seen.add(k); k = merges[k]; }
    return k;
  }

  function enriched() {
    const overrides = Store.getOverrides();
    const catOv = Store.getTxnCategoryOverrides();
    return Store.getTransactions().map((t) => {
      const tid = t.fitid || (t.date + '|' + t.name + '|' + t.amount);
      const category = catOv[tid] || categorize(t.name, overrides);
      const type = categoryType(category);
      const row = { ...t, merchantKey: merchantKeyOf(t.name), category };
      row.storeKey = Store.transactionStoreKey(t);
      row.tid = tid;
      // Tags = per-transaction tags ∪ merchant-level tags.
      const mTags = Store.getMerchantTags()[row.merchantKey] || [];
      row.tags = [...new Set([...tagsOf(row.tid), ...mTags])];
      const cmOv = Store.getCardmemberOverrides()[row.tid];
      let cm = t.cardmember || 'Unknown';
      if (cmOv) cm = cmOv;
      row.cardmember = resolveCardmember(cm);
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
      hint: 'Click a slice to filter',
      export: { canvasId: 'chartCategory', filename: 'spend-by-category.png' },
      body: `<div class="cat-view-toggle"><label>View <select id="catViewMode"><option value="categories">Categories</option><option value="groups">Groups</option></select></label></div><div class="canvas-wrap"><canvas id="chartCategory"></canvas></div>`, render: renderCategory },
    { id: 'merchants', nav: 'Merchants', eyebrow: 'Merchants', title: 'Top merchants',
      export: { canvasId: 'chartMerchant', filename: 'top-merchants.png' },
      body: `<div class="canvas-wrap"><canvas id="chartMerchant"></canvas></div>`, render: renderMerchants },
    { id: 'trend', nav: 'Trend', eyebrow: 'Trend', title: 'Spend over time',
      export: 'trend',
      body: `<div class="trend-controls">
          <label>View <select id="trendMode"><option value="time">Spend over time</option><option value="merchants">Top merchants</option><option value="categories">Top categories</option></select></label>
          <label id="trendTopWrap" hidden>Show top <input type="number" id="trendTopN" min="1" max="50" step="1" value="5"> <span id="trendTopUnit">merchants</span></label>
        </div>
        <div class="canvas-wrap"><canvas id="chartTrend"></canvas></div>`,
      render: renderTrend },
    { id: 'cardmember', nav: 'Cardmembers', eyebrow: 'People', title: 'By cardmember', pro: true,
      hint: 'Click a bar to filter',
      export: { canvasId: 'chartCardmember', filename: 'by-cardmember.png' },
      body: `<div class="canvas-wrap"><canvas id="chartCardmember"></canvas></div>`,
      render: () => charts.cardmemberBar(analyze.byCardmember(cardScopeTxns), activeCardmember) },
    { id: 'recurring', nav: 'Recurring', eyebrow: 'Subscriptions', title: 'Recurring charges',
      hint: 'Same merchant & exact amount', body: `<div class="table-wrap"><table id="recurringTable"></table></div>`, render: renderRecurring },
    { id: 'anomalies', nav: 'Anomalies', eyebrow: 'Flags', title: 'Anomalies',
      hint: 'Budget overruns · duplicates · large charges',
      body: `<div class="table-wrap"><table id="anomalyTable"></table></div>`, render: () => renderAnomalies(viewTxns) },
    { id: 'patterns', nav: 'Patterns', eyebrow: 'Behavior', title: 'Spending patterns',
      hint: 'Spend-only · respects filters',
      export: [
        { canvasId: 'chartDow', filename: 'spending-by-day-of-week.png', label: 'Day of week chart' },
        { canvasId: 'chartWom', filename: 'spending-by-week-of-month.png', label: 'Week of month chart' },
      ],
      body: `<div class="patterns-grid"><div class="canvas-wrap"><canvas id="chartDow"></canvas></div><div class="canvas-wrap"><canvas id="chartWom"></canvas></div></div>`,
      render: renderPatterns },
    { id: 'heatmap', nav: 'Heatmap', eyebrow: 'Calendar', title: 'Spend heatmap',
      hint: 'Click a day to filter', body: `<div class="hm-head"><select id="hmMonth"></select><div class="hm-legend" id="hmLegend"></div></div><div id="heatmapGrid"></div>`,
      render: renderHeatmap },
    { id: 'uncategorized', nav: 'Uncategorized', eyebrow: 'Review', title: 'Review uncategorized',
      hint: 'Assign a category to clear the backlog', body: `<div class="table-wrap"><table id="uncatTable"></table></div>`, render: renderUncategorized },
    { id: 'transactions', nav: 'Transactions', eyebrow: 'Ledger', title: 'Transactions',
      hint: 'Category changes follow your default in Settings → Categories',
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
          <span class="bulk-sep"></span>
          <button class="btn danger" id="bulkDelete" disabled>Delete 0</button>
        </div>
        <div class="txn-pager" id="txnPager" hidden>
          <button type="button" class="btn sm" id="txnPrev" disabled>Previous</button>
          <span id="txnPageLabel">1 / 1</span>
          <button type="button" class="btn sm" id="txnNext" disabled>Next</button>
        </div>
        <div class="table-wrap"><table id="txnTable"><thead><tr>
          <th class="chk-cell"></th><th data-sort="date">Date</th><th data-sort="name">Merchant</th><th data-sort="cardmember">Cardmember</th>
          <th data-sort="category">Category</th><th data-sort="amount" class="num">Amount</th><th class="tag-cell">Tags</th><th class="sub-cell">Sub</th><th class="txn-actions"></th>
        </tr></thead><tbody></tbody></table></div>`,
      render: renderTransactions },
  ];
  const WIDGET_MAP = Object.fromEntries(WIDGETS.map((w) => [w.id, w]));
  const ANALYSIS_PAGES = [
    { id: 'mom', nav: 'Month over month', eyebrow: 'Comparison', title: 'Month over month',
      hint: 'All months in the selected account (ignores dashboard date filter)',
      export: { canvasId: 'chartMoM', filename: 'month-over-month.png' },
      body: `<div class="ba-head-row"><label for="momPeriod">Period</label><select id="momPeriod"></select></div>
        <div class="canvas-wrap tall"><canvas id="chartMoM"></canvas></div>
        <div class="mom-details">
          <div class="table-wrap"><table id="momTable"></table></div>
          <h3>Biggest category movers (vs previous month)</h3>
          <div class="table-wrap"><table id="moversTable"></table></div>
        </div>`,
      render: renderMoM },
    { id: 'budgetActual', nav: 'Budget vs actual', eyebrow: 'Budgets', title: 'Budget vs actual',
      hint: 'Monthly limits scaled to the selected calendar period',
      export: { canvasId: 'chartBudgetActual', filename: 'budget-vs-actual.png' },
      body: `<div class="ba-head-row"><label for="budgetActualPeriod">Period</label><select id="budgetActualPeriod"></select></div>
        <div class="ba-head-row ba-custom-range" id="budgetActualCustomRange" hidden>
          <label for="budgetActualFrom">From</label><input type="date" id="budgetActualFrom">
          <span class="dr-sep">→</span>
          <label for="budgetActualTo">To</label><input type="date" id="budgetActualTo">
        </div>
        <div class="canvas-wrap tall"><canvas id="chartBudgetActual"></canvas></div>
        <div class="budget-actual-details">
          <div class="table-wrap"><table id="budgetActualTable"></table></div>
        </div>`,
      render: renderBudgetActual },
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
  ];
  const ANALYSIS_MAP = Object.fromEntries(ANALYSIS_PAGES.map((p) => [p.id, p]));
  const DEFAULT_ORDER = WIDGETS.map((w) => w.id);
  const WIDGET_SPAN = {
    overview: 'full',
    category: 'half',
    merchants: 'half',
    trend: 'half',
    cardmember: 'half',
    patterns: 'half',
    heatmap: 'half',
    anomalies: 'half',
    recurring: 'full',
    uncategorized: 'full',
    transactions: 'full',
  };
  const GRID_COLS = 12;
  const GRID_CELL_H = 96;
  const GRID_GAP = 12;
  const WIDTH_SNAP = [6, 12];
  const DEFAULT_GRID_H = {
    overview: 3, category: 4, merchants: 4, trend: 4, cardmember: 4,
    recurring: 5, anomalies: 4, patterns: 4, heatmap: 5, uncategorized: 5,
    transactions: 7,
  };
  const GRID_MAX_W = {
    overview: 12, category: 6, merchants: 6, trend: 6, cardmember: 6,
    recurring: 12, anomalies: 6, patterns: 12, heatmap: 12, uncategorized: 12,
    transactions: 12,
  };
  const GRID_MAX_H = {
    overview: 12, category: 4, merchants: 4, trend: 5, cardmember: 5,
    recurring: 8, anomalies: 6, patterns: 4, heatmap: 12, uncategorized: 8,
    transactions: 12,
  };
  let gridStack = null;
  let gridSaveTimer = null;
  let gridReady = false;
  let gridNormalizing = false;
  let summaryCardCount = 7;
  let summaryCardCols = 4;
  const SUMMARY_CARD_MIN_W = 190;
  const SUMMARY_CARD_ROW_PX = 112;
  const SUMMARY_WIDGET_HEAD_PX = 72;
  const SUMMARY_WIDGET_PAD_PX = 40;

  function gridRowsForPx(px) {
    return Math.max(3, Math.ceil((px + GRID_GAP) / (GRID_CELL_H + GRID_GAP)));
  }

  function measureOverviewContentPx() {
    const widget = document.getElementById('widget-overview');
    const cards = widget?.querySelector('#summaryCards');
    if (!widget || !cards || !cards.children.length) return null;
    const head = widget.querySelector('.widget-head');
    const widgetStyle = getComputedStyle(widget);
    const padY = parseFloat(widgetStyle.paddingTop) + parseFloat(widgetStyle.paddingBottom);
    let headBlock = SUMMARY_WIDGET_HEAD_PX;
    if (head) {
      const headStyle = getComputedStyle(head);
      headBlock = head.offsetHeight + (parseFloat(headStyle.marginBottom) || 0);
    }
    return headBlock + cards.offsetHeight + padY + 8;
  }

  function maxSummaryCols() {
    if (document.body.classList.contains('is-mobile')) return 2;
    const el = document.getElementById('widget-overview');
    const w = el ? el.clientWidth - 40 : (document.getElementById('widgets')?.clientWidth || 900);
    return Math.max(1, Math.min(8, Math.floor(w / SUMMARY_CARD_MIN_W)));
  }

  // Pick a column count that avoids a trailing row with a single tile.
  function summaryColsForCount(n, maxCols) {
    const cap = Math.max(1, Math.min(n, maxCols || maxSummaryCols()));
    let best = cap;
    let bestScore = Infinity;
    const score = (c) => {
      const rows = Math.ceil(n / c);
      const last = n % c || c;
      if (last === 1 && rows > 1) return Infinity;
      return rows * 1000 - last * 10 + Math.abs(c - last);
    };
    for (let c = 1; c <= cap; c++) {
      const s = score(c);
      if (s < bestScore) { bestScore = s; best = c; }
    }
    if (bestScore === Infinity) {
      bestScore = Infinity;
      for (let c = 1; c <= cap; c++) {
        const rows = Math.ceil(n / c);
        const last = n % c || c;
        const s = rows * 1000 + (last === 1 && rows > 1 ? 500 : 0) - last * 5;
        if (s < bestScore) { bestScore = s; best = c; }
      }
    }
    return best;
  }

  function overviewHeightForSummary(count, cols) {
    const measured = measureOverviewContentPx();
    if (measured != null) return gridRowsForPx(measured);
    const n = count != null ? count : summaryCardCount;
    const c = cols || summaryCardCols || summaryColsForCount(n, maxSummaryCols());
    const rows = Math.ceil(n / c);
    const gap = document.body.classList.contains('is-mobile') ? 10 : 14;
    const bodyPx = rows * SUMMARY_CARD_ROW_PX + Math.max(0, rows - 1) * gap;
    const totalPx = SUMMARY_WIDGET_HEAD_PX + bodyPx + SUMMARY_WIDGET_PAD_PX;
    return gridRowsForPx(totalPx);
  }

  function applySummaryLayout() {
    const host = $('#summaryCards');
    if (!host) return;
    summaryCardCols = summaryColsForCount(summaryCardCount, maxSummaryCols());
    host.style.gridTemplateColumns = `repeat(${summaryCardCols}, minmax(0, 1fr))`;
  }

  // Synchronously measure the overview's rendered height, set its grid height to match, and
  // shift any widgets below it down so none overlap. Reading offsetHeight/scrollHeight forces a
  // synchronous layout, so this is accurate the moment the overview content is in the DOM — no
  // requestAnimationFrame needed (rAF is throttled/never fires in headless/background tabs, which
  // previously left this correction dead and let stale saved layouts overlap the taller overview).
  function syncOverviewLayout() {
    if (!gridStack) return false;
    if (!visibleOrder().includes('overview')) return false;
    const h = overviewHeightForSummary();
    const el = gridStack.el.querySelector('.grid-stack-item[gs-id="overview"]');
    if (!el) return false;
    const curH = +el.getAttribute('gs-h');
    let changed = false;
    if (curH !== h) {
      gridNormalizing = true;
      try {
        gridStack.update(el, {
          h, w: 12, x: 0, y: 0,
          minW: 12, maxW: 12, minH: h, maxH: h,
          noMove: true, noResize: true,
        });
      } finally {
        gridNormalizing = false;
      }
      changed = true;
    }
    // The overview is full-width and its height is dynamic. A layout saved when the overview was
    // shorter leaves widgets beneath it overlapping into its rows. Realign the top content row to
    // the overview's bottom (shifting the rest down uniformly so the custom arrangement is
    // preserved). Runs even when the height didn't change here, so a stale overlap is corrected.
    const reflowed = reflowBelowOverview(h);
    if (changed || reflowed) normalizeGridLayout(true);
    return changed || reflowed;
  }
  function adjustOverviewHeight() {
    if (!visibleOrder().includes('overview')) return;
    // Synchronous pass: correct now, independent of rAF firing.
    syncOverviewLayout();
    // Deferred pass: re-measure after the browser has fully settled layout/fonts, in case the
    // synchronous measurement was slightly off. Harmless when rAF doesn't fire.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!gridStack) return;
        syncOverviewLayout();
      });
    });
  }
  // Push visible non-overview widgets down so the topmost one sits flush under the overview.
  // Only ever shifts down (closing an overlap); a plain gap below the overview is left as-is.
  // Returns true if anything moved. Shifting away from the locked overview can't trigger the
  // collision-resolver recursion that re-asserting positions toward it would.
  function reflowBelowOverview(overviewH) {
    if (!gridStack) return false;
    const items = visibleOrder()
      .filter((id) => id !== 'overview')
      .map((id) => {
        const el = gridStack.el.querySelector(`.grid-stack-item[gs-id="${id}"]`);
        if (!el) return null;
        return { el, y: +el.getAttribute('gs-y') || 0 };
      })
      .filter(Boolean);
    if (!items.length) return false;
    const minY = Math.min(...items.map((it) => it.y));
    const delta = overviewH - minY;
    if (delta <= 0) return false;
    gridNormalizing = true;
    gridStack.batchUpdate();
    try {
      items.forEach((it) => gridStack.update(it.el, { y: it.y + delta }));
    } finally {
      gridStack.batchUpdate(false);
      gridNormalizing = false;
    }
    return true;
  }

  function defaultWidgetW(id) { return id === 'overview' ? 12 : (WIDGET_SPAN[id] === 'full' ? 12 : 6); }
  function gridHeight(id) {
    if (id === 'overview') return overviewHeightForSummary();
    return DEFAULT_GRID_H[id] || 4;
  }
  function gridMinW(id) { return id === 'overview' ? 12 : 6; }
  function gridMinH(id) {
    if (id === 'overview') return overviewHeightForSummary();
    return 3;
  }
  function normalizeLegacyW(w) {
    if (!w || w <= 0) return 0;
    if (w > 6) return 12;
    return 6;
  }
  function gridMaxW(id) {
    return GRID_MAX_W[id] || GRID_COLS;
  }
  function gridMaxH(id) {
    if (id === 'overview') return overviewHeightForSummary();
    const base = GRID_MAX_H[id] || 8;
    if (id === 'category' || id === 'merchants') return Math.max(gridMinH(id), Math.min(base, gridHeight(id)));
    return base;
  }
  function syncPeopleTrendHeight(grid) {
    if (!grid.trend || !grid.cardmember) return;
    grid.cardmember.h = grid.trend.h;
  }
  function syncPeopleTrendHeightOnGrid() {
    if (!gridStack || gridNormalizing) return;
    const trendEl = gridStack.el.querySelector('.grid-stack-item[gs-id="trend"]');
    const cmEl = gridStack.el.querySelector('.grid-stack-item[gs-id="cardmember"]');
    if (!trendEl || !cmEl) return;
    const trendH = +trendEl.getAttribute('gs-h') || gridHeight('trend');
    const cmH = +cmEl.getAttribute('gs-h');
    if (cmH === trendH) return;
    gridNormalizing = true;
    try {
      gridStack.update(cmEl, {
        h: trendH,
        maxW: gridMaxW('cardmember'), maxH: gridMaxH('cardmember'),
        minW: gridMinW('cardmember'), minH: gridMinH('cardmember'),
      });
    } finally {
      gridNormalizing = false;
    }
  }
  function allowedWidths(id) {
    const min = gridMinW(id);
    const max = gridMaxW(id);
    return WIDTH_SNAP.filter((w) => w >= min && w <= max);
  }
  function snapWidth(id, w) {
    const opts = allowedWidths(id);
    if (!opts.length) return Math.max(gridMinW(id), Math.min(gridMaxW(id), w));
    let best = opts[0];
    opts.forEach((val) => { if (Math.abs(val - w) < Math.abs(best - w)) best = val; });
    return best;
  }
  function clampGridItem(id, g) {
    const rawW = normalizeLegacyW(g.w || defaultWidgetW(id));
    const w = id === 'overview' ? 12 : snapWidth(id, rawW);
    const rawH = g.h || gridHeight(id);
    const h = Math.max(gridMinH(id), Math.min(gridMaxH(id), rawH < gridMinH(id) ? gridHeight(id) : rawH));
    return { x: id === 'overview' ? 0 : (g.x || 0), y: id === 'overview' ? 0 : (g.y || 0), w, h };
  }
  function repackGrid(grid, visibleIds, respectProvidedOrder = false) {
    const next = {};
    let x = 0;
    let y = 0;
    let rowH = 0;

    const pack = (id) => {
      const g = clampGridItem(id, grid[id] || { w: defaultWidgetW(id), h: gridHeight(id) });
      if (x + g.w > GRID_COLS) { y += rowH; x = 0; rowH = 0; }
      next[id] = { x, y, w: g.w, h: g.h };
      x += g.w;
      rowH = Math.max(rowH, g.h);
      if (x >= GRID_COLS) { y += rowH; x = 0; rowH = 0; }
    };

    if (visibleIds.includes('overview')) {
      const oh = clampGridItem('overview', { w: 12, h: gridHeight('overview'), ...(grid.overview || {}) });
      next.overview = oh;
      y = oh.h;
      x = 0;
      rowH = 0;
    }

    let sequence = visibleIds.filter((id) => id !== 'overview');
    if (!respectProvidedOrder) {
      sequence = orderFromGrid(grid, sequence);
    }
    sequence.forEach(pack);
    syncPeopleTrendHeight(next);
    return next;
  }
  function migrateOrderToGrid(order, hidden) {
    const vis = order.filter((id) => !hidden.includes(id));
    return repackGrid(
      Object.fromEntries(
        vis.map((id) => [id, { w: defaultWidgetW(id), h: gridHeight(id), x: 0, y: 0 }])
      ),
      vis,
      true
    );
  }
  function orderFromGrid(grid, visibleIds) {
    return visibleIds.slice().sort((a, b) => {
      const ga = grid[a] || { y: 0, x: 0 };
      const gb = grid[b] || { y: 0, x: 0 };
      if (ga.y !== gb.y) return ga.y - gb.y;
      return ga.x - gb.x;
    });
  }
  function ensureGrid(order, hidden, grid) {
    const next = { ...grid };
    const visibles = order.filter((id) => !hidden.includes(id));
    // Compute current max bottom so any newly-visible or new widgets (e.g. after app update)
    // are appended below the existing custom layout instead of overlapping at (0,0).
    let maxBottom = 0;
    Object.keys(next).forEach((k) => {
      const gg = next[k];
      if (gg) maxBottom = Math.max(maxBottom, (gg.y || 0) + (gg.h || 0));
    });
    visibles.forEach((id) => {
      if (!next[id]) {
        next[id] = clampGridItem(id, { x: 0, y: maxBottom, w: defaultWidgetW(id), h: gridHeight(id) });
        maxBottom += next[id].h || 0;
      } else {
        next[id] = clampGridItem(id, next[id]);
      }
    });
    Object.keys(next).forEach((id) => {
      if (!WIDGET_MAP[id] || hidden.includes(id)) delete next[id];
    });
    syncPeopleTrendHeight(next);
    return next;
  }

  function getLayout() {
    const l = Store.getLayout() || {};
    let order = Array.isArray(l.order) ? l.order.filter((id) => WIDGET_MAP[id]) : [];
    DEFAULT_ORDER.forEach((id) => { if (!order.includes(id)) order.push(id); });
    const hidden = (Array.isArray(l.hidden) ? l.hidden : []).filter((id) => WIDGET_MAP[id]);
    if (!hidden.includes('overview') && order.includes('overview')) {
      order = ['overview', ...order.filter((id) => id !== 'overview')];
    }
    let grid = (l.grid && typeof l.grid === 'object') ? { ...l.grid } : migrateOrderToGrid(order, hidden);
    grid = ensureGrid(order, hidden, grid);
    // Note: no repack here. Saved grid positions (x/y/w/h) are retained exactly for custom
    // dashboard layouts. repackGrid is only used for structural tidy-ups (initial migrate,
    // hide/remove to close gaps, or applying a sequence from Settings → Layout).
    return { order, hidden, grid };
  }
  function saveLayout(l) {
    const cur = getLayout();
    Store.setLayout({
      order: l.order || cur.order,
      hidden: l.hidden || cur.hidden,
      grid: l.grid || cur.grid,
    });
  }
  function defaultLayout() {
    let order = [...DEFAULT_ORDER];
    const hidden = isPro() ? [] : order.filter(isProWidget);
    if (!hidden.includes('overview') && order.includes('overview')) {
      order = ['overview', ...order.filter((id) => id !== 'overview')];
    }
    const grid = migrateOrderToGrid(order, hidden);
    return { order, hidden, grid };
  }
  function resetLayoutToDefault() {
    confirmModal({
      title: 'Reset dashboard layout?',
      message: 'Widget order, visibility, sizes, and positions go back to the defaults. Any custom arrangement from dragging on the dashboard is cleared.',
      confirmLabel: 'Reset layout',
      confirmClass: 'btn danger',
      onConfirm: () => {
        saveLayout(defaultLayout());
        renderWidgetManager();
        toast('Dashboard layout reset to default', { check: true });
      },
    });
  }
  function destroyGridStack() {
    if (gridStack) {
      gridStack.destroy(false);
      gridStack = null;
    }
    charts.release('chartCategory');
    charts.release('chartCardmember');
  }
  function gridItemId(el, node) {
    return node?.id || el?.getAttribute('gs-id') || el?.querySelector('[data-widget]')?.dataset?.widget || null;
  }
  function gridPosFromEl(id, el, node) {
    return {
      x: node?.x ?? (+el?.getAttribute('gs-x') || 0),
      y: node?.y ?? (+el?.getAttribute('gs-y') || 0),
      w: node?.w ?? (+el?.getAttribute('gs-w') || defaultWidgetW(id)),
      h: node?.h ?? (+el?.getAttribute('gs-h') || gridHeight(id)),
    };
  }
  function gridFromStack() {
    const grid = {};
    if (!gridStack) return grid;
    const ingest = (id, el, node) => {
      if (!id || !WIDGET_MAP[id]) return;
      grid[id] = clampGridItem(id, gridPosFromEl(id, el, node));
    };
    if (gridStack.engine?.nodes?.length) {
      gridStack.engine.nodes.forEach((n) => ingest(gridItemId(n.el, n), n.el, n));
    }
    if (!Object.keys(grid).length) {
      gridStack.save(false).forEach((n) => ingest(gridItemId(n.el, n), n.el, n));
    }
    if (!Object.keys(grid).length) {
      visibleOrder().forEach((id) => {
        const el = gridStack.el.querySelector(`.grid-stack-item[gs-id="${id}"]`);
        if (el) ingest(id, el, null);
      });
    }
    return grid;
  }
  function persistLayoutFromGrid(opts = {}) {
    const rawGrid = gridFromStack();
    if (!Object.keys(rawGrid).length) return false;
    const grid = {};
    Object.keys(rawGrid).forEach((id) => {
      if (id && WIDGET_MAP[id]) grid[id] = clampGridItem(id, rawGrid[id]);
    });
    const { order: curOrder, hidden } = getLayout();
    const visibleNow = Object.keys(grid);
    const hiddenIds = curOrder.filter((id) => hidden.includes(id));
    const sortedVisible = orderFromGrid(grid, visibleNow);
    saveLayout({ grid, order: [...sortedVisible, ...hiddenIds.filter((id) => !sortedVisible.includes(id))] });
    if (viewName === 'dashboard') { buildNav(true); initScrollSpy(); }
    if (opts.toast) toast('Layout saved', { check: true });
    return true;
  }
  function normalizeGridLayout(force) {
    if (!gridStack || gridNormalizing) return;
    if (!force && !gridReady) return;
    gridNormalizing = true;
    // try/finally so a transient throw can never leave gridNormalizing stuck true,
    // which would silently disable every future drag/resize save.
    try {
      const ids = visibleOrder();
      const { order, hidden } = getLayout();
      let grid = gridFromStack();
      if (!Object.keys(grid).length) {
        // Read live DOM positions (never revert to stale saved layout after a drag).
        ids.forEach((id) => {
          const el = gridStack.el.querySelector(`.grid-stack-item[gs-id="${id}"]`);
          if (el) grid[id] = clampGridItem(id, gridPosFromEl(id, el, null));
        });
      }
      // Retain exact positions from GridStack (or saved). Do not repack/force-flow here.
      // Clamp only to enforce mins/maxes/snaps/overview pin. This is what allows custom
      // layouts to survive refresh and drag operations.
      // The update loop runs inside batchUpdate so GridStack resolves any collisions ONCE
      // at the end instead of cascading per-item — re-asserting clamped positions one at a
      // time against the locked overview can otherwise send its collision resolver into
      // infinite recursion (stack overflow).
      const nextGrid = {};
      gridStack.batchUpdate();
      try {
        ids.forEach((id) => {
          const el = gridStack.el.querySelector(`.grid-stack-item[gs-id="${id}"]`);
          if (!el) return;
          const from = grid[id] || {
            x: +el.getAttribute('gs-x') || 0,
            y: +el.getAttribute('gs-y') || 0,
            w: +el.getAttribute('gs-w') || defaultWidgetW(id),
            h: +el.getAttribute('gs-h') || gridHeight(id),
          };
          const g = clampGridItem(id, from);
          const update = {
            maxW: gridMaxW(id), maxH: gridMaxH(id),
            minW: gridMinW(id), minH: gridMinH(id),
          };
          // Only force x/y/w/h when clamp actually changed them (e.g. a snap), so we don't
          // needlessly re-place already-valid widgets (including the locked overview).
          if (g.x !== from.x || g.y !== from.y || g.w !== from.w || g.h !== from.h) {
            update.x = g.x; update.y = g.y; update.w = g.w; update.h = g.h;
          }
          gridStack.update(el, update);
          nextGrid[id] = g;
        });
      } finally {
        gridStack.batchUpdate(false);
      }
      const hiddenIds = order.filter((id) => hidden.includes(id));
      const sortedVisible = orderFromGrid(nextGrid, ids);
      saveLayout({ grid: nextGrid, order: [...sortedVisible, ...hiddenIds.filter((id) => !sortedVisible.includes(id))] });
    } finally {
      gridNormalizing = false;
    }
    syncPeopleTrendHeightOnGrid();
    // Keep sidebar in sync with any position-derived order after init or drag-stop.
    if (viewName === 'dashboard') {
      buildNav(allTxns.length > 0);
      initScrollSpy();
    }
  }
  function refreshGridConstraints() {
    if (!gridStack || gridNormalizing) return;
    visibleOrder().forEach((id) => {
      const el = gridStack.el.querySelector(`.grid-stack-item[gs-id="${id}"]`);
      if (!el) return;
      const g = clampGridItem(id, {
        x: +el.getAttribute('gs-x') || 0,
        y: +el.getAttribute('gs-y') || 0,
        w: +el.getAttribute('gs-w') || defaultWidgetW(id),
        h: +el.getAttribute('gs-h') || gridHeight(id),
      });
      gridStack.update(el, {
        w: g.w, h: g.h,
        maxW: gridMaxW(id), maxH: gridMaxH(id),
        minW: gridMinW(id), minH: gridMinH(id),
      });
    });
    syncPeopleTrendHeightOnGrid();
  }
  function onGridLayoutChange() {
    if (!gridStack || !gridReady || gridNormalizing) return;
    // Debounced *silent* save for live `change` events. The user-facing "Layout saved"
    // toast is fired once, authoritatively, from dragstop/resizestop instead.
    clearTimeout(gridSaveTimer);
    gridSaveTimer = setTimeout(() => persistLayoutFromGrid({ toast: false }), 200);
  }
  function initGridStack(container, savedGrid) {
    if (typeof GridStack === 'undefined') return;
    destroyGridStack();
    gridReady = false;
    gridStack = GridStack.init({
      column: GRID_COLS,
      cellHeight: GRID_CELL_H,
      margin: GRID_GAP,
      animate: true,
      float: false,
      handle: '.drag-handle',
      draggable: { handle: '.drag-handle', appendTo: 'body' },
      disableOneColumnMode: false,
    }, container);
    gridStack.on('change', onGridLayoutChange);
    // dragstop/resizestop fire only from a genuine user gesture, so they persist and
    // toast unconditionally — never gated on gridReady/gridNormalizing. We do NOT re-run
    // normalizeGridLayout here: GridStack has already placed the widgets validly (it enforces
    // min/max during the gesture), and re-asserting clamped positions against the locked
    // overview tips GridStack's collision resolver into infinite recursion (stack overflow),
    // which previously killed the save+toast. persistLayoutFromGrid clamps for storage only —
    // it reads positions, it never mutates the live grid — so it can't recurse.
    gridStack.on('dragstop', () => {
      clearTimeout(gridSaveTimer);
      persistLayoutFromGrid({ toast: true });
    });
    gridStack.on('resizestop', () => {
      clearTimeout(gridSaveTimer);
      if (typeof Chart !== 'undefined' && Chart.instances) {
        Object.values(Chart.instances).forEach((c) => { if (c && c.resize) c.resize(); });
      }
      syncPeopleTrendHeightOnGrid();
      if ($('#txnTable') && refineTxnPageSize()) renderTxnTable(true);
      persistLayoutFromGrid({ toast: true });
    });
    const ids = visibleOrder();
    const grid = savedGrid || getLayout().grid;
    const layout = ids.map((id) => {
      const g = clampGridItem(id, grid[id] || { w: defaultWidgetW(id), h: gridHeight(id) });
      return { id, x: g.x, y: g.y, w: g.w, h: g.h };
    });
    // The full-width overview's height is dynamic. clampGridItem already gives it the current
    // height, but non-overview widgets keep their saved y — a layout saved when the overview
    // was shorter leaves the top row overlapping it. Shift the whole non-overview group down so
    // the topmost sits flush under the overview (preserves the user's arrangement; only ever
    // shifts down). Done on the plain layout array before load, so it's deterministic and
    // independent of render timing / gridReady.
    const ovItem = layout.find((l) => l.id === 'overview');
    if (ovItem) {
      const others = layout.filter((l) => l.id !== 'overview');
      if (others.length) {
        const minY = Math.min(...others.map((l) => l.y));
        const delta = (ovItem.y + ovItem.h) - minY;
        if (delta > 0) others.forEach((l) => { l.y += delta; });
      }
    }
    gridNormalizing = true;
    try {
      // Let GridStack auto-register DOM widgets (enables drag/resize), then apply saved
      // positions. auto:false + makeWidget alone left drag handles inert.
      gridStack.load(layout);
      ids.forEach((id) => {
        const el = container.querySelector(`.grid-stack-item[gs-id="${id}"]`);
        if (!el) return;
        if (id === 'overview') {
          gridStack.update(el, {
            noMove: true, noResize: true, locked: true,
            w: 12, x: 0, y: 0, minW: 12, maxW: 12,
          });
          gridStack.movable(el, false);
          gridStack.resizable(el, false);
        } else {
          gridStack.movable(el, true);
          gridStack.resizable(el, true);
        }
      });
    } finally {
      gridNormalizing = false;
    }
    requestAnimationFrame(() => {
      // Set gridReady first: the grid is interactive now regardless of whether the
      // initial normalize succeeds, and saves must not be permanently gated if it throws.
      gridReady = true;
      try { normalizeGridLayout(true); } catch (e) { /* non-fatal: drag/resize still persist */ }
      adjustOverviewHeight();
    });
  }
  function widgetExportButtons(w) {
    if (!w.export) return '';
    if (w.export === 'trend') {
      return `<button type="button" class="icon-btn widget-dl" data-export="trend" title="Download chart">${svg(DOWNLOAD)}</button>`;
    }
    if (Array.isArray(w.export)) {
      return w.export.map((e) =>
        `<button type="button" class="icon-btn widget-dl" data-canvas="${e.canvasId}" data-filename="${e.filename}" title="Download ${e.label}">${svg(DOWNLOAD)}</button>`
      ).join('');
    }
    return `<button type="button" class="icon-btn widget-dl" data-canvas="${w.export.canvasId}" data-filename="${w.export.filename}" title="Download chart">${svg(DOWNLOAD)}</button>`;
  }
  function trendExportFilename() {
    const slug = trendWidgetTitle().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'trend';
    return `${slug}.png`;
  }
  function bindWidgetDownloads(container) {
    container.querySelectorAll('.widget-dl').forEach((btn) => {
      btn.addEventListener('click', () => {
        const canvasId = btn.dataset.export === 'trend' ? 'chartTrend' : btn.dataset.canvas;
        const filename = btn.dataset.export === 'trend' ? trendExportFilename() : btn.dataset.filename;
        charts.downloadPng(canvasId, filename, (ok) => toast(ok ? 'Chart downloaded' : 'Chart not ready'));
      });
    });
  }
  function isProWidget(id) { return !!(WIDGET_MAP[id] && WIDGET_MAP[id].pro); }
  function enforceProLayout() {
    if (isPro()) return;
    const { order, hidden } = getLayout();
    const set = new Set(hidden);
    let changed = false;
    order.filter(isProWidget).forEach((id) => { if (!set.has(id)) { set.add(id); changed = true; } });
    if (changed) saveLayout({ order, hidden: [...set], grid: getLayout().grid });
  }
  // Some analysis pages are only meaningful with enough data (e.g. year-in-review needs ≥12 months of span).
  // We *always list* Year in review in the nav now; renderYearReview shows a friendly note if data is thin.
  function isAnalysisView(v) { return typeof v === 'string' && v.startsWith('analysis-'); }
  function analysisPageId(v) { return v.slice('analysis-'.length); }
  function analysisPageAvailable(id) {
    if (id === 'yearReview') return true; // always show the link; the page itself explains when it has real value
    if (id === 'budgetActual') return true; // always list in nav; renderBudgetActual shows a humorous note if no budgets are set yet
    return !!ANALYSIS_MAP[id];
  }
  function widgetAvailable(id) {
    if (isProWidget(id) && !isPro()) return false;
    return true;
  }
  function visibleOrder() {
    const { order, hidden, grid } = getLayout();
    let vis = order.filter((id) => !hidden.includes(id) && widgetAvailable(id));
    // Derive visible list from the *grid positions* (y then x). This makes the left sidebar,
    // PDF sections, etc. always reflect the actual top-to-bottom widget order on screen.
    // Works even if master 'order' (for settings list) differs, and ensures order survives
    // refresh for custom layouts.
    return orderFromGrid(grid, vis);
  }

  function goToSettings(tab) {
    viewName = 'prefs';
    if (tab) settingsTab = tab;
    render();
  }

  function bindSettingsLinks(root) {
    if (!root) return;
    root.querySelectorAll('a[data-settings-tab]').forEach((a) => {
      const tab = a.dataset.settingsTab;
      a.href = '#';
      a.onclick = (e) => {
        e.preventDefault();
        goToSettings(tab);
      };
    });
  }

  // Accounts gate: when a backend is configured, signed-out users can only run
  // the demo. (No gate when accounts aren't configured - there'd be no way in.)
  function requiresSignIn() {
    return !!(F.Auth && F.Auth.enabled() && !F.Auth.isSignedIn());
  }
  // Free plan: signed-in users without Pro only see the last FREE_MONTHS months.
  // Demo mode previews the full Pro experience.
  function isDemoActive() {
    return !!(F.Demo && F.Demo.active && F.Demo.active());
  }
  function isFreeGated() {
    if (isDemoActive()) return false;
    return !!(F.Auth && F.Auth.enabled() && F.Auth.isSignedIn() && userLicense !== 'pro');
  }
  function isPro() { return !isFreeGated(); }
  function requirePro(label) {
    if (isPro()) return true;
    openUpgradeModal();
    toast((label || 'This feature') + ' is available on Pro.');
    return false;
  }
  function proLockOverlayHtml(label) {
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    return `<span class="pro-chip">Pro</span><p>${esc(label || 'Upgrade to unlock')}</p><button type="button" class="btn primary pro-lock-upgrade">Upgrade to Pro</button>`;
  }
  function applyProLock(container, label) {
    if (!container) return;
    if (isPro()) {
      container.classList.remove('pro-lock');
      container.querySelector('.pro-lock-overlay')?.remove();
      return;
    }
    container.classList.add('pro-lock');
    let ov = container.querySelector('.pro-lock-overlay');
    if (!ov) {
      ov = document.createElement('div');
      ov.className = 'pro-lock-overlay';
      ov.innerHTML = proLockOverlayHtml(label);
      container.appendChild(ov);
      ov.querySelector('.pro-lock-upgrade').onclick = openUpgradeModal;
    } else {
      const p = ov.querySelector('p');
      if (p) p.textContent = label || 'Upgrade to unlock';
    }
  }
  function monthsBetween(earlierYmd, laterYmd) {
    if (!earlierYmd || !laterYmd || laterYmd <= earlierYmd) return 0;
    const [y1, m1] = earlierYmd.split('-').map(Number);
    const [y2, m2] = laterYmd.split('-').map(Number);
    return Math.max(0, (y2 - y1) * 12 + (m2 - m1));
  }
  // Cutoff anchored to the most recent transaction (not the system clock), so the
  // free window is always the 2 most recent months present in the user's data.
  function freeCutoffFrom(anchorYmd) {
    const [y, m] = (anchorYmd || fmtYMD(new Date())).split('-').map(Number);
    return fmtYMD(new Date(y, (m - 1) - (FREE_MONTHS - 1), 1));
  }
  function openUpgradeModal(plan) {
    // `plan` may be 'monthly'/'annual' (or 'pro-monthly'/'pro-annual' from a
    // landing-page deep link) to preselect a billing cycle.
    const wantMonthly = /month/i.test(typeof plan === 'string' ? plan : '');
    const email = (F.Auth && F.Auth.user && F.Auth.user() && F.Auth.user().email) || '';
    const q = email ? '?prefilled_email=' + encodeURIComponent(email) : '';
    openModal(
      `<h2>Upgrade to Pro</h2>
       <p class="muted">Unlock your full transaction history, AI chat, custom KPI cards, categorization rules, unlimited accounts, and cardmember breakdown. Your data stays in your browser - Pro lifts the ${FREE_MONTHS}-month limit and unlocks premium features.</p>
       <div class="pro-plans upgrade-plans" role="group" aria-label="Choose Pro billing">
         <button type="button" class="pro-plan pro-plan-pick" data-plan="monthly" data-href="${STRIPE_MONTHLY}${q}" aria-pressed="false">
           <div class="pro-plan-head"><span class="pro-plan-name">Monthly</span></div>
           <div class="pro-plan-price"><strong>$7</strong><span>/mo</span></div>
         </button>
         <button type="button" class="pro-plan pro-plan-pick is-selected" data-plan="annual" data-href="${STRIPE_ANNUAL}${q}" aria-pressed="true">
           <div class="pro-plan-head">
             <span class="pro-plan-name">Annual</span>
             <span class="pro-plan-pill">3-day free trial</span>
           </div>
           <div class="pro-plan-price">
             <s class="price-was">$84</s>
             <strong>$70</strong><span>/yr</span>
           </div>
         </button>
       </div>
       <a class="btn primary upgrade-checkout" id="upgCheckout" href="${STRIPE_ANNUAL}${q}" target="_blank" rel="noopener" style="width:100%;justify-content:center;margin-top:12px">Start free trial</a>
       <p class="muted upgrade-trial-note" id="upgTrialNote" style="font-size:12px;margin-top:14px">Annual Pro includes a 3-day free trial - cancel before it ends to avoid charges. After checkout, Pro unlocks once Stripe confirms your subscription. Use the same email as your Finalyze account.</p>
       <p class="muted upgrade-bill-note" id="upgBillNote" hidden style="font-size:12px;margin-top:14px">Monthly Pro is billed today at $7/month. After checkout, Pro unlocks once Stripe confirms your subscription. Use the same email as your Finalyze account.</p>
       <div class="import-actions"><button class="btn" id="upgRefresh">I’ve paid - refresh</button><button class="btn" id="upgClose">Close</button></div>`);
    const body = $('#modalBody');
    const labels = { annual: 'Start free trial', monthly: 'Subscribe' };
    const picks = body ? body.querySelectorAll('.upgrade-plan-pick, .pro-plan-pick') : [];
    const checkout = $('#upgCheckout');
    const trialNote = $('#upgTrialNote');
    const billNote = $('#upgBillNote');
    function selectPlan(btn) {
      picks.forEach((b) => { b.classList.remove('is-selected'); b.setAttribute('aria-pressed', 'false'); });
      btn.classList.add('is-selected');
      btn.setAttribute('aria-pressed', 'true');
      if (checkout) {
        checkout.href = btn.dataset.href;
        checkout.textContent = labels[btn.dataset.plan] || 'Continue';
        checkout.target = '_blank';
        checkout.rel = 'noopener';
        checkout.classList.remove('is-disabled');
        checkout.removeAttribute('aria-disabled');
        checkout.removeAttribute('tabindex');
      }
      if (trialNote) trialNote.hidden = btn.dataset.plan !== 'annual';
      if (billNote) billNote.hidden = btn.dataset.plan !== 'monthly';
    }
    picks.forEach((btn) => { btn.onclick = () => selectPlan(btn); });
    const pre = body && body.querySelector(`.pro-plan-pick[data-plan="${wantMonthly ? 'monthly' : 'annual'}"]`);
    if (pre) selectPlan(pre);
    const c = $('#upgClose'); if (c) c.onclick = closeModal;
    const r = $('#upgRefresh');
    if (r) r.onclick = async () => {
      r.disabled = true; r.textContent = 'Checking…';
      await refreshLicense();
      if (userLicense === 'pro') { closeModal(); toast('Pro unlocked - full history restored', { check: true }); }
      else { r.disabled = false; r.textContent = 'I’ve paid - refresh'; toast('No active Pro subscription yet - it can take a moment after paying.'); }
    };
  }
  function renderUpgradeSlot() {
    const slot = $('#upgradeSlot');
    if (!slot) return;
    if (isFreeGated()) {
      slot.innerHTML = `<button class="btn primary upgrade-btn" id="upgradeBtn" style="width:100%">${svg(ICON.custom)}Upgrade to Pro</button>`;
      $('#upgradeBtn').onclick = openUpgradeModal;
    } else slot.innerHTML = '';
  }
  // Refresh the cached license from the signed-in profile, then re-render.
  async function refreshLicense() {
    if (F.Auth && F.Auth.enabled() && F.Auth.isSignedIn()) {
      try {
        const p = await F.Auth.getProfile();
        userLicense = (p && p.license) || 'free';
        try { localStorage.setItem('finalyze.license', userLicense); } catch (e) {}
      } catch (e) { /* offline / fetch failed → keep last-known cached license */ }
    } else {
      userLicense = 'free';
      try { localStorage.removeItem('finalyze.license'); } catch (e) {}
    }
    render();
  }

  // ============ Top-level render ============
  function syncFiltersPanel() {
    const headFilters = $('#headFilters');
    const dateControls = $('#dateControls');
    const ftBtn = $('#filtersToggle');
    if (!headFilters || !dateControls) return;
    const collapsed = filtersHidden;
    headFilters.classList.toggle('filters-collapsed', collapsed);
    if (ftBtn) {
      ftBtn.classList.toggle('collapsed', collapsed);
      ftBtn.setAttribute('aria-expanded', String(!collapsed));
    }
    const label = $('#filtersToggleLabel');
    if (label) label.textContent = collapsed ? 'Show filters' : 'Hide filters';
    dateControls.setAttribute('aria-hidden', collapsed ? 'true' : 'false');
    if (collapsed) dateControls.setAttribute('inert', '');
    else dateControls.removeAttribute('inert');
    if (document.body.classList.contains('is-mobile')) dateControls.hidden = collapsed;
    else dateControls.hidden = false;
  }

  function render() {
    allTxns = enriched();
    enforceProLayout();

    // Sign-in gate - block the app for signed-out users, unless they're in the demo.
    const demoActive = !!(F.Demo && F.Demo.active && F.Demo.active());
    if (requiresSignIn() && !demoActive) {
      const gate = $('#authGate');
      if (gate) gate.hidden = false;
      $('#empty').hidden = true;
      $('#dashboard').hidden = true;
      $('#analysis').hidden = true;
      $('#prefs').hidden = true;
      $('#filtersToggle').hidden = true;
      $('#headFilters').hidden = true;
      $('#dateControls').hidden = true;
      document.body.classList.remove('settings-mode');
      $('#nav').innerHTML = '';
      const h1g = document.querySelector('.page-head h1');
      if (h1g) h1g.textContent = 'Welcome to Finalyze';
      $('#rangeSub').textContent = 'Sign in to import and analyze your statements.';
      return;
    }
    if ($('#authGate')) $('#authGate').hidden = true;
    renderUpgradeSlot();
    const proBadge = $('#proBadge');
    if (proBadge) proBadge.hidden = !(demoActive || (F.Auth && F.Auth.enabled() && F.Auth.isSignedIn() && userLicense === 'pro'));

    // Free plan: only the FREE_MONTHS most recent months of data are accessible
    const fullTxns = allTxns;
    let hiddenOlder = 0;
    let hiddenMonths = 0;
    if (isFreeGated() && allTxns.length) {
      const latest = allTxns.reduce((mx, t) => (t.date > mx ? t.date : mx), allTxns[0].date);
      const cutoff = freeCutoffFrom(latest);
      const n = allTxns.length;
      allTxns = allTxns.filter((t) => t.date >= cutoff);
      hiddenOlder = n - allTxns.length;
      const earliest = fullTxns.reduce((mn, t) => (t.date < mn ? t.date : mn), fullTxns[0].date);
      hiddenMonths = monthsBetween(earliest, cutoff);
    }
    const freeBn = $('#freeBanner');
    if (freeBn) {
      if (isFreeGated() && (hiddenOlder > 0 || allTxns.length)) {
        freeBn.hidden = false;
        const missParts = [];
        if (hiddenOlder > 0) missParts.push(`${hiddenOlder} older transaction${hiddenOlder === 1 ? '' : 's'}`);
        if (hiddenMonths > 0) missParts.push(`~${hiddenMonths} month${hiddenMonths === 1 ? '' : 's'} of history`);
        const missLine = missParts.length ? ` · ${missParts.join(' and ')} waiting in Pro` : '';
        freeBn.innerHTML = `<span><strong>Free plan</strong> - showing the last ${FREE_MONTHS} months${missLine}. Pro unlocks AI chat, custom cards, rules, multi-account &amp; cardmember breakdown.</span> <button class="linkish" id="freeUpgrade" type="button">Upgrade to Pro →</button>`;
        const fu = $('#freeUpgrade'); if (fu) fu.onclick = openUpgradeModal;
      } else { freeBn.hidden = true; freeBn.innerHTML = ''; }
    }

    const hasData = allTxns.length > 0;
    if (hasData && viewName !== 'prefs') ensureDefaultDateRange();
    const isAnalysis = isAnalysisView(viewName);
    $('#empty').hidden = hasData || viewName === 'prefs';
    $('#dashboard').hidden = !hasData || viewName === 'prefs' || isAnalysis;
    $('#analysis').hidden = !hasData || !isAnalysis;
    $('#prefs').hidden = viewName !== 'prefs';

    const showHead = hasData && viewName !== 'prefs';
    const showFilters = showHead && viewName === 'dashboard';
    const headFilters = $('#headFilters');
    const ftBtn = $('#filtersToggle');
    if (headFilters) headFilters.hidden = !showFilters;
    if (ftBtn) ftBtn.hidden = !showFilters;
    if (showFilters) syncFiltersPanel();
    const pdfBtn = $('#exportPdfBtn');
    if (pdfBtn) pdfBtn.hidden = !(hasData && viewName === 'dashboard');

    document.body.classList.toggle('settings-mode', viewName === 'prefs');
    document.body.classList.toggle('analysis-mode', isAnalysis);
    document.body.classList.toggle('analysis-mom-page', viewName === 'analysis-mom');
    document.body.classList.toggle('analysis-budget-page', viewName === 'analysis-budgetActual');
    const h1 = document.querySelector('.page-head h1');
    if (h1) {
      if (viewName === 'prefs') h1.textContent = 'Settings';
      else if (isAnalysis) h1.textContent = (ANALYSIS_MAP[analysisPageId(viewName)] || {}).title || 'Analysis';
      else h1.textContent = 'Spending overview';
    }
    if (viewName === 'prefs') {
      renderPrefs();
      buildSettingsNav();
      showSettingsTab();
      return;
    }
    if (isAnalysis) {
      const pageId = analysisPageId(viewName);
      if (!analysisPageAvailable(pageId)) {
        viewName = 'dashboard';
        render();
        return;
      }
      populateDatePresetSelect();
      enforceFreeDatePresets();
      syncDateInputs();
      syncFilterInputs();
      syncAccountFilter();
      recomputeViewData();
      buildNav(true); // keep the full sidebar; the active analysis item is highlighted
      renderAnalysisPage(pageId);
      const page = ANALYSIS_MAP[pageId];
      const sub = $('#rangeSub');
      if (sub && page) sub.textContent = page.hint || '';
      return;
    }
    if (!hasData) { $('#rangeSub').textContent = 'Import a bank statement to begin.'; $('#nav').innerHTML = ''; return; }

    populateDatePresetSelect();
    enforceFreeDatePresets();
    syncDateInputs();
    syncFilterInputs();
    syncAccountFilter();
    recomputeViewData();
    buildNav(true);
    buildWidgets();
    renderFilterBanner();
    renderSizeBanner();
  }

  function recomputeViewData() {
    const accountTxns = activeAccount === 'all' ? allTxns : allTxns.filter((t) => (t.accountId || 'default') === activeAccount);
    periodTxns = filterTxns(accountTxns, { dateFrom, dateTo });
    datedTxns = filterTxns(accountTxns, { dateFrom, dateTo, amountMin, amountMax, flowFilter });
    const anaBase = txnsForAnalysis(datedTxns);
    if (activeCategory && !anaBase.some((t) => t.isSpend && txnMatchesSlice(t, activeCategory))) activeCategory = null;
    if (activeCardmember && !anaBase.some((t) => t.isSpend && t.cardmember === activeCardmember)) activeCardmember = null;
    if (!isPro() && activeCardmember) activeCardmember = null;
    const matchCross = (base) => base.filter((t) =>
      (!activeCategory || txnMatchesSlice(t, activeCategory)) && (!activeCardmember || t.cardmember === activeCardmember));
    catScopeTxns = activeCardmember ? anaBase.filter((t) => t.cardmember === activeCardmember) : anaBase;
    cardScopeTxns = activeCategory ? anaBase.filter((t) => txnMatchesSlice(t, activeCategory)) : anaBase;
    viewTxns = matchCross(anaBase);
    ledgerTxns = matchCross(datedTxns);

    const subScope = (activeCategory || activeCardmember) ? viewTxns : datedTxns;
    const s = analyze.summary(subScope);
    const filterBits = [];
    if (activeCategory) filterBits.push(activeCategory);
    if (activeCardmember) filterBits.push(activeCardmember);
    if (dateFrom || dateTo) filterBits.push(`${dateFrom || '…'} → ${dateTo || '…'}`);
    if (amountMin || amountMax) filterBits.push(`amount ${amountMin || '…'}–${amountMax || '…'}`);
    if (flowFilter !== 'all') filterBits.push(flowFilterLabel(flowFilter).toLowerCase());
    const rangeNote = filterBits.length ? ` · filtered ${filterBits.join(' · ')}` : '';
    const sub = $('#rangeSub');
    if (sub) sub.textContent = `${s.count} transactions · ${s.dateFrom || '-'} → ${s.dateTo || '-'} · ${Store.currency()}${rangeNote}`;
  }

  function momScopeTxns() {
    const base = activeAccount === 'all' ? allTxns : allTxns.filter((t) => (t.accountId || 'default') === activeAccount);
    return txnsForAnalysis(base);
  }

  function refreshDashboardWidgets() {
    if (viewName !== 'dashboard') return;
    visibleOrder().forEach((id) => {
      try {
        const w = WIDGET_MAP[id];
        if (w && w.render) w.render();
      } catch (e) {
        console.error('Widget render failed:', id, e);
      }
    });
    refreshDataCharts();
  }

  function categoryChartRows() {
    return categoryViewMode === 'groups'
      ? analyze.byCategoryGroup(catScopeTxns, getCategoryGroups())
      : analyze.byCategory(catScopeTxns);
  }

  // Single pass to redraw every chart from the current cross-filter scopes.
  function refreshDataCharts() {
    if (document.getElementById('chartCategory')) {
      charts.categoryPie(categoryChartRows(), activeCategory);
    }
    if (document.getElementById('chartMerchant')) {
      charts.merchantBar(analyze.byMerchant(viewTxns));
    }
    if (document.getElementById('chartTrend')) {
      updateTrendChart();
    }
    if (document.getElementById('chartDow') || document.getElementById('chartWom')) {
      charts.spendingPatterns(analyze.byDayOfWeek(viewTxns), analyze.byWeekOfMonth(viewTxns));
    }
    if (document.getElementById('chartCardmember')) {
      charts.cardmemberBar(analyze.byCardmember(cardScopeTxns), activeCardmember);
    }
  }

  function refreshAfterDataChange() {
    if (viewName === 'dashboard') {
      const catCanvas = document.getElementById('chartCategory');
      const cmCanvas = document.getElementById('chartCardmember');
      if (catCanvas) catCanvas.style.pointerEvents = 'none';
      if (cmCanvas) cmCanvas.style.pointerEvents = 'none';
      allTxns = enriched();
      recomputeViewData();
      syncDateInputs();
      syncFilterInputs();
      syncAccountFilter();
      refreshDashboardWidgets();
      renderFilterBanner();
      if (catCanvas) catCanvas.style.pointerEvents = '';
      if (cmCanvas) cmCanvas.style.pointerEvents = '';
    } else {
      render();
    }
  }

  const SIZE_WARN = 4 * 1024 * 1024;

  function formatStorageSize(bytes) {
    if (bytes >= 1024 * 1024) return `~${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `~${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

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
      accounts.map((a) => `<option value="${esc(a.id)}">${esc(a.label)}</option>`).join('');
    if (!accounts.some((a) => a.id === activeAccount) && activeAccount !== 'all') activeAccount = 'all';
    sel.value = activeAccount;
  }

  function buildNav(hasData) {
    const nav = $('#nav');
    if (!hasData) { nav.innerHTML = ''; return; }
    const ids = visibleOrder();
    // The active analysis page (if any) is highlighted within the always-present
    // full sidebar so the nav item set never changes between dashboard and analysis.
    const curAnalysis = isAnalysisView(viewName) ? analysisPageId(viewName) : null;
    let html = `<div class="nav-section-label">Dashboard <span class="nav-section-hint">sections</span></div>` +
      ids.map((id) =>
        `<a href="#widget-${id}" data-widget="${id}">${svg(NAV_ICON[id] || '')} ${WIDGET_MAP[id].nav}</a>`).join('');
    const analysisIds = ANALYSIS_PAGES.filter((p) => analysisPageAvailable(p.id)).map((p) => p.id);
    if (analysisIds.length) {
      html += `<div class="nav-section-label">Analysis <span class="nav-section-hint">pages</span></div>` +
        analysisIds.map((id) =>
          `<a href="#" data-analysis="${id}"${id === curAnalysis ? ' class="active"' : ''}>${svg(NAV_ICON[id] || '')} ${ANALYSIS_MAP[id].nav}</a>`).join('');
    }
    nav.innerHTML = html;
    $$('#nav a[data-widget]').forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault();
      const goto = () => { const el = document.getElementById('widget-' + a.dataset.widget); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
      if (viewName !== 'dashboard') { viewName = 'dashboard'; render(); requestAnimationFrame(goto); }
      else goto();
      document.body.classList.remove('nav-open');
    }));
    $$('#nav a[data-analysis]').forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault();
      viewName = 'analysis-' + a.dataset.analysis;
      render();
      document.body.classList.remove('nav-open');
    }));
  }

  function renderAnalysisPage(id) {
    const page = ANALYSIS_MAP[id];
    const host = $('#analysisBody');
    if (!host || !page) return;
    host.innerHTML =
      `<div class="analysis-page panel${id === 'mom' ? ' analysis-page-mom' : ''}${id === 'budgetActual' ? ' analysis-page-budget' : ''}">
        <div class="phead">
          <div><div class="eyebrow">${page.eyebrow}</div><h2>${page.title}</h2></div>
          <div class="analysis-tools">${page.hint ? `<span class="hint">${page.hint}</span>` : ''}${widgetExportButtons(page)}</div>
        </div>
        <div class="analysis-content">${page.body}</div>
      </div>`;
    bindWidgetDownloads(host);
    page.render();
    if ((id === 'mom' || id === 'budgetActual') && window.Chart) {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const inst = Chart.getChart(id === 'mom' ? 'chartMoM' : 'chartBudgetActual');
        if (inst) inst.resize();
      }));
    }
    const main = document.querySelector('main');
    if (main && main.scrollTo) main.scrollTo({ top: 0 });
  }

  // Settings is organised into tabs; each tab shows a subset of the prefs panels.
  const SETTINGS_TABS = [
    { id: 'categories', label: 'Categories', panels: ['set-category-apply', 'set-categories', 'set-cards', 'set-groups', 'set-merchants', 'set-cardmembers'] },
    { id: 'rules', label: 'Rules', panels: ['set-rules', 'set-sub-rules', 'set-merge-rules'] },
    { id: 'budgets', label: 'Budgets', panels: ['set-budgets'] },
    { id: 'accounts', label: 'Accounts & data', panels: ['set-accounts', 'set-tours', 'set-danger'] },
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
    const { grid: savedGrid } = getLayout();
    // Use the saved grid positions directly (no repack) so custom drag layouts, sizes,
    // and arrangements are restored exactly on refresh / re-render.
    destroyGridStack();
    unbindTxnResizeObserver();
    container.classList.add('grid-stack');
    container.innerHTML = ids.map((id) => {
      const w = WIDGET_MAP[id];
      const g = clampGridItem(id, savedGrid[id] || { w: defaultWidgetW(id), h: gridHeight(id) });
      const pinned = id === 'overview';
      const lockAttrs = pinned ? ' gs-no-move="true" gs-no-resize="true" gs-locked="true"' : '';
      const drag = pinned ? '' : `<span class="drag-handle" title="Drag to move">${svg(GRIP)}</span>`;
      return `<div class="grid-stack-item${pinned ? ' overview-pinned' : ''}" gs-id="${id}" gs-x="${g.x}" gs-y="${g.y}" gs-w="${g.w}" gs-h="${g.h}" gs-min-w="${gridMinW(id)}" gs-min-h="${gridMinH(id)}" gs-max-w="${gridMaxW(id)}" gs-max-h="${gridMaxH(id)}"${lockAttrs}>
        <div class="grid-stack-item-content">
          <section class="panel widget${pinned ? ' widget-pinned' : ''}" id="widget-${id}" data-widget="${id}">
        <div class="widget-head">
              ${drag}
          <div class="titles"><div class="eyebrow">${w.eyebrow}</div><h2>${w.title}${(w.pro && F.Demo && F.Demo.active && F.Demo.active()) ? ' <span class="pro-chip" title="Pro feature — unlocked in this demo">Pro</span>' : ''}</h2></div>
              <div class="widget-tools">${w.hint ? `<span class="hint">${w.hint}</span>` : ''}${widgetExportButtons(w)}<button class="icon-btn widget-hide" title="Hide widget">${svg(EYE_OFF)}</button></div>
        </div>
        <div class="widget-body">${w.body}</div>
          </section>
        </div>
      </div>`;
    }).join('');

    initGridStack(container, savedGrid);
    ids.forEach((id) => {
      try { WIDGET_MAP[id].render(); } catch (e) { console.error('Widget render failed:', id, e); }
    });
    refreshDataCharts();
    refreshGridConstraints();
    adjustOverviewHeight();

    $$('#widgets .widget-hide').forEach((btn) =>
      btn.addEventListener('click', () => hideWidget(btn.closest('.widget').dataset.widget)));

    bindWidgetDownloads(container);
    initScrollSpy();
  }

  // ============ Widget renderers ============
  function card(icon, label, value, cls, deltaHtml, badge) {
    return `<div class="card">
      <div class="top"><span class="ic">${svg(icon)}</span>${badge || ''}${deltaHtml || ''}</div>
      <div class="value ${cls || ''}">${value}</div>
      <div class="label">${esc(label)}</div>
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
    const reimbTotal = ledgerTxns.reduce((a, t) => a + reimbursableAmount(t), 0);
    if (bizTotal > 0) cards.push(card(ICON.balance, 'Business expenses', fmt(bizTotal), 'small'));
    if (reimbTotal > 0) cards.push(card(ICON.refund, 'Reimbursable', fmt(reimbTotal), 'small'));
    if (!activeCategory && bal != null) cards.push(card(ICON.balance, 'Statement balance', fmt(bal), bal < 0 ? 'neg' : ''));
    if (s.dateFrom) cards.push(card(ICON.calendar, 'Date range', `${s.dateFrom}<br>→ ${s.dateTo}`, 'small'));

    // Custom KPI cards - Pro only; respect category/cardmember cross-filters when active.
    if (isPro()) {
      const period = periodLabel();
      const kpiScope = (activeCategory || activeCardmember) ? viewTxns : periodTxns;
      const ccBadge = (F.Demo && F.Demo.active && F.Demo.active()) ? '<span class="pro-chip" title="Pro feature — unlocked in this demo">Pro</span>' : '';
      Store.getCustomCards().forEach((cc) => {
        const matched = kpiScope.filter((t) => cardMatch(t, cc));
        const total = matched.reduce((a, t) => a + Math.abs(t.amount), 0);
        cards.push(card(ICON.custom, `${esc(cc.name)} · ${period}`, fmt(total), 'small', '', ccBadge));
      });
    }

    $('#summaryCards').innerHTML = cards.join('');
    summaryCardCount = cards.length;
    applySummaryLayout();
    adjustOverviewHeight();
  }

  // ---- Feature 3: budget alerts ----
  // Calendar-month spend per category for budgetMonthYm(), scoped to the active account.
  function monthByCategory(ym) {
    const base = activeAccount === 'all' ? allTxns : allTxns.filter((t) => (t.accountId || 'default') === activeAccount);
    const byCat = {};
    base.forEach((t) => { if (t.isSpend && t.date.slice(0, 7) === ym) byCat[t.category] = (byCat[t.category] || 0) + t.spend; });
    return byCat;
  }

  function monthGroupSpend(ym) {
    const byCat = monthByCategory(ym);
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
    const ym = budgetMonthYm();
    return allBudgetRows(ym).filter((a) => a.pct >= 80);
  }

  function budgetReferenceDate() {
    if (F.Demo && F.Demo.active && F.Demo.active() && allTxns.length) {
      const max = allTxns.reduce((mx, t) => (t.date > mx ? t.date : mx), allTxns[0].date);
      const p = max.split('-').map(Number);
      return new Date(p[0], p[1] - 1, p[2]);
    }
    return new Date();
  }

  const BUDGET_ACTUAL_PRESETS = [
    { v: 'this-month', l: 'This month' },
    { v: 'this-quarter', l: 'This quarter' },
    { v: 'this-year', l: 'This year' },
    { v: 'last-month', l: 'Last month' },
    { v: 'last-quarter', l: 'Last quarter' },
    { v: 'last-year', l: 'Last year' },
    { v: 'all', l: 'All time' },
    { v: 'custom', l: 'Custom range' },
  ];

  function monthsInDateRange(from, to) {
    if (!from && !to) return [];
    const startYm = (from || to).slice(0, 7);
    const endYm = (to || from).slice(0, 7);
    const out = [];
    let [y, m] = startYm.split('-').map(Number);
    const [ey, em] = endYm.split('-').map(Number);
    while (y < ey || (y === ey && m <= em)) {
      out.push(`${y}-${String(m).padStart(2, '0')}`);
      m++;
      if (m > 12) { m = 1; y++; }
    }
    return out;
  }

  function budgetActualRange(preset) {
    if (preset === 'custom') {
      let from = budgetActualCustom.from;
      let to = budgetActualCustom.to;
      if (from && to && from > to) { const t = from; from = to; to = t; }
      return [from, to];
    }
    const ref = budgetReferenceDate();
    if (preset === 'all') {
      const base = activeAccount === 'all' ? allTxns : allTxns.filter((t) => (t.accountId || 'default') === activeAccount);
      const yms = [...new Set(base.filter((t) => t.isSpend && t.date).map((t) => t.date.slice(0, 7)))].sort();
      if (!yms.length) return datePresetRange('this-month', ref);
      const [ly, lm] = yms[yms.length - 1].split('-').map(Number);
      return [yms[0] + '-01', fmtYMD(new Date(ly, lm, 0))];
    }
    return datePresetRange(preset, ref) || ['', ''];
  }

  function budgetActualRangeLabel(from, to, preset) {
    if (preset === 'custom') return 'Custom range';
    if (preset && PRESET_LABEL[preset]) return PRESET_LABEL[preset];
    if (!from && !to) return 'All time';
    return `${from || '…'} → ${to || '…'}`;
  }

  function allBudgetRowsForRange(from, to) {
    const budgets = Store.getBudgets();
    const base = activeAccount === 'all' ? allTxns : allTxns.filter((t) => (t.accountId || 'default') === activeAccount);
    const txns = filterTxns(base, { dateFrom: from, dateTo: to });
    const monthCount = Math.max(1, monthsInDateRange(from, to).length);
    const byCat = {};
    txns.forEach((t) => {
      if (t.isSpend) byCat[t.category] = (byCat[t.category] || 0) + t.spend;
    });
    const groups = getCategoryGroups();
    const inGroup = new Set();
    const byGroup = {};
    groups.forEach((g) => {
      g.categories.forEach((c) => inGroup.add(c));
      byGroup[g.name] = g.categories.reduce((a, c) => a + (byCat[c] || 0), 0);
    });
    const rows = [];
    getCategoryGroups().forEach((g) => {
      if (budgets[g.name] == null) return;
      const spent = byGroup[g.name] || 0;
      const budget = budgets[g.name] * monthCount;
      rows.push({
        cat: g.name, spent, budget,
        pct: budget ? (spent / budget) * 100 : 0,
        remaining: budget - spent,
        isGroup: true,
        monthCount,
      });
    });
    Object.keys(budgets).forEach((c) => {
      if (inGroup.has(c)) return;
      if (getCategoryGroups().some((g) => g.name === c)) return;
      const spent = byCat[c] || 0;
      const budget = budgets[c] * monthCount;
      rows.push({
        cat: c, spent, budget,
        pct: budget ? (spent / budget) * 100 : 0,
        remaining: budget - spent,
        isGroup: false,
        monthCount,
      });
    });
    return rows.sort((a, b) => b.pct - a.pct);
  }

  function allBudgetRows(ym) {
    const budgets = Store.getBudgets();
    const { byCat, byGroup, inGroup } = monthGroupSpend(ym);
    const rows = [];
    getCategoryGroups().forEach((g) => {
      if (budgets[g.name] == null) return;
      const spent = byGroup[g.name] || 0;
      const budget = budgets[g.name];
      rows.push({
        cat: g.name, spent, budget,
        pct: budget ? (spent / budget) * 100 : 0,
        remaining: budget - spent,
        isGroup: true,
      });
    });
    Object.keys(budgets).forEach((c) => {
      if (inGroup.has(c)) return;
      if (getCategoryGroups().some((g) => g.name === c)) return;
      const spent = byCat[c] || 0;
      const budget = budgets[c];
      rows.push({
        cat: c, spent, budget,
        pct: budget ? (spent / budget) * 100 : 0,
        remaining: budget - spent,
        isGroup: false,
      });
    });
    return rows.sort((a, b) => b.pct - a.pct);
  }

  function analysisPeriodOptions(monthCount) {
    const opts = [];
    if (monthCount >= 3) opts.push({ v: '3', l: 'Last 3 months' });
    if (monthCount >= 6) opts.push({ v: '6', l: 'Last 6 months' });
    if (monthCount >= 12) opts.push({ v: '12', l: 'Last 12 months' });
    opts.push({ v: 'all', l: monthCount ? `All months (${monthCount})` : 'All months' });
    return opts;
  }

  function defaultAnalysisPeriod(monthCount) {
    if (monthCount <= 12) return 'all';
    return '12';
  }

  function sliceByAnalysisPeriod(sortedItems, preset) {
    if (preset === 'all') return sortedItems;
    const n = parseInt(preset, 10);
    return Number.isFinite(n) ? sortedItems.slice(-n) : sortedItems;
  }

  function budgetActualChartHeight(rowCount) {
    const n = Math.max(1, rowCount || 1);
    return Math.min(120 + n * 26, 480);
  }

  function renderBudgetActual() {
    const validPresets = new Set(BUDGET_ACTUAL_PRESETS.map((p) => p.v));
    if (!validPresets.has(budgetActualPreset)) budgetActualPreset = 'this-month';

    if (!budgetActualCustomInit) {
      const [from, to] = datePresetRange('this-month', budgetReferenceDate());
      budgetActualCustom = { from: from || '', to: to || '' };
      budgetActualCustomInit = true;
    }

    // Always-list behavior (like Year in review): if no budgets defined, show a humorous
    // discovery note and hide the period/chart UI so it doesn't look broken/empty.
    const hasAnyBudgets = Object.keys(Store.getBudgets()).length > 0;

    if (!hasAnyBudgets) {
      const periodRow = document.querySelector('.analysis-page-budget .ba-head-row');
      const customRow = $('#budgetActualCustomRange');
      const chartWrap = document.querySelector('.analysis-page-budget .canvas-wrap');
      const table = $('#budgetActualTable');
      const hintEl = document.querySelector('.analysis-page-budget .analysis-tools .hint');

      if (periodRow) periodRow.style.display = 'none';
      if (customRow) customRow.hidden = true;
      if (chartWrap) chartWrap.style.display = 'none';
      if (table) {
        table.innerHTML = `
          <tbody><tr><td class="muted-cell" colspan="6">
            <div style="padding:28px 16px; text-align:center; color:var(--muted);">
              <div style="max-width:420px; margin:0 auto; text-align:left;">
                <p style="font-size:15px; line-height:1.5; margin:0 0 10px;">🧾 Budget vs Actual is ready to audit your life choices...</p>
                <p style="margin:0; line-height:1.5;">You haven't set any budgets yet. Without targets this page is basically a very opinionated receipt viewer that has nothing to be opinionated about.</p>
                <p style="margin:12px 0 0; font-size:13px; opacity:.85;">Head to <a href="#" data-settings-tab="budgets" style="color:var(--accent); text-decoration:underline;">Settings → Budgets</a>, give a few categories or groups a monthly cap (coffee? takeout? "I definitely needed that gadget"?), and this will transform into glorious green/red bars, over/under drama, and the occasional "you actually stayed under budget" victory lap. Your wallet is already nervous. 📊</p>
              </div>
            </div>
          </td></tr></tbody>
        `;
        bindSettingsLinks(table);
      }
      if (hintEl) {
        hintEl.innerHTML = 'No budgets set — add some in <a href="#" data-settings-tab="budgets" style="color:var(--accent); text-decoration:underline;">Settings → Budgets</a>';
        bindSettingsLinks(hintEl);
      }
      return;
    }

    // Restore UI elements that may have been hidden by a previous no-budgets render in this session
    const periodRow = document.querySelector('.analysis-page-budget .ba-head-row');
    if (periodRow) periodRow.style.display = '';
    const cw = document.querySelector('.analysis-page-budget .canvas-wrap');
    if (cw) cw.style.display = '';

    const periodSel = $('#budgetActualPeriod');
    if (periodSel) {
      periodSel.innerHTML = BUDGET_ACTUAL_PRESETS.map((p) =>
        `<option value="${p.v}"${p.v === budgetActualPreset ? ' selected' : ''}>${p.l}</option>`).join('');
      periodSel.onchange = () => { budgetActualPreset = periodSel.value; renderBudgetActual(); };
    }

    const customRow = $('#budgetActualCustomRange');
    const isCustom = budgetActualPreset === 'custom';
    if (customRow) customRow.hidden = !isCustom;

    if (isCustom) {
      const fromIn = $('#budgetActualFrom');
      const toIn = $('#budgetActualTo');
      if (fromIn && toIn) {
        fromIn.value = budgetActualCustom.from;
        toIn.value = budgetActualCustom.to;
        fromIn.onchange = (e) => { budgetActualCustom.from = e.target.value; renderBudgetActual(); };
        toIn.onchange = (e) => { budgetActualCustom.to = e.target.value; renderBudgetActual(); };
      }
    }

    const [from, to] = budgetActualRange(budgetActualPreset);
    if (budgetActualPreset === 'custom' && (!from || !to)) {
      $('#budgetActualTable').innerHTML =
        '<tbody><tr><td class="muted-cell" colspan="6">Pick a from and to date.</td></tr></tbody>';
      const hint = document.querySelector('.analysis-page-budget .analysis-tools .hint');
      if (hint) hint.textContent = 'Custom range · pick dates';
      return;
    }
    const rows = allBudgetRowsForRange(from, to);
    const rangeLabel = budgetActualRangeLabel(from, to, budgetActualPreset);
    const monthCount = rows[0]?.monthCount || monthsInDateRange(from, to).length || 1;
    const chartWrap = document.querySelector('.analysis-page-budget .canvas-wrap');
    if (chartWrap) chartWrap.style.height = budgetActualChartHeight(rows.length) + 'px';
    charts.budgetActual(rows);
    const budgetHead = monthCount > 1 ? `<th class="num">Budget <span class="muted-cell">(${monthCount} mo)</span></th>` : '<th class="num">Budget</th>';
    $('#budgetActualTable').innerHTML = rows.length
      ? `<thead><tr><th>Category</th>${budgetHead}<th class="num">Actual</th><th class="num">Remaining</th><th class="num">% used</th><th>Status</th></tr></thead><tbody>` +
        rows.map((r) => {
          const over = r.pct >= 100;
          const near = r.pct >= 80 && !over;
          const status = over ? '<span class="tag warn">Over</span>'
            : near ? '<span class="tag info">Near</span>'
            : '<span class="tag marked">OK</span>';
          const remClass = r.remaining < 0 ? 'amt-neg' : r.remaining > 0 ? 'amt-pos' : '';
          return `<tr><td>${chip(r.cat)}${r.isGroup ? ' <small class="muted">(group)</small>' : ''}</td>` +
            `<td class="num">${fmt(r.budget)}</td><td class="num">${fmt(r.spent)}</td>` +
            `<td class="num ${remClass}">${fmt(r.remaining)}</td>` +
            `<td class="num${over ? ' amt-neg' : ''}">${r.pct.toFixed(0)}%</td><td>${status}</td></tr>`;
        }).join('') + '</tbody>'
      : '<tbody><tr><td class="muted-cell" colspan="6">No budgets set. Add limits in <a href="#" data-settings-tab="budgets" style="color:var(--accent); text-decoration:underline;">Settings → Budgets</a>.</td></tr></tbody>';

    const bt = $('#budgetActualTable');
    if (bt) bindSettingsLinks(bt);

    const hint = document.querySelector('.analysis-page-budget .analysis-tools .hint');
    if (hint) {
      const over = rows.filter((r) => r.pct >= 100).length;
      const near = rows.filter((r) => r.pct >= 80 && r.pct < 100).length;
      let extra = '';
      if (over) extra += ` · ${over} over`;
      if (near) extra += ` · ${near} near limit`;
      const span = from && to && from !== to ? `${from} → ${to}` : (from || to || '');
      hint.textContent = `${rangeLabel}${span ? ` · ${span}` : ''} · ${rows.length} budget${rows.length === 1 ? '' : 's'}${extra}`;
    }
    if (window.Chart) {
      requestAnimationFrame(() => {
        const inst = Chart.getChart('chartBudgetActual');
        if (inst) inst.resize();
      });
    }
  }
  function buildBudgetAlertsHtml() {
    const alerts = overBudgetCategories();
    if (!alerts.length) return '';
    const ym = budgetMonthYm();
    return `<div id="budgetAlerts" class="budget-alerts"><div class="ba-head">Budgets · ${ym}</div>` +
      alerts.map((a) => {
        const over = a.pct >= 100;
        const c = sliceColor(a.cat);
        return `<div class="ba-row ${over ? 'over' : 'near'}">
          <span class="chip" style="background:${c}1a;color:${c}"><span class="dot" style="background:${c}"></span>${esc(a.cat)}${a.isGroup ? ' <small>(group)</small>' : ''}</span>
          <div class="ba-bar"><span style="width:${Math.min(100, a.pct).toFixed(0)}%;background:${over ? 'var(--danger,#ef4655)' : c}"></span></div>
          <span class="ba-num">${fmt(a.spent)} / ${fmt(a.budget)} <strong>${a.pct.toFixed(0)}%</strong>${over ? ' ⚠' : ''}</span>
        </div>`;
      }).join('') + '</div>';
  }
  function renderBudgetAlerts() {
    const widget = document.getElementById('widget-anomalies');
    if (!widget) return;
    const body = widget.querySelector('.widget-body');
    if (!body) return;
    const html = buildBudgetAlertsHtml();
    const existing = body.querySelector('#budgetAlerts');
    if (!html) { existing?.remove(); return; }
    if (existing) existing.outerHTML = html;
    else {
      const tableWrap = body.querySelector('.table-wrap');
      if (tableWrap) tableWrap.insertAdjacentHTML('beforebegin', html);
      else body.insertAdjacentHTML('afterbegin', html);
    }
  }

  function renderCategory() {
    const sel = $('#catViewMode');
    if (sel) {
      sel.value = categoryViewMode;
      sel.onchange = () => { categoryViewMode = sel.value; activeCategory = null; refreshAfterDataChange(); };
    }
  }

  function renderMerchants() {
    // Chart redrawn in refreshDataCharts() so it always uses the latest viewTxns.
  }

  function momChartHeight(monthCount) {
    const n = Math.max(1, monthCount || 1);
    return Math.min(160 + n * 16, 420);
  }

  function renderMoM() {
    const fullMom = analyze.monthOverMonth(momScopeTxns());
    const opts = analysisPeriodOptions(fullMom.length);
    const valid = new Set(opts.map((o) => o.v));
    if (!valid.has(momPeriod)) momPeriod = defaultAnalysisPeriod(fullMom.length);

    const sel = $('#momPeriod');
    if (sel) {
      sel.innerHTML = opts.map((o) =>
        `<option value="${o.v}"${o.v === momPeriod ? ' selected' : ''}>${o.l}</option>`).join('');
      sel.onchange = () => { momPeriod = sel.value; renderMoM(); };
    }

    const mom = sliceByAnalysisPeriod(fullMom, momPeriod);
    const chartWrap = document.querySelector('.analysis-page-mom .canvas-wrap');
    if (chartWrap) chartWrap.style.height = momChartHeight(mom.length) + 'px';
    charts.momBar(mom);
    $('#momTable').innerHTML =
      `<thead><tr><th>Month</th><th class="num">Spend</th><th class="num">Refunds</th><th class="num">Payments</th><th class="num">Net</th><th class="num">Δ Spend</th><th class="num">% Δ</th></tr></thead><tbody>` +
      mom.map((m) =>
        `<tr><td>${m.month}</td><td class="num">${fmt(m.spend)}</td><td class="num">${fmt(m.refunds)}</td><td class="num">${fmt(m.payments)}</td><td class="num">${fmt(m.net)}</td>` +
        `<td class="num ${m.deltaSpend > 0 ? 'amt-neg' : m.deltaSpend < 0 ? 'amt-pos' : ''}">${m.deltaSpend == null ? '-' : fmt(m.deltaSpend)}</td>` +
        `<td class="num">${fmtPct(m.pctSpend)}</td></tr>`
      ).join('') + '</tbody>';

    const movers = analyze.categoryMovers(mom).slice(0, 8);
    $('#moversTable').innerHTML = movers.length
      ? `<thead><tr><th>Category</th><th class="num">Previous</th><th class="num">Current</th><th class="num">Δ</th></tr></thead><tbody>` +
        movers.map((m) =>
          `<tr><td>${chip(m.category)}</td><td class="num">${fmt(m.previous)}</td><td class="num">${fmt(m.current)}</td>` +
          `<td class="num ${m.delta > 0 ? 'amt-neg' : 'amt-pos'}">${fmt(m.delta)}</td></tr>`
        ).join('') + '</tbody>'
      : '<tbody><tr><td class="muted-cell" colspan="4">Need at least two months in the selected period.</td></tr></tbody>';

    const hint = document.querySelector('.analysis-page-mom .analysis-tools .hint');
    if (hint) {
      const label = opts.find((o) => o.v === momPeriod)?.l || `${mom.length} months`;
      hint.textContent = `${label} · movers vs latest month in period`;
    }
    if (window.Chart) {
      requestAnimationFrame(() => {
        const inst = Chart.getChart('chartMoM');
        if (inst) inst.resize();
      });
    }
  }

  function renderRecurring() {
    const subs = Store.getSubscriptions();
    const rows = analyze.recurring(viewTxns, subs, Store.getSubscriptionRules());
    $('#recurringTable').innerHTML = rows.length
      ? `<thead><tr><th>Merchant</th><th>Category</th><th class="num">Charge</th><th class="num">Times</th><th class="num">Months</th><th>Last seen</th><th></th></tr></thead><tbody>` +
        rows.map((r) =>
          `<tr><td>${maskMerch(r.merchant)}</td><td>${chip(r.category)}</td><td class="num">${r.varies ? '<span class="muted">varies</span>' : fmt(r.amount)}</td>` +
          `<td class="num">${r.count}</td><td class="num">${r.months}</td><td>${r.lastDate}</td>` +
          `<td>${r.byRule ? '<span class="tag marked">rule</span>' : r.marked ? '<span class="tag marked">marked</span>' : ''}</td></tr>`
        ).join('') + '</tbody>'
      : '<tbody><tr><td class="muted-cell">No recurring charges. Tick the “Sub” box on a transaction, or add a keyword rule in <a href="#" data-settings-tab="rules" style="color:var(--accent); text-decoration:underline;">Settings → Subscription rules</a>.</td></tr></tbody>';

    const rt = $('#recurringTable');
    if (rt) bindSettingsLinks(rt);
  }

  function renderAnomalies(txns) {
    // Exclude recurring/subscription groups and any merchants the user excluded.
    const subs = Store.getSubscriptions();
    const subKeys = new Set(analyze.recurring(txns, subs, Store.getSubscriptionRules()).map((r) => r.key));
    const mExcl = Store.getMerchantAnomalyExcludes();
    const subRe = analyze.compileSubRules(Store.getSubscriptionRules());
    const isSub = (t) => mExcl[t.merchantKey] || analyze.matchesSubRule(t, subRe) || subKeys.has(analyze.subKey(t.merchantKey, t.spend));
    const rows = analyze.anomalies(txns, isSub);
    $('#anomalyTable').innerHTML = rows.length
      ? `<thead><tr><th>Type</th><th>Date</th><th>Merchant</th><th class="num">Amount</th></tr></thead><tbody>` +
        rows.map((r) => {
          const tag = r.type === 'Large outlier' ? 'warn' : 'info';
          return `<tr><td><span class="tag ${tag}">${r.type}</span></td><td>${r.date}</td>` +
            `<td>${maskMerch(r.merchant)}<div class="muted-cell" style="font-size:11px">${censored ? '' : esc(r.reason)}</div></td>` +
            `<td class="num amt-neg">${fmt(r.amount)}</td></tr>`;
        }).join('') + '</tbody>'
      : '<tbody><tr><td class="muted-cell">No anomalies detected.</td></tr></tbody>';
    renderBudgetAlerts();
  }

  function renderPatterns() {
    // Charts redrawn in refreshDataCharts().
  }

  function trendWidgetTitle() {
    if (trendMode === 'merchants') return `Top ${trendTopN} merchants over time`;
    if (trendMode === 'categories') return `Top ${trendTopN} categories over time`;
    return 'Spend over time';
  }

  function updateTrendTitle() {
    const head = document.querySelector('#widget-trend .widget-head h2');
    if (head) head.textContent = trendWidgetTitle();
  }

  function updateTrendChart() {
    if (trendMode === 'merchants') charts.trendMerchants(analyze.topMerchantsOverTime(viewTxns, trendTopN));
    else if (trendMode === 'categories') charts.trendCategories(analyze.topCategoriesOverTime(viewTxns, trendTopN));
    else charts.spendLine(analyze.spendOverTime(viewTxns));
  }

  // Trend widget: spend over time, top-N merchants, or top-N categories.
  function renderTrend() {
    const sel = $('#trendMode'), topWrap = $('#trendTopWrap'), topUnit = $('#trendTopUnit'), topN = $('#trendTopN');
    if (sel) {
      sel.value = trendMode;
      sel.onchange = () => { trendMode = sel.value; renderTrend(); };
    }
    const showTop = trendMode === 'merchants' || trendMode === 'categories';
    if (topWrap) topWrap.hidden = !showTop;
    if (topUnit) topUnit.textContent = trendMode === 'categories' ? 'categories' : 'merchants';
    if (topN) {
      topN.value = trendTopN;
      topN.onchange = topN.oninput = () => {
        trendTopN = Math.max(1, Math.min(50, parseInt(topN.value, 10) || 1));
        topN.value = trendTopN;
        updateTrendTitle();
        updateTrendChart();
      };
    }
    updateTrendTitle();
    if (document.getElementById('chartTrend')) updateTrendChart();
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
      refreshAfterDataChange();
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
    const dcell = (d) => `<td class="num ${d > 0 ? 'amt-neg' : d < 0 ? 'amt-pos' : ''}">${d === 0 ? '-' : (d > 0 ? '+' : '') + fmt(d)}</td>`;
    const totalRow = (label, key) => `<tr><td>${label}</td><td class="num">${fmt(cmp.a[key])}</td><td class="num">${fmt(cmp.b[key])}</td>${dcell(cmp.b[key] - cmp.a[key])}</tr>`;
    $('#compareOut').innerHTML =
      `<div class="table-wrap"><table class="cmp-table"><thead><tr><th></th><th class="num">Period A</th><th class="num">Period B</th><th class="num">Δ</th></tr></thead><tbody>` +
        totalRow('Total spend', 'totalSpend') + totalRow('Net spend', 'net') +
        totalRow('Refunds', 'totalRefunds') + totalRow('Payments', 'totalPayments') +
      `</tbody></table></div>
      <h3>By category</h3>
      <div class="table-wrap"><table><thead><tr><th>Category</th><th class="num">A</th><th class="num">B</th><th class="num">Δ</th></tr></thead><tbody>${
        cmp.categories.slice(0, 20).map((c) => `<tr><td>${chip(c.category)}</td><td class="num">${fmt(c.a)}</td><td class="num">${fmt(c.b)}</td>${dcell(c.delta)}</tr>`).join('')
      }</tbody></table></div>
      <h3>Top merchants</h3>
      <div class="table-wrap"><table><thead><tr><th>Merchant</th><th class="num">A</th><th class="num">B</th><th class="num">Δ</th></tr></thead><tbody>${
        cmp.merchants.map((m) => `<tr><td>${esc(m.merchant)}</td><td class="num">${fmt(m.a)}</td><td class="num">${fmt(m.b)}</td>${dcell(m.delta)}</tr>`).join('')
      }</tbody></table></div>`;
  }

  // ---- Feature 6: year in review ----
  function renderYearReview() {
    const base = activeAccount === 'all' ? allTxns : allTxns.filter((t) => (t.accountId || 'default') === activeAccount);
    const months = analyze.monthSpan(base);
    const sel = $('#yrSelect');
    const head = document.querySelector('#analysisBody .yr-head');
    const out = $('#yearReviewOut');

    if (months < 12) {
      if (head) head.style.display = 'none';
      if (out) {
        const plural = months === 1 ? '' : 's';
        out.innerHTML = `
          <div style="padding:28px 16px; text-align:center; color:var(--muted);">
            <div style="max-width:420px; margin:0 auto; text-align:left;">
              <p style="font-size:15px; line-height:1.5; margin:0 0 10px;">⏳ Whoa there, time traveler.</p>
              <p style="margin:0; line-height:1.5;">We only have <strong>${months}</strong> month${plural} of data so far. A proper "Year in Review" needs the full 12-month director's cut before it can deliver the dramatic "what was I thinking" montage and the year-over-year plot twist.</p>
            </div>
          </div>
        `;
      }
      return;
    }

    if (head) head.style.display = '';
    const years = analyze.yearsPresent(base);
    if (!years.length) {
      if (out) out.innerHTML = '<p class="muted">No yearly data yet.</p>';
      return;
    }
    if (!years.includes(yrSelected)) yrSelected = years[years.length - 1];
    if (sel) {
      sel.innerHTML = years.map((y) => `<option value="${y}"${y === yrSelected ? ' selected' : ''}>${y}</option>`).join('');
      sel.onchange = () => { yrSelected = sel.value; drawYearReview(); };
    }
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
      : card(ICON.balance, 'Biggest day', '-', 'small');
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
        yr.merchants.map((m) => `<tr><td>${esc(m.merchant)}</td><td class="num">${fmt(m.spend)}</td><td class="num">${m.count}</td></tr>`).join('')
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
    // Use catScopeTxns (date/cardmember scoped) so a category-chart drill-down does not empty the review queue.
    const rows = catScopeTxns.filter((t) => t.category === other && t.isSpend)
      .sort((a, b) => b.spend - a.spend || b.date.localeCompare(a.date));
    const head = document.querySelector('#widget-uncategorized .widget-head h2');
    if (head) head.textContent = rows.length ? `Review uncategorized (${rows.length})` : 'Review uncategorized';

    const opts = getCategories().map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    if (!rows.length) {
      table.innerHTML = '<tbody><tr><td class="muted-cell">Nothing in “Other” for the current filters - you’re caught up.</td></tr></tbody>';
      return;
    }
    table.innerHTML =
      `<thead><tr><th>Date</th><th>Merchant</th><th class="num">Amount</th><th>Category</th></tr></thead><tbody>` +
      rows.map((t) =>
        `<tr><td>${t.date}</td><td>${esc(t.name)}</td><td class="num amt-neg">${fmt(t.spend)}</td>` +
        `<td><select class="cat-select cat-select-txn" data-tid="${encodeURIComponent(t.tid)}" data-merchant="${encodeURIComponent(t.merchantKey)}">${opts}</select></td></tr>`
      ).join('') + '</tbody>';

    table.querySelectorAll('select.cat-select').forEach((sel, i) => wireCategorySelect(sel, rows[i]));
  }

  function unbindTxnResizeObserver() {
    if (txnResizeObs) { txnResizeObs.disconnect(); txnResizeObs = null; }
  }

  function measureTxnPageSize() {
    // On mobile the ledger renders as stacked cards; deriving the page size from
    // the (tall) card height yields ~1 row/page. Page in fixed 25-row batches
    // instead, decoupled from layout (desktop keeps fit-to-height behaviour).
    if (document.body.classList.contains('is-mobile')) return TXN_PAGE_FALLBACK;
    const widget = document.getElementById('widget-transactions');
    if (!widget) return txnPageSize || TXN_PAGE_FALLBACK;
    const wrap = widget.querySelector('.table-wrap');
    const table = widget.querySelector('#txnTable');
    if (!wrap || !table) return txnPageSize || TXN_PAGE_FALLBACK;
    const wrapH = wrap.clientHeight;
    if (wrapH < 24) return txnPageSize || TXN_PAGE_FALLBACK;
    const headH = table.querySelector('thead')?.offsetHeight || 0;
    const sample = table.querySelector('tbody tr');
    const rowH = sample?.offsetHeight || 38;
    const available = wrapH - headH;
    if (available < rowH) return TXN_PAGE_MIN;
    return Math.max(TXN_PAGE_MIN, Math.min(TXN_PAGE_MAX, Math.floor(available / rowH)));
  }

  function bindTxnResizeObserver() {
    const widget = document.getElementById('widget-transactions');
    if (!widget) return;
    unbindTxnResizeObserver();
    const body = widget.querySelector('.widget-body');
    if (!body || typeof ResizeObserver === 'undefined') return;
    txnResizeObs = new ResizeObserver(() => {
      if (!$('#txnTable')) return;
      const next = measureTxnPageSize();
      if (next === txnPageSize) return;
      const firstRow = txnPage * txnPageSize;
      txnPageSize = next;
      txnPage = Math.max(0, Math.floor(firstRow / txnPageSize));
      renderTxnTable(true);
    });
    txnResizeObs.observe(body);
  }

  function refineTxnPageSize() {
    const next = measureTxnPageSize();
    if (next === txnPageSize) return false;
    const firstRow = txnPage * txnPageSize;
    txnPageSize = next;
    txnPage = Math.max(0, Math.floor(firstRow / txnPageSize));
    return true;
  }

  function renderCategoryFilterOptions() {
    const present = [...new Set(allTxns.map((t) => t.category))].sort();
    const sel = $('#txnCategory');
    sel.innerHTML = '<option value="">All categories</option>' + present.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    sel.value = txnCatFilter;
  }

  function renderTransactions() {
    const showCm = isPro();
    $('#txnSearch').value = txnQuery;
    renderCategoryFilterOptions();
    $('#bulkCat').innerHTML = catOptions();
    const bh = $('#bulkCardholder');
    const ba = $('#bulkCardApply');
    if (bh) bh.hidden = !showCm;
    if (ba) ba.hidden = !showCm;
    const cmTh = document.querySelector('#txnTable th[data-sort="cardmember"]');
    if (cmTh) cmTh.hidden = !showCm;
    if (showCm) {
      $('#cardholderList').innerHTML = [...new Set(allTxns.map((t) => t.cardmember))].sort()
        .map((c) => `<option value="${esc(c)}"></option>`).join('');
    }
    $('#txnSearch').oninput = () => { txnQuery = $('#txnSearch').value; txnPage = 0; renderTxnTable(); };
    $('#txnCategory').onchange = () => { txnCatFilter = $('#txnCategory').value; txnPage = 0; renderTxnTable(); };
    $('#txnPrev').onclick = () => { if (txnPage > 0) { txnPage--; renderTxnTable(); } };
    $('#txnNext').onclick = () => { txnPage++; renderTxnTable(); };
    $('#txnSelectAll').onchange = () => {
      const on = $('#txnSelectAll').checked;
      $$('#txnTable .row-check').forEach((cb) => { cb.checked = on; });
      updateBulkButton();
    };
    $('#bulkApply').onclick = applyBulkRecategorize;
    $('#bulkCardApply').onclick = applyBulkCardholder;
    $('#bulkDelete').onclick = applyBulkDelete;
    $('#bulkCardholder').oninput = updateBulkButton;
    $$('#txnTable th[data-sort]').forEach((th) => th.onclick = () => {
      const k = th.dataset.sort;
      if (sortKey === k) sortDir *= -1; else { sortKey = k; sortDir = (k === 'date' || k === 'amount') ? -1 : 1; }
      txnPage = 0;
      renderTxnTable();
    });
    renderTxnTable();
    bindTxnResizeObserver();
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
  function selectedStoreKeys() {
    return selectedRowChecks().map((cb) => decodeURIComponent(cb.dataset.storeKey));
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
    const dbtn = $('#bulkDelete');
    if (dbtn) {
      const r = selectedRowChecks().length;
      dbtn.textContent = `Delete ${r}`;
      dbtn.disabled = r === 0;
    }
  }
  function applyBulkDelete() {
    const keys = selectedStoreKeys();
    if (!keys.length) return;
    if (!confirm(`Delete ${keys.length} selected transaction${keys.length === 1 ? '' : 's'}? This cannot be undone.`)) return;
    let n = 0;
    keys.forEach((k) => { if (Store.deleteTransaction(k)) n++; });
    toast(`Deleted ${n} transaction${n === 1 ? '' : 's'}`, { check: true });
    refreshAfterDataChange();
  }
  function applyBulkRecategorize() {
    const keys = selectedMerchantKeys();
    if (!keys.length) return;
    const cat = $('#bulkCat').value;
    keys.forEach((mk) => Store.setOverride(mk, cat));
    toast(`Recategorized ${keys.length} merchant${keys.length === 1 ? '' : 's'} → ${cat}`, { check: true });
    refreshAfterDataChange();
  }
  function applyBulkCardholder() {
    const tids = selectedTids();
    const name = $('#bulkCardholder').value.trim();
    if (!tids.length || !name) return;
    tids.forEach((tid) => Store.setCardmemberOverride(tid, name));
    toast(`Set cardholder “${name}” on ${tids.length} transaction${tids.length === 1 ? '' : 's'}`, { check: true });
    refreshAfterDataChange();
  }

  function editTransactionMerchant(storeKey, currentName) {
    const next = prompt('Edit merchant name:', currentName);
    if (next == null) return;
    const trimmed = next.trim();
    if (!trimmed || trimmed === currentName) return;
    if (!Store.updateTransactionMerchant(storeKey, trimmed)) {
      toast('Could not update merchant');
      return;
    }
    toast('Merchant updated', { check: true });
    refreshAfterDataChange();
  }

  function deleteTransactionRow(storeKey, label) {
    const msg = label
      ? `Delete this transaction?\n\n${label}`
      : 'Delete this transaction?';
    if (!confirm(msg)) return;
    if (!Store.deleteTransaction(storeKey)) {
      toast('Could not delete transaction');
      return;
    }
    toast('Transaction deleted', { check: true });
    refreshAfterDataChange();
  }

  function renderTxnTable(skipRefine) {
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

    txnPageSize = measureTxnPageSize();
    const totalPages = Math.max(1, Math.ceil(rows.length / txnPageSize));
    if (txnPage >= totalPages) txnPage = totalPages - 1;
    if (txnPage < 0) txnPage = 0;
    const pageStart = txnPage * txnPageSize;
    const pageRows = rows.slice(pageStart, pageStart + txnPageSize);
    const pageEnd = pageStart + pageRows.length;
    $('#txnCount').textContent = rows.length
      ? `${pageStart + 1}–${pageEnd} of ${rows.length} (${ledgerTxns.length} total)`
      : `0 of ${ledgerTxns.length}`;
    const pager = $('#txnPager');
    if (pager) {
      pager.hidden = totalPages <= 1;
      $('#txnPageLabel').textContent = `${txnPage + 1} / ${totalPages}`;
      $('#txnPrev').disabled = txnPage <= 0;
      $('#txnNext').disabled = txnPage >= totalPages - 1;
    }
    const showCm = isPro();
    $('#txnTable tbody').innerHTML = pageRows.map((t) => {
      const amtCls = t.isSpend ? 'amt-neg' : 'amt-pos';
      const key = analyze.subKey(t.merchantKey, t.spend);
      const subCell = t.isSpend
        ? `<input type="checkbox" class="sub-check" data-key="${encodeURIComponent(key)}" ${subs[key] ? 'checked' : ''} title="Mark this merchant + amount as a subscription">`
        : '';
      const tagCell = txnTagCellHtml(t);
      return `<tr>
        <td class="chk-cell"><input type="checkbox" class="row-check" data-merchant="${encodeURIComponent(t.merchantKey)}" data-tid="${encodeURIComponent(t.tid)}" data-store-key="${encodeURIComponent(t.storeKey)}"></td>
        <td data-label="Date">${t.date}</td>
        <td class="txn-merch" data-label="Merchant"><span class="txn-name" data-merchant="${encodeURIComponent(t.merchantKey)}">${maskMerch(t.name)}</span><button type="button" class="icon-btn txn-edit" data-store-key="${encodeURIComponent(t.storeKey)}" data-name="${encodeURIComponent(t.name)}" title="Edit merchant">${svg(PENCIL)}</button></td>
        ${showCm ? `<td data-label="Cardmember">${esc(t.cardmember)}</td>` : ''}
        <td data-label="Category"><select class="cat-select cat-select-txn" data-tid="${encodeURIComponent(t.tid)}" data-merchant="${encodeURIComponent(t.merchantKey)}">${opts}</select></td>
        <td class="num ${amtCls}" data-label="Amount">${fmt(t.amount)}</td>
        <td class="tag-cell" data-label="Tags">${tagCell}</td>
        <td class="sub-cell" data-label="Subscription">${subCell}</td>
        <td class="txn-actions"><button type="button" class="icon-btn txn-del danger" data-store-key="${encodeURIComponent(t.storeKey)}" data-name="${encodeURIComponent(t.name)}" title="Delete transaction">${svg(TRASH)}</button></td>
      </tr>`;
    }).join('');

    const tb = $('#txnTable tbody');
    tb.querySelectorAll('select.cat-select').forEach((sel, i) => wireCategorySelect(sel, pageRows[i]));
    tb.querySelectorAll('input.sub-check').forEach((cb) => {
      cb.onchange = () => {
        Store.setSubscription(decodeURIComponent(cb.dataset.key), cb.checked);
        toast(cb.checked ? 'Marked as subscription - all matching charges tracked' : 'Removed from subscriptions', { check: true });
        refreshAfterDataChange();
      };
    });
    tb.querySelectorAll('input.row-check').forEach((cb) => cb.onchange = updateBulkButton);
    tb.querySelectorAll('.tag-btn').forEach((btn) => btn.onclick = () => {
      const tid = decodeURIComponent(btn.dataset.tid), tag = btn.dataset.tag;
      const turningOn = !btn.classList.contains('on');
      Store.setTxnTag(tid, tag, turningOn);
      if (turningOn && tag === 'reimbursable' && !Store.getTxnReimburse()[tid]) {
        Store.setTxnReimburse(tid, { mode: 'percent', value: 100 });
      }
      refreshAfterDataChange();
    });
    bindReimbFields(tb);
    tb.querySelectorAll('.txn-name').forEach((el) => el.onclick = () => openMerchantDrill(decodeURIComponent(el.dataset.merchant)));
    tb.querySelectorAll('.txn-edit').forEach((btn) => btn.onclick = (e) => {
      e.stopPropagation();
      editTransactionMerchant(decodeURIComponent(btn.dataset.storeKey), decodeURIComponent(btn.dataset.name));
    });
    tb.querySelectorAll('.txn-del').forEach((btn) => btn.onclick = () => {
      deleteTransactionRow(decodeURIComponent(btn.dataset.storeKey), decodeURIComponent(btn.dataset.name));
    });
    updateBulkButton();

    if (!skipRefine) {
      const wrap = document.querySelector('#widget-transactions .table-wrap');
      const needsLayout = wrap && wrap.clientHeight < 24;
      const retry = () => {
        if (refineTxnPageSize()) renderTxnTable(true);
      };
      if (needsLayout) requestAnimationFrame(() => requestAnimationFrame(retry));
      else if (refineTxnPageSize()) renderTxnTable(true);
    }
  }

  function renderFilterBanner() {
    const b = $('#filterBanner');
    if (!b) return;
    const hasCross = activeCategory || activeCardmember;
    const hasTxn = hasTxnFilters();
    const show = viewName === 'dashboard' && (hasCross || hasTxn);
    if (!show) { b.hidden = true; b.innerHTML = ''; return; }
    b.hidden = false;
    const parts = ['<span>Filtering all widgets by</span>'];
    if (activeCategory) {
      parts.push(`${filterChip(activeCategory)}<button type="button" class="clear-filter" data-filter-clear="category">Clear</button>`);
    }
    if (activeCardmember) {
      parts.push(`${filterChip(activeCardmember)}<button type="button" class="clear-filter" data-filter-clear="cardmember">Clear</button>`);
    }
    if (flowFilter !== 'all') {
      parts.push(`<span class="chip">${flowFilterLabel(flowFilter)}</span><button type="button" class="clear-filter" data-filter-clear="flow">Clear</button>`);
    }
    if (amountMin || amountMax) {
      parts.push(`<span class="chip">${amountMin || '…'} – ${amountMax || '…'}</span><button type="button" class="clear-filter" data-filter-clear="amount">Clear</button>`);
    }
    b.innerHTML = parts.join('');
  }

  function bindFilterBanner() {
    const b = $('#filterBanner');
    if (!b || b.dataset.bound) return;
    b.dataset.bound = '1';
    b.addEventListener('pointerdown', (e) => {
      const btn = e.target.closest('[data-filter-clear]');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      charts.suppressCategoryClick(300);
      charts.suppressCardmemberClick(300);
      const which = btn.dataset.filterClear;
      if (which === 'category') clearCategoryCrossFilter();
      else if (which === 'cardmember') activeCardmember = null;
      else if (which === 'flow') flowFilter = 'all';
      else if (which === 'amount') { amountMin = ''; amountMax = ''; }
      refreshAfterDataChange();
    }, true);
  }

  function clearCategoryCrossFilter() {
    if (activeCategory && txnCatFilter && categoryMatchesSlice(txnCatFilter, activeCategory)) {
      txnCatFilter = '';
      txnPage = 0;
    }
    activeCategory = null;
    charts.suppressCategoryClick(150);
  }

  function onCategoryChartClick(cat) {
    if (!cat) return;
    charts.suppressCategoryClick(300);
    activeCategory = activeCategory === cat ? null : cat;
    refreshAfterDataChange();
  }

  function onCardmemberChartClick(cm) {
    if (!cm) return;
    charts.suppressCardmemberClick(300);
    activeCardmember = activeCardmember === cm ? null : cm;
    refreshAfterDataChange();
  }

  function clearDashboardFilters() {
    clearCategoryCrossFilter();
    activeCardmember = null;
    dateFrom = '';
    dateTo = '';
    dateRangeInit = true;
    amountMin = '';
    amountMax = '';
    flowFilter = 'all';
    excludeTagged = false;
    activeAccount = 'all';
    txnQuery = '';
    txnCatFilter = '';
    txnPage = 0;
    persistDatePeriod();
    refreshAfterDataChange();
  }

  // ============ Preferences ============
  function renderDangerZoneDemoCopy() {
    const zone = $('#set-danger');
    if (!zone) return;
    const demo = isDemoActive();
    const intro = zone.querySelector('p.muted');
    const opts = zone.querySelectorAll('.danger-opt .muted');
    if (intro) {
      intro.textContent = demo
        ? 'These actions only affect demo sample data. Your own saved data on this device is not touched.'
        : 'Export a backup first if you might want any of this back.';
    }
    if (opts[0]) {
      opts[0].textContent = demo
        ? 'Removes demo transactions only; keeps demo settings (categories, rules, budgets, layout).'
        : 'Removes imported transactions, keeps all your settings (categories, rules, budgets, custom cards, accounts, layout).';
    }
    if (opts[1]) {
      opts[1].textContent = demo
        ? 'Clears all demo data and exits demo mode. Your own saved data is not affected.'
        : 'Removes all transactions and every saved setting from this device.';
    }
  }

  function renderPrefs() {
    renderCategoryApplyPref();
    renderCatManager(); renderRuleManager(); renderSubRuleManager(); renderMergeRuleManager(); renderCardManager(); renderGroupManager(); renderBudgetManager();
    renderAccountManager(); renderMergeManager(); renderCardmemberMergeManager(); renderWidgetManager(); renderAccountSize();
    renderDangerZoneDemoCopy();
  }

  function renderCategoryApplyPref() {
    const sel = $('#categoryApplyMode');
    if (!sel) return;
    sel.value = Store.getCategoryApplyMode();
    sel.onchange = () => {
      Store.setCategoryApplyMode(sel.value);
      toast('Category change preference saved', { check: true });
    };
  }

  function catOptions(selected) {
    return getCategories().map((c) => `<option value="${esc(c)}"${c === selected ? ' selected' : ''}>${esc(c)}</option>`).join('');
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
              <code class="rule-pat">/${esc(r.pattern || '')}/${r.flags || 'i'}</code>
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
      Store.updateRule(sel.dataset.id, { category: sel.value }); render(); toast('Rule updated', { check: true });
    });
    $$('.rule-del', container).forEach((btn) => btn.onclick = () => {
      Store.removeRule(btn.dataset.id); render(); toast('Rule removed', { check: true });
    });
    $('#ruleAddBtn').onclick = () => {
      const pattern = $('#rulePattern').value.trim();
      const flags = $('#ruleCase').checked ? '' : 'i';
      if (!pattern) { toast('Enter a regex pattern'); return; }
      if (!isPro()) { requirePro('Custom categorization rules'); return; }
      if (Store.addRule(pattern, $('#ruleCat').value, flags)) { render(); toast('Rule added', { check: true }); }
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
    applyProLock(container, 'Custom categorization rules');
  }

  // ---- Subscription keyword rules ----
  function renderSubRuleManager() {
    const container = $('#subRuleManager');
    if (!container) return;
    const rules = Store.getSubscriptionRules();
    container.innerHTML =
      (rules.length
        ? `<div class="rule-list">` + rules.map((r) =>
            `<div class="rule-row">
              <code class="rule-pat">/${esc(r.pattern || '')}/${r.flags || 'i'}</code>
              <span class="rule-arrow">→ recurring</span>
              <button class="icon-btn subrule-del" data-id="${r.id}" title="Delete rule">${svg(TRASH)}</button>
            </div>`).join('') + `</div>`
        : `<p class="muted-cell" style="padding:6px 0 12px">No subscription rules yet.</p>`) +
      `<div class="rule-add">
        <input type="text" id="subRulePattern" placeholder="Keyword or regex, e.g. NETFLIX|SPOTIFY|GYM">
        <label class="rule-ci" title="Case sensitive"><input type="checkbox" id="subRuleCase"> Aa</label>
        <button class="btn primary" id="subRuleAddBtn">Add rule</button>
      </div>`;

    $$('.subrule-del', container).forEach((btn) => btn.onclick = () => {
      Store.removeSubscriptionRule(btn.dataset.id); render(); toast('Rule removed', { check: true });
    });
    $('#subRuleAddBtn').onclick = () => {
      const pattern = $('#subRulePattern').value.trim();
      const flags = $('#subRuleCase').checked ? '' : 'i';
      if (!pattern) { toast('Enter a keyword or regex'); return; }
      if (!isPro()) { requirePro('Subscription rules'); return; }
      if (Store.addSubscriptionRule(pattern, flags)) { render(); toast('Subscription rule added', { check: true }); }
      else toast('Invalid regular expression');
    };
    applyProLock(container, 'Subscription rules');
  }

  // ---- Auto-merge rules ----
  function renderMergeRuleManager() {
    const container = $('#mergeRuleManager');
    if (!container) return;
    const rules = Store.getMergeRules();
    container.innerHTML =
      (rules.length
        ? `<div class="rule-list">` + rules.map((r) =>
            `<div class="rule-row">
              <code class="rule-pat">/${esc(r.pattern || '')}/${r.flags || 'i'}</code>
              <span class="rule-arrow">→</span>
              <span class="merge-rule-target">${(r.target || '').replace(/</g, '&lt;')}</span>
              <button class="icon-btn mergerule-del" data-id="${r.id}" title="Delete rule">${svg(TRASH)}</button>
            </div>`).join('') + `</div>`
        : `<p class="muted-cell" style="padding:6px 0 12px">No auto-merge rules yet.</p>`) +
      `<div class="rule-add">
        <input type="text" id="mergeRulePattern" placeholder="Match (keyword/regex), e.g. AMZN|AMAZON">
        <label class="rule-ci" title="Case sensitive"><input type="checkbox" id="mergeRuleCase"> Aa</label>
        <input type="text" id="mergeRuleTarget" placeholder="Merge into… e.g. Amazon">
        <button class="btn primary" id="mergeRuleAddBtn">Add rule</button>
      </div>`;

    $$('.mergerule-del', container).forEach((btn) => btn.onclick = () => {
      Store.removeMergeRule(btn.dataset.id); render(); toast('Rule removed', { check: true });
    });
    $('#mergeRuleAddBtn').onclick = () => {
      const pattern = $('#mergeRulePattern').value.trim();
      const target = $('#mergeRuleTarget').value.trim();
      const flags = $('#mergeRuleCase').checked ? '' : 'i';
      if (!pattern || !target) { toast('Enter a pattern and a merge-into name'); return; }
      if (!isPro()) { requirePro('Auto-merge rules'); return; }
      if (Store.addMergeRule(pattern, target, flags)) { render(); toast('Auto-merge rule added', { check: true }); }
      else toast('Invalid regular expression');
    };
    applyProLock(container, 'Auto-merge rules');
  }

  // ---- Custom KPI cards (Spending overview) ----
  const CC_FIELD_LABELS = { category: 'Category', description: 'Description/Merchant', cardmember: 'Cardmember', amount: 'Amount', type: 'Type' };
  const CC_FIELD_OPS = { category: ['is'], description: ['contains', 'not-contains', 'matches'], cardmember: ['is', 'contains'], amount: ['gt', 'lt', 'gte', 'lte', 'eq'], type: ['is'] };
  const CC_OP_LABELS = { is: 'is', contains: 'contains', 'not-contains': "doesn't contain", matches: 'matches regex', gt: '>', lt: '<', gte: '≥', lte: '≤', eq: '=' };
  const ccEsc = esc;
  let cardDraft = null;

  function ccDefaultValue(field) {
    if (field === 'category') return getCategories()[0] || '';
    if (field === 'type') return 'spend';
    return '';
  }
  function ccValueControl(cond) {
    if (cond.field === 'category') return `<select class="cc-val">${catOptions(cond.value)}</select>`;
    if (cond.field === 'type') return `<select class="cc-val">${['spend', 'payment', 'refund'].map((v) => `<option value="${v}"${v === cond.value ? ' selected' : ''}>${v}</option>`).join('')}</select>`;
    if (cond.field === 'amount') return `<input type="number" step="0.01" class="cc-val" value="${ccEsc(cond.value)}" placeholder="0.00">`;
    return `<input type="text" class="cc-val" value="${ccEsc(cond.value)}" placeholder="${cond.field === 'description' ? 'e.g. cpap' : 'value'}">`;
  }
  function ccCondRow(cond, i) {
    const ops = CC_FIELD_OPS[cond.field] || ['is'];
    return `<div class="cc-cond" data-i="${i}">
      <select class="cc-field">${Object.keys(CC_FIELD_LABELS).map((f) => `<option value="${f}"${f === cond.field ? ' selected' : ''}>${CC_FIELD_LABELS[f]}</option>`).join('')}</select>
      <select class="cc-op">${ops.map((o) => `<option value="${o}"${o === cond.op ? ' selected' : ''}>${CC_OP_LABELS[o]}</option>`).join('')}</select>
      ${ccValueControl(cond)}
      <button class="icon-btn cc-cond-del" title="Remove condition">${svg(TRASH)}</button>
    </div>`;
  }
  function ccReadDraft(container) {
    const name = container.querySelector('#ccName').value.trim();
    const match = container.querySelector('#ccMatch').value;
    const conditions = [...container.querySelectorAll('.cc-cond')].map((row) => ({
      field: row.querySelector('.cc-field').value,
      op: row.querySelector('.cc-op').value,
      value: row.querySelector('.cc-val').value,
    }));
    cardDraft = { name, match, conditions };
  }
  function ccSummary(cc) {
    return (cc.conditions || []).map((x) => `${CC_FIELD_LABELS[x.field] || x.field} ${CC_OP_LABELS[x.op] || x.op} ${x.value}`).join(cc.match === 'any' ? ' OR ' : ' AND ');
  }
  function renderCardManager() {
    const container = $('#cardManager');
    if (!container) return;
    if (!cardDraft) cardDraft = { name: '', match: 'all', conditions: [{ field: 'category', op: 'is', value: ccDefaultValue('category') }] };
    const cards = Store.getCustomCards();
    container.innerHTML =
      (cards.length
        ? `<div class="rule-list">` + cards.map((cc) =>
            `<div class="rule-row"><strong>${ccEsc(cc.name)}</strong><span class="rule-arrow">·</span><span class="muted cc-sum">${ccEsc(ccSummary(cc))}</span><button class="icon-btn cc-del" data-id="${cc.id}" title="Delete card">${svg(TRASH)}</button></div>`).join('') + `</div>`
        : `<p class="muted-cell" style="padding:6px 0 12px">No custom cards yet. Build one below - it appears in the Spending overview, totalled over the selected period.</p>`) +
      `<div class="cc-builder">
        <div class="cc-head-row">
          <input type="text" id="ccName" placeholder="Card name, e.g. CPAP Spend" value="${ccEsc(cardDraft.name)}">
          <label class="cc-match">Match <select id="ccMatch"><option value="all"${cardDraft.match === 'all' ? ' selected' : ''}>All conditions</option><option value="any"${cardDraft.match === 'any' ? ' selected' : ''}>Any condition</option></select></label>
        </div>
        <div id="ccConds">${cardDraft.conditions.map((c, i) => ccCondRow(c, i)).join('')}</div>
        <div class="cc-actions"><button type="button" class="btn sm" id="ccAddCond">+ Add condition</button><button type="button" class="btn primary" id="ccCreate">Create card</button></div>
      </div>`;

    $$('.cc-del', container).forEach((b) => b.onclick = () => { Store.removeCustomCard(b.dataset.id); render(); toast('Card removed', { check: true }); });
    container.querySelector('#ccName').oninput = (e) => { cardDraft.name = e.target.value; };
    container.querySelector('#ccMatch').onchange = (e) => { cardDraft.match = e.target.value; };
    container.querySelector('#ccAddCond').onclick = () => { ccReadDraft(container); cardDraft.conditions.push({ field: 'description', op: 'contains', value: '' }); renderCardManager(); };
    $$('.cc-cond', container).forEach((row) => {
      const i = +row.dataset.i;
      row.querySelector('.cc-field').onchange = (e) => { ccReadDraft(container); const f = e.target.value; cardDraft.conditions[i] = { field: f, op: (CC_FIELD_OPS[f] || ['is'])[0], value: ccDefaultValue(f) }; renderCardManager(); };
      row.querySelector('.cc-op').onchange = () => ccReadDraft(container);
      row.querySelector('.cc-val').oninput = () => ccReadDraft(container);
      row.querySelector('.cc-val').onchange = () => ccReadDraft(container);
      row.querySelector('.cc-cond-del').onclick = () => { ccReadDraft(container); if (cardDraft.conditions.length > 1) cardDraft.conditions.splice(i, 1); renderCardManager(); };
    });
    container.querySelector('#ccCreate').onclick = () => {
      ccReadDraft(container);
      if (!isPro()) { requirePro('Custom KPI cards'); return; }
      if (!cardDraft.name) { toast('Name your card'); return; }
      const valid = cardDraft.conditions.filter((c) => c.field && (c.field === 'amount' ? c.value !== '' : String(c.value).trim() !== '' || c.field === 'category' || c.field === 'type'));
      if (!valid.length) { toast('Add at least one condition'); return; }
      Store.addCustomCard({ name: cardDraft.name, match: cardDraft.match, conditions: valid });
      cardDraft = null;
      render(); toast('Custom card created', { check: true });
    };
    applyProLock(container, 'Custom KPI cards');
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

    $$('#budgetManager .budget-amt').forEach((inp) => {
      const save = () => {
        const cat = decodeURIComponent(inp.dataset.cat);
        Store.setBudget(cat, inp.value);
        toast(inp.value ? `Budget set for ${cat}` : `Budget cleared for ${cat}`, { check: true });
        render();
      };
      inp.onchange = save;
      inp.onblur = save;
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
              <input type="text" class="group-name" value="${esc(g.name)}" data-id="${g.id}">
              <div class="group-cats">${g.categories.map((c) => chip(c)).join(' ') || '<span class="muted">No categories</span>'}</div>
              <button class="icon-btn group-del" data-id="${g.id}" title="Remove group">${svg(TRASH)}</button>
            </div>`).join('')
        : '<p class="muted-cell" style="padding:6px 0 12px">No groups yet.</p>') +
      `<div class="group-add">
        <input type="text" id="newGroupName" placeholder="Group name, e.g. Food">
        <input type="color" id="newGroupColor" value="#5b5bf0">
        <select id="newGroupCats" multiple size="4" title="Hold Ctrl/Cmd to select multiple">${spendCats.map((c) =>
          `<option value="${esc(c)}"${assigned.has(c) ? ' disabled' : ''}>${esc(c)}${assigned.has(c) ? ' (in group)' : ''}</option>`).join('')}</select>
        <button class="btn primary" id="addGroupBtn">Add group</button>
      </div>`;

    $$('.group-color', container).forEach((inp) => inp.onchange = () => {
      Store.updateCategoryGroup(inp.dataset.id, { color: inp.value }); render();
    });
    $$('.group-name', container).forEach((inp) => inp.onchange = () => {
      if (Store.updateCategoryGroup(inp.dataset.id, { name: inp.value.trim() })) render();
      else toast('Could not rename - name empty or taken');
    });
    $$('.group-del', container).forEach((btn) => btn.onclick = () => {
      Store.removeCategoryGroup(btn.dataset.id); render(); toast('Group removed', { check: true });
    });
    $('#addGroupBtn').onclick = () => {
      const name = $('#newGroupName').value.trim();
      const cats = [...$('#newGroupCats').selectedOptions].map((o) => o.value);
      if (!name) { toast('Enter a group name'); return; }
      if (!cats.length) { toast('Select at least one category'); return; }
      if (Store.addCategoryGroup(name, $('#newGroupColor').value, cats)) {
        render(); toast(`Group “${name}” added`, { check: true });
      } else toast('That group name already exists');
    };
  }

  async function renderAccountSize() {
    const el = $('#storageSize');
    if (!el) return;
    try {
      const bytes = await Store.estimatedBytes();
      el.textContent = `Storage used: ${formatStorageSize(bytes)}` + (bytes >= SIZE_WARN ? ' · consider exporting a backup' : '');
    } catch (e) { el.textContent = ''; }
  }

  // ---- Feature 8: accounts ----
  function importAccountSelectHtml(accounts) {
    const opts = accounts.map((a) => `<option value="${esc(a.id)}">${esc(a.label)}</option>`).join('');
    const extra = isPro() ? '<option value="__new">+ New account…</option>' : '';
    return opts + extra;
  }
  function renderAccountManager() {
    const container = $('#accountManager');
    if (!container) return;
    const accounts = Store.getAccounts();
    const counts = {};
    allTxns.forEach((t) => { const a = t.accountId || 'default'; counts[a] = (counts[a] || 0) + 1; });
    const canAdd = isPro();
    container.innerHTML =
      `<div class="acct-list">` + accounts.map((a) =>
        `<div class="acct-row">
          <span class="acct-label">${esc(a.label)}</span>
          <span class="acct-meta">
            <span class="mi-meta">${counts[a.id] || 0} txns</span>
            <button class="icon-btn acct-rename" data-id="${encodeURIComponent(a.id)}" title="Rename account">${svg(PENCIL)}</button>
          </span>
        </div>`).join('') + `</div>` +
      (canAdd
        ? `<div class="acct-add">
        <input type="text" id="newAcctName" placeholder="New account label, e.g. Personal Visa">
        <button class="btn primary" id="addAcctBtn">Add account</button>
      </div>`
        : `<p class="muted" style="margin-top:10px">Free plan includes one account. <button type="button" class="linkish" id="acctProUpgrade">Upgrade to Pro</button> for unlimited accounts and cardmember breakdown.</p>`);
    const upg = container.querySelector('#acctProUpgrade');
    if (upg) upg.onclick = openUpgradeModal;
    $$('.acct-rename', container).forEach((btn) => btn.onclick = () => {
      const id = decodeURIComponent(btn.dataset.id);
      const acc = accounts.find((a) => a.id === id);
      if (!acc) return;
      const next = prompt(`Rename “${acc.label}” to:`, acc.label);
      if (next == null) return;
      if (Store.renameAccount(id, next.trim())) {
        renderAccountManager();
        syncAccountFilter();
        toast('Account renamed', { check: true });
      } else toast('Could not rename - name is empty or already in use');
    });
    const addBtn = $('#addAcctBtn');
    if (addBtn) addBtn.onclick = () => {
      const label = $('#newAcctName').value.trim();
      if (!label) { toast('Enter an account label'); return; }
      if (!Store.addAccount(label)) { requirePro('Multiple accounts'); return; }
      $('#newAcctName').value = ''; renderAccountManager(); toast('Account added', { check: true });
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
        ? `<div class="merge-suggestions"><h3>Suggested merges</h3><p class="muted" style="margin:0 0 10px">Likely duplicates - merge to roll up spend, or dismiss to hide.</p>` +
          suggestions.map((s) =>
            `<div class="merge-suggest-row">
              <span class="ms-names"><strong>${esc(s.a)}</strong> + <strong>${esc(s.b)}</strong></span>
              <span class="mi-meta">${fmt(s.combined)} combined</span>
              <div class="merge-suggest-actions">
                <button class="btn sm merge-sugg-btn" data-a="${encodeURIComponent(s.a)}" data-b="${encodeURIComponent(s.b)}">Merge</button>
                <button class="btn sm ghost merge-dismiss-btn" data-a="${encodeURIComponent(s.a)}" data-b="${encodeURIComponent(s.b)}">Dismiss</button>
              </div>
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
        `<label class="merge-item" data-name="${esc(m.key.toLowerCase())}">
          <input type="checkbox" class="merge-check" value="${encodeURIComponent(m.key)}">
          <span class="mi-name">${esc(m.key)}</span><span class="mi-meta">${m.count}× · ${fmt(m.spend)}</span>
        </label>`).join('')}</div>
      <div class="merge-apply">
        <input type="text" id="mergeName" placeholder="Merge into… (defaults to first ticked)">
        <button class="btn primary" id="mergeBtn">Merge selected</button>
      </div>` +
      (canonicals.length
        ? `<h3>Remembered merges</h3>` + canonicals.map((c) =>
            `<div class="merge-saved"><span class="ms-canon">${esc(c)}<button class="icon-btn ms-rename" data-canon="${encodeURIComponent(c)}" title="Rename merged merchant">${svg(PENCIL)}</button></span><span class="ms-aliases">${
              byCanonical[c].map((a) => `<span class="ms-alias">${esc(a)}<button class="ms-x" data-alias="${encodeURIComponent(a)}" title="Remove">×</button></span>`).join('')
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
      render(); toast(`Merged into “${canonical}”`, { check: true });
    });
    $$('.merge-dismiss-btn', container).forEach((btn) => btn.onclick = () => {
      Store.dismissMergeSuggestion(decodeURIComponent(btn.dataset.a), decodeURIComponent(btn.dataset.b));
      renderMergeManager(); toast('Suggestion dismissed', { check: true });
    });
    $$('.ms-rename', container).forEach((btn) => btn.onclick = () => {
      const old = decodeURIComponent(btn.dataset.canon);
      const next = prompt(`Rename merged merchant “${old}” to:`, old);
      if (next == null || !next.trim() || next.trim() === old) return;
      Store.mergeMerchants([old], next.trim()); render(); toast('Merged merchant renamed', { check: true });
    });
    $('#mergeBtn').onclick = () => {
      const aliases = $$('.merge-check', container).filter((c) => c.checked).map((c) => decodeURIComponent(c.value));
      if (aliases.length < 2) { toast('Tick at least two merchants to merge'); return; }
      const canonical = ($('#mergeName').value.trim()) || aliases[0];
      Store.mergeMerchants(aliases, canonical);
      render(); toast(`Merged ${aliases.length} merchants into “${canonical}”`, { check: true });
    };
    $$('.ms-x', container).forEach((btn) => btn.onclick = () => {
      Store.removeMerge(decodeURIComponent(btn.dataset.alias)); render(); toast('Merge removed', { check: true });
    });
  }

  function renderCardmemberMergeManager() {
    const container = $('#cmMergeManager');
    if (!container) return;
    const map = {};
    allTxns.forEach((t) => {
      const k = t.cardmember || 'Unknown';
      const m = (map[k] = map[k] || { key: k, spend: 0, count: 0 });
      m.spend += (t.spend || Math.abs(t.amount)); m.count += 1;
    });
    const list = Object.values(map);
    list.sort((a, b) => {
      if (cmMergeSort === 'spend$') return b.spend - a.spend || a.key.localeCompare(b.key);
      if (cmMergeSort === 'spend#') return b.count - a.count || a.key.localeCompare(b.key);
      return a.key.localeCompare(b.key);
    });

    const merges = Store.getCardmemberMerges();
    const byCanonical = {};
    Object.keys(merges).forEach((alias) => { (byCanonical[merges[alias]] = byCanonical[merges[alias]] || []).push(alias); });
    const canonicals = Object.keys(byCanonical).sort();
    const suggestions = analyze.suggestCardmemberMerges(list, merges, Store.getDismissedCardmemberMergeSuggestions());

    container.innerHTML =
      (suggestions.length
        ? `<div class="merge-suggestions"><h3>Suggested merges</h3><p class="muted" style="margin:0 0 10px">Likely duplicate cardholders - merge to roll up spend, or dismiss to hide.</p>` +
          suggestions.map((s) =>
            `<div class="merge-suggest-row">
              <span class="ms-names"><strong>${esc(s.a)}</strong> + <strong>${esc(s.b)}</strong></span>
              <span class="mi-meta">${fmt(s.combined)} combined</span>
              <div class="merge-suggest-actions">
                <button class="btn sm merge-sugg-btn" data-a="${encodeURIComponent(s.a)}" data-b="${encodeURIComponent(s.b)}">Merge</button>
                <button class="btn sm ghost merge-dismiss-btn" data-a="${encodeURIComponent(s.a)}" data-b="${encodeURIComponent(s.b)}">Dismiss</button>
              </div>
            </div>`).join('') + `</div>`
        : '') +
      `<div class="field merge-search">${svg(SEARCH)}<input type="search" id="cmMergeSearch" placeholder="Filter cardmembers…"></div>
      <div class="merge-toolbar">
        <label class="merge-all"><input type="checkbox" id="cmMergeAll"> Select all</label>
        <label class="merge-sort">Sort
          <select id="cmMergeSort">
            <option value="alpha"${cmMergeSort === 'alpha' ? ' selected' : ''}>Alpha A-Z</option>
            <option value="spend$"${cmMergeSort === 'spend$' ? ' selected' : ''}>Spend by $</option>
            <option value="spend#"${cmMergeSort === 'spend#' ? ' selected' : ''}>Spend by #</option>
          </select>
        </label>
      </div>
      <div class="merge-list">${list.map((m) =>
        `<label class="merge-item" data-name="${esc(m.key.toLowerCase())}">
          <input type="checkbox" class="merge-check" value="${encodeURIComponent(m.key)}">
          <span class="mi-name">${esc(m.key)}</span><span class="mi-meta">${m.count}× · ${fmt(m.spend)}</span>
        </label>`).join('')}</div>
      <div class="merge-apply">
        <input type="text" id="cmMergeName" placeholder="Merge into… (defaults to first ticked)">
        <button class="btn primary" id="cmMergeBtn">Merge selected</button>
      </div>` +
      (canonicals.length
        ? `<h3>Remembered merges</h3>` + canonicals.map((c) =>
            `<div class="merge-saved"><span class="ms-canon">${esc(c)}<button class="icon-btn ms-rename" data-canon="${encodeURIComponent(c)}" title="Rename merged cardmember">${svg(PENCIL)}</button></span><span class="ms-aliases">${
              byCanonical[c].map((a) => `<span class="ms-alias">${esc(a)}<button class="ms-x" data-alias="${encodeURIComponent(a)}" title="Remove">×</button></span>`).join('')
            }</span></div>`).join('')
        : '');

    const visibleChecks = () => $$('.merge-item', container).filter((it) => !it.hidden).map((it) => it.querySelector('.merge-check'));
    $('#cmMergeSearch').oninput = () => {
      const q = $('#cmMergeSearch').value.toLowerCase();
      $$('.merge-item', container).forEach((it) => { it.hidden = !!q && !it.dataset.name.includes(q); });
      $('#cmMergeAll').checked = false;
    };
    $('#cmMergeAll').onchange = () => { const on = $('#cmMergeAll').checked; visibleChecks().forEach((c) => { c.checked = on; }); };
    $('#cmMergeSort').onchange = () => { cmMergeSort = $('#cmMergeSort').value; renderCardmemberMergeManager(); };
    $$('.merge-sugg-btn', container).forEach((btn) => btn.onclick = () => {
      const a = decodeURIComponent(btn.dataset.a), b = decodeURIComponent(btn.dataset.b);
      const mapByKey = Object.fromEntries(list.map((m) => [m.key, m]));
      const canonical = (mapByKey[a]?.spend || 0) >= (mapByKey[b]?.spend || 0) ? a : b;
      Store.mergeCardmembers([a, b], canonical);
      render(); toast(`Merged into “${canonical}”`, { check: true });
    });
    $$('.merge-dismiss-btn', container).forEach((btn) => btn.onclick = () => {
      Store.dismissCardmemberMergeSuggestion(decodeURIComponent(btn.dataset.a), decodeURIComponent(btn.dataset.b));
      renderCardmemberMergeManager(); toast('Suggestion dismissed', { check: true });
    });
    $$('.ms-rename', container).forEach((btn) => btn.onclick = () => {
      const old = decodeURIComponent(btn.dataset.canon);
      const next = prompt(`Rename merged cardmember “${old}” to:`, old);
      if (next == null || !next.trim() || next.trim() === old) return;
      Store.mergeCardmembers([old], next.trim()); render(); toast('Merged cardmember renamed', { check: true });
    });
    $('#cmMergeBtn').onclick = () => {
      const aliases = $$('.merge-check', container).filter((c) => c.checked).map((c) => decodeURIComponent(c.value));
      if (aliases.length < 2) { toast('Tick at least two cardmembers to merge'); return; }
      const canonical = ($('#cmMergeName').value.trim()) || aliases[0];
      Store.mergeCardmembers(aliases, canonical);
      render(); toast(`Merged ${aliases.length} cardmembers into “${canonical}”`, { check: true });
    };
    $$('.ms-x', container).forEach((btn) => btn.onclick = () => {
      Store.removeCardmemberMerge(decodeURIComponent(btn.dataset.alias)); render(); toast('Merge removed', { check: true });
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
        <span class="cat-actions">
        <button class="icon-btn cat-rename" data-cat="${encodeURIComponent(c)}" title="Rename category">${svg(PENCIL)}</button>
          ${custom.has(c) ? `<button class="icon-btn cat-remove" data-cat="${encodeURIComponent(c)}" title="Remove category">${svg(TRASH)}</button>` : ''}
        </span>
      </div>`).join('');
    $$('#catManager .cat-color').forEach((inp) => inp.onchange = () => {
      Store.setCategoryColor(decodeURIComponent(inp.dataset.cat), inp.value); renderCatManager();
    });
    $$('#catManager .cat-rename').forEach((btn) => btn.onclick = () => {
      const old = decodeURIComponent(btn.dataset.cat);
      const next = prompt(`Rename “${old}” to:`, old);
      if (next == null) return;
      if (Store.renameCategory(old, next.trim())) { renderCatManager(); render(); toast('Category renamed', { check: true }); }
      else toast('Could not rename - name is empty or already in use');
    });
    $$('#catManager .cat-type').forEach((sel) => sel.onchange = () => {
      Store.setCategoryType(decodeURIComponent(sel.dataset.cat), sel.value);
      toast(sel.value === 'payment' ? 'Now treated as Payment/Refund' : 'Now treated as Spending', { check: true });
    });
    $$('#catManager .cat-remove').forEach((btn) => btn.onclick = () => {
      Store.removeCategory(decodeURIComponent(btn.dataset.cat)); renderCatManager(); toast('Category removed', { check: true });
    });
  }

  function renderWidgetManager() {
    enforceProLayout();
    const { order, hidden } = getLayout();
    const hiddenSet = new Set(hidden);
    const container = $('#widgetManager');
    container.innerHTML = order.map((id) => {
      const w = WIDGET_MAP[id];
      const pro = isProWidget(id);
      const locked = pro && !isPro();
      const visible = !hiddenSet.has(id);
      const proBadge = pro ? ' <span class="pro-chip">Pro</span>' : '';
      const visCtrl = locked
        ? `<label class="wm-vis-label wm-locked" title="Upgrade to Pro to show this widget"><input type="checkbox" class="wm-vis" data-widget="${id}" disabled> Visible</label>`
        : `<label><input type="checkbox" class="wm-vis" data-widget="${id}" ${visible ? 'checked' : ''}> Visible</label>`;
      return `<div class="wm-row${locked ? ' wm-pro-locked' : ''}" data-widget="${id}">
        <span class="drag-handle" title="Drag to reorder">${svg(GRIP)}</span>
        <span class="wm-name">${svg(NAV_ICON[id] || '')}${w.title}${proBadge}</span>
        ${visCtrl}
      </div>`;
    }).join('') +
      `<div class="wm-reset-row">
        <button type="button" class="btn" id="resetLayoutBtn">Reset to default layout</button>
        <p class="muted wm-reset-hint">Restores default widget order, visibility, and positions. Clears any custom arrangement from the dashboard.</p>
      </div>`;
    $$('#widgetManager .wm-vis:not(:disabled)').forEach((cb) => cb.onchange = () => toggleWidgetHidden(cb.dataset.widget, !cb.checked));
    makeSortable(container, '.wm-row', (ids) => {
      // Reorder in settings applies a new sequence: pack the current visibles in exactly this
      // order (respect seq) so the dashboard will show them top-to-bottom in the chosen order.
      // The exact coords are then retained on refresh (no load-time repack).
      const { hidden, grid } = getLayout();
      const visSeq = ids.filter((wid) => !hidden.includes(wid) && widgetAvailable(wid));
      const packed = repackGrid(grid, visSeq, true);
      saveLayout({ order: ids, grid: packed });
    });
    const resetBtn = $('#resetLayoutBtn');
    if (resetBtn) resetBtn.onclick = resetLayoutToDefault;
  }

  // ============ Layout mutations ============
  function destroyWidgetCharts(id) {
    const root = document.getElementById('widget-' + id);
    if (!root || typeof Chart === 'undefined' || !Chart.getChart) return;
    root.querySelectorAll('canvas').forEach((canvas) => {
      const inst = Chart.getChart(canvas);
      if (inst) inst.destroy();
    });
  }

  function removeWidgetFromDashboard(id) {
    const { order, hidden, grid } = getLayout();
    if (hidden.includes(id)) return;
    const newHidden = [...hidden, id];

    let currentGrid = gridFromStack();
    if (!Object.keys(currentGrid).length) {
      Object.keys(grid).forEach((k) => { currentGrid[k] = grid[k]; });
    }
    delete currentGrid[id];

    const ids = order.filter((wid) => !newHidden.includes(wid) && widgetAvailable(wid));
    // Repack the survivors following the provided logical sequence (from master order) to close the gap.
    // This is a structural change, so repacking is appropriate (and only here + migrate + settings reorder).
    const packed = repackGrid(currentGrid, ids, true);
    const hiddenIds = order.filter((wid) => newHidden.includes(wid));
    const sortedVisible = orderFromGrid(packed, ids);
    const nextLayout = {
      order: [...sortedVisible, ...hiddenIds.filter((wid) => !sortedVisible.includes(wid))],
      hidden: newHidden,
      grid: packed,
    };

    if (!gridStack) {
      saveLayout(nextLayout);
      buildNav(allTxns.length > 0);
      return;
    }

    gridNormalizing = true;
    try {
      destroyWidgetCharts(id);
      if (id === 'transactions') unbindTxnResizeObserver();
      const el = gridStack.el.querySelector(`.grid-stack-item[gs-id="${id}"]`);
      if (el) gridStack.removeWidget(el, true);
      ids.forEach((wid) => {
        const widgetEl = gridStack.el.querySelector(`.grid-stack-item[gs-id="${wid}"]`);
        if (!widgetEl || !packed[wid]) return;
        gridStack.update(widgetEl, {
          x: packed[wid].x, y: packed[wid].y, w: packed[wid].w, h: packed[wid].h,
          maxW: gridMaxW(wid), maxH: gridMaxH(wid),
          minW: gridMinW(wid), minH: gridMinH(wid),
        });
      });
      syncPeopleTrendHeightOnGrid();
    } finally {
      gridNormalizing = false;
    }

    saveLayout(nextLayout);
    buildNav(allTxns.length > 0);
    initScrollSpy();
    if (typeof Chart !== 'undefined' && Chart.instances) {
      Object.values(Chart.instances).forEach((c) => { if (c && c.resize) c.resize(); });
    }
  }

  function hideWidget(id) {
    const w = WIDGET_MAP[id];
    if (!w) return;
    confirmModal({
      title: `Hide “${w.title}”?`,
      message: 'You can show it again in Settings → Layout.',
      confirmLabel: 'Hide widget',
      confirmClass: 'btn danger',
      onConfirm: () => {
        removeWidgetFromDashboard(id);
        toast(`Hid “${w.title}” - re-enable in Settings`, { check: true });
      },
    });
  }
  function toggleWidgetHidden(id, hide) {
    if (!hide && isProWidget(id) && !isPro()) {
      requirePro(WIDGET_MAP[id].title);
      renderWidgetManager();
      return;
    }
    const { order, hidden, grid } = getLayout();
    const set = new Set(hidden);
    const wasHidden = set.has(id);
    if (hide) set.add(id); else set.delete(id);
    let nextGrid = { ...grid };
    if (hide) {
      delete nextGrid[id];
    } else if (wasHidden) {
      // Newly unhidden from settings: append below the current max bottom of saved grid
      // so it doesn't land on top of existing custom layout.
      let maxBottom = 0;
      Object.keys(nextGrid).forEach((k) => {
        const gg = nextGrid[k];
        if (gg) maxBottom = Math.max(maxBottom, (gg.y || 0) + (gg.h || 0));
      });
      nextGrid[id] = clampGridItem(id, { x: 0, y: maxBottom, w: defaultWidgetW(id), h: gridHeight(id) });
    }
    saveLayout({ order, hidden: [...set], grid: nextGrid });
    // Only rebuild the widget nav if we're on the dashboard; calling from Settings would
    // clobber the settings sidebar with dashboard widget links.
    if (viewName === 'dashboard') buildNav(allTxns.length > 0);
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
    const links = $$('#nav a[data-widget]');
    spy = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) links.forEach((l) => l.classList.toggle('active', l.getAttribute('href') === '#' + en.target.id));
      });
    }, { rootMargin: '-20% 0px -70% 0px' });
    $$('#widgets .widget').forEach((s) => spy.observe(s));
  }

  // ============ Import / backup ============
  function csvColOptions(rows, colCount, hasHeader, selected) {
    let html = '<option value="-1">- Skip -</option>';
    for (let i = 0; i < colCount; i++) {
      const label = F.csvColLabel(rows, i, hasHeader);
      html += `<option value="${i}"${selected === i ? ' selected' : ''}>${esc(label)}</option>`;
    }
    return html;
  }

  function readCsvMappingForm(body, rows) {
    const val = (id) => Number(body.querySelector('#' + id).value);
    return {
      hasHeader: body.querySelector('#csvHasHeader').checked,
      mapping: {
        date: val('mapDate'),
        description: val('mapDesc'),
        debit: val('mapDebit'),
        credit: val('mapCredit'),
        amount: val('mapAmount'),
        cardmember: val('mapCard'),
      },
      amountSign: body.querySelector('#csvAmountSign').value,
      remember: body.querySelector('#csvRemember').checked,
    };
  }

  function validateCsvMapping(m) {
    if (m.mapping.date < 0) return 'Choose a Date column.';
    if (m.mapping.description < 0) return 'Choose a Description column.';
    const split = m.mapping.debit >= 0 || m.mapping.credit >= 0;
    if (!split && m.mapping.amount < 0) return 'Choose Amount or Charges/Payments columns.';
    return null;
  }

  function refreshCsvMappingForm(body, rows, colCount, state) {
    const hasHeader = state.hasHeader;
    const m = state.mapping;
    const split = m.debit >= 0 || m.credit >= 0;
    body.querySelector('#mapDate').innerHTML = csvColOptions(rows, colCount, hasHeader, m.date);
    body.querySelector('#mapDesc').innerHTML = csvColOptions(rows, colCount, hasHeader, m.description);
    body.querySelector('#mapDebit').innerHTML = csvColOptions(rows, colCount, hasHeader, m.debit);
    body.querySelector('#mapCredit').innerHTML = csvColOptions(rows, colCount, hasHeader, m.credit);
    body.querySelector('#mapAmount').innerHTML = csvColOptions(rows, colCount, hasHeader, m.amount);
    body.querySelector('#mapCard').innerHTML = csvColOptions(rows, colCount, hasHeader, m.cardmember);
    body.querySelector('#csvAmountSign').disabled = split;
    const prev = body.querySelector('#csvPreview');
    if (prev) {
      prev.innerHTML = rows.slice(0, 6).map((r, ri) => {
        const cells = [];
        for (let c = 0; c < colCount; c++) cells.push(`<td>${esc(r[c] || '')}</td>`);
        const cls = hasHeader && ri === 0 ? ' class="csv-header-row"' : '';
        return `<tr${cls}>${cells.join('')}</tr>`;
      }).join('');
    }
  }

  // Cheeky nudge when someone tries to import while playing with the demo.
  function openDemoImportNudge() {
    const accounts = !!(F.Auth && F.Auth.enabled());
    openModal(
      `<h2>Whoa there - that's our play money 🤹</h2>
       <p class="muted">You're exploring the demo with sample transactions. Ready to see <em>your</em> money in all its glory? Create a free account and import your own statement.</p>
       <div class="import-actions">
         <button class="btn" id="nudgeStay">Keep poking around</button>
         <button class="btn primary" id="nudgeGo">${accounts ? 'Create my account' : 'Got it'}</button>
       </div>`);
    const stay = $('#nudgeStay'); if (stay) stay.onclick = closeModal;
    const go = $('#nudgeGo');
    if (go) go.onclick = () => { closeModal(); if (accounts && F.Account && F.Account.openSignIn) F.Account.openSignIn('signup'); };
  }

  function handleFiles(fileList) {
    const files = [...fileList];
    if (!files.length) return;
    if (F.Demo && F.Demo.active && F.Demo.active()) { openDemoImportNudge(); return; }
    if (requiresSignIn()) {
      toast('Sign in to import your statements');
      if (F.Account && F.Account.openSignIn) F.Account.openSignIn();
      return;
    }
    const pdfFiles = files.filter((f) => /\.pdf$/i.test(f.name));
    // PDF parsing is heuristic - show a review/fix step before importing.
    if (pdfFiles.length && pdfFiles.length === files.length) { openPdfReview(files); return; }
    const csvFiles = files.filter((f) => /\.csv$/i.test(f.name));
    if (!csvFiles.length) { openImportModal(files, null); return; }
      const reader = new FileReader();
      reader.onload = () => {
      try { openImportModal(files, reader.result); }
      catch (e) { toast('Could not read CSV: ' + e.message); openImportModal(files, null); }
    };
    reader.onerror = () => toast('Could not read CSV file');
    reader.readAsText(csvFiles[0]);
  }

  function openImportModal(files, csvSampleText) {
    const accounts = Store.getAccounts();
    const csvFiles = files.filter((f) => /\.csv$/i.test(f.name));
    const pdfFiles = files.filter((f) => /\.pdf$/i.test(f.name));
    const hasCsv = csvFiles.length > 0 && csvSampleText;
    const pdfNote = pdfFiles.length && !hasCsv
      ? '<p class="muted">PDF statements are parsed from extracted text (CIBC-style charge/payment columns supported). Scanned image-only PDFs won\'t work - CSV or OFX is more reliable.</p>'
      : '';

    let preview = null, mapState = null;
    if (hasCsv) {
      preview = F.previewCSV(csvSampleText);
      const saved = Store.getCsvImportPrefs();
      mapState = {
        hasHeader: saved ? saved.hasHeader : preview.hasHeaderGuess,
        mapping: saved ? Object.assign({}, preview.mapping, saved.mapping) : preview.mapping,
        amountSign: saved && saved.amountSign ? saved.amountSign : preview.amountSign,
      };
      if (mapState.amountSign === 'split') mapState.amountSign = 'auto';
    }

    const mapSection = hasCsv ? `
      <div class="csv-import">
        <h3>Column mapping</h3>
        <p class="muted">Match your file’s columns to Finalyze. Auto-detect is pre-filled - adjust if anything looks wrong.${csvFiles.length > 1 ? ' Same mapping applies to all CSV files in this import.' : ''}</p>
        <label class="csv-check"><input type="checkbox" id="csvHasHeader"${mapState.hasHeader ? ' checked' : ''}> First row is column headers</label>
        <div class="table-wrap csv-preview-wrap"><table class="csv-preview"><thead><tr>${Array.from({ length: preview.colCount }, (_, i) => `<th>${i + 1}</th>`).join('')}</tr></thead><tbody id="csvPreview"></tbody></table></div>
        <div class="csv-map-grid">
          <label>Date <span class="req">*</span><select id="mapDate"></select></label>
          <label>Description <span class="req">*</span><select id="mapDesc"></select></label>
          <label>Charges / debits<select id="mapDebit"></select></label>
          <label>Payments / credits<select id="mapCredit"></select></label>
          <label>Amount (single column)<select id="mapAmount"></select></label>
          <label>Card / cardmember<select id="mapCard"></select></label>
        </div>
        <p class="muted csv-hint">Use <strong>Amount</strong> for a single signed column, or <strong>Charges</strong> + <strong>Payments</strong> for split columns (typical for CIBC).</p>
        <div class="csv-map-extra">
          <label>Amount sign <select id="csvAmountSign">
            <option value="auto"${mapState.amountSign === 'auto' ? ' selected' : ''}>Auto-detect</option>
            <option value="charge-pos"${mapState.amountSign === 'charge-pos' ? ' selected' : ''}>Positive numbers are charges</option>
            <option value="as-is"${mapState.amountSign === 'as-is' ? ' selected' : ''}>Use sign in file</option>
          </select></label>
          <button type="button" class="btn" id="csvAutoDetect">Reset to auto-detect</button>
          <label class="csv-check"><input type="checkbox" id="csvRemember"${Store.getCsvImportPrefs() ? ' checked' : ''}> Remember mapping for next import</label>
        </div>
      </div>` : '';

    const body = openModal(
      `<h2>Import ${files.length} file${files.length > 1 ? 's' : ''}</h2>
      <p class="muted">Assign these transactions to an account${hasCsv ? ' and confirm CSV columns' : ''}.</p>
      <div class="import-acct">
        <select id="impAccount">${importAccountSelectHtml(accounts)}</select>
        <input type="text" id="impNewName" placeholder="New account label" hidden>
      </div>
      ${pdfNote}
      ${mapSection}
      <div class="import-actions"><button class="btn" id="impCancel">Cancel</button><button class="btn primary" id="impGo">Import</button></div>`);

    const selA = body.querySelector('#impAccount'), newName = body.querySelector('#impNewName');
    selA.onchange = () => { newName.hidden = selA.value !== '__new'; if (!newName.hidden) newName.focus(); };

    if (hasCsv) {
      const rows = preview.rows;
      const colCount = preview.colCount;
      const syncForm = () => refreshCsvMappingForm(body, rows, colCount, mapState);
      syncForm();

      body.querySelector('#csvHasHeader').onchange = (e) => {
        mapState.hasHeader = e.target.checked;
        const guessed = F.guessCSVMapping(rows, mapState.hasHeader);
        mapState.mapping = guessed.mapping;
        syncForm();
      };

      ['mapDate', 'mapDesc', 'mapDebit', 'mapCredit', 'mapAmount', 'mapCard'].forEach((id) => {
        body.querySelector('#' + id).onchange = () => {
          const m = readCsvMappingForm(body, rows);
          mapState.hasHeader = m.hasHeader;
          mapState.mapping = m.mapping;
          mapState.amountSign = m.amountSign;
          syncForm();
        };
      });

      body.querySelector('#csvAutoDetect').onclick = () => {
        mapState.hasHeader = preview.hasHeaderGuess;
        body.querySelector('#csvHasHeader').checked = mapState.hasHeader;
        const guessed = F.guessCSVMapping(rows, mapState.hasHeader);
        mapState.mapping = guessed.mapping;
        mapState.amountSign = preview.amountSign === 'split' ? 'auto' : preview.amountSign;
        body.querySelector('#csvAmountSign').value = mapState.amountSign;
        syncForm();
      };
    }

    body.querySelector('#impCancel').onclick = closeModal;
    body.querySelector('#impGo').onclick = () => {
      let accountId = selA.value;
      if (accountId === '__new') {
        accountId = Store.addAccount(newName.value.trim());
        if (!accountId) { requirePro('Multiple accounts'); return; }
      }
      let csvOpts = null;
      if (hasCsv) {
        const m = readCsvMappingForm(body, preview.rows);
        const err = validateCsvMapping(m);
        if (err) { toast(err); return; }
        csvOpts = { hasHeader: m.hasHeader, mapping: m.mapping, amountSign: m.amountSign, sourceLabel: 'CSV' };
        if (m.remember) Store.setCsvImportPrefs({ hasHeader: m.hasHeader, mapping: m.mapping, amountSign: m.amountSign });
        else Store.setCsvImportPrefs(null);
      }
      closeModal();
      doImport(files, accountId, csvOpts);
    };
  }
  function doImport(files, accountId, csvOpts) {
    let totalAdded = 0, totalDup = 0, emptyFiles = 0;
    const errors = [], sources = new Set();
    const finish = () => {
      render();
      if (errors.length) { toast('Import failed - ' + errors[0]); return; }
      if (totalAdded === 0 && emptyFiles > 0) {
        toast('No transactions found. Expecting OFX/QFX, CSV, or a text-based PDF statement.');
        return;
      }
      const fmt = sources.size ? ' · ' + [...sources].join(', ') : '';
      toast(`Imported ${totalAdded} new · ${totalDup} already in history${fmt}`, { check: true });
      if (totalAdded > 0) maybeOfferFirstImportTours();
    };

    const readText = (file) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('could not read file'));
      reader.readAsText(file);
    });
    const readBuffer = (file) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('could not read file'));
      reader.readAsArrayBuffer(file);
    });

    Promise.all(files.map(async (file) => {
      try {
        let parsed;
        if (/\.pdf$/i.test(file.name)) {
          parsed = await F.parsePDF(await readBuffer(file));
        } else if (/\.csv$/i.test(file.name)) {
          const text = await readText(file);
          parsed = csvOpts ? F.parseCSVWithMapping(text, csvOpts) : F.parseCSV(text);
        } else {
          parsed = parseQFX(await readText(file));
        }
        if (parsed.source) sources.add(parsed.source);
        if (!parsed.transactions.length) emptyFiles++;
        const { added, duplicates } = Store.mergeTransactions(parsed, accountId);
        totalAdded += added;
        totalDup += duplicates;
      } catch (e) {
        errors.push(file.name + ': ' + e.message);
      }
    })).then(finish);
  }

  // ---- PDF import review (parse → let the user fix formatting → import) ----
  const readArrayBuffer = (file) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('could not read file'));
    r.readAsArrayBuffer(file);
  });

  function pdfRowToTxn(r) {
    const amt = Number(r.amount) || 0;
    return {
      fitid: '', date: r.date, type: amt < 0 ? 'DEBIT' : 'CREDIT', amount: amt,
      isSpend: amt < 0, spend: amt < 0 ? Math.abs(amt) : 0, refund: amt > 0 ? amt : 0,
      name: (r.name || '').trim() || 'Unknown', cardmember: r.cardmember || 'Unknown',
    };
  }

  async function openPdfReview(files) {
    toast('Reading PDF…');
    const rows = [], errors = [];
    for (const f of files) {
      try {
        const parsed = await F.parsePDF(await readArrayBuffer(f));
        parsed.transactions.forEach((t) => rows.push({
          include: true, date: t.date, name: t.name, amount: t.amount, cardmember: t.cardmember || 'Unknown',
        }));
      } catch (e) { errors.push(f.name + ': ' + e.message); }
    }
    if (!rows.length) { toast('Import failed - ' + (errors[0] || 'no transactions found in PDF')); return; }
    rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    renderPdfReview(rows, errors);
  }

  function renderPdfReview(rows, errors) {
    const accounts = Store.getAccounts();
    const errNote = errors.length
      ? `<p class="muted">Couldn’t read ${errors.length} file(s). Scanned image-only PDFs have no text layer - CSV or OFX is more reliable.</p>` : '';

    const body = openModal(
      `<h2>Review PDF import</h2>
      <p class="muted">PDF statements are parsed heuristically, so check the rows below. Edit any value, untick rows to skip, and import when it looks right.</p>
      <div class="import-acct">
        <select id="impAccount">${importAccountSelectHtml(accounts)}</select>
        <input type="text" id="impNewName" placeholder="New account label" hidden>
      </div>
      ${errNote}
      <div class="pdf-review-bar">
        <span class="muted" id="pdfReviewCount"></span>
        <span class="dc-spacer"></span>
        <button type="button" class="btn sm" id="pdfFlip" title="Flip the sign of every amount">⇅ Flip all signs</button>
      </div>
      <p class="muted pdf-hint">Amount: <strong>negative</strong> = out, <strong>positive</strong> = in.</p>
      <div class="table-wrap pdf-review-wrap"><table class="pdf-review"><thead><tr>
        <th class="chk-cell"></th><th>Date</th><th>Description</th><th class="num">Amount</th><th>Type</th>
      </tr></thead><tbody id="pdfReviewBody"></tbody></table></div>
      <div class="import-actions"><button class="btn" id="impCancel">Cancel</button><button class="btn primary" id="impGo">Import</button></div>`);

    const tbody = body.querySelector('#pdfReviewBody');
    tbody.innerHTML = rows.map((r, i) => `<tr data-i="${i}">
      <td class="chk-cell"><input type="checkbox" class="pdf-inc" ${r.include ? 'checked' : ''}></td>
      <td data-label="Date"><input type="date" class="pdf-date" value="${r.date}"></td>
      <td data-label="Description"><input type="text" class="pdf-name" value="${esc(r.name || '')}"></td>
      <td class="num" data-label="Amount"><input type="number" step="0.01" class="pdf-amt" value="${r.amount}"></td>
      <td data-label="Type"><span class="pdf-type ${r.amount < 0 ? 'amt-neg' : 'amt-pos'}">${r.amount < 0 ? 'Out' : 'In'}</span><button type="button" class="pdf-flip-row" title="Flip this transaction’s sign">⇅</button></td>
    </tr>`).join('');

    const selA = body.querySelector('#impAccount'), newName = body.querySelector('#impNewName');
    selA.onchange = () => { newName.hidden = selA.value !== '__new'; if (!newName.hidden) newName.focus(); };

    const updateCount = () => {
      const n = tbody.querySelectorAll('.pdf-inc:checked').length;
      body.querySelector('#pdfReviewCount').textContent = `${n} of ${rows.length} transactions selected`;
    };
    const refreshType = (tr) => {
      const amt = Number(tr.querySelector('.pdf-amt').value) || 0;
      const tp = tr.querySelector('.pdf-type');
      tp.textContent = amt < 0 ? 'Out' : 'In';
      tp.className = 'pdf-type ' + (amt < 0 ? 'amt-neg' : 'amt-pos');
    };
    tbody.addEventListener('input', (e) => {
      const tr = e.target.closest('tr');
      if (e.target.classList.contains('pdf-amt')) refreshType(tr);
      if (e.target.classList.contains('pdf-inc')) updateCount();
    });
    tbody.addEventListener('click', (e) => {
      if (!e.target.classList.contains('pdf-flip-row')) return;
      const tr = e.target.closest('tr');
      const inp = tr.querySelector('.pdf-amt');
      inp.value = String(-(Number(inp.value) || 0));
      refreshType(tr);
    });
    body.querySelector('#pdfFlip').onclick = () => {
      tbody.querySelectorAll('tr').forEach((tr) => {
        const inp = tr.querySelector('.pdf-amt');
        inp.value = String(-(Number(inp.value) || 0));
        refreshType(tr);
      });
    };
    updateCount();

    body.querySelector('#impCancel').onclick = closeModal;
    body.querySelector('#impGo').onclick = () => {
      let accountId = selA.value;
      if (accountId === '__new') {
        accountId = Store.addAccount(newName.value.trim());
        if (!accountId) { requirePro('Multiple accounts'); return; }
      }
      const txns = [];
      tbody.querySelectorAll('tr').forEach((tr, i) => {
        if (!tr.querySelector('.pdf-inc').checked) return;
        const date = tr.querySelector('.pdf-date').value;
        if (!date) return;
        txns.push(pdfRowToTxn({
          date,
          name: tr.querySelector('.pdf-name').value,
          amount: tr.querySelector('.pdf-amt').value,
          cardmember: rows[i] ? rows[i].cardmember : 'Unknown',
        }));
      });
      if (!txns.length) { toast('Select at least one transaction to import'); return; }
      const { added, duplicates } = Store.mergeTransactions({ transactions: txns, source: 'PDF' }, accountId);
      closeModal();
      render();
      toast(`Imported ${added} new · ${duplicates} already in history · PDF`, { check: true });
      if (added > 0) maybeOfferFirstImportTours();
    };
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
      reader.onload = () => { try { Store.importJSON(reader.result); toast('Backup restored', { check: true }); render(); } catch (e) { toast('Import failed: ' + e.message); } };
    reader.readAsText(file);
  }
  function importSettings(file) {
    const reader = new FileReader();
    reader.onload = () => { try { Store.importSettingsJSON(reader.result); toast('Settings restored', { check: true }); render(); } catch (e) { toast('Import failed: ' + e.message); } };
    reader.readAsText(file);
  }

  function applyCategoryOne(tid, txnName, newCat) {
    const autoCat = categorize(txnName, Store.getOverrides());
    if (newCat === autoCat) Store.setTxnCategoryOverride(tid, '');
    else Store.setTxnCategoryOverride(tid, newCat);
  }

  function applyCategoryAll(merchantKey, newCat) {
    Store.setOverride(merchantKey, newCat);
    Store.clearTxnCategoryOverridesForMerchant(merchantKey);
  }

  function wireCategorySelect(sel, t) {
    sel.value = t.category;
    sel.removeAttribute('title');
    sel.onchange = () => {
      const newCat = sel.value;
      if (newCat === t.category) return;
      const opts = {
        tid: t.tid,
        merchantKey: t.merchantKey,
        merchantLabel: maskMerch(t.merchantKey),
        txnName: t.name,
        newCat,
        previousCat: t.category,
        selectEl: sel,
      };
      const mode = Store.getCategoryApplyMode();
      if (mode === 'one') {
        applyCategoryOne(opts.tid, opts.txnName, opts.newCat);
        clearStaleCategoryFilters(opts.previousCat, opts.newCat);
        t.category = opts.newCat;
        toast('Category saved for this transaction', { check: true });
        refreshAfterDataChange();
        return;
      }
      if (mode === 'all') {
        applyCategoryAll(opts.merchantKey, opts.newCat);
        clearStaleCategoryFilters(opts.previousCat, opts.newCat);
        t.category = opts.newCat;
        toast('Category saved for all transactions at this merchant', { check: true });
        refreshAfterDataChange();
        return;
      }
      promptCategoryApply(opts);
    };
  }

  function clearStaleCategoryFilters(previousCat, newCat) {
    if (!previousCat || previousCat === newCat) return;
    if (txnCatFilter === previousCat && newCat !== previousCat) {
      txnCatFilter = '';
      txnPage = 0;
    }
    if (activeCategory && categoryMatchesSlice(previousCat, activeCategory) && !categoryMatchesSlice(newCat, activeCategory)) {
      clearCategoryCrossFilter();
    }
  }

  function promptCategoryApply(opts) {
    const { tid, merchantKey, merchantLabel, txnName, newCat, previousCat, selectEl } = opts;
    if (selectEl) selectEl.value = previousCat;
    const body = openModal(
      `<div class="eyebrow">Category</div>
       <h2>Apply “${esc(newCat)}”?</h2>
       <p class="muted">Choose how to apply this category for <strong>${esc(merchantLabel)}</strong>.</p>
       <div class="cat-apply-actions">
         <button type="button" class="btn primary" id="catApplyOne">Just this transaction</button>
         <button type="button" class="btn" id="catApplyAll">All transactions for this merchant</button>
         <button type="button" class="btn ghost" id="catApplyCancel">Cancel</button>
       </div>`
    );
    body.querySelector('#catApplyOne').onclick = () => {
      applyCategoryOne(tid, txnName, newCat);
      clearStaleCategoryFilters(previousCat, newCat);
      closeModal();
      toast('Category saved for this transaction', { check: true });
      refreshAfterDataChange();
    };
    body.querySelector('#catApplyAll').onclick = () => {
      applyCategoryAll(merchantKey, newCat);
      clearStaleCategoryFilters(previousCat, newCat);
      closeModal();
      toast('Category saved for all transactions at this merchant', { check: true });
      refreshAfterDataChange();
    };
    body.querySelector('#catApplyCancel').onclick = () => closeModal();
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

  function openPdfExportModal() {
    const sections = visibleOrder();
    if (!sections.length) {
      toast('Nothing to export');
      return;
    }
    const rows = sections.map((id) => {
      const w = WIDGET_MAP[id];
      return `<label class="pdf-export-row">
        <input type="checkbox" class="pdf-export-check" data-widget="${id}" checked>
        <span class="pdf-export-row-title">${esc(w.title)}</span>
      </label>`;
    }).join('');
    const body = openModal(
      `<h2>Export to PDF</h2>
       <p class="muted pdf-export-intro">Uncheck sections to leave out. Title and date range are always included.</p>
       <div class="pdf-export-toolbar">
         <button type="button" class="linkish" id="pdfSelectAll">Select all</button>
         <span class="pdf-export-sep" aria-hidden="true">·</span>
         <button type="button" class="linkish" id="pdfSelectNone">Select none</button>
       </div>
       <div class="pdf-export-list">${rows}</div>
       <div class="import-actions">
         <button class="btn" id="pdfExportCancel" type="button">Cancel</button>
         <button class="btn primary" id="pdfExportGo" type="button">Export PDF</button>
       </div>`);
    body.querySelector('#pdfExportCancel').onclick = closeModal;
    body.querySelector('#pdfSelectAll').onclick = () => {
      $$('.pdf-export-check', body).forEach((cb) => { cb.checked = true; });
    };
    body.querySelector('#pdfSelectNone').onclick = () => {
      $$('.pdf-export-check', body).forEach((cb) => { cb.checked = false; });
    };
    body.querySelector('#pdfExportGo').onclick = () => {
      const selected = [...body.querySelectorAll('.pdf-export-check:checked')].map((cb) => cb.dataset.widget);
      if (!selected.length) {
        toast('Select at least one section');
        return;
      }
      const selectedSet = new Set(selected);
      const ordered = sections.filter((id) => selectedSet.has(id));
      closeModal();
      if (F.exportDashboardPdf) F.exportDashboardPdf({ widgetIds: ordered });
      else toast('PDF export unavailable');
    };
  }

  function confirmModal(opts) {
    const title = esc(opts.title || 'Confirm');
    const message = esc(opts.message || '');
    const confirmLabel = esc(opts.confirmLabel || 'Confirm');
    const cancelLabel = esc(opts.cancelLabel || 'Cancel');
    const confirmClass = opts.confirmClass || 'btn primary';
    const body = openModal(
      `<h2>${title}</h2>
       <p class="muted">${message}</p>
       <div class="import-actions">
         <button class="btn" id="confirmCancel" type="button">${cancelLabel}</button>
         <button class="${confirmClass}" id="confirmOk" type="button">${confirmLabel}</button>
       </div>`);
    body.querySelector('#confirmCancel').onclick = closeModal;
    body.querySelector('#confirmOk').onclick = () => { closeModal(); if (opts.onConfirm) opts.onConfirm(); };
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
        <div class="dm-row"><label>Category</label><select id="dmCat">${catOptions(curCat)}</select><span class="dm-hint muted">All transactions at this merchant</span></div>
        <div class="dm-row"><label>Merchant tags</label><div class="dm-toggles">
          <button class="tag-btn${mTags.includes('business') ? ' on' : ''}" data-mtag="business">Work / Business</button>
          <button class="tag-btn${mTags.includes('reimbursable') ? ' on' : ''}" data-mtag="reimbursable">Reimbursable</button>
          <button class="tag-btn${exclAnom ? ' on' : ''}" data-mexcl="1">Exclude from anomalies</button>
        </div></div>
        ${mTags.includes('reimbursable')
          ? `<div class="dm-row"><label>Reimbursable</label>${reimbFieldHtml(
              Store.getMerchantReimburse()[merchantKey] || { mode: 'percent', value: 100 },
              { scope: 'merchant', merchantKey }
            )}</div>`
          : ''}
      </div>
      <div class="drill-chart-head">
        <h3>Monthly trend</h3>
        <button type="button" class="btn sm" id="drillDownloadPng">Download PNG</button>
      </div>
      <div class="canvas-wrap"><canvas id="drillTrend"></canvas></div>
      ${detail.categories.length > 1
        ? `<h3>Category history</h3><div class="drill-cats">${detail.categories.map((c) => `${chip(c.category)} <span class="muted">${c.count}×</span>`).join(' ')}</div>`
        : ''}
      <h3>Transactions</h3>
      <div class="table-wrap drill-table"><table><thead><tr><th>Date</th><th>Name</th><th>Category</th><th class="num">Amount</th><th class="tag-cell">Tags</th></tr></thead><tbody>${
        detail.txns.map((t) => `<tr><td>${t.date}</td><td>${maskMerch(t.name)}</td><td>${chip(t.category)}</td><td class="num ${t.isSpend ? 'amt-neg' : 'amt-pos'}">${fmt(t.amount)}</td><td class="tag-cell">${txnTagCellHtml(t, { txnOnly: true })}</td></tr>`).join('')
      }</tbody></table></div>`);
    charts.merchantTrend(detail.monthly, body.querySelector('#drillTrend'));
    const drillDl = body.querySelector('#drillDownloadPng');
    if (drillDl) {
      drillDl.onclick = () => {
        const slug = merchantKey.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'merchant';
        charts.downloadPng('drillTrend', `${slug}-trend.png`, (ok) => toast(ok ? 'Chart downloaded' : 'Chart not ready'));
      };
    }

    body.querySelector('#dmCat').onchange = (e) => {
      Store.setOverride(merchantKey, e.target.value);
      refreshAfterDataChange();
      toast(`Category set for ${merchantKey}`, { check: true });
      openMerchantDrill(merchantKey);
    };
    body.querySelectorAll('[data-mtag]').forEach((btn) => btn.onclick = () => {
      const tag = btn.dataset.mtag;
      const turningOn = !btn.classList.contains('on');
      Store.setMerchantTag(merchantKey, tag, turningOn);
      if (turningOn && tag === 'reimbursable' && !Store.getMerchantReimburse()[merchantKey]) {
        Store.setMerchantReimburse(merchantKey, { mode: 'percent', value: 100 });
      }
      refreshAfterDataChange(); openMerchantDrill(merchantKey);
    });
    body.querySelectorAll('.drill-table .tag-btn[data-tid]').forEach((btn) => btn.onclick = () => {
      const tid = decodeURIComponent(btn.dataset.tid), tag = btn.dataset.tag;
      const turningOn = !btn.classList.contains('on');
      Store.setTxnTag(tid, tag, turningOn);
      if (turningOn && tag === 'reimbursable' && !Store.getTxnReimburse()[tid]) {
        Store.setTxnReimburse(tid, { mode: 'percent', value: 100 });
      }
      refreshAfterDataChange();
      openMerchantDrill(merchantKey);
    });
    bindReimbFields(body);
    const exBtn = body.querySelector('[data-mexcl]');
    if (exBtn) exBtn.onclick = () => {
      Store.setMerchantAnomalyExclude(merchantKey, !exBtn.classList.contains('on'));
      refreshAfterDataChange(); toast(exBtn.classList.contains('on') ? 'Merchant included in anomalies' : 'Merchant excluded from anomalies', { check: true }); openMerchantDrill(merchantKey);
    };
  }

  // ============ Theme ============
  function applyTheme(mode) {
    document.documentElement.dataset.theme = mode;
    try { localStorage.setItem('finalyze.theme', mode); } catch (e) {} // share with the landing page
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
    refreshAfterDataChange();
  }

  // ============ Init ============
  // Treat real touch devices (phones/tablets) as "mobile" so the dashboard can
  // pack widgets two-up to fit narrow screens. UA + coarse-pointer, not just a
  // small desktop window.
  function detectMobile() {
    const ua = /Mobi|Android|iPhone|iPad|iPod|Windows Phone|BlackBerry/i.test(navigator.userAgent);
    const touch = matchMedia('(pointer:coarse)').matches;
    const narrow = matchMedia('(max-width:1024px)').matches;
    const phone = matchMedia('(max-width:640px)').matches;
    document.body.classList.toggle('is-mobile', ua || phone || (touch && narrow));
  }

  async function init() {
    Store.onSaveError((e) => toast('Could not save: ' + (e.message || 'storage error')));
    populateDatePresetSelect();
    detectMobile();
    addEventListener('resize', () => {
      detectMobile();
      syncFiltersPanel();
      if (viewName === 'dashboard' && $('#summaryCards')) {
        applySummaryLayout();
        adjustOverviewHeight();
      }
    });
    // Filter bar starts collapsed on mobile (it's cramped); remembers your choice.
    const storedFilters = localStorage.getItem('finalyze.filtersHidden');
    filtersHidden = storedFilters == null ? document.body.classList.contains('is-mobile') : storedFilters === '1';
    syncFiltersPanel();
    await Store.init();
    if (F.Demo?.ensureScope) await F.Demo.ensureScope();
    censored = await Store.getCensor();
    const theme = (await Store.getTheme()) || localStorage.getItem('finalyze.theme') || 'light';
    applyTheme(theme);
    // Sync censor mode (chart defaults + button label) before the first render.
    if ($('#censorLabel')) $('#censorLabel').textContent = censored ? 'Show $' : 'Hide $';
    if ($('#censorBtn')) $('#censorBtn').classList.toggle('active', censored);
    if (window.Chart) charts.setCensor(censored);
    bindFilterBanner();
    charts.setCategoryClickHandler(onCategoryChartClick);
    charts.setCardmemberClickHandler(onCardmemberChartClick);
    charts.setMerchantClickHandler((mk) => openMerchantDrill(mk));

    [$('#fileInput'), $('#fileInput2')].forEach((inp) => inp && inp.addEventListener('change', (e) => handleFiles(e.target.files)));
    $('#importInput').addEventListener('change', (e) => { if (e.target.files[0]) { importBackup(e.target.files[0]); e.target.value = ''; } });
    const importSettingsInput = $('#importSettingsInput');
    if (importSettingsInput) importSettingsInput.addEventListener('change', (e) => { if (e.target.files[0]) { importSettings(e.target.files[0]); e.target.value = ''; } });
    $('#exportBtn').addEventListener('click', exportBackup);
    const pdfBtn = $('#exportPdfBtn');
    if (pdfBtn) pdfBtn.addEventListener('click', openPdfExportModal);
    $('#themeBtn').addEventListener('click', toggleTheme);
    $('#censorBtn').addEventListener('click', () => applyCensor(!censored));
    $('#menuBtn').addEventListener('click', (e) => { e.stopPropagation(); document.body.classList.toggle('nav-open'); });
    // Mobile: tap outside the open sidebar (or press Escape) to close it.
    document.addEventListener('click', (e) => {
      if (!document.body.classList.contains('nav-open')) return;
      if (e.target.closest('.sidebar') || e.target.closest('#menuBtn')) return;
      document.body.classList.remove('nav-open');
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.body.classList.remove('nav-open'); });
    $('#filtersToggle').addEventListener('click', () => {
      filtersHidden = !filtersHidden;
      localStorage.setItem('finalyze.filtersHidden', filtersHidden ? '1' : '0');
      syncFiltersPanel();
    });
    $('#settingsBtn').addEventListener('click', () => { viewName = viewName === 'prefs' ? 'dashboard' : 'prefs'; render(); });
    bindSettingsLinks($('#betaBanner'));
    $('#datePreset').addEventListener('change', (e) => {
      const range = datePresetRange(e.target.value);
      if (!range) return;
      [dateFrom, dateTo] = range;
      dateRangeInit = true;
      persistDatePeriod();
      refreshAfterDataChange();
    });
    $('#dateFrom').addEventListener('change', (e) => { dateFrom = e.target.value; persistDatePeriod(); refreshAfterDataChange(); });
    $('#dateTo').addEventListener('change', (e) => { dateTo = e.target.value; persistDatePeriod(); refreshAfterDataChange(); });
    $('#dateClear').addEventListener('click', () => { dateFrom = ''; dateTo = ''; dateRangeInit = true; persistDatePeriod(); refreshAfterDataChange(); });
    $('#amountMin').addEventListener('change', (e) => { amountMin = e.target.value; refreshAfterDataChange(); });
    $('#amountMax').addEventListener('change', (e) => { amountMax = e.target.value; refreshAfterDataChange(); });
    $('#flowFilter').addEventListener('change', (e) => { flowFilter = e.target.value; refreshAfterDataChange(); });
    $('#accountFilter').addEventListener('change', (e) => { activeAccount = e.target.value; refreshAfterDataChange(); });
    $('#exclTags').addEventListener('change', (e) => { excludeTagged = e.target.checked; refreshAfterDataChange(); });
    $('#txnFilterClear').addEventListener('click', clearDashboardFilters);
    $('#modalClose').addEventListener('click', closeModal);
    $('#modalBackdrop').addEventListener('click', closeModal);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modal').hidden) closeModal(); });
    $('#clearBtn').addEventListener('click', async () => {
      if (isDemoActive()) {
        if (!confirm('Clear all demo data and exit demo mode? Your own saved data on this device is not affected.')) return;
        activeCategory = null; activeCardmember = null;
        amountMin = ''; amountMax = ''; flowFilter = 'all';
        excludeTagged = false; activeAccount = 'all'; cmpInit = false; yrSelected = '';
        dateFrom = ''; dateTo = ''; dateRangeInit = false; demoDefaultApplied = false;
        await F.Demo.clearDemoAll();
        render();
        return;
      }
      if (confirm('Clear ALL data and settings on this device? This cannot be undone. Export a backup first if unsure.')) {
        Store.clearAll(); activeCategory = null; activeCardmember = null;
        amountMin = ''; amountMax = ''; flowFilter = 'all';
        excludeTagged = false; activeAccount = 'all'; cmpInit = false; yrSelected = '';
        dateFrom = ''; dateTo = ''; dateRangeInit = false; demoDefaultApplied = false;
        render(); toast('All data cleared', { check: true });
      }
    });
    $('#replayDashTour').addEventListener('click', startDashboardTour);
    $('#replaySettingsTour').addEventListener('click', startSettingsTour);
    // Auth gate buttons + re-render when sign-in state changes.
    const gateSignIn = $('#gateSignIn'); if (gateSignIn) gateSignIn.addEventListener('click', () => F.Account && F.Account.openSignIn && F.Account.openSignIn());
    const gateDemo = $('#gateDemo'); if (gateDemo) gateDemo.addEventListener('click', () => F.Demo && F.Demo.start());
    // On sign-in/out, switch to that user's local data partition (so two
    // accounts in the same browser never see each other's transactions),
    // reload it, and re-render. Then refresh the license.
    if (F.Auth && F.Auth.onChange) {
      let lastScopeUid = (F.Auth.user && F.Auth.user() && F.Auth.user().id) || null;
      F.Auth.onChange(async (user) => {
        if (F.Demo?.active && F.Demo.active()) {
          F.Demo.onAuthChange(user);
          refreshLicense();
          if (F.AIUI?.resetAutoRestore) F.AIUI.resetAutoRestore();
          if (F.AIUI?.autoRestoreModels) F.AIUI.autoRestoreModels();
          render();
          return;
        }
        const uid = (user && user.id) || null;
        if (uid !== lastScopeUid && Store.setUserScope) {
          lastScopeUid = uid;
          try {
            await Store.setUserScope(uid);
            activeCategory = null; activeCardmember = null;
            dateFrom = ''; dateTo = ''; amountMin = ''; amountMax = ''; flowFilter = 'all';
            dateRangeInit = false; cmpInit = false; yrSelected = '';
            demoDefaultApplied = false;
            render();
          } catch (e) { /* keep prior view on error */ }
        }
        refreshLicense();
        if (F.AIUI?.resetAutoRestore) F.AIUI.resetAutoRestore();
        if (F.AIUI?.autoRestoreModels) F.AIUI.autoRestoreModels();
      });
    }
    // Re-check license when returning to the tab (e.g. after paying in Stripe),
    // throttled so it doesn't refetch on every focus.
    let lastLicenseCheck = 0;
    addEventListener('focus', () => {
      if (!(F.Auth && F.Auth.enabled() && F.Auth.isSignedIn())) return;
      const now = Date.now();
      if (now - lastLicenseCheck < 5000) return;
      lastLicenseCheck = now;
      refreshLicense();
    });
    $('#clearTxnBtn').addEventListener('click', async () => {
      if (isDemoActive()) {
        if (!confirm('Clear demo transactions only? Demo settings stay; your own saved data is not affected.')) return;
        activeCategory = null; activeCardmember = null;
        dateFrom = ''; dateTo = ''; amountMin = ''; amountMax = ''; flowFilter = 'all';
        dateRangeInit = false; excludeTagged = false; cmpInit = false; yrSelected = '';
        demoDefaultApplied = false;
        viewName = 'dashboard';
        await F.Demo.clearDemoTransactions();
        render();
        return;
      }
      if (confirm('Clear all imported transactions? Your settings (categories, rules, budgets, custom cards, accounts, layout) are kept. This cannot be undone.')) {
        Store.clearTransactions(); activeCategory = null; activeCardmember = null;
        dateFrom = ''; dateTo = ''; amountMin = ''; amountMax = ''; flowFilter = 'all';
        dateRangeInit = false; excludeTagged = false; cmpInit = false; yrSelected = '';
        viewName = 'dashboard';
        render(); toast('Transactions cleared - settings kept', { check: true });
      }
    });
    $('#addCatBtn').addEventListener('click', () => {
      const name = $('#newCatName').value.trim();
      if (!name) { toast('Enter a category name'); return; }
      if (Store.addCategory(name, $('#newCatColor').value, $('#newCatType').value)) { $('#newCatName').value = ''; renderCatManager(); toast('Category added', { check: true }); }
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

    if (F.AIUI?.autoRestoreModels && !(F.Auth && F.Auth.enabled())) F.AIUI.autoRestoreModels();

    // Deep link from the landing page: ?demo=1 loads the sample data + tour
    // (only when there's no data yet, so it never clobbers a real import).
    const wantsDemo = new URLSearchParams(location.search).get('demo');
    if (wantsDemo && !allTxns.length) {
      // Pre-clear any date filter from a prior real session so the demo can start with its own default (quarter).
      dateFrom = ''; dateTo = ''; dateRangeInit = false; demoDefaultApplied = false;
      if (F.Demo && F.Demo.start) F.Demo.start();
    }
    // Local/preview: ?upgrade=1 opens the Pro checkout modal without signing in.
    if (new URLSearchParams(location.search).get('upgrade')) {
      openUpgradeModal();
    }
  }

  // ---- First-import: offer dashboard and/or settings tours ----
  function maybeOfferFirstImportTours() {
    if (F.Demo && F.Demo.active && F.Demo.active()) return;
    if (!allTxns.length) return;
    const dashOffered = localStorage.getItem('finalyze.dashboardTourOffered');
    const settingsOffered = localStorage.getItem('finalyze.settingsTourOffered');
    if (dashOffered && settingsOffered) return;
    localStorage.setItem('finalyze.dashboardTourOffered', '1');
    localStorage.setItem('finalyze.settingsTourOffered', '1');
    const body = openModal(
      `<h2>Your data is in</h2>
       <p class="muted">Nice - your statement imported successfully. Want a quick tour of the dashboard, settings, or both?</p>
       <div class="import-actions import-actions-stack">
         <button class="btn primary" id="tourDash">Tour the dashboard</button>
         <button class="btn" id="tourSettings">Tour settings</button>
         <button class="btn ghost-dim" id="tourNo">Not now</button>
       </div>`);
    body.querySelector('#tourNo').onclick = closeModal;
    body.querySelector('#tourDash').onclick = () => { closeModal(); startDashboardTour(); };
    body.querySelector('#tourSettings').onclick = () => { closeModal(); startSettingsTour(); };
  }

  function maybeOfferSettingsTour() {
    maybeOfferFirstImportTours();
  }

  function startSettingsTour() {
    const goTab = (tab) => () => { viewName = 'prefs'; settingsTab = tab; render(); };
    if (!F.Demo || !F.Demo.runTour) { goTab('categories')(); return; }
    const steps = [
      { before: goTab('categories'), title: 'Welcome to Settings', body: 'A 30-second tour of what you can customize. Change any of this anytime from Settings.' },
      { before: goTab('categories'), sel: '#set-categories', title: 'Categories', body: 'Add your own categories, recolor them, and set each as spending, payment, or refund.' },
      { before: goTab('categories'), sel: '#set-cards', title: 'Custom cards', body: 'Build KPI cards from criteria (e.g. Health + “cpap”). They appear in the overview, totalled for the selected period.' },
      { before: goTab('categories'), sel: '#set-groups', title: 'Category groups', body: 'Roll up categories (e.g. Dining + Groceries → Food) for charts and budgets.' },
      { before: goTab('categories'), sel: '#set-merchants', title: 'Merge merchants', body: 'Combine differently-named merchants into one - remembered for future imports.' },
      { before: goTab('categories'), sel: '#set-cardmembers', title: 'Merge cardmembers', body: 'Combine duplicate cardholder names so household spend rolls up correctly.' },
      { before: goTab('rules'), sel: '#set-rules', title: 'Auto-categorization rules', body: 'Match merchant text with a keyword or regex and assign a category - applied before the built-in rules.' },
      { before: goTab('rules'), sel: '#set-sub-rules', title: 'Subscription rules', body: 'Flag a merchant as recurring by keyword, even when the charge amount changes each cycle.' },
      { before: goTab('rules'), sel: '#set-merge-rules', title: 'Auto-merge rules', body: 'Automatically fold matching merchant names into one canonical name - applied to every import.' },
      { before: goTab('budgets'), sel: '#set-budgets', title: 'Budgets', body: 'Set monthly limits per category or group. The overview warns at 80% and over.' },
      { before: goTab('accounts'), sel: '#set-accounts', title: 'Accounts & data', body: 'Track multiple cards/accounts, check storage use, and back up or restore your data.' },
      { before: goTab('layout'), sel: '#set-layout', title: 'Layout', body: 'Show, hide, and reorder widgets here. On the dashboard, drag by the grip handle and resize from the edges - widths snap to tidy sizes and panels pack together automatically.' },
      { before: goTab('categories'), title: 'You’re all set', body: 'Tweak anything anytime from Settings. Enjoy Finalyze!', final: true },
    ];
    F.Demo.runTour(steps, () => F.Demo.endTour(), 'Finish');
  }

  // Non-destructive dashboard walkthrough (replayable on real data - unlike the
  // demo tour, it doesn't clear anything).
  function startDashboardTour() {
    const toDash = () => { viewName = 'dashboard'; render(); };
    if (!F.Demo || !F.Demo.runTour) { toDash(); return; }
    const steps = [
      { before: toDash, title: 'Your dashboard', body: 'A quick tour of what each section shows. Use the filters and date range up top to scope everything.' },
      { before: toDash, sel: '#widget-overview', title: 'Spending overview', body: 'Totals at a glance - spend, refunds, payments, net, averages, plus any custom cards you add.' },
      { before: toDash, sel: '#widget-category', title: 'Spend by category', body: 'Where your money goes. Tap a slice to filter the whole dashboard to that category.' },
      { before: toDash, sel: '#widget-merchants', title: 'Top merchants', body: 'Who you pay most. Tap a bar for a merchant drill-down with history and average ticket.' },
      { before: toDash, sel: '#widget-recurring', title: 'Recurring & subscriptions', body: 'Repeating charges, including keyword-matched subscriptions even when the amount varies.' },
      { before: toDash, sel: '#widget-anomalies', title: 'Anomalies', body: 'Possible duplicates and unusually large charges, surfaced automatically.' },
      { before: toDash, sel: '#widget-transactions', title: 'Transactions', body: 'Search, filter, retag, recategorise, and bulk-edit. Category changes are remembered per merchant.' },
      {
        before: () => { toDash(); return F.Demo.animateDemoAIClick && F.Demo.animateDemoAIClick(); },
        sel: '.ai-modal .ai-panel',
        aiFocus: true,
        scroll: false,
        title: 'Ask the AI',
        body: 'Finalyze AI surfaces instant insights from your data. Enable on-device models for chat and richer answers - all locally, opt-in.',
        after: () => F.Demo.closeDemoAI && F.Demo.closeDemoAI(),
        final: true,
      },
    ];
    F.Demo.runTour(steps, () => F.Demo.endTour(), 'Finish');
  }

  F.filterTxns = filterTxns;
  F.render = render;
  // Helper for demo entry to guarantee a clean slate for date defaulting (so demo can get its quarter default even if the tab had prior real data filters).
  F._resetDemoDateDefault = function() {
    dateFrom = '';
    dateTo = '';
    dateRangeInit = false;
    demoDefaultApplied = false;
  };
  F.openUpgradeModal = openUpgradeModal;
  F.isPro = isPro;
  F.requirePro = requirePro;
  F.applyProLock = applyProLock;
  F.toast = toast;
  F.enriched = enriched;       // categorized + flow-typed rows for AI context
  F.openMerchantDrill = openMerchantDrill;
  F.goToSettings = goToSettings;

  document.addEventListener('DOMContentLoaded', init);
})();
