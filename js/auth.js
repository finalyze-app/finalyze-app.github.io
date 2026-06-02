// Finalyze account layer - a tiny, dependency-free Supabase client.
//
// We deliberately avoid the Supabase JS SDK (which would be a CDN/runtime
// dependency) and instead talk to Supabase's Auth (GoTrue) and REST (PostgREST)
// endpoints directly with fetch. This keeps the app's "no third-party scripts"
// posture intact: the only network traffic is to YOUR Supabase project, and only
// for email/account data - never transactions.
//
// Public surface: window.Finalyze.Auth
//   await Auth.init()                  -> restores an existing session
//   Auth.enabled()                     -> is a backend configured?
//   Auth.isSignedIn() / Auth.user()    -> current state
//   await Auth.signUp(email, password) -> create an account
//   await Auth.signIn(email, password) -> email + password sign-in
//   await Auth.signOut()
//   await Auth.getProfile()            -> { id, email, license, referral_code, ... }
//   await Auth.updateProfile(patch)    -> upsert non-sensitive profile fields
//   Auth.onChange(fn)                  -> subscribe to sign-in/sign-out

(function (global) {
  const F = (global.Finalyze = global.Finalyze || {});
  const cfg = F.config || {};
  const SESSION_KEY = 'finalyze.session';

  let session = null;        // { access_token, refresh_token, expires_at, user }
  const listeners = [];

  function enabled() { return !!(cfg.enabled && cfg.enabled()); }
  function notify() { listeners.forEach((fn) => { try { fn(session && session.user); } catch (e) {} }); }
  function onChange(fn) { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; }

  function loadSession() {
    try { session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { session = null; }
  }
  function saveSession(s) {
    session = s;
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  }

  function authUrl(path) { return cfg.SUPABASE_URL.replace(/\/$/, '') + '/auth/v1' + path; }
  function restUrl(path) { return cfg.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1' + path; }
  function baseHeaders(extra) {
    return Object.assign({ apikey: cfg.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }, extra || {});
  }
  function authedHeaders(extra) {
    return baseHeaders(Object.assign({ Authorization: 'Bearer ' + (session && session.access_token) }, extra || {}));
  }

  // Post-confirmation redirect (GoTrue `email_redirect_to`). Production → finalyze.cc/app/;
  // local dev → same host /app/ so confirm links work on localhost too.
  function emailConfirmRedirect() {
    const host = global.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') {
      return global.location.origin + '/app/';
    }
    const fixed = (cfg.EMAIL_CONFIRM_REDIRECT || '').trim();
    if (fixed) return fixed;
    return (cfg.SITE_URL || global.location.origin).replace(/\/$/, '') + '/app/';
  }

  async function jsonOrThrow(res) {
    let body = null;
    try { body = await res.json(); } catch (e) {}
    if (!res.ok) {
      const msg = (body && (body.msg || body.error_description || body.message || body.error)) || ('HTTP ' + res.status);
      throw new Error(msg);
    }
    return body;
  }

  // ---- email + password ----
  // Create an account. If the project requires email confirmation, no session is
  // returned until the user confirms; otherwise we get tokens straight away.
  async function signUp(email, password) {
    if (!enabled()) throw new Error('Accounts are not configured.');
    const ref = (global.Finalyze.Referral && global.Finalyze.Referral.getRef && global.Finalyze.Referral.getRef()) || '';
    const payload = { email, password };
    if (ref) payload.data = { referred_by: ref };
    // GoTrue expects redirect_to on the query string (not the JSON body) for confirm links.
    const redirectTo = emailConfirmRedirect();
    const res = await fetch(
      authUrl('/signup') + '?redirect_to=' + encodeURIComponent(redirectTo),
      { method: 'POST', headers: baseHeaders(), body: JSON.stringify(payload) },
    );
    const body = await jsonOrThrow(res);
    if (body && body.access_token) {
      if (global.Finalyze.Referral && global.Finalyze.Referral.clearRef) global.Finalyze.Referral.clearRef();
      stash(body); notify();
      await touchLastLogin();
      return { signedIn: true };
    }
    if (global.Finalyze.Referral && global.Finalyze.Referral.clearRef) global.Finalyze.Referral.clearRef();
    return { signedIn: false, needsConfirmation: true };
  }

  // Sign in with email + password (GoTrue password grant).
  async function signIn(email, password) {
    if (!enabled()) throw new Error('Accounts are not configured.');
    const res = await fetch(authUrl('/token?grant_type=password'), {
      method: 'POST', headers: baseHeaders(),
      body: JSON.stringify({ email, password }),
    });
    const body = await jsonOrThrow(res);
    stash(body); notify();
    await touchLastLogin();
    return { signedIn: true };
  }

  // ---- OAuth (Google) ----
  // Returns the URL we tell Supabase to send the user back to after Google auth.
  // Same origin + path so it works on localhost and on the live site; this exact
  // URL must be in Supabase Auth → URL Configuration → Redirect URLs.
  function oauthRedirect() {
    return global.location.origin + global.location.pathname;
  }

  // Kick off the Google sign-in by navigating to Supabase's authorize endpoint.
  // GoTrue handles the Google handshake and redirects back with tokens in the
  // URL hash, which handleOAuthCallback() picks up on the next load.
  function signInWithGoogle() {
    if (!enabled()) throw new Error('Accounts are not configured.');
    const ref = (global.Finalyze.Referral && global.Finalyze.Referral.getRef && global.Finalyze.Referral.getRef()) || '';
    const params = new URLSearchParams({ provider: 'google', redirect_to: oauthRedirect() });
    // Pass the referral through so the signup trigger can read it (user_metadata).
    if (ref) params.set('redirect_to', oauthRedirect() + '?ref=' + encodeURIComponent(ref));
    global.location.href = authUrl('/authorize?' + params.toString());
  }

  // On load, if Supabase redirected back with tokens in the URL hash, stash the
  // session and clean the hash so tokens don't linger in the address bar.
  function handleOAuthCallback() {
    const hash = global.location.hash || '';
    if (hash.indexOf('access_token=') === -1) return false;
    const p = new URLSearchParams(hash.replace(/^#/, ''));
    const access_token = p.get('access_token');
    const refresh_token = p.get('refresh_token');
    if (!access_token) return false;
    stash({ access_token, refresh_token, expires_in: p.get('expires_in') });
    if (global.Finalyze.Referral && global.Finalyze.Referral.clearRef) global.Finalyze.Referral.clearRef();
    try {
      const clean = global.location.origin + global.location.pathname;
      global.history.replaceState(null, '', clean);
    } catch (e) {}
    return true;
  }

  async function signOut() {
    if (session && session.access_token) {
      try { await fetch(authUrl('/logout'), { method: 'POST', headers: authedHeaders() }); } catch (e) {}
    }
    saveSession(null);
    notify();
  }

  // ---- session handling ----
  function stash(tokens) {
    const expiresIn = Number(tokens.expires_in || 3600);
    saveSession({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: Date.now() + expiresIn * 1000,
      user: tokens.user || (session && session.user) || null,
    });
  }

  async function refresh() {
    if (!session || !session.refresh_token) return false;
    try {
      const res = await fetch(authUrl('/token?grant_type=refresh_token'), {
        method: 'POST', headers: baseHeaders(),
        body: JSON.stringify({ refresh_token: session.refresh_token }),
      });
      const body = await jsonOrThrow(res);
      stash(body);
      return true;
    } catch (e) { saveSession(null); return false; }
  }

  async function fetchUser() {
    if (!session || !session.access_token) return null;
    try {
      const res = await fetch(authUrl('/user'), { headers: authedHeaders() });
      if (res.status === 401) { if (await refresh()) return fetchUser(); return null; }
      const user = await jsonOrThrow(res);
      session.user = user; saveSession(session);
      return user;
    } catch (e) { return null; }
  }

  async function init() {
    if (!enabled()) return null;
    loadSession();
    // If we just came back from Google, the hash carries fresh tokens.
    if (handleOAuthCallback()) { await fetchUser(); await touchLastLogin(); notify(); return session && session.user; }
    if (session) {
      if (session.expires_at && Date.now() > session.expires_at - 60000) await refresh();
      await fetchUser();
    }
    notify();
    return session && session.user;
  }

  async function touchLastLogin() {
    if (!isSignedIn()) return null;
    try {
      const res = await fetch(restUrl('/rpc/touch_last_login'), {
        method: 'POST', headers: authedHeaders(), body: '{}',
      });
      return await jsonOrThrow(res);
    } catch (e) {
      return null;
    }
  }

  // ---- profile (non-sensitive account data only) ----
  async function getProfile() {
    if (!isSignedIn()) return null;
    const uid = session.user.id;
    const res = await fetch(restUrl('/profiles?select=*&id=eq.' + uid), { headers: authedHeaders() });
    const rows = await jsonOrThrow(res);
    return (rows && rows[0]) || null;
  }

  async function updateProfile(patch) {
    if (!isSignedIn()) throw new Error('Not signed in.');
    const allowed = ['country', 'currency', 'household_size', 'goals', 'onboarded'];
    const safe = {};
    for (const key of allowed) {
      if (patch && Object.prototype.hasOwnProperty.call(patch, key)) safe[key] = patch[key];
    }
    const row = Object.assign({ id: session.user.id, email: session.user.email }, safe);
    const res = await fetch(restUrl('/profiles'), {
      method: 'POST',
      headers: authedHeaders({ Prefer: 'resolution=merge-duplicates,return=representation' }),
      body: JSON.stringify(row),
    });
    const rows = await jsonOrThrow(res);
    return (rows && rows[0]) || row;
  }

  // Generate referral_code server-side if missing (existing users pre-migration).
  async function ensureReferralCode() {
    if (!isSignedIn()) return null;
    const res = await fetch(restUrl('/rpc/ensure_referral_code'), {
      method: 'POST', headers: authedHeaders(), body: '{}',
    });
    const body = await jsonOrThrow(res);
    return typeof body === 'string' ? body : (body && body.referral_code) || null;
  }

  // Submit beta feedback ticket (stored in public.tickets; Eastern date/time columns).
  async function submitTicket({ type, description, submitted_date, submitted_time }) {
    if (!isSignedIn()) throw new Error('Sign in to submit feedback.');
    type = (type || '').trim();
    description = (description || '').trim();
    if (!type) throw new Error('Choose a ticket type.');
    if (!description) throw new Error('Enter a description.');
    const row = {
      user_id: session.user.id,
      email: session.user.email || '',
      type,
      description,
      submitted_date,
      submitted_time,
    };
    const res = await fetch(restUrl('/tickets'), {
      method: 'POST',
      headers: authedHeaders({ Prefer: 'return=minimal' }),
      body: JSON.stringify(row),
    });
    if (!res.ok) {
      let body = null;
      try { body = await res.json(); } catch (e) {}
      const msg = (body && (body.message || body.error || body.hint)) || ('HTTP ' + res.status);
      throw new Error(msg);
    }
  }

  function isSignedIn() { return !!(session && session.user); }
  function user() { return session && session.user; }

  F.Auth = { init, enabled, isSignedIn, user, signUp, signIn, signInWithGoogle, signOut, getProfile, updateProfile, ensureReferralCode, submitTicket, onChange };
})(window);
