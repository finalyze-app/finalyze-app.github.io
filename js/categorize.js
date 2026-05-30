// Merchant categorization. OFX/Amex has no category field, so we derive it.
// Resolution order:
//   1. Merchant override (Store.getOverrides(), by canonical merchant key)
//   2. User custom rules (Store.getCustomRules(), in order)
//   3. Built-in keyword RULES below
//   4. "Other"

(function (global) {
  // Normalize a raw merchant NAME to a stable key for overrides + aggregation.
  // Strips trailing store/phone digit runs and collapses whitespace.
  function normalizeMerchant(name) {
    if (!name) return 'Unknown';
    let s = name.toUpperCase().trim();
    s = s.replace(/\s+\d[\d\s]*$/, ''); // trailing store #/phone
    s = s.replace(/\s{2,}/g, ' ').trim();
    return s || name.toUpperCase().trim();
  }

  const CATEGORIES = [
    'Groceries', 'Online/Amazon', 'Dining', 'Subscriptions', 'Shopping/Retail',
    'Pharmacy', 'Gas/Convenience', 'Entertainment', 'Insurance', 'Health',
    'Tech/Hosting', 'Payments', 'Refunds', 'Other',
  ];

  // Category "type": 'spend' (default), 'payment' (card payments), or 'refund'
  // (merchant returns). Payments and refunds are excluded from spend analysis and
  // totalled separately. Users can change a category's type or create their own.
  const DEFAULT_CATEGORY_TYPES = { 'Payments': 'payment', 'Refunds': 'refund' };
  function categoryType(cat) {
    const types = (global.Finalyze.Store && global.Finalyze.Store.getCategoryTypes()) || {};
    return types[cat] || DEFAULT_CATEGORY_TYPES[cat] || 'spend';
  }

  // Resolve a base category name through the user's rename map (transitively).
  function applyRename(cat, renames) {
    const seen = new Set();
    while (renames && renames[cat] && !seen.has(cat)) { seen.add(cat); cat = renames[cat]; }
    return cat;
  }
  function getRenames() {
    return (global.Finalyze.Store && global.Finalyze.Store.getCategoryRenames()) || {};
  }

  // Resolve a normalized merchant key through the user's merge map (transitively),
  // so aliased merchant names collapse to a single canonical merchant.
  function resolveMerchant(key) {
    const m = (global.Finalyze.Store && global.Finalyze.Store.getMerchantMerges()) || {};
    const seen = new Set();
    while (m[key] && !seen.has(key)) { seen.add(key); key = m[key]; }
    return key;
  }
  // The canonical merchant key for a raw transaction name (normalize + merge).
  function merchantKeyOf(name) { return resolveMerchant(normalizeMerchant(name)); }

  // Stable per-category colors shared by charts and table chips.
  const CATEGORY_COLORS = {
    'Groceries': '#0fae6f',
    'Online/Amazon': '#ff9900',
    'Dining': '#ef4655',
    'Subscriptions': '#5b5bf0',
    'Shopping/Retail': '#7c4dff',
    'Pharmacy': '#06b6d4',
    'Gas/Convenience': '#f5a524',
    'Entertainment': '#ec4899',
    'Insurance': '#0ea5e9',
    'Health': '#14b8a6',
    'Tech/Hosting': '#8b5cf6',
    'Payments': '#0ea5e9',
    'Refunds': '#0fae6f',
    'Other': '#94a3b8',
  };
  // All categories = built-in + user-defined (from Store, read at call time).
  function getCategories() {
    const custom = (global.Finalyze.Store && global.Finalyze.Store.getCustomCategories()) || [];
    const renames = getRenames();
    const names = CATEGORIES.slice(0, -1).map((c) => applyRename(c, renames)); // all but trailing 'Other'
    custom.forEach((c) => { if (!names.includes(c.name) && c.name !== 'Other') names.push(c.name); });
    names.push(applyRename('Other', renames));
    return names;
  }

  function categoryColor(cat) {
    const overrides = (global.Finalyze.Store && global.Finalyze.Store.getCategoryColors()) || {};
    return overrides[cat] || CATEGORY_COLORS[cat] || '#94a3b8';
  }

  // Ordered: first match wins. Subscriptions checked before generic merchants
  // so e.g. "WALMART DELIVERY PASS" is a subscription, not Groceries.
  const RULES = [
    [/MOBILE PAYMENT|AUTOPAY|PAYMENT RECEIVED|PAYMENT - THANK|THANK YOU/i, 'Payments'],
    [/NETFLIX|OPENAI|CHATGPT|APPLECOMBILL|UBER ONE|INSTACARTSUBSCRIP|DELIVERY PASS|GOOGLE\b|NEST/i, 'Subscriptions'],
    [/AMZN|AMAZONCA|AMAZON/i, 'Online/Amazon'],
    [/UBER EATS|TIM HORTONS|JERSEY MIKE|BURGER|7 BREW|CHAI N CHILL|STACKED PANCAKE|RPM BAKEHOUSE|RESTAURANT|CAFE|COFFEE|PIZZA/i, 'Dining'],
    [/METRO|SARGENT FARMS|TRADER JOE|INSTACART|WALMART|SUPERCENTER|GROCER/i, 'Groceries'],
    [/SHOPPERS DRUG MART|PHARMA|DRUG MART/i, 'Pharmacy'],
    [/CIRCLE K|AW STORE|A&W|ESSO|PETRO|SHELL|GAS\b/i, 'Gas/Convenience'],
    [/CINEPLEX|CINEMA|THEATRE|THEATER/i, 'Entertainment'],
    [/AVIVA|INSURANCE/i, 'Insurance'],
    [/DENTA|DENTAL|CLINIC|HEALTH|MEDICAL/i, 'Health'],
    [/NAMECHEAP|HOSTING|DOMAIN|SUITEADVANCED|GODADDY/i, 'Tech/Hosting'],
    [/GAP|ABERCROMBIE|MARSHALLS|WINNERS|HOMESENSE|HOMEGOODS|TARGET|INDIGO|STAPLES|TJ|TK MAXX|ABERCROMBIE/i, 'Shopping/Retail'],
  ];

  function getCustomRules() {
    return (global.Finalyze.Store && global.Finalyze.Store.getCustomRules()) || [];
  }
  // Apply a single rule's regex to a name; bad patterns are skipped safely.
  function ruleMatches(rule, name) {
    try { return new RegExp(rule.pattern, rule.flags || 'i').test(name); } catch (e) { return false; }
  }
  // Resolve which category a name WOULD get, ignoring overrides — used by the rule
  // tester and to preview rule effects.
  function previewCategory(name) {
    const renames = getRenames();
    for (const r of getCustomRules()) if (ruleMatches(r, name)) return applyRename(r.category, renames);
    for (const [re, cat] of RULES) if (re.test(name)) return applyRename(cat, renames);
    return applyRename('Other', renames);
  }

  function categorize(name, overrides) {
    const key = merchantKeyOf(name);
    if (overrides && overrides[key]) return overrides[key];
    return previewCategory(name);
  }

  global.Finalyze = global.Finalyze || {};
  global.Finalyze.normalizeMerchant = normalizeMerchant;
  global.Finalyze.merchantKeyOf = merchantKeyOf;
  global.Finalyze.resolveMerchant = resolveMerchant;
  global.Finalyze.categorize = categorize;
  global.Finalyze.previewCategory = previewCategory;
  global.Finalyze.CATEGORIES = CATEGORIES;
  global.Finalyze.CATEGORY_COLORS = CATEGORY_COLORS;
  global.Finalyze.categoryColor = categoryColor;
  global.Finalyze.getCategories = getCategories;
  global.Finalyze.categoryType = categoryType;
  global.Finalyze.applyRename = applyRename;
  global.Finalyze.DEFAULT_CATEGORY_TYPES = DEFAULT_CATEGORY_TYPES;
})(window);
