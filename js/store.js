// Persistence layer. IndexedDB + in-memory cache. Fully on-device.

(function (global) {
  const LS_KEY = 'finalyze.v1';
  const LS_THEME = 'finalyze.theme';
  const LS_CENSOR = 'finalyze.censor';
  const LS_CURRENCY = 'finalyze.currency'; // user's preferred display currency (overrides statement CURDEF)
  const idb = () => global.Finalyze.idb;

  function blank() {
    return {
      transactions: {}, overrides: {}, currency: 'CAD', balance: null, balanceAsOf: null,
      subscriptions: {}, customCategories: [], categoryColors: {}, categoryTypes: {},
      categoryRenames: {}, merchantMerges: {}, mergeRules: [], customRules: [], subscriptionRules: [], customCards: [], budgets: {}, txnTags: {},
      cardmemberOverrides: {}, merchantTags: {}, merchantAnomalyExcludes: {},
      mergeSuggestionsDismissed: {}, categoryGroups: [],
      accounts: [{ id: 'default', label: 'Default' }], layout: null, csvImportPrefs: null,
    };
  }

  function sanitizeStr(s) {
    return typeof s === 'string' ? s.replace(/[<>]/g, '') : s;
  }

  function validateBackup(incoming) {
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
      throw new Error('Invalid backup file.');
    }
    const base = blank();
    const out = Object.assign(blank(), incoming);
    for (const key of Object.keys(out)) {
      if (!(key in base)) delete out[key];
    }
    if (out.transactions != null && (typeof out.transactions !== 'object' || Array.isArray(out.transactions))) {
      throw new Error('Invalid backup: transactions must be an object.');
    }
    if (out.overrides != null && typeof out.overrides !== 'object') throw new Error('Invalid backup: overrides must be an object.');
    if (out.customCategories != null && !Array.isArray(out.customCategories)) throw new Error('Invalid backup: customCategories must be an array.');
    if (out.accounts != null && !Array.isArray(out.accounts)) throw new Error('Invalid backup: accounts must be an array.');
    if (out.categoryGroups != null && !Array.isArray(out.categoryGroups)) throw new Error('Invalid backup: categoryGroups must be an array.');
    if (out.transactions) {
      for (const id in out.transactions) {
        const t = out.transactions[id];
        if (!t || typeof t !== 'object') { delete out.transactions[id]; continue; }
        if (t.name != null) t.name = sanitizeStr(t.name);
        if (t.cardmember != null) t.cardmember = sanitizeStr(t.cardmember);
      }
    }
    if (Array.isArray(out.customCategories)) {
      out.customCategories.forEach((c) => { if (c && c.name != null) c.name = sanitizeStr(c.name); });
    }
    if (Array.isArray(out.accounts)) {
      out.accounts.forEach((a) => { if (a && a.label != null) a.label = sanitizeStr(a.label); });
    }
    if (Array.isArray(out.categoryGroups)) {
      out.categoryGroups.forEach((g) => { if (g && g.name != null) g.name = sanitizeStr(g.name); });
    }
    if (out.overrides) {
      for (const k in out.overrides) {
        if (typeof out.overrides[k] === 'string') out.overrides[k] = sanitizeStr(out.overrides[k]);
      }
    }
    if (out.merchantMerges) {
      for (const k in out.merchantMerges) {
        if (typeof out.merchantMerges[k] === 'string') out.merchantMerges[k] = sanitizeStr(out.merchantMerges[k]);
      }
    }
    return out;
  }

  function migrate(data) {
    const OLD = 'Payments/Refunds';
    let changed = false;
    for (const k in data.overrides) if (data.overrides[k] === OLD) { data.overrides[k] = 'Payments'; changed = true; }
    if (data.categoryColors && data.categoryColors[OLD]) {
      if (!data.categoryColors['Payments']) data.categoryColors['Payments'] = data.categoryColors[OLD];
      delete data.categoryColors[OLD]; changed = true;
    }
    if (data.categoryTypes && data.categoryTypes[OLD]) { delete data.categoryTypes[OLD]; changed = true; }
    (data.customCategories || []).forEach((c) => { if (c.name === OLD) { c.name = 'Payments'; changed = true; } });
    if (!Array.isArray(data.accounts) || !data.accounts.length) { data.accounts = [{ id: 'default', label: 'Default' }]; changed = true; }
    if (!data.accounts.some((a) => a.id === 'default')) { data.accounts.unshift({ id: 'default', label: 'Default' }); changed = true; }
    for (const id in data.transactions) {
      if (!data.transactions[id].accountId) { data.transactions[id].accountId = 'default'; changed = true; }
    }
    if (!data.mergeSuggestionsDismissed) { data.mergeSuggestionsDismissed = {}; changed = true; }
    if (!Array.isArray(data.categoryGroups)) { data.categoryGroups = []; changed = true; }
    return changed;
  }

  let cache = blank();
  let initDone = false;
  let saveErrorHandler = null;

  // --- per-user data scoping ---
  // Imported financial data is stored under an IndexedDB key scoped to the signed-in
  // user (`data:<uid>`), so two accounts in the same browser never share data. When
  // signed out (or accounts disabled), the legacy unscoped `data` key is used.
  const LS_SESSION = 'finalyze.session';
  function currentUid() {
    try {
      const s = JSON.parse(localStorage.getItem(LS_SESSION) || 'null');
      return (s && s.user && s.user.id) || null;
    } catch (e) { return null; }
  }
  function dataKeyFor(uid) { return uid ? 'data:' + uid : 'data'; }
  let dataKey = dataKeyFor(currentUid());

  function persist() {
    idb().set(dataKey, cache).catch((e) => {
      if (saveErrorHandler) saveErrorHandler(e);
    });
  }

  function save(data) {
    cache = data;
    persist();
  }

  async function loadFromIdbOrMigrate() {
    // 1. Scoped data for the current user (or unscoped when signed out).
    let data = await idb().get(dataKey);
    if (data) {
      data = Object.assign(blank(), data);
      if (migrate(data)) await idb().set(dataKey, data);
      return data;
    }
    // 2. First time this user is seen on this device: if there's legacy
    //    unscoped data with transactions, hand it off to this account (one-time)
    //    so an existing single user keeps their history. The unscoped key is then
    //    removed, so any *other* account that logs in starts empty.
    if (dataKey !== 'data') {
      const legacy = await idb().get('data');
      if (legacy && legacy.transactions && Object.keys(legacy.transactions).length) {
        data = Object.assign(blank(), legacy);
        migrate(data);
        await idb().set(dataKey, data);
        await idb().del('data');
        return data;
      }
    }
    // 3. Very old localStorage payload (pre-IndexedDB) — migrate once.
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        data = Object.assign(blank(), JSON.parse(raw));
        migrate(data);
        await idb().set(dataKey, data);
        const theme = localStorage.getItem(LS_THEME);
        const censor = localStorage.getItem(LS_CENSOR);
        if (theme) await idb().set('theme', theme);
        if (censor) await idb().set('censor', censor);
        localStorage.removeItem(LS_KEY);
        localStorage.removeItem(LS_THEME);
        localStorage.removeItem(LS_CENSOR);
        return data;
      }
    } catch (e) { /* fall through */ }
    return blank();
  }

  const Store = {
    data: cache,

    async init() {
      if (initDone) return cache;
      cache = await loadFromIdbOrMigrate();
      this.data = cache;
      initDone = true;
      return cache;
    },

    // Switch the active data scope to a given user id (null = signed out).
    // Reloads the in-memory cache from that user's IndexedDB partition. Returns
    // the loaded cache so callers can re-render. No-op if the scope is unchanged.
    async setUserScope(uid) {
      const key = dataKeyFor(uid || null);
      if (key === dataKey && initDone) return cache;
      dataKey = key;
      cache = await loadFromIdbOrMigrate();
      this.data = cache;
      initDone = true;
      return cache;
    },

    currentScope() { return dataKey; },

    onSaveError(fn) { saveErrorHandler = fn; },

    reload() { return cache; },

    async getTheme() {
      await this.init();
      const t = await idb().get('theme');
      if (t) return t;
      return localStorage.getItem(LS_THEME);
    },

    setTheme(mode) {
      idb().set('theme', mode).catch((e) => { if (saveErrorHandler) saveErrorHandler(e); });
    },

    async getCensor() {
      await this.init();
      const c = await idb().get('censor');
      if (c != null) return c === '1' || c === true;
      return localStorage.getItem(LS_CENSOR) === '1';
    },

    setCensor(on) {
      idb().set('censor', on ? '1' : '0').catch((e) => { if (saveErrorHandler) saveErrorHandler(e); });
    },

    async estimatedBytes() {
      await this.init();
      return idb().estimatedSize();
    },

    mergeTransactions(parsed, accountId) {
      accountId = accountId || 'default';
      let added = 0, duplicates = 0;
      for (const t of parsed.transactions) {
        const id = (accountId === 'default' ? '' : accountId + ':') + (t.fitid || (t.date + '|' + t.name + '|' + t.amount));
        if (cache.transactions[id]) { duplicates++; continue; }
        cache.transactions[id] = Object.assign({ accountId }, t);
        added++;
      }
      if (parsed.currency) cache.currency = parsed.currency;
      if (parsed.balance != null) {
        if (!cache.balanceAsOf || (parsed.balanceAsOf && parsed.balanceAsOf >= new Date(cache.balanceAsOf))) {
          cache.balance = parsed.balance;
          cache.balanceAsOf = parsed.balanceAsOf ? parsed.balanceAsOf.toISOString().slice(0, 10) : null;
        }
      }
      persist();
      return { added, duplicates };
    },

    getTransactions() { return Object.values(cache.transactions); },
    getOverrides() { return cache.overrides },

    transactionStoreKey(t) {
      const accountId = t.accountId || 'default';
      const tid = t.fitid || (t.date + '|' + t.name + '|' + t.amount);
      return (accountId === 'default' ? '' : accountId + ':') + tid;
    },

    _migrateTxnMeta(oldTid, newTid) {
      if (!oldTid || oldTid === newTid) return;
      const tags = this.getTxnTags();
      if (tags[oldTid]) {
        tags[newTid] = tags[oldTid];
        delete tags[oldTid];
      }
      const cm = this.getCardmemberOverrides();
      if (cm[oldTid]) {
        cm[newTid] = cm[oldTid];
        delete cm[oldTid];
      }
    },

    updateTransactionMerchant(storeKey, newName) {
      newName = (newName || '').trim();
      if (!storeKey || !newName) return false;
      const t = cache.transactions[storeKey];
      if (!t || t.name === newName) return !!t;
      const oldTid = t.fitid || (t.date + '|' + t.name + '|' + t.amount);
      t.name = newName;
      const newKey = this.transactionStoreKey(t);
      if (newKey !== storeKey) {
        delete cache.transactions[storeKey];
        cache.transactions[newKey] = t;
      }
      const newTid = t.fitid || (t.date + '|' + t.name + '|' + t.amount);
      this._migrateTxnMeta(oldTid, newTid);
      persist();
      return true;
    },

    deleteTransaction(storeKey) {
      const t = cache.transactions[storeKey];
      if (!t) return false;
      const tid = t.fitid || (t.date + '|' + t.name + '|' + t.amount);
      delete cache.transactions[storeKey];
      delete this.getTxnTags()[tid];
      delete this.getCardmemberOverrides()[tid];
      persist();
      return true;
    },

    setOverride(merchantKey, category) {
      if (!merchantKey) return;
      if (category) cache.overrides[merchantKey] = category;
      else delete cache.overrides[merchantKey];
      persist();
    },

    getSubscriptions() { return cache.subscriptions; },
    setSubscription(key, on) {
      if (!key) return;
      if (on) cache.subscriptions[key] = true;
      else delete cache.subscriptions[key];
      persist();
    },

    getCustomCategories() { return cache.customCategories; },
    getCategoryColors() { return cache.categoryColors; },
    getCategoryTypes() { return cache.categoryTypes; },

    addCategory(name, color, type) {
      name = (name || '').trim();
      if (!name) return false;
      if (cache.customCategories.some((c) => c.name.toLowerCase() === name.toLowerCase())) return false;
      cache.customCategories.push({ name, color: color || '#94a3b8', type: type || 'spend' });
      if (color) cache.categoryColors[name] = color;
      if (type) cache.categoryTypes[name] = type;
      persist();
      return true;
    },

    removeCategory(name) {
      cache.customCategories = cache.customCategories.filter((c) => c.name !== name);
      delete cache.categoryColors[name];
      delete cache.categoryTypes[name];
      for (const k in cache.overrides) if (cache.overrides[k] === name) delete cache.overrides[k];
      (cache.categoryGroups || []).forEach((g) => {
        g.categories = g.categories.filter((c) => c !== name);
      });
      persist();
    },

    setCategoryColor(name, color) {
      cache.categoryColors[name] = color;
      const c = cache.customCategories.find((x) => x.name === name);
      if (c) c.color = color;
      persist();
    },

    setCategoryType(name, type) {
      cache.categoryTypes[name] = type;
      const c = cache.customCategories.find((x) => x.name === name);
      if (c) c.type = type;
      persist();
    },

    getCategoryRenames() { return cache.categoryRenames; },

    renameCategory(oldName, newName) {
      oldName = (oldName || '').trim();
      newName = (newName || '').trim();
      if (!oldName || !newName || oldName === newName) return false;
      const all = (global.Finalyze.getCategories && global.Finalyze.getCategories()) || [];
      if (all.some((c) => c.toLowerCase() === newName.toLowerCase())) return false;

      const BUILTINS = global.Finalyze.CATEGORIES || [];
      const renames = cache.categoryRenames;
      let originalKey = null;
      for (const k in renames) if (renames[k] === oldName) { originalKey = k; break; }
      if (!originalKey && BUILTINS.includes(oldName)) originalKey = oldName;

      if (originalKey) {
        if (newName === originalKey) delete renames[originalKey];
        else renames[originalKey] = newName;
      } else {
        const c = cache.customCategories.find((x) => x.name === oldName);
        if (c) c.name = newName;
      }

      const defColor = (global.Finalyze.CATEGORY_COLORS || {})[oldName];
      const curColor = cache.categoryColors[oldName] || defColor;
      if (curColor) cache.categoryColors[newName] = curColor;
      delete cache.categoryColors[oldName];

      const defType = (global.Finalyze.DEFAULT_CATEGORY_TYPES || {})[oldName];
      const curType = cache.categoryTypes[oldName] || defType;
      if (curType) cache.categoryTypes[newName] = curType;
      delete cache.categoryTypes[oldName];

      for (const k in cache.overrides) if (cache.overrides[k] === oldName) cache.overrides[k] = newName;

      (cache.categoryGroups || []).forEach((g) => {
        g.categories = g.categories.map((c) => (c === oldName ? newName : c));
      });

      persist();
      return true;
    },

    getMerchantMerges() { return cache.merchantMerges; },

    mergeMerchants(aliases, canonical) {
      canonical = (canonical || '').trim();
      if (!canonical || !aliases || !aliases.length) return false;
      const m = cache.merchantMerges;
      const targets = new Set(aliases.concat(canonical));
      for (const k in m) if (targets.has(m[k])) m[k] = canonical;
      aliases.forEach((a) => { if (a !== canonical) m[a] = canonical; });
      if (m[canonical] === canonical) delete m[canonical];

      aliases.forEach((a) => {
        if (a !== canonical && cache.overrides[a]) {
          if (!cache.overrides[canonical]) cache.overrides[canonical] = cache.overrides[a];
          delete cache.overrides[a];
        }
      });

      const subs = cache.subscriptions, next = {};
      const aliasSet = new Set(aliases);
      for (const key in subs) {
        const i = key.lastIndexOf('||');
        const mk = key.slice(0, i), amt = key.slice(i + 2);
        next[(aliasSet.has(mk) ? canonical : mk) + '||' + amt] = subs[key];
      }
      cache.subscriptions = next;
      persist();
      return true;
    },

    removeMerge(alias) {
      if (cache.merchantMerges[alias]) { delete cache.merchantMerges[alias]; persist(); }
    },

    getDismissedMergeSuggestions() { return cache.mergeSuggestionsDismissed || (cache.mergeSuggestionsDismissed = {}); },

    dismissMergeSuggestion(a, b) {
      const pk = [a, b].sort().join('||');
      this.getDismissedMergeSuggestions()[pk] = true;
      persist();
    },

    getCustomRules() { return cache.customRules || (cache.customRules = []); },

    addRule(pattern, category, flags) {
      pattern = (pattern || '').trim();
      if (!pattern || !category) return false;
      try { new RegExp(pattern, flags || 'i'); } catch (e) { return false; }
      const id = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      this.getCustomRules().push({ id, pattern, category, flags: flags || 'i' });
      persist();
      return true;
    },

    updateRule(id, patch) {
      const r = this.getCustomRules().find((x) => x.id === id);
      if (!r) return false;
      if (patch.pattern != null) {
        try { new RegExp(patch.pattern, patch.flags || r.flags || 'i'); } catch (e) { return false; }
        r.pattern = patch.pattern;
      }
      if (patch.category != null) r.category = patch.category;
      if (patch.flags != null) r.flags = patch.flags;
      persist();
      return true;
    },

    removeRule(id) {
      cache.customRules = this.getCustomRules().filter((x) => x.id !== id);
      persist();
    },

    reorderRules(ids) {
      const map = Object.fromEntries(this.getCustomRules().map((r) => [r.id, r]));
      cache.customRules = ids.map((id) => map[id]).filter(Boolean);
      persist();
    },

    // Keyword/regex rules that mark matching merchants as recurring/subscriptions
    // regardless of amount.
    getSubscriptionRules() {
      const F = global.Finalyze;
      if (F && F.isPro && !F.isPro()) return [];
      return cache.subscriptionRules || (cache.subscriptionRules = []);
    },
    addSubscriptionRule(pattern, flags) {
      const F = global.Finalyze;
      if (F && F.isPro && !F.isPro()) return false;
      pattern = (pattern || '').trim();
      if (!pattern) return false;
      try { new RegExp(pattern, flags || 'i'); } catch (e) { return false; }
      const id = 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      this.getSubscriptionRules().push({ id, pattern, flags: flags || 'i' });
      persist();
      return true;
    },
    removeSubscriptionRule(id) {
      cache.subscriptionRules = this.getSubscriptionRules().filter((x) => x.id !== id);
      persist();
    },

    // Auto-merge rules: regex/keyword -> canonical merchant name.
    getMergeRules() {
      const F = global.Finalyze;
      if (F && F.isPro && !F.isPro()) return [];
      return cache.mergeRules || (cache.mergeRules = []);
    },
    addMergeRule(pattern, target, flags) {
      const F = global.Finalyze;
      if (F && F.isPro && !F.isPro()) return false;
      pattern = (pattern || '').trim(); target = (target || '').trim();
      if (!pattern || !target) return false;
      try { new RegExp(pattern, flags || 'i'); } catch (e) { return false; }
      const id = 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      this.getMergeRules().push({ id, pattern, target, flags: flags || 'i' });
      persist();
      return true;
    },
    removeMergeRule(id) {
      cache.mergeRules = this.getMergeRules().filter((x) => x.id !== id);
      persist();
    },

    // Custom KPI cards shown in the Spending overview, defined by criteria.
    getCustomCards() { return cache.customCards || (cache.customCards = []); },
    addCustomCard(card) {
      if (!card || !card.name) return false;
      const id = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      this.getCustomCards().push({ id, name: card.name, match: card.match || 'all', conditions: card.conditions || [] });
      persist();
      return id;
    },
    updateCustomCard(id, patch) {
      const c = this.getCustomCards().find((x) => x.id === id);
      if (!c) return false;
      Object.assign(c, patch || {});
      persist();
      return true;
    },
    removeCustomCard(id) {
      cache.customCards = this.getCustomCards().filter((x) => x.id !== id);
      persist();
    },

    getBudgets() { return cache.budgets || (cache.budgets = {}); },

    setBudget(category, amount) {
      const n = Number(amount);
      if (!category) return;
      if (isFinite(n) && n > 0) cache.budgets[category] = n;
      else delete cache.budgets[category];
      persist();
    },

    clearBudget(category) { delete this.getBudgets()[category]; persist(); },

    getCategoryGroups() { return cache.categoryGroups || (cache.categoryGroups = []); },

    addCategoryGroup(name, color, categories) {
      name = (name || '').trim();
      if (!name) return null;
      if (this.getCategoryGroups().some((g) => g.name.toLowerCase() === name.toLowerCase())) return null;
      categories = (categories || []).filter(Boolean);
      const id = 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      this.getCategoryGroups().push({ id, name, color: color || '#5b5bf0', categories });
      persist();
      return id;
    },

    updateCategoryGroup(id, patch) {
      const g = this.getCategoryGroups().find((x) => x.id === id);
      if (!g) return false;
      if (patch.name != null) {
        const newName = patch.name.trim();
        if (!newName) return false;
        if (this.getCategoryGroups().some((x) => x.id !== id && x.name.toLowerCase() === newName.toLowerCase())) return false;
        if (cache.budgets[g.name] != null) {
          cache.budgets[newName] = cache.budgets[g.name];
          delete cache.budgets[g.name];
        }
        g.name = newName;
      }
      if (patch.color != null) g.color = patch.color;
      if (patch.categories != null) g.categories = patch.categories.filter(Boolean);
      persist();
      return true;
    },

    removeCategoryGroup(id) {
      const g = this.getCategoryGroups().find((x) => x.id === id);
      if (g) delete cache.budgets[g.name];
      cache.categoryGroups = this.getCategoryGroups().filter((x) => x.id !== id);
      persist();
    },

    assignCategoryToGroup(category, groupId) {
      if (!category) return false;
      this.getCategoryGroups().forEach((g) => {
        g.categories = g.categories.filter((c) => c !== category);
        if (groupId && g.id === groupId) g.categories.push(category);
      });
      persist();
      return true;
    },

    getTxnTags() { return cache.txnTags || (cache.txnTags = {}); },

    setTxnTag(fitid, tag, on) {
      if (!fitid || !tag) return;
      const tags = this.getTxnTags();
      const cur = new Set(tags[fitid] || []);
      if (on) cur.add(tag); else cur.delete(tag);
      if (cur.size) tags[fitid] = [...cur]; else delete tags[fitid];
      persist();
    },

    getMerchantTags() { return cache.merchantTags || (cache.merchantTags = {}); },

    setMerchantTag(merchantKey, tag, on) {
      if (!merchantKey || !tag) return;
      const tags = this.getMerchantTags();
      const cur = new Set(tags[merchantKey] || []);
      if (on) cur.add(tag); else cur.delete(tag);
      if (cur.size) tags[merchantKey] = [...cur]; else delete tags[merchantKey];
      persist();
    },

    getMerchantAnomalyExcludes() { return cache.merchantAnomalyExcludes || (cache.merchantAnomalyExcludes = {}); },

    setMerchantAnomalyExclude(merchantKey, on) {
      if (!merchantKey) return;
      if (on) this.getMerchantAnomalyExcludes()[merchantKey] = true;
      else delete this.getMerchantAnomalyExcludes()[merchantKey];
      persist();
    },

    getCardmemberOverrides() { return cache.cardmemberOverrides || (cache.cardmemberOverrides = {}); },

    setCardmemberOverride(tid, name) {
      if (!tid) return;
      name = (name || '').trim();
      if (name) this.getCardmemberOverrides()[tid] = name;
      else delete this.getCardmemberOverrides()[tid];
      persist();
    },

    getAccounts() { return cache.accounts || (cache.accounts = [{ id: 'default', label: 'Default' }]); },

    addAccount(label) {
      label = (label || '').trim();
      if (!label) return null;
      const F = global.Finalyze;
      const accs = this.getAccounts();
      if (F && F.isPro && !F.isPro() && accs.length >= 1) return null;
      const existing = accs.find((a) => a.label.toLowerCase() === label.toLowerCase());
      if (existing) return existing.id;
      const id = 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      accs.push({ id, label });
      persist();
      return id;
    },

    getLayout() { return cache.layout; },
    setLayout(layout) { cache.layout = layout; persist(); },

    getCsvImportPrefs() { return cache.csvImportPrefs; },
    setCsvImportPrefs(prefs) {
      cache.csvImportPrefs = prefs || null;
      persist();
    },

    clearAll() {
      cache = blank();
      persist();
      idb().del('theme');
      idb().del('censor');
    },

    // Clear only imported financial data (transactions + their per-transaction
    // annotations), keeping all settings: categories, rules, budgets, custom
    // cards, groups, merges, accounts, layout, theme, etc.
    clearTransactions() {
      cache.transactions = {};
      cache.txnTags = {};
      cache.cardmemberOverrides = {};
      persist();
    },

    exportJSON() { return JSON.stringify(cache, null, 2); },

    importJSON(jsonText) {
      const incoming = JSON.parse(jsonText);
      cache = validateBackup(incoming);
      migrate(cache);
      persist();
    },

    // Display currency: the user's chosen preference (from onboarding/profile)
    // wins; otherwise fall back to the statement's CURDEF, then CAD. We do not
    // convert amounts — this is purely the currency label shown in the UI.
    currency() {
      let pref = null;
      try { pref = localStorage.getItem(LS_CURRENCY); } catch (e) {}
      return (pref && pref.trim()) || cache.currency || 'CAD';
    },
    currencyPref() {
      try { return localStorage.getItem(LS_CURRENCY) || null; } catch (e) { return null; }
    },
    setCurrencyPref(code) {
      code = (code || '').toString().trim().toUpperCase().slice(0, 3);
      try {
        if (code) localStorage.setItem(LS_CURRENCY, code);
        else localStorage.removeItem(LS_CURRENCY);
      } catch (e) {}
    },
    balance() { return cache.balance; },
    balanceAsOf() { return cache.balanceAsOf; },
  };

  global.Finalyze = global.Finalyze || {};
  global.Finalyze.Store = Store;
})(window);
