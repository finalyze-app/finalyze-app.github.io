// Persistence layer. IndexedDB + in-memory cache. Fully on-device.

(function (global) {
  const LS_KEY = 'finalyze.v1';
  const LS_THEME = 'finalyze.theme';
  const LS_CENSOR = 'finalyze.censor';
  const idb = () => global.Finalyze.idb;

  function blank() {
    return {
      transactions: {}, overrides: {}, currency: 'CAD', balance: null, balanceAsOf: null,
      subscriptions: {}, customCategories: [], categoryColors: {}, categoryTypes: {},
      categoryRenames: {}, merchantMerges: {}, customRules: [], budgets: {}, txnTags: {},
      cardmemberOverrides: {}, merchantTags: {}, merchantAnomalyExcludes: {},
      mergeSuggestionsDismissed: {}, categoryGroups: [],
      accounts: [{ id: 'default', label: 'Default' }], layout: null, csvImportPrefs: null,
    };
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

  function persist() {
    idb().set('data', cache).catch((e) => {
      if (saveErrorHandler) saveErrorHandler(e);
    });
  }

  function save(data) {
    cache = data;
    persist();
  }

  async function loadFromIdbOrMigrate() {
    let data = await idb().get('data');
    if (data) {
      data = Object.assign(blank(), data);
      if (migrate(data)) await idb().set('data', data);
      return data;
    }
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        data = Object.assign(blank(), JSON.parse(raw));
        migrate(data);
        await idb().set('data', data);
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
      const accs = this.getAccounts();
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

    exportJSON() { return JSON.stringify(cache, null, 2); },

    importJSON(jsonText) {
      const incoming = JSON.parse(jsonText);
      if (!incoming || typeof incoming !== 'object') throw new Error('Invalid backup file.');
      cache = Object.assign(blank(), incoming);
      migrate(cache);
      persist();
    },

    currency() { return cache.currency || 'CAD'; },
    balance() { return cache.balance; },
    balanceAsOf() { return cache.balanceAsOf; },
  };

  global.Finalyze = global.Finalyze || {};
  global.Finalyze.Store = Store;
})(window);
