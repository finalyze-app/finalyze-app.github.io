// Finalyze backend configuration.
//
// The ONLY server Finalyze talks to is Supabase, and ONLY for:
//   - email capture + magic-link sign-in
//   - license / referral status
//   - feature unlocks
//   - non-sensitive app settings (country, currency, goals, household size)
//
// Your financial transactions NEVER touch this server. They stay in IndexedDB
// on this device, exactly as before. If these values are left blank, the whole
// account layer silently disables itself and Finalyze runs 100% locally.
//
// To enable accounts: create a Supabase project, then paste its Project URL and
// anon/public key below. See SUPABASE_SETUP.md for the one-time SQL setup.

(function (global) {
  global.Finalyze = global.Finalyze || {};
  global.Finalyze.config = {
    SUPABASE_URL: 'https://pdanbjmzynsyukfhoftw.supabase.co',      // e.g. 'https://abcdefgh.supabase.co'
    SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBkYW5iam16eW5zeXVrZmhvZnR3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxNzgyODksImV4cCI6MjA5NTc1NDI4OX0.mRR2F_rRjpTee8u2G10PK3i-ZFGR3vA6Qm_SCNsGC-w', // the public "anon" key (safe to ship in the client)

    // Stripe Customer Portal login link (Stripe → Settings → Billing → Customer
    // portal → "Get a link"). Powers the "Manage subscription" button (cancel /
    // switch monthly↔annual). Leave blank to hide that button.
    STRIPE_PORTAL_URL: '',

    // Where the magic-link should send the user back to. Defaults to this page.
    get REDIRECT_URL() {
      return location.origin + location.pathname;
    },

    enabled() {
      return !!(this.SUPABASE_URL && this.SUPABASE_ANON_KEY);
    },
  };
})(window);
