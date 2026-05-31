// Shared HTML escaping for safe innerHTML / attribute interpolation.
(function (global) {
  const MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => MAP[c]);
  }

  global.Finalyze = global.Finalyze || {};
  global.Finalyze.escapeHtml = escapeHtml;
})(window);
