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

  F.AIChat = {
    webgpu, ready, enable, unload, ask, insights, localInsights, contextText,
    models, selectedModelKey, setSelectedModelKey, activeModelKey, wantsAutoEnable,
  };
})(window);
