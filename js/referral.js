// Finalyze — referral link capture (?ref=CODE) and signup propagation.
(function (global) {
  const F = (global.Finalyze = global.Finalyze || {});
  const KEY = 'finalyze.ref';

  function normalize(code) {
    return String(code || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
  }

  function captureFromUrl() {
    try {
      const ref = normalize(new URLSearchParams(location.search).get('ref'));
      if (ref) sessionStorage.setItem(KEY, ref);
    } catch (e) {}
  }

  function getRef() {
    try { return sessionStorage.getItem(KEY) || ''; } catch (e) { return ''; }
  }

  function clearRef() {
    try { sessionStorage.removeItem(KEY); } catch (e) {}
  }

  function appendRef(href) {
    const ref = getRef();
    if (!ref) return href;
    const sep = href.includes('?') ? '&' : '?';
    return href + sep + 'ref=' + encodeURIComponent(ref);
  }

  function shareUrl(code) {
    const base = (F.config && F.config.SITE_URL) || location.origin + location.pathname.replace(/[^/]*$/, '');
    const root = String(base).replace(/\/$/, '') + '/';
    return root + '?ref=' + encodeURIComponent(code || '');
  }

  captureFromUrl();

  F.Referral = { getRef, clearRef, appendRef, shareUrl, captureFromUrl };
})(window);
