// Finalyze - Phase 3: AI insights + ask-your-data chat (WebLLM).
//
// OPT-IN. The language model runs entirely in-browser via WebGPU; your spending
// data is summarised locally and fed to the model on-device - nothing is sent to
// any server. Models download once and are cached.
//
// Only one chat tier (Standard or Enhanced) may be loaded at a time.
// Categorization runs separately and can be loaded alongside chat.
//
// Public: window.Finalyze.AIChat
//   AIChat.webgpu()                       -> WebGPU supported?
//   AIChat.models()                       -> { standard, enhanced } specs
//   AIChat.selectedModelKey()             -> persisted tier choice
//   AIChat.setSelectedModelKey(key)        -> persist tier (does not load)
//   AIChat.activeModelKey()               -> loaded tier, or null
//   await AIChat.enable(onProgress)       -> download + init selected LLM
//   await AIChat.unload()                 -> free GPU / WASM memory
//   AIChat.ready()
//   await AIChat.ask(question, onToken)   -> streamed answer (LLM)
//   AIChat.localInsights()                -> [strings] deterministic insights
//   await AIChat.insights(onToken)        -> LLM narrative (falls back to local)

(function (global) {
  const F = (global.Finalyze = global.Finalyze || {});
  const LIB_URL = 'https://esm.run/@mlc-ai/web-llm';
  const LS_CHAT_MODEL = 'finalyze.chatModel';
  const LS_CHAT_ENABLED = 'finalyze.aiChatEnabled';
  const MAX_CONTEXT_CHARS = 14000;

  const CHAT_MODELS = {
    standard: {
      id: 'standard',
      label: 'Standard',
      size: '~1 GB',
      desc: 'Fast answers for everyday questions.',
      modelId: 'Llama-3.2-1B-Instruct-q4f32_1-MLC',
    },
    enhanced: {
      id: 'enhanced',
      label: 'Enhanced',
      size: '~2.3 GB',
      desc: 'Smarter reasoning; larger download and slower on low-end devices.',
      modelId: 'Llama-3.2-3B-Instruct-q4f16_1-MLC',
    },
  };

  let engine = null;
  let loadedModelKey = null;
  let enabling = null;

  function webgpu() { return typeof navigator !== 'undefined' && 'gpu' in navigator; }
  function ready() { return !!engine; }
  function models() { return CHAT_MODELS; }
  function activeModelKey() { return loadedModelKey; }

  function selectedModelKey() {
    const k = localStorage.getItem(LS_CHAT_MODEL);
    return CHAT_MODELS[k] ? k : 'standard';
  }

  function setSelectedModelKey(key) {
    if (!CHAT_MODELS[key]) return;
    localStorage.setItem(LS_CHAT_MODEL, key);
  }

  function enabledPrefKey() {
    try {
      const u = F.Auth && F.Auth.user && F.Auth.user();
      if (u && u.id) return `${LS_CHAT_ENABLED}.${u.id}`;
    } catch (e) { /* ignore */ }
    return LS_CHAT_ENABLED;
  }
  function markEnabledPref() {
    try {
      localStorage.setItem(LS_CHAT_ENABLED, '1');
      localStorage.setItem(enabledPrefKey(), '1');
    } catch (e) { /* ignore */ }
  }
  function clearEnabledPref() {
    try {
      localStorage.removeItem(LS_CHAT_ENABLED);
      localStorage.removeItem(enabledPrefKey());
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.startsWith(LS_CHAT_ENABLED + '.')) localStorage.removeItem(k);
      }
    } catch (e) { /* ignore */ }
  }
  function wantsAutoEnable() {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(LS_CHAT_ENABLED) && localStorage.getItem(k) === '1') return true;
      }
    } catch (e) { /* ignore */ }
    return false;
  }

  async function unload(opts) {
    const clearPref = !opts || opts.clearPref !== false;
    if (enabling) {
      try { await enabling; } catch (e) { /* cancelled or failed */ }
    }
    if (engine) {
      try { await engine.unload(); } catch (e) { /* ignore */ }
      engine = null;
      loadedModelKey = null;
    }
    if (clearPref) clearEnabledPref();
  }

  async function enable(onProgress, modelKey) {
    if (!webgpu()) throw new Error('This browser has no WebGPU - chat needs Chrome/Edge 121+ or Safari 18+.');
    const key = modelKey || selectedModelKey();
    const spec = CHAT_MODELS[key];
    if (!spec) throw new Error('Unknown chat model.');
    if (engine && loadedModelKey === key) return true;
    if (enabling) return enabling;

    enabling = (async () => {
      await unload({ clearPref: false });
      const webllm = await import(/* webpackIgnore: true */ LIB_URL);
      engine = await webllm.CreateMLCEngine(spec.modelId, {
        initProgressCallback: (r) => { if (onProgress) onProgress(r); },
      });
      loadedModelKey = key;
      setSelectedModelKey(key);
      markEnabledPref();
      return true;
    })();
    try { return await enabling; } finally { enabling = null; }
  }

  // ---- build a rich spending context from local data ----
  function money(n) {
    return (F.Store ? F.Store.currency() : '') + ' ' + (Math.round(n * 100) / 100).toLocaleString();
  }
  function rows() { return (F.enriched ? F.enriched() : []); }
  function pct(part, whole) { return whole ? ((part / whole) * 100).toFixed(1) + '%' : 'n/a'; }

  function stats() {
    const A = F.analyze, r = rows();
    if (!r.length) return null;
    const s = A.summary(r);
    const mom = A.monthOverMonth(r);
    const byCat = A.byCategory(r);
    const byMerch = A.byMerchant(r, 25);
    const subs = A.recurring(r, (F.Store && F.Store.getSubscriptions()) || {}, F.Store && F.Store.getSubscriptionRules());
    const last = mom[mom.length - 1];
    const prev = mom[mom.length - 2];
    const movers = mom.length >= 2 && A.categoryMovers ? A.categoryMovers(mom).slice(0, 12) : [];
    const cardmembers = A.byCardmember ? A.byCardmember(r) : [];
    const budgets = (F.Store && F.Store.getBudgets()) || {};
    return {
      s, mom, byCat, byMerch, subs, last, prev, movers, cardmembers, budgets,
      currency: F.Store.currency(),
    };
  }

  function budgetLines(d) {
    const budgets = d.budgets;
    const keys = Object.keys(budgets).filter((k) => budgets[k] > 0);
    if (!keys.length) return [];
    const ym = d.last ? d.last.month : null;
    const byCat = ym && d.last ? d.last.byCategory : {};
    const groups = (F.Store && F.Store.getCategoryGroups()) || [];
    const inGroup = new Set();
    groups.forEach((g) => g.categories.forEach((c) => inGroup.add(c)));

    const spentFor = (key) => {
      const g = groups.find((x) => x.name === key);
      if (g) return g.categories.reduce((a, c) => a + (byCat[c] || 0), 0);
      if (inGroup.has(key)) return null;
      return byCat[key] || 0;
    };

    const lines = keys.map((key) => {
      const limit = budgets[key];
      const spent = spentFor(key);
      if (spent == null) return null;
      const pctUsed = limit ? Math.round((spent / limit) * 100) : 0;
      return `${key}: spent ${money(spent)} / budget ${money(limit)} (${pctUsed}%${ym ? ' in ' + ym : ''})`;
    }).filter(Boolean);
    return lines.length ? ['Monthly budgets (latest month where available):', ...lines.map((l) => '- ' + l)] : [];
  }

  function taggedTotals(txns) {
    let business = 0, reimb = 0;
    txns.forEach((t) => {
      if (!t.isSpend || !t.tags || !t.tags.length) return;
      if (t.tags.includes('business')) business += t.spend;
      if (t.tags.includes('reimbursable')) reimb += t.spend;
    });
    const lines = [];
    if (business > 0) lines.push(`Business-tagged spend: ${money(business)}.`);
    if (reimb > 0) lines.push(`Reimbursable-tagged spend: ${money(reimb)}.`);
    return lines;
  }

  function trimContext(text) {
    if (text.length <= MAX_CONTEXT_CHARS) return text;
    return text.slice(0, MAX_CONTEXT_CHARS - 80) + '\n\n[Context truncated to fit model limits - ask about a specific category, merchant, or month for detail.]';
  }

  function contextText() {
    const d = stats();
    if (!d) return 'No transactions imported yet.';
    const r = rows();
    const L = [];

    L.push('=== Overview ===');
    L.push(`Currency: ${d.currency}. Transactions: ${d.s.count} (${d.s.debitCount} spend, ${d.s.creditCount} credits/payments).`);
    L.push(`Date range: ${d.s.dateFrom} to ${d.s.dateTo}.`);
    L.push(`Total spend ${money(d.s.totalSpend)}, refunds ${money(d.s.totalRefunds)}, payments ${money(d.s.totalPayments)}, net spend ${money(d.s.net)}.`);
    L.push(`Average spend/transaction ${money(d.s.avgSpend)}, median ${money(d.s.medianSpend)}.`);

    L.push('');
    L.push('=== All categories (spend) ===');
    d.byCat.forEach((c) => {
      L.push(`- ${c.category}: ${money(c.spend)} (${c.count} txns, ${pct(c.spend, d.s.totalSpend)} of total)`);
    });

    L.push('');
    L.push('=== Top merchants ===');
    d.byMerch.forEach((m) => {
      L.push(`- ${m.merchant}: ${money(m.spend)} (${m.count} txns)`);
    });

    if (d.mom.length) {
      L.push('');
      L.push('=== Monthly trends (most recent last) ===');
      d.mom.slice(-12).forEach((m) => {
        let line = `${m.month}: spend ${money(m.spend)}, refunds ${money(m.refunds)}, net ${money(m.net)}`;
        if (m.deltaSpend != null) line += ` (Δ ${money(m.deltaSpend)} vs prior, ${m.pctSpend == null ? 'n/a' : m.pctSpend.toFixed(1) + '%'})`;
        L.push(line);
      });
    }

    if (d.movers.length) {
      L.push('');
      L.push('=== Biggest category changes (latest vs previous month) ===');
      d.movers.forEach((m) => {
        L.push(`- ${m.category}: ${money(m.previous)} → ${money(m.current)} (Δ ${money(m.delta)})`);
      });
    }

    if (d.subs.length) {
      L.push('');
      L.push('=== Recurring / subscriptions ===');
      d.subs.forEach((x) => {
        L.push(`- ${x.merchant}: ${money(x.amount)} × ${x.count} (${x.months} months, last ${x.lastDate})`);
      });
      const cycleTotal = d.subs.reduce((a, x) => a + x.amount, 0);
      L.push(`Estimated per-cycle total: ${money(cycleTotal)}.`);
    }

    const budgetSec = budgetLines(d);
    if (budgetSec.length) {
      L.push('');
      L.push('=== ' + budgetSec[0]);
      budgetSec.slice(1).forEach((line) => L.push(line));
    }

    if (d.s.largest && d.s.largest.length) {
      L.push('');
      L.push('=== Largest single transactions ===');
      d.s.largest.forEach((t) => {
        L.push(`- ${t.date} ${t.name} (${t.category}): ${money(t.spend)}`);
      });
    }

    if (d.cardmembers.length > 1) {
      L.push('');
      L.push('=== By cardmember ===');
      d.cardmembers.forEach((cm) => {
        L.push(`- ${cm.cardmember}: ${money(cm.spend)} (${cm.count} txns)`);
      });
    }

    const tagLines = taggedTotals(r);
    if (tagLines.length) {
      L.push('');
      L.push('=== Tags ===');
      tagLines.forEach((line) => L.push(line));
    }

    return trimContext(L.join('\n'));
  }

  // ---- deterministic insights (no model needed) ----
  function localInsights() {
    const d = stats();
    if (!d) return ['Import a statement to see insights.'];
    const out = [];
    if (d.last && d.prev && d.last.pctSpend != null) {
      const dir = d.last.deltaSpend >= 0 ? 'more' : 'less';
      out.push(`You spent ${money(Math.abs(d.last.deltaSpend))} ${dir} in ${d.last.month} than ${d.prev.month} (${d.last.pctSpend.toFixed(0)}%).`);
      if (d.movers[0]) out.push(`Biggest change by category: ${d.movers[0].category} ${d.movers[0].delta >= 0 ? 'up' : 'down'} ${money(Math.abs(d.movers[0].delta))}.`);
    }
    if (d.byCat[0]) out.push(`Largest category is ${d.byCat[0].category} at ${money(d.byCat[0].spend)} (${pct(d.byCat[0].spend, d.s.totalSpend)} of spend).`);
    if (d.byMerch[0]) out.push(`Top merchant is ${d.byMerch[0].merchant} at ${money(d.byMerch[0].spend)}.`);
    if (d.subs.length) {
      const monthly = d.subs.reduce((a, x) => a + x.amount, 0);
      out.push(`${d.subs.length} recurring charges totalling about ${money(monthly)} per cycle - review for anything unused.`);
    }
    out.push(`Average transaction is ${money(d.s.avgSpend)}; median ${money(d.s.medianSpend)}.`);
    return out;
  }

  async function chatStream(messages, onToken) {
    const completion = await engine.chat.completions.create({ messages, temperature: 0.4, stream: true });
    let full = '';
    for await (const chunk of completion) {
      const tok = chunk.choices[0]?.delta?.content || '';
      if (tok) { full += tok; if (onToken) onToken(tok, full); }
    }
    return full;
  }

  const SYS = 'You are Finalyze, a concise spending-analysis assistant. You ONLY analyze the user\'s recorded transaction history from the detailed summary provided - overview, all categories, top merchants, monthly trends, category changes, subscriptions, budgets, largest transactions, cardmembers, and tags. Use the user\'s currency, cite specific numbers, and never invent data. Do NOT give affordability, budgeting-advice, forecasting, or investment answers (e.g. "can I afford X", "should I buy Y") - the app only has past spend data, not income, savings, or balances. If asked something like that, briefly say you can only analyze recorded spending and offer a relevant breakdown instead. If the summary lacks the answer, say so clearly.';

  async function ask(question, onToken) {
    if (!engine) throw new Error('AI chat is not enabled yet.');
    const messages = [
      { role: 'system', content: SYS },
      { role: 'user', content: 'Spending data:\n' + contextText() + '\n\nQuestion: ' + question },
    ];
    return chatStream(messages, onToken);
  }

  async function insights(onToken) {
    if (!engine) return localInsights().join('\n\n');
    const messages = [
      { role: 'system', content: SYS },
      { role: 'user', content: 'Spending data:\n' + contextText() + '\n\nGive 4-5 short, specific insights and one concrete money-saving suggestion. Use bullet points.' },
    ];
    return chatStream(messages, onToken);
  }

  // ---- deterministic query layer (no model needed) ----
  // Answers the common, high-value questions directly from local aggregates so
  // the flagship prompts ("how much on coffee?", "what changed?", "top
  // merchants", "which subscriptions cost the most?") always return a specific
  // numeric answer - even when no LLM is loaded, and without the model ever
  // refusing a valid merchant/category lookup. Returns a string, or null when
  // the question isn't a recognised intent (so the LLM can take over).
  const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function dateLabel(iso) {
    if (!iso) return '';
    const p = iso.split('-').map(Number);
    return `${MONTHS_SHORT[p[1] - 1]} ${p[2]}, ${p[0]}`;
  }
  function rangeLabel(from, to) {
    if (!from) return '';
    return from === to ? dateLabel(from) : `${dateLabel(from)} – ${dateLabel(to)}`;
  }
  function monthName(ym) {
    const p = (ym || '').split('-').map(Number);
    return p.length === 2 ? `${MONTHS_LONG[p[1] - 1]} ${p[0]}` : ym;
  }

  // Category-style words that aren't categories -> merchant-name patterns.
  const SYNONYMS = {
    gym: /GOODLIFE|FITNESS|GYM|YOGA|PELOTON|CRUNCH|PLANET FIT/i,
    fitness: /GOODLIFE|FITNESS|GYM|YOGA|PELOTON/i,
    phone: /ROGERS|BELL|TELUS|FIDO|FREEDOM|KOODO|WIRELESS|\bPHONE\b/i,
    rent: /\bRENT\b|LANDLORD|PROPERTY/i,
    internet: /ROGERS|BELL|TELUS|TEKSAVVY|INTERNET/i,
  };
  // Filler words stripped from an extracted "on X" term.
  const STOP = /\b(last|this|past|previous|recent|the|a|my|in|on|total|overall|so far|month|months|week|year|quarter|please|all|spending|spend)\b/g;

  function spendSummary(label, txns, breakdown) {
    if (!txns.length) return null;
    const total = txns.reduce((a, t) => a + t.spend, 0);
    const dates = txns.map((t) => t.date).sort();
    const n = txns.length;
    let s = `You spent ${money(total)} on ${label} (${n} transaction${n > 1 ? 's' : ''}) between ${rangeLabel(dates[0], dates[n - 1])}.`;
    if (breakdown) {
      const m = {};
      txns.forEach((t) => { m[t.merchantKey] = (m[t.merchantKey] || 0) + t.spend; });
      const list = Object.entries(m).sort((a, b) => b[1] - a[1]);
      if (list.length > 1) s += ' Breakdown: ' + list.slice(0, 5).map(([k, v]) => `${k} ${money(v)}`).join(', ') + '.';
    }
    return s;
  }

  function answerSpendOn(r, rawTerm) {
    const term = (rawTerm || '').trim().toLowerCase();
    if (term.length < 2) return null;
    // 1. category match (exact, then token/substring)
    const cats = F.analyze.byCategory(r);
    let cat = cats.find((c) => c.category.toLowerCase() === term)
      || cats.find((c) => {
        const cl = c.category.toLowerCase();
        return cl.split(/[\/ &]/).includes(term) || cl.includes(term);
      });
    if (cat) {
      return spendSummary(cat.category, r.filter((t) => t.isSpend && t.category === cat.category));
    }
    // 2. merchant name / description substring
    const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    let matched = r.filter((t) => t.isSpend && (re.test(t.name || '') || re.test(t.merchantKey || '')));
    // 3. synonym -> merchant pattern
    if (!matched.length && SYNONYMS[term]) {
      const syn = SYNONYMS[term];
      matched = r.filter((t) => t.isSpend && (syn.test(t.name || '') || syn.test(t.merchantKey || '')));
    }
    if (matched.length) return spendSummary(`“${rawTerm.trim()}”`, matched, true);
    return null;
  }

  function localAnswer(question) {
    const r = rows();
    if (!r.length) return 'No transactions in the current view yet. Import a statement or widen your filters.';
    const q = (question || '').toLowerCase().trim();
    if (!q) return null;
    const A = F.analyze;

    // Top merchants
    if (/\btop (merchant|store|vendor|shop|place)/.test(q) || /(biggest|most expensive).*(merchant|store|vendor)/.test(q) || /who (do|did) i.*pay/.test(q) || /where.*spend.*most/.test(q)) {
      const m = A.byMerchant(r, 5);
      if (m.length) return 'Your top merchants: ' + m.map((x, i) => `${i + 1}. ${x.merchant} ${money(x.spend)} (${x.count})`).join('; ') + '.';
    }
    // Subscriptions / recurring
    if (/subscription|recurring|membership/.test(q)) {
      const all = A.recurring(r, (F.Store && F.Store.getSubscriptions()) || {}, F.Store && F.Store.getSubscriptionRules());
      // Prefer genuine subscriptions (Subscriptions category / rule / user-marked)
      // over coincidental same-amount repeats (e.g. a duplicate grocery run).
      let subs = all.filter((x) => x.category === 'Subscriptions' || x.byRule || x.marked);
      let label = 'subscription';
      if (!subs.length) { subs = all; label = 'recurring charge'; }
      if (subs.length) {
        const sorted = [...subs].sort((a, b) => b.amount - a.amount);
        const total = subs.reduce((a, x) => a + x.amount, 0);
        return `You have ${subs.length} ${label}${subs.length > 1 ? 's' : ''} (~${money(total)} per cycle). Largest: ` + sorted.slice(0, 5).map((x) => `${x.merchant} ${money(x.amount)}`).join(', ') + '.';
      }
      return 'No recurring charges detected in the current view.';
    }
    // What changed (month over month)
    if (/what changed|changed.*month|month over month|vs last month|compared to last|than last month|spend (more|less)/.test(q)) {
      const mom = A.monthOverMonth(r);
      if (mom.length >= 2) {
        const last = mom[mom.length - 1], prev = mom[mom.length - 2];
        const dir = last.deltaSpend >= 0 ? 'more' : 'less';
        const movers = A.categoryMovers(mom).slice(0, 3);
        let s = `You spent ${money(Math.abs(last.deltaSpend))} ${dir} in ${monthName(last.month)} than ${monthName(prev.month)} (${last.pctSpend == null ? 'n/a' : last.pctSpend.toFixed(0) + '%'}).`;
        if (movers.length) s += ' Biggest movers: ' + movers.map((mv) => `${mv.category} ${mv.delta >= 0 ? '+' : '−'}${money(Math.abs(mv.delta))}`).join(', ') + '.';
        return s;
      }
      return 'There’s only one month in the current view, so there’s nothing to compare yet.';
    }
    // Cardmember split
    if (/cardmember|card member|by person|who spent more/.test(q)) {
      const cm = A.byCardmember(r.filter((t) => t.isSpend));
      if (cm.length > 1) return 'By cardmember: ' + cm.map((c) => `${c.cardmember} ${money(c.spend)} (${c.count})`).join(', ') + '.';
    }
    // Total / net / overview (only when it's not an "on X" lookup)
    if (/\b(total|net|overall|altogether|summary|overview)\b/.test(q) && !/\b(on|at|for)\s+\S/.test(q)) {
      const s = A.summary(r);
      return `Across ${rangeLabel(s.dateFrom, s.dateTo)} you spent ${money(s.totalSpend)} over ${s.debitCount} purchases (net ${money(s.net)} after ${money(s.totalRefunds)} in refunds).`;
    }
    // "How much did I spend on/at/for X?"
    const m = q.match(/(?:how much.*?|spen[dt]|pay|paid|cost).*?\b(?:on|at|for|with)\s+([a-z0-9 '&.\-]+?)\s*\??$/);
    if (m) {
      const term = m[1].replace(STOP, ' ').replace(/\s+/g, ' ').trim();
      const ans = answerSpendOn(r, term);
      if (ans) return ans;
    }
    // Bare term (e.g. the hero-style "coffee", "subscriptions")
    if (/^[a-z0-9 '&.\-]{2,30}\??$/.test(q)) {
      const ans = answerSpendOn(r, q.replace(/\?$/, '').replace(STOP, ' ').replace(/\s+/g, ' ').trim());
      if (ans) return ans;
    }
    return null;
  }

  F.AIChat = {
    webgpu, ready, enable, unload, ask, insights, localInsights, localAnswer, contextText,
    models, selectedModelKey, setSelectedModelKey, activeModelKey, wantsAutoEnable,
  };
})(window);
