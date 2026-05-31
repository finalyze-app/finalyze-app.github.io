// Finalyze account UI — sign-in, onboarding wizard, and the sidebar account chip.
//
// This whole layer is OPTIONAL. If no Supabase backend is configured
// (js/config.js left blank), nothing is injected and Finalyze runs fully local.
// When configured, it captures an email via magic-link, runs a one-time
// onboarding wizard, and stores ONLY non-sensitive profile data on the server.

(function (global) {
  const F = (global.Finalyze = global.Finalyze || {});
  const Auth = F.Auth;
  const esc = (s) => F.escapeHtml(s);
  const $ = (s, r = document) => r.querySelector(s);

  const ONBOARD_KEY = 'finalyze.onboarded';

  const CURRENCIES = {
    Canada: 'CAD', 'United States': 'USD', 'United Kingdom': 'GBP', Eurozone: 'EUR',
    Australia: 'AUD', 'New Zealand': 'NZD', Other: 'USD',
  };
  const GOALS = [
    ['save', 'Save more'], ['debt', 'Pay off debt'], ['retire', 'Retire early'],
    ['home', 'Buy a home'], ['reduce', 'Reduce spending'],
  ];

  let overlay = null;

  function modal(html) {
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'acct-modal';
      overlay.innerHTML = '<div class="acct-backdrop"></div><div class="acct-panel" role="dialog" aria-modal="true"></div>';
      document.body.appendChild(overlay);
      overlay.querySelector('.acct-backdrop').addEventListener('click', close);
    }
    overlay.querySelector('.acct-panel').innerHTML = html;
    overlay.classList.add('open');
    document.body.classList.add('modal-open');
    return overlay.querySelector('.acct-panel');
  }
  function close() {
    if (overlay) overlay.classList.remove('open');
    document.body.classList.remove('modal-open');
  }

  // Password strength requirements (sign-up).
  function pwChecks(pw) {
    pw = pw || '';
    return {
      len: pw.length >= 8,
      lower: /[a-z]/.test(pw),
      upper: /[A-Z]/.test(pw),
      digit: /\d/.test(pw),
      symbol: /[^A-Za-z0-9]/.test(pw),
    };
  }

  // ---- sign-in / sign-up (email + password) ----
  function openSignIn(mode) {
    mode = mode === 'signup' ? 'signup' : 'signin';
    const isSignup = mode === 'signup';
    const ref = (F.Referral && F.Referral.getRef && F.Referral.getRef()) || '';
    const refNote = isSignup && ref
      ? '<p class="acct-ref-note muted">Referred by a friend — your 2nd month of Pro is free when you upgrade.</p>'
      : '';
    const panel = modal(`
      <button class="acct-close" aria-label="Close">×</button>
      <div class="acct-head">
        <h2>${isSignup ? 'Create your Finalyze account' : 'Sign in to Finalyze'}</h2>
        <p class="muted">Your financial data stays on this device — only your email is stored on the server.</p>
        ${refNote}
      </div>
      <form id="acctForm" class="acct-form">
        <input type="email" id="acctEmail" placeholder="you@example.com" required autocomplete="email" />
        <input type="password" id="acctPassword" placeholder="Password" required minlength="8"
          autocomplete="${isSignup ? 'new-password' : 'current-password'}" />
        ${isSignup ? `
        <div class="pw-strength" id="pwStrength" aria-hidden="true"><span class="pw-strength-bar" id="pwBar"></span></div>
        <ul class="pw-reqs" id="pwReqs">
          <li data-k="len"><span class="pw-dot"></span>At least 8 characters</li>
          <li data-k="lower"><span class="pw-dot"></span>A lowercase letter</li>
          <li data-k="upper"><span class="pw-dot"></span>An uppercase letter</li>
          <li data-k="digit"><span class="pw-dot"></span>A number</li>
          <li data-k="symbol"><span class="pw-dot"></span>A symbol</li>
        </ul>
        <input type="password" id="acctPassword2" placeholder="Confirm password" required minlength="8" autocomplete="new-password" />` : ''}
        <button type="submit" class="btn primary" id="acctSubmit">${isSignup ? 'Create account' : 'Sign in'}</button>
      </form>
      <p class="acct-switch">${isSignup
        ? 'Already have an account? <a href="#" id="acctToggle">Sign in</a>'
        : 'No account yet? <a href="#" id="acctToggle">Create one</a>'}</p>
      <p class="acct-msg" id="acctMsg"></p>`);
    panel.querySelector('.acct-close').onclick = close;
    panel.querySelector('#acctToggle').onclick = (e) => { e.preventDefault(); openSignIn(isSignup ? 'signin' : 'signup'); };
    if (isSignup) {
      const pwInput = panel.querySelector('#acctPassword');
      const reqs = panel.querySelector('#pwReqs');
      const bar = panel.querySelector('#pwBar');
      const update = () => {
        const c = pwChecks(pwInput.value);
        reqs.querySelectorAll('li').forEach((li) => li.classList.toggle('met', !!c[li.dataset.k]));
        const score = Object.values(c).filter(Boolean).length;
        bar.style.width = (score / 5 * 100) + '%';
        bar.className = 'pw-strength-bar ' + (score <= 2 ? 'weak' : score < 5 ? 'fair' : 'strong');
      };
      pwInput.addEventListener('input', update);
      update();
    }
    panel.querySelector('#acctForm').onsubmit = async (e) => {
      e.preventDefault();
      const email = panel.querySelector('#acctEmail').value.trim();
      const password = panel.querySelector('#acctPassword').value;
      const btn = panel.querySelector('#acctSubmit');
      const msg = panel.querySelector('#acctMsg');
      msg.textContent = '';
      if (isSignup) {
        const confirm = panel.querySelector('#acctPassword2').value;
        if (password !== confirm) { msg.className = 'acct-msg err'; msg.textContent = 'Passwords do not match.'; return; }
        const c = pwChecks(password);
        if (!(c.len && c.lower && c.upper && c.digit && c.symbol)) {
          msg.className = 'acct-msg err';
          msg.textContent = 'Password must be 8+ characters with uppercase, lowercase, a number, and a symbol.';
          return;
        }
      }
      btn.disabled = true; btn.textContent = isSignup ? 'Creating…' : 'Signing in…';
      try {
        const res = isSignup ? await Auth.signUp(email, password) : await Auth.signIn(email, password);
        if (res && res.signedIn) {
          close();
          await afterSignIn();
        } else {
          msg.className = 'acct-msg ok';
          msg.textContent = 'Account created — check your inbox to confirm your email, then sign in.';
          btn.textContent = 'Confirm your email';
        }
      } catch (err) {
        msg.className = 'acct-msg err';
        msg.textContent = err.message || 'Something went wrong. Try again.';
        btn.disabled = false; btn.textContent = isSignup ? 'Create account' : 'Sign in';
      }
    };
  }

  // After a successful sign-in: refresh the chip and run onboarding if needed.
  async function afterSignIn() {
    renderChip();
    if (localStorage.getItem(ONBOARD_KEY)) return;
    let profile = null;
    try { profile = await Auth.getProfile(); } catch (e) {}
    if (!(profile && profile.onboarded)) openOnboarding();
    else localStorage.setItem(ONBOARD_KEY, '1');
  }

  // ---- onboarding wizard ----
  function openOnboarding() {
    const u = Auth.user();
    const state = { country: 'Canada', currency: 'CAD', household: 1, goals: [] };
    const panel = modal(renderOnboard(state));
    wireOnboard(panel, state, u);
  }
  function renderOnboard(state) {
    return `
      <div class="acct-head">
        <div class="eyebrow">Welcome</div>
        <h2>Let's set up Finalyze</h2>
        <p class="muted">A few quick questions to tailor your insights. You can change these later.</p>
      </div>
      <div class="acct-form">
        <label class="ob-field"><span>Country</span>
          <select id="obCountry">${Object.keys(CURRENCIES).map((c) => `<option${c === state.country ? ' selected' : ''}>${c}</option>`).join('')}</select>
        </label>
        <label class="ob-field"><span>Currency</span>
          <input type="text" id="obCurrency" value="${state.currency}" maxlength="3" />
        </label>
        <label class="ob-field"><span>Household size</span>
          <input type="number" id="obHousehold" min="1" max="20" value="${state.household}" />
        </label>
        <div class="ob-field"><span>Financial goals</span>
          <div class="ob-goals" id="obGoals">
            ${GOALS.map(([id, label]) => `<button type="button" class="ob-goal" data-goal="${id}">${label}</button>`).join('')}
          </div>
        </div>
        <button class="btn primary" id="obFinish">Finish setup</button>
      </div>
      <p class="acct-msg" id="acctMsg"></p>`;
  }
  function wireOnboard(panel, state, u) {
    const country = panel.querySelector('#obCountry');
    const currency = panel.querySelector('#obCurrency');
    country.onchange = () => { currency.value = CURRENCIES[country.value] || currency.value; };
    panel.querySelectorAll('.ob-goal').forEach((b) => b.onclick = () => {
      const g = b.dataset.goal;
      const i = state.goals.indexOf(g);
      if (i >= 0) { state.goals.splice(i, 1); b.classList.remove('on'); }
      else { state.goals.push(g); b.classList.add('on'); }
    });
    panel.querySelector('#obFinish').onclick = async () => {
      const patch = {
        country: country.value,
        currency: (currency.value || 'USD').toUpperCase().slice(0, 3),
        household_size: Number(panel.querySelector('#obHousehold').value) || 1,
        goals: state.goals,
        onboarded: true,
      };
      const btn = panel.querySelector('#obFinish');
      btn.disabled = true; btn.textContent = 'Saving…';
      try { await Auth.updateProfile(patch); } catch (e) {}
      localStorage.setItem(ONBOARD_KEY, '1');
      close();
      renderChip();
    };
  }

  // ---- account panel (signed in) ----
  async function openAccount() {
    const u = Auth.user();
    let profile = null;
    try { profile = await Auth.getProfile(); } catch (e) {}
    if (profile && !profile.referral_code && Auth.ensureReferralCode) {
      try {
        await Auth.ensureReferralCode();
        profile = await Auth.getProfile();
      } catch (e) { /* RPC missing until migration is applied */ }
    }
    const demoPro = F.Demo && F.Demo.active && F.Demo.active();
    const license = demoPro ? 'pro' : ((profile && profile.license) || 'free');
    const isPro = license === 'pro';
    const portal = (F.config && F.config.STRIPE_PORTAL_URL) || '';
    const refCode = (profile && profile.referral_code) || '';
    const refCount = (profile && profile.referral_count) || 0;
    const rewardsEarned = (profile && profile.rewards_earned) || 0;
    const shareLink = refCode && F.Referral ? F.Referral.shareUrl(refCode) : '';
    const billingBtn = demoPro
      ? ''
      : isPro
      ? (portal ? `<button class="btn" id="acctManage">Manage subscription</button>` : '')
      : `<button class="btn primary" id="acctUpgrade">Upgrade to Pro</button>`;
    const panel = modal(`
      <button class="acct-close" aria-label="Close">×</button>
      <div class="acct-head">
        <div class="eyebrow">Account</div>
        <h2>${esc(u ? u.email : '')}</h2>
      </div>
      <div class="acct-rows">
        ${demoPro ? `<div class="acct-row"><span>Demo</span><strong class="muted">Pro preview — sample data only</strong></div>` : ''}
        <div class="acct-row"><span>Plan</span><strong class="acct-plan ${license}">${isPro ? 'Pro' : 'Free'}</strong></div>
        ${profile && profile.country ? `<div class="acct-row"><span>Country</span><strong>${esc(profile.country)}</strong></div>` : ''}
      </div>
      ${refCode ? `
      <div class="acct-referrals">
        <div class="eyebrow">Referrals</div>
        <p class="muted acct-ref-desc">Give a month, get a month. When a friend upgrades to Pro, you both get $7 off your next bill.</p>
        <div class="acct-ref-stats"><span><strong>${refCount}</strong> friend${refCount === 1 ? '' : 's'} upgraded</span><span><strong>${rewardsEarned}</strong> month${rewardsEarned === 1 ? '' : 's'} earned</span></div>
        <div class="acct-ref-link">
          <input type="text" id="acctRefLink" readonly value="${shareLink.replace(/"/g, '&quot;')}" />
          <button class="btn primary" id="acctRefCopy" type="button">Copy link</button>
        </div>
      </div>` : ''}
      ${billingBtn ? `<div class="acct-billing">${billingBtn}${isPro && portal ? `<p class="muted" style="font-size:12px;margin:8px 0 0">Cancel or switch between monthly and annual in the Stripe portal.</p>` : ''}</div>` : ''}
      <div class="acct-actions">
        <button class="btn" id="acctEdit">Edit preferences</button>
        <button class="btn ghost danger" id="acctSignOut">Sign out</button>
      </div>
      <p class="muted acct-note">Your transactions never leave this device. Only your email and account settings are synced.</p>`);
    panel.querySelector('.acct-close').onclick = close;
    panel.querySelector('#acctEdit').onclick = openOnboarding;
    panel.querySelector('#acctSignOut').onclick = async () => { await Auth.signOut(); close(); renderChip(); };
    const copyBtn = panel.querySelector('#acctRefCopy');
    if (copyBtn && shareLink) {
      copyBtn.onclick = async () => {
        try {
          await navigator.clipboard.writeText(shareLink);
          if (F.toast) F.toast('Referral link copied');
          else copyBtn.textContent = 'Copied!';
        } catch (e) {
          const inp = panel.querySelector('#acctRefLink');
          if (inp) { inp.select(); document.execCommand('copy'); }
          if (F.toast) F.toast('Link copied');
        }
      };
    }
    const mng = panel.querySelector('#acctManage');
    if (mng) mng.onclick = () => {
      const email = (u && u.email) || '';
      const url = portal + (email ? (portal.includes('?') ? '&' : '?') + 'prefilled_email=' + encodeURIComponent(email) : '');
      window.open(url, '_blank', 'noopener');
    };
    const upg = panel.querySelector('#acctUpgrade');
    if (upg) upg.onclick = () => { close(); if (F.openUpgradeModal) F.openUpgradeModal(); };
  }

  // ---- sidebar chip ----
  // Signed out: a "Sign in" button sits at the TOP (below the logo).
  // Signed in: the account chip sits at the BOTTOM of the sidebar.
  function renderChip() {
    const bottom = $('#accountSlot');
    const top = $('#accountSlotTop');
    if (bottom) bottom.innerHTML = '';
    if (top) top.innerHTML = '';
    if (!bottom || !Auth.enabled()) return;
    if (Auth.isSignedIn()) {
      const u = Auth.user();
      const initial = (u && u.email ? u.email[0] : '?').toUpperCase();
      bottom.innerHTML = `<button class="acct-chip" id="acctChipBtn" title="Account">
        <span class="acct-avatar">${initial}</span>
        <span class="acct-chip-email">${u ? esc(u.email) : ''}</span>
      </button>`;
      $('#acctChipBtn').onclick = openAccount;
    } else if (top) {
      top.innerHTML = `<button class="btn primary" id="acctSignInBtn2" style="width:100%">Sign in</button>`;
      $('#acctSignInBtn2').onclick = openSignIn;
    }
  }

  async function init() {
    if (!Auth || !Auth.enabled()) { renderChip(); return; }
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    const u = await Auth.init();
    renderChip();
    Auth.onChange(renderChip);
    // Deep link from the landing page: ?signin=1 / ?signup=1 opens the form.
    const params = new URLSearchParams(location.search);
    if (!u && (params.get('signin') || params.get('signup'))) {
      openSignIn(params.get('signup') ? 'signup' : 'signin');
    }
    // First-time sign-in → run onboarding once.
    if (u && !localStorage.getItem(ONBOARD_KEY)) {
      let profile = null;
      try { profile = await Auth.getProfile(); } catch (e) {}
      if (!(profile && profile.onboarded)) openOnboarding();
      else localStorage.setItem(ONBOARD_KEY, '1');
    }
  }

  F.Account = { init, openSignIn, openAccount };
  document.addEventListener('DOMContentLoaded', init);
})(window);
