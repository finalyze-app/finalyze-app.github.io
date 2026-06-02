// Finalyze - first-run demo / guided tour.
//
// Loads bundled dummy transactions (sample/demo.csv) into an isolated IndexedDB
// partition so exploring the demo never touches a user's real saved data. A
// localStorage flag drives the demo banner; clearing demo restores the prior
// data scope (signed-out legacy `data` or the signed-in user's partition).

(function (global) {
  const F = (global.Finalyze = global.Finalyze || {});
  const $ = (s, r = document) => r.querySelector(s);
  const DEMO_KEY = 'finalyze.demo';
  const DEMO_RETURN_KEY = 'finalyze.demoReturnScope';
  const DEMO_SCOPE = '__demo__';
  const DEMO_CSV = 'sample/demo.csv';

  // Tour steps. `sel` is the element to spotlight (null = centered card).
  const STEPS = [
    { sel: null, title: 'Welcome to Finalyze', body: 'This is a live demo loaded with dummy March–May 2026 transactions. Take a 60-second tour of what the app does - then load your own data.' },
    { sel: '#widget-overview', title: 'Your money at a glance', body: 'KPI cards summarise total spend, refunds, payments, net, and averages for the selected period.' },
    { sel: '#widget-category', title: 'Where it goes', body: 'Spending is auto-categorised from the merchant name. Tap a slice to filter the whole dashboard to that category.' },
    { sel: '#widget-merchants', title: 'Top merchants', body: 'See who you pay most. Tap a bar to open a merchant drill-down with its history, average ticket, and category.' },
    { sel: '#widget-recurring', title: 'Recurring & subscriptions', body: 'Finalyze flags repeating charges - Netflix, Spotify, ChatGPT, Apple - so nothing slips through unnoticed.' },
    { sel: '#widget-anomalies', title: 'Anomalies', body: 'Budget overruns (≥80% of limit), possible duplicate charges, and unusually large purchases are surfaced here automatically.' },
    { sel: '#widget-transactions', title: 'Every transaction', body: 'Search, filter, retag, and recategorise. Changes to a merchant’s category are remembered for future imports.' },
    {
      sel: '.ai-modal .ai-panel',
      aiFocus: true,
      scroll: false,
      title: 'Ask the AI (optional)',
      body: 'Finalyze AI opens with instant insights from your data - no upload. Optional on-device models add chat and richer narratives; enable them anytime under Models.',
      before: animateDemoAIClick,
      after: closeDemoAI,
    },
    { sel: null, title: 'Ready for the real thing?', body: 'That’s the tour! Clear this sample data and import your own bank or card export (.qfx / .ofx / .csv). Your data never leaves your device.', final: true },
  ];

  let idx = 0, coach = null, target = null, demoCursor = null;
  let steps = STEPS, onFinal = null, finalLabel = '';
  let stepToken = 0, cursorAnimCancel = null;

  function active() { return localStorage.getItem(DEMO_KEY) === '1'; }

  function demoScopeKey() { return 'data:' + DEMO_SCOPE; }

  function isOnDemoScope() {
    return !!(F.Store && F.Store.currentScope && F.Store.currentScope() === demoScopeKey());
  }

  function saveReturnScope() {
    if (!F.Store || !F.Store.currentScope) return;
    try { localStorage.setItem(DEMO_RETURN_KEY, F.Store.currentScope()); } catch (e) { /* ignore */ }
  }

  function scopeKeyToUid(key) {
    if (!key || key === 'data') return null;
    return key.startsWith('data:') ? key.slice(5) : null;
  }

  async function restoreReturnScope() {
    let key = 'data';
    try { key = localStorage.getItem(DEMO_RETURN_KEY) || 'data'; localStorage.removeItem(DEMO_RETURN_KEY); } catch (e) { /* ignore */ }
    await F.Store.setUserScope(scopeKeyToUid(key));
  }

  async function enterDemoScope() {
    await F.Store.init();
    saveReturnScope();
    await F.Store.setUserScope(DEMO_SCOPE);
  }

  async function ensureScope() {
    if (!active()) return;
    await F.Store.init();
    if (!localStorage.getItem(DEMO_RETURN_KEY)) saveReturnScope();
    if (!isOnDemoScope()) await F.Store.setUserScope(DEMO_SCOPE);
  }

  function onAuthChange(user) {
    if (!active()) return;
    const key = user && user.id ? 'data:' + user.id : 'data';
    try { localStorage.setItem(DEMO_RETURN_KEY, key); } catch (e) { /* ignore */ }
  }

  async function endDemoMode() {
    if (isOnDemoScope()) await restoreReturnScope();
    else {
      try { localStorage.removeItem(DEMO_RETURN_KEY); } catch (e) { /* ignore */ }
    }
    try { localStorage.removeItem(DEMO_KEY); } catch (e) { /* ignore */ }
    updateBanner();
  }

  async function start() {
    try {
      await F.Store.init();
      if (!active()) await enterDemoScope();
      else await ensureScope();
      F.Store.clearAll();
      const res = await fetch(DEMO_CSV, { cache: 'no-store' });
      if (!res.ok) throw new Error('could not load demo data');
      const csv = await res.text();
      const parsed = F.parseCSV(csv);
      await Promise.resolve(F.Store.mergeTransactions(parsed, 'default'));
      F.Store.setBudget('Shopping/Retail', 120);
      F.Store.setBudget('Groceries', 200);
      localStorage.setItem(DEMO_KEY, '1');
      F.render && F.render();
      updateBanner();
      startDemoTour();
    } catch (e) {
      await endDemoMode();
      F.render && F.render();
      F.toast && F.toast('Demo failed: ' + (e.message || e));
    }
  }

  // ---- coachmark tour ----
  function openCoach() {
    if (!coach) {
      coach = document.createElement('div');
      coach.className = 'demo-coach';
      coach.innerHTML = `<div class="demo-coach-card" role="dialog" aria-modal="false">
        <div class="dc-step" id="dcStep"></div>
        <h3 id="dcTitle"></h3>
        <p id="dcBody"></p>
        <div class="dc-actions">
          <button class="btn sm ghost-dim" id="dcSkip" type="button">Skip tour</button>
          <span class="dc-spacer"></span>
          <button class="btn sm" id="dcBack" type="button">Back</button>
          <button class="btn sm primary" id="dcNext" type="button">Next</button>
        </div>
      </div>`;
      document.body.appendChild(coach);
      $('#dcSkip', coach).onclick = endTour;
      $('#dcBack', coach).onclick = () => go(idx - 1);
      $('#dcNext', coach).onclick = () => {
        if (steps[idx].final) { (onFinal || endTour)(); return; }
        go(idx + 1);
      };
    }
    coach.classList.add('open');
    go(0);
  }

  function runTour(stepList, finalFn, label) {
    steps = stepList && stepList.length ? stepList : STEPS;
    onFinal = finalFn || endTour;
    finalLabel = label || 'Done';
    idx = 0;
    openCoach();
  }

  function accountsRequired() { return !!(F.Auth && F.Auth.enabled() && !F.Auth.isSignedIn()); }

  function startDemoTour() {
    steps = STEPS; onFinal = clearAndImport;
    finalLabel = accountsRequired() ? 'Clear demo & create my account' : 'Clear demo & import my data';
    idx = 0; openCoach();
  }

  function tourTarget(el) {
    if (!el) return null;
    return el.closest('.grid-stack-item') || el;
  }

  function openDemoAI() {
    if (F.AIUI && F.AIUI.open) F.AIUI.open('insights');
  }

  function closeDemoAI() {
    cancelCursorAnim();
    document.querySelector('.ai-modal')?.classList.remove('demo-focus');
    document.getElementById('aiBtn')?.classList.remove('demo-cursor-target', 'demo-cursor-press');
    if (F.AIUI && F.AIUI.close) F.AIUI.close();
  }

  function ensureDemoCursor() {
    if (demoCursor) return demoCursor;
    demoCursor = document.createElement('div');
    demoCursor.className = 'demo-cursor';
    demoCursor.setAttribute('aria-hidden', 'true');
    demoCursor.innerHTML = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.87a.5.5 0 0 0 .35-.85L6.35 2.86a.5.5 0 0 0-.85.35Z" fill="#fff" stroke="#111827" stroke-width="1.25" stroke-linejoin="round"/>
    </svg>`;
    document.body.appendChild(demoCursor);
    return demoCursor;
  }

  function hideDemoCursor() {
    if (!demoCursor) return;
    demoCursor.classList.remove('visible', 'clicking', 'attention', 'traveling', 'hovering');
  }

  function cancelCursorAnim() {
    if (cursorAnimCancel) {
      cursorAnimCancel();
      cursorAnimCancel = null;
    }
    hideDemoCursor();
    document.getElementById('aiBtn')?.classList.remove('demo-cursor-target', 'demo-cursor-press');
  }

  function wait(ms) {
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        cursorAnimCancel = null;
        resolve();
      }, ms);
      cursorAnimCancel = () => { clearTimeout(t); cursorAnimCancel = null; resolve(); };
    });
  }

  async function animateDemoAIClick() {
    cancelCursorAnim();
    closeDemoAI();
    const btn = document.getElementById('aiBtn');
    if (!btn) {
      openDemoAI();
      return;
    }
    const token = stepToken;
    const cursor = ensureDemoCursor();
    const card = coach && $('.demo-coach-card', coach);
    const cardRect = card ? card.getBoundingClientRect() : null;
    const btnRect = btn.getBoundingClientRect();
    const startX = cardRect ? cardRect.left + cardRect.width * 0.68 : window.innerWidth * 0.52;
    const startY = cardRect ? cardRect.top - 36 : window.innerHeight * 0.4;
    const endX = btnRect.left + btnRect.width * 0.62;
    const endY = btnRect.top + btnRect.height * 0.55;

    cursor.style.left = startX + 'px';
    cursor.style.top = startY + 'px';
    cursor.classList.remove('clicking', 'traveling', 'hovering');
    cursor.classList.add('visible', 'attention');

    await wait(1100);
    if (token !== stepToken) return;

    cursor.classList.remove('attention');
    cursor.classList.add('traveling');
    cursor.style.left = endX + 'px';
    cursor.style.top = endY + 'px';

    await wait(1500);
    if (token !== stepToken) return;

    cursor.classList.remove('traveling');
    cursor.classList.add('hovering');
    btn.classList.add('demo-cursor-target');

    await wait(1200);
    if (token !== stepToken) return;

    cursor.classList.remove('hovering');
    cursor.classList.add('clicking');
    btn.classList.add('demo-cursor-press');
    await wait(260);
    if (token !== stepToken) return;

    btn.click();
    btn.classList.remove('demo-cursor-press', 'demo-cursor-target');
    cursor.classList.remove('clicking', 'hovering', 'visible');
    cursorAnimCancel = null;

    await wait(320);
  }

  function paintCoach(step) {
    $('#dcStep', coach).textContent = `Step ${idx + 1} of ${steps.length}`;
    $('#dcTitle', coach).textContent = step.title;
    $('#dcBody', coach).textContent = step.body;
    $('#dcBack', coach).style.visibility = idx === 0 ? 'hidden' : 'visible';
    $('#dcNext', coach).textContent = step.final ? finalLabel : 'Next';
    $('#dcNext', coach).classList.toggle('final', !!step.final);
    $('#dcSkip', coach).style.visibility = 'visible';
  }

  function applyStepTarget(step) {
    if (step.sel) {
      const el = document.querySelector(step.sel);
      if (el) {
        if (step.aiFocus) {
          const modal = el.closest('.ai-modal');
          if (modal) { modal.classList.add('demo-focus'); target = modal; }
        } else {
          target = tourTarget(el);
          target.classList.add('demo-target');
        }
        if (step.scroll !== false) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }

  async function go(n) {
    const prevStep = steps[idx];
    idx = Math.max(0, Math.min(steps.length - 1, n));
    const step = steps[idx];
    stepToken += 1;
    const token = stepToken;
    clearTarget();
    if (prevStep && prevStep !== step && typeof prevStep.after === 'function') {
      try { prevStep.after(); } catch (e) { /* ignore */ }
    }
    paintCoach(step);
    if (typeof step.before === 'function') {
      try { await Promise.resolve(step.before()); } catch (e) { /* ignore */ }
    }
    if (token !== stepToken) return;
    applyStepTarget(step);
  }

  function clearTarget() {
    cancelCursorAnim();
    if (target) {
      target.classList.remove('demo-target');
      target.classList.remove('demo-focus');
      target = null;
    }
  }

  function endTour() {
    const step = steps[idx];
    if (step && typeof step.after === 'function') {
      try { step.after(); } catch (e) { /* ignore */ }
    }
    clearTarget();
    if (coach) coach.classList.remove('open');
  }

  // ---- banner + teardown ----
  function updateBanner() {
    const host = $('#demoBanner');
    if (!host) return;
    if (!active()) { host.hidden = true; host.innerHTML = ''; if (F.Tickets && F.Tickets.refresh) F.Tickets.refresh(); return; }
    host.hidden = false;
    host.innerHTML = `<span><strong>Demo mode</strong> - sample data · Pro features unlocked.</span>
      <span class="demo-banner-actions">
        <button class="linkish" id="demoReplay" type="button">Replay tour</button>
        <button class="btn sm primary" id="demoClear" type="button">${accountsRequired() ? 'Clear demo &amp; create account' : 'Clear demo &amp; import my data'}</button>
      </span>`;
    $('#demoReplay').onclick = () => { startDemoTour(); };
    $('#demoClear').onclick = clearAndImport;
    if (F.Tickets && F.Tickets.refresh) F.Tickets.refresh();
  }

  async function clearDemoTransactions() {
    await ensureScope();
    F.Store.clearTransactions();
    F.render && F.render();
    F.toast && F.toast('Demo transactions cleared - demo settings kept');
  }

  async function teardownDemo() {
    await ensureScope();
    F.Store.clearAll();
    await endDemoMode();
  }

  async function clearDemoAll() {
    endTour();
    await teardownDemo();
    F.render && F.render();
    F.toast && F.toast('Demo cleared - your own saved data was not affected');
  }

  async function clearAndImport() {
    endTour();
    await teardownDemo();
    F.render && F.render();
    if (F.Auth && F.Auth.enabled() && !F.Auth.isSignedIn()) {
      F.toast && F.toast('Loved the demo? Create a free account to bring in your own data');
      if (F.Account && F.Account.openSignIn) F.Account.openSignIn('signup');
      return;
    }
    F.toast && F.toast('Demo cleared - choose your own export to import');
    const inp = $('#fileInput') || $('#fileInput2');
    if (inp) inp.click();
  }

  async function init() {
    const btn = $('#demoStartBtn');
    if (btn) btn.onclick = start;
    if (!active()) return;
    await ensureScope();
    if (F.Store.getTransactions().length) {
      const b = F.Store.getBudgets();
      if (!Object.keys(b).length) {
        F.Store.setBudget('Shopping/Retail', 120);
        F.Store.setBudget('Groceries', 200);
        F.render && F.render();
      }
      updateBanner();
    } else {
      await endDemoMode();
      F.render && F.render();
    }
  }

  F.Demo = {
    start, active, clearAndImport, clearDemoTransactions, clearDemoAll,
    ensureScope, onAuthChange, runTour, endTour, openDemoAI, closeDemoAI, animateDemoAIClick,
    _updateBanner: updateBanner,
  };
  document.addEventListener('DOMContentLoaded', () => { init().catch(() => {}); });
})(window);
