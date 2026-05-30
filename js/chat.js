// Finalyze — Phase 3: AI insights + ask-your-data chat (WebLLM).
//
// OPT-IN. The language model runs entirely in-browser via WebGPU; your spending
// data is summarised locally and fed to the model on-device — nothing is sent to
// any server. The model (~0.8–1.2 GB) downloads once and is cached.
//
// Everything degrades gracefully: if WebGPU or the model isn't available, the
// Insights tab still works using deterministic, locally-computed observations.
//
// Public: window.Finalyze.AIChat
//   AIChat.webgpu()                       -> WebGPU supported?
//   await AIChat.enable(onProgress)       -> download + init the LLM
//   AIChat.ready()
//   await AIChat.ask(question, onToken)   -> streamed answer (LLM)
//   AIChat.localInsights()                -> [strings] deterministic insights
//   await AIChat.insights(onToken)        -> LLM narrative (falls back to local)

(function (global) {
  const F = (global.Finalyze = global.Finalyze || {});
  const LIB_URL = 'https://esm.run/@mlc-ai/web-llm';
  const MODEL = 'Llama-3.2-1B-Instruct-q4f32_1-MLC';

  let engine = null;
  let enabling = null;

  function webgpu() { return typeof navigator !== 'undefined' && 'gpu' in navigator; }
  function ready() { return !!engine; }

  async function enable(onProgress) {
    if (engine) return true;
    if (!webgpu()) throw new Error('This browser has no WebGPU — chat needs Chrome/Edge 121+ or Safari 18+.');
    if (enabling) return enabling;
    enabling = (async () => {
      const webllm = await import(/* webpackIgnore: true */ LIB_URL);
      engine = await webllm.CreateMLCEngine(MODEL, {
        initProgressCallback: (r) => { if (onProgress) onProgress(r); },
      });
      return true;
    })();
    try { return await enabling; } finally { enabling = null; }
  }

  // ---- build a compact spending context from local data ----
  function money(n) { return (F.Store ? F.Store.currency() : '') + ' ' + (Math.round(n * 100) / 100).toLocaleString(); }
  function rows() { return (F.enriched ? F.enriched() : []); }

  function stats() {
    const A = F.analyze, r = rows();
    if (!r.length) return null;
    const s = A.summary(r);
    const mom = A.monthOverMonth(r);
    const byCat = A.byCategory(r).slice(0, 8);
    const byMerch = A.byMerchant(r).slice(0, 8);
    const subs = A.recurring(r, (F.Store && F.Store.getSubscriptions()) || {});
    const last = mom[mom.length - 1], prev = mom[mom.length - 2];
    return { s, mom, byCat, byMerch, subs, last, prev, currency: F.Store.currency() };
  }

  function contextText() {
    const d = stats();
    if (!d) return 'No transactions imported yet.';
    const L = [];
    L.push(`Currency: ${d.currency}. Transactions: ${d.s.count}. Date range: ${d.s.dateFrom} to ${d.s.dateTo}.`);
    L.push(`Total spend ${money(d.s.totalSpend)}, refunds ${money(d.s.totalRefunds)}, net ${money(d.s.net)}, avg/txn ${money(d.s.avgSpend)}.`);
    L.push('Top categories: ' + d.byCat.map((c) => `${c.category} ${money(c.spend)}`).join(', ') + '.');
    L.push('Top merchants: ' + d.byMerch.map((m) => `${m.merchant} ${money(m.spend)}`).join(', ') + '.');
    if (d.subs.length) L.push('Recurring/subscriptions: ' + d.subs.slice(0, 8).map((x) => `${x.merchant} ${money(x.amount)}`).join(', ') + '.');
    if (d.last && d.prev) L.push(`Latest month ${d.last.month} spend ${money(d.last.spend)} vs previous ${d.prev.month} ${money(d.prev.spend)} (${d.last.pctSpend == null ? 'n/a' : d.last.pctSpend.toFixed(1) + '%'}).`);
    return L.join('\n');
  }

  // ---- deterministic insights (no model needed) ----
  function localInsights() {
    const d = stats();
    if (!d) return ['Import a statement to see insights.'];
    const out = [];
    if (d.last && d.prev && d.last.pctSpend != null) {
      const dir = d.last.deltaSpend >= 0 ? 'more' : 'less';
      out.push(`You spent ${money(Math.abs(d.last.deltaSpend))} ${dir} in ${d.last.month} than ${d.prev.month} (${d.last.pctSpend.toFixed(0)}%).`);
      const movers = d.mom && F.analyze.categoryMovers ? F.analyze.categoryMovers(d.mom).slice(0, 1) : [];
      if (movers[0]) out.push(`Biggest change by category: ${movers[0].category} ${movers[0].delta >= 0 ? 'up' : 'down'} ${money(Math.abs(movers[0].delta))}.`);
    }
    if (d.byCat[0]) out.push(`Largest category is ${d.byCat[0].category} at ${money(d.byCat[0].spend)} (${((d.byCat[0].spend / d.s.totalSpend) * 100).toFixed(0)}% of spend).`);
    if (d.byMerch[0]) out.push(`Top merchant is ${d.byMerch[0].merchant} at ${money(d.byMerch[0].spend)}.`);
    if (d.subs.length) {
      const monthly = d.subs.reduce((a, x) => a + x.amount, 0);
      out.push(`${d.subs.length} recurring charges totalling about ${money(monthly)} per cycle — review for anything unused.`);
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

  const SYS = 'You are Finalyze, a concise spending-analysis assistant. You ONLY analyze the user\'s recorded transaction history from the summary provided — totals, categories, merchants, trends, subscriptions, and changes over time. Use the user\'s currency, be specific with numbers, keep answers short, and never invent data. Do NOT give affordability, budgeting-advice, forecasting, or investment answers (e.g. "can I afford X", "should I buy Y") — the app only has past spend data, not income, savings, or balances. If asked something like that, briefly say you can only analyze recorded spending and offer a relevant spending breakdown instead. If the summary lacks the answer, say so.';

  async function ask(question, onToken) {
    if (!engine) throw new Error('AI chat is not enabled yet.');
    const messages = [
      { role: 'system', content: SYS },
      { role: 'user', content: 'Spending summary:\n' + contextText() + '\n\nQuestion: ' + question },
    ];
    return chatStream(messages, onToken);
  }

  async function insights(onToken) {
    if (!engine) return localInsights().join('\n\n');
    const messages = [
      { role: 'system', content: SYS },
      { role: 'user', content: 'Spending summary:\n' + contextText() + '\n\nGive 4-5 short, specific insights and one concrete money-saving suggestion. Use bullet points.' },
    ];
    return chatStream(messages, onToken);
  }

  F.AIChat = { webgpu, ready, enable, ask, insights, localInsights, contextText };
})(window);
