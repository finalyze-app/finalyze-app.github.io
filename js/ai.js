// Finalyze - Phase 2: on-device AI categorization (Transformers.js).
//
// OPT-IN. Nothing here runs until the user explicitly enables AI, at which point
// the model (~30 MB) is downloaded once and cached by the browser. Inference then
// happens entirely in-browser - transaction text never leaves the device.
//
// Strategy: embed merchant names with a small sentence-transformer, then classify
// each uncategorized merchant by cosine similarity against (a) the user's own past
// corrections [exemplars], and (b) seed phrases for each category. Exemplars win
// when confident, so the model "learns from corrections".
//
// Public: window.Finalyze.AICat
//   AICat.available()                 -> is the platform capable?
//   await AICat.enable(onProgress)    -> download + warm up the model
//   AICat.ready()
//   await AICat.suggestUncategorized()-> [{ key, name, spend, count, category, score }]
//   AICat.uncategorizedMerchants()    -> the raw work list (no model needed)

(function (global) {
  const F = (global.Finalyze = global.Finalyze || {});

  // ESM build of Transformers.js, loaded lazily from CDN only on opt-in.
  const LIB_URL = 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';
  const MODEL = 'Xenova/all-MiniLM-L6-v2';
  const LS_CAT_ENABLED = 'finalyze.aiCatEnabled';

  // Seed phrases per built-in category - used when the user has no matching
  // correction yet. Custom categories fall back to their own name.
  const SEEDS = {
    'Groceries': 'grocery supermarket food market produce',
    'Online/Amazon': 'amazon online marketplace ecommerce order',
    'Restaurants': 'restaurant takeout fast food bar diner delivery uber eats doordash',
    'Coffee': 'coffee cafe espresso latte starbucks tim hortons',
    'Subscriptions': 'subscription streaming membership monthly recurring software',
    'Shopping/Retail': 'clothing apparel store mall retail shopping department',
    'Pharmacy': 'pharmacy drugstore prescription health chemist',
    'Gas/Convenience': 'gas station fuel petrol convenience store',
    'Transit': 'transit train bus subway presto fare parking commute',
    'Entertainment': 'movie cinema concert games entertainment tickets',
    'Insurance': 'insurance premium policy coverage',
    'Health': 'doctor dental medical clinic health fitness gym',
    'Tech/Hosting': 'software hosting domain cloud server developer tech',
    'Transport': 'uber taxi transit train bus parking rideshare',
    'Travel': 'flight hotel airbnb airline travel booking',
    'Utilities': 'electricity water internet phone bill utility',
  };

  let extractor = null;
  let enabling = null;
  const cache = new Map(); // text -> Float32Array (normalized)

  function available() {
    // Needs dynamic import + fetch; effectively any modern browser online.
    return typeof fetch === 'function';
  }
  function ready() { return !!extractor; }

  function enabledPrefKey() {
    try {
      const u = F.Auth && F.Auth.user && F.Auth.user();
      if (u && u.id) return `${LS_CAT_ENABLED}.${u.id}`;
    } catch (e) { /* ignore */ }
    return LS_CAT_ENABLED;
  }
  function markEnabledPref() {
    try {
      localStorage.setItem(LS_CAT_ENABLED, '1');
      localStorage.setItem(enabledPrefKey(), '1');
    } catch (e) { /* ignore */ }
  }
  function clearEnabledPref() {
    try {
      localStorage.removeItem(LS_CAT_ENABLED);
      localStorage.removeItem(enabledPrefKey());
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.startsWith(LS_CAT_ENABLED + '.')) localStorage.removeItem(k);
      }
    } catch (e) { /* ignore */ }
  }
  function wantsAutoEnable() {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(LS_CAT_ENABLED) && localStorage.getItem(k) === '1') return true;
      }
    } catch (e) { /* ignore */ }
    return false;
  }

  async function enable(onProgress) {
    if (extractor) return true;
    if (enabling) return enabling;
    enabling = (async () => {
      const t = await import(/* webpackIgnore: true */ LIB_URL);
      // Cache Storage only exists in a secure context (https/localhost). On a
      // plain-HTTP LAN origin it's unavailable, so disable browser caching to
      // avoid a hard failure - the model still downloads, just not persisted.
      const canCache = typeof caches !== 'undefined';
      if (t.env) { t.env.allowLocalModels = false; t.env.useBrowserCache = canCache; }
      extractor = await t.pipeline('feature-extraction', MODEL, {
        quantized: true,
        progress_callback: (p) => { if (onProgress) onProgress(p); },
      });
      markEnabledPref();
      return true;
    })();
    try { return await enabling; } finally { enabling = null; }
  }

  async function unload() {
    if (enabling) {
      try { await enabling; } catch (e) { /* ignore */ }
    }
    extractor = null;
    cache.clear();
    enabling = null;
    clearEnabledPref();
  }

  async function embed(text) {
    const key = (text || '').toLowerCase();
    if (cache.has(key)) return cache.get(key);
    const out = await extractor(key, { pooling: 'mean', normalize: true });
    const vec = out.data instanceof Float32Array ? out.data : Float32Array.from(out.data);
    cache.set(key, vec);
    return vec;
  }
  function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }

  // ---- work list (no model required) ----
  function uncategorizedMerchants() {
    const Store = F.Store;
    const overrides = Store.getOverrides();
    const cats = F.getCategories();
    const other = cats[cats.length - 1];
    const map = new Map();
    Store.getTransactions().forEach((t) => {
      if (t.amount >= 0) return; // spend only
      const cat = F.categorize(t.name, overrides);
      if (cat !== other) return;
      const key = F.merchantKeyOf(t.name);
      const cur = map.get(key) || { key, name: t.name, spend: 0, count: 0 };
      cur.spend += Math.abs(t.amount); cur.count++;
      map.set(key, cur);
    });
    return [...map.values()].sort((a, b) => b.spend - a.spend);
  }

  // Candidate categories = spend-type categories only (skip Payments/Refunds/Other).
  function candidateCategories() {
    const cats = F.getCategories();
    const other = cats[cats.length - 1];
    return cats.filter((c) => c !== other && F.categoryType(c) === 'spend');
  }

  async function suggestUncategorized() {
    if (!extractor) throw new Error('AI model is not enabled yet.');
    const Store = F.Store;
    const work = uncategorizedMerchants();
    if (!work.length) return [];

    // Build exemplar vectors from the user's past corrections.
    const overrides = Store.getOverrides();
    const exemplars = [];
    for (const [mkey, cat] of Object.entries(overrides)) {
      if (F.categoryType(cat) !== 'spend') continue;
      exemplars.push({ vec: await embed(mkey), category: cat });
    }
    // Category label/seed vectors.
    const cands = candidateCategories();
    const labelVecs = [];
    for (const c of cands) labelVecs.push({ vec: await embed(SEEDS[c] || c), category: c });

    const out = [];
    for (const m of work) {
      const v = await embed(m.key);
      let best = { category: null, score: -1 };
      // exemplars first (weighted slightly higher - these are the user's truth)
      for (const e of exemplars) { const s = dot(v, e.vec) * 1.05; if (s > best.score) best = { category: e.category, score: s }; }
      for (const l of labelVecs) { const s = dot(v, l.vec); if (s > best.score) best = { category: l.category, score: s }; }
      if (best.category) out.push(Object.assign({}, m, { category: best.category, score: Math.min(1, best.score) }));
    }
    return out.sort((a, b) => b.score - a.score);
  }

  F.AICat = { available, ready, enable, unload, suggestUncategorized, uncategorizedMerchants, candidateCategories, wantsAutoEnable };
})(window);
