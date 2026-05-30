// Finalyze — first-run demo / guided tour.
//
// Loads bundled dummy transactions (sample/demo.csv) so a first-time visitor can
// explore the app without importing their own data, then walks them through the
// key features with a coachmark tour. The final step clears the demo data and
// opens the import picker so they can bring their own statement.
//
// Demo data is just normal transactions in IndexedDB, flagged by a localStorage
// key so we can show a banner and wipe it cleanly. Only offered when the app has
// no data yet (the empty state), so clearing is always safe.

(function (global) {
  const F = (global.Finalyze = global.Finalyze || {});
  const $ = (s, r = document) => r.querySelector(s);
  const DEMO_KEY = 'finalyze.demo';
  const DEMO_CSV = 'sample/demo.csv';

  // Tour steps. `sel` is the element to spotlight (null = centered card).
  const STEPS = [
    { sel: null, title: 'Welcome to Finalyze', body: 'This is a live demo loaded with dummy May 2026 transactions. Take a 60-second tour of what the app does — then load your own data.' },
    { sel: '#widget-overview', title: 'Your money at a glance', body: 'KPI cards summarise total spend, refunds, payments, net, and averages for the selected period. Deltas show how this month compares to last.' },
    { sel: '#widget-category', title: 'Where it goes', body: 'Spending is auto-categorised from the merchant name. Tap a slice to filter the whole dashboard to that category.' },
    { sel: '#widget-merchants', title: 'Top merchants', body: 'See who you pay most. Tap a bar to open a merchant drill-down with its history, average ticket, and category.' },
    { sel: '#widget-recurring', title: 'Recurring & subscriptions', body: 'Finalyze flags repeating charges — Netflix, Spotify, ChatGPT, Apple — so nothing slips through unnoticed.' },
    { sel: '#widget-anomalies', title: 'Anomalies', body: 'Possible duplicates and unusually large charges are surfaced automatically so you can catch surprises.' },
    { sel: '#widget-transactions', title: 'Every transaction', body: 'Search, filter, retag, and recategorise. Changes to a merchant’s category are remembered for future imports.' },
    { sel: null, title: 'Ask the AI (optional)', body: 'The Finalyze AI button (in the sidebar) gives plain-English insights and lets you chat with your spending — all on your device, opt-in.' },
    { sel: null, title: 'Ready for the real thing?', body: 'That’s the tour! Clear this sample data and import your own bank or card export (.qfx / .ofx / .csv). Your data never leaves your device.', final: true },
  ];

  let idx = 0, coach = null, target = null;
  let steps = STEPS, onFinal = null, finalLabel = '';

  function active() { return localStorage.getItem(DEMO_KEY) === '1'; }

  async function start() {
    try {
      const res = await fetch(DEMO_CSV, { cache: 'no-store' });
      if (!res.ok) throw new Error('could not load demo data');
      const csv = await res.text();
      const parsed = F.parseCSV(csv);
      await Promise.resolve(F.Store.mergeTransactions(parsed, 'default'));
      localStorage.setItem(DEMO_KEY, '1');
      F.render && F.render();
      updateBanner();
      startDemoTour();
    } catch (e) {
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

  // Run an arbitrary coachmark tour. Each step: { sel, title, body, final?, before? }.
  function runTour(stepList, finalFn, label) {
    steps = stepList && stepList.length ? stepList : STEPS;
    onFinal = finalFn || endTour;
    finalLabel = label || 'Done';
    idx = 0;
    openCoach();
  }
  function startDemoTour() {
    steps = STEPS; onFinal = clearAndImport; finalLabel = 'Clear demo & import my data';
    idx = 0; openCoach();
  }

  function go(n) {
    idx = Math.max(0, Math.min(steps.length - 1, n));
    const step = steps[idx];
    clearTarget();
    if (typeof step.before === 'function') { try { step.before(); } catch (e) {} }
    if (step.sel) {
      target = document.querySelector(step.sel);
      if (target) {
        target.classList.add('demo-target');
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
    $('#dcStep', coach).textContent = `Step ${idx + 1} of ${steps.length}`;
    $('#dcTitle', coach).textContent = step.title;
    $('#dcBody', coach).textContent = step.body;
    $('#dcBack', coach).style.visibility = idx === 0 ? 'hidden' : 'visible';
    $('#dcNext', coach).textContent = step.final ? finalLabel : 'Next';
    $('#dcNext', coach).classList.toggle('final', !!step.final);
    $('#dcSkip', coach).style.visibility = 'visible';
  }

  function clearTarget() { if (target) { target.classList.remove('demo-target'); target = null; } }

  function endTour() {
    clearTarget();
    if (coach) coach.classList.remove('open');
  }

  // ---- banner + teardown ----
  function updateBanner() {
    const host = $('#demoBanner');
    if (!host) return;
    if (!active()) { host.hidden = true; host.innerHTML = ''; return; }
    host.hidden = false;
    host.innerHTML = `<span><strong>Demo mode</strong> — showing sample data.</span>
      <span class="demo-banner-actions">
        <button class="linkish" id="demoReplay" type="button">Replay tour</button>
        <button class="btn sm primary" id="demoClear" type="button">Clear demo &amp; import my data</button>
      </span>`;
    $('#demoReplay').onclick = () => { startDemoTour(); };
    $('#demoClear').onclick = clearAndImport;
  }

  function clearAndImport() {
    endTour();
    Promise.resolve(F.Store.clearAll()).then(() => {
      localStorage.removeItem(DEMO_KEY);
      F.render && F.render();
      updateBanner();
      F.toast && F.toast('Demo cleared — choose your own export to import');
      const inp = $('#fileInput') || $('#fileInput2');
      if (inp) inp.click();
    });
  }

  function init() {
    const btn = $('#demoStartBtn');
    if (btn) btn.onclick = start;
    // If demo data is still loaded from a previous visit, keep the banner shown.
    if (active()) {
      if (F.Store && F.Store.getTransactions && F.Store.getTransactions().length) updateBanner();
      else localStorage.removeItem(DEMO_KEY);
    }
  }

  F.Demo = { start, active, clearAndImport, runTour, endTour, _updateBanner: updateBanner };
  // Store.init() is async; run after it (DOMContentLoaded + a tick is enough since
  // app.js init awaits Store.init before first render, and the banner only needs
  // the button wired immediately).
  document.addEventListener('DOMContentLoaded', () => setTimeout(init, 0));
})(window);
