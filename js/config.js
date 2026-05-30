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
    SUPABASE_URL: '',      // e.g. 'https://abcdefgh.supabase.co'
    SUPABASE_ANON_KEY: '', // the public "anon" key (safe to ship in the client)

    // Where the magic-link should send the user back to. Defaults to this page.
    get REDIRECT_URL() {
      return location.origin + location.pathname;
    },

    enabled() {
      return !!(this.SUPABASE_URL && this.SUPABASE_ANON_KEY);
    },
  };
})(window);
