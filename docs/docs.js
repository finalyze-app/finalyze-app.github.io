(function () {
  try {
    document.documentElement.dataset.theme = localStorage.getItem('finalyze.theme') || 'light';
  } catch (e) {
    document.documentElement.dataset.theme = 'light';
  }

  var SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  var MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';

  var themeBtn = document.getElementById('themeToggle');
  function syncTheme() {
    var dark = document.documentElement.dataset.theme === 'dark';
    if (themeBtn) themeBtn.innerHTML = dark ? SUN : MOON;
  }
  syncTheme();
  if (themeBtn) {
    themeBtn.onclick = function () {
      var next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem('finalyze.theme', next); } catch (e) {}
      syncTheme();
    };
  }

  var side = document.querySelector('.docs-side');
  var overlay = document.getElementById('docsOverlay');
  var menuBtn = document.getElementById('menuBtn');
  function closeMenu() {
    if (side) side.classList.remove('open');
    if (overlay) overlay.classList.remove('show');
  }
  if (menuBtn && side) {
    menuBtn.onclick = function () {
      side.classList.toggle('open');
      if (overlay) overlay.classList.toggle('show', side.classList.contains('open'));
    };
  }
  if (overlay) overlay.onclick = closeMenu;
  document.querySelectorAll('.docs-side a').forEach(function (a) {
    a.addEventListener('click', closeMenu);
  });

  var links = [].slice.call(document.querySelectorAll('.nav-group a[href^="#"]'));
  if (!links.length || !('IntersectionObserver' in window)) return;

  var obs = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (!en.isIntersecting) return;
      var id = en.target.id;
      links.forEach(function (a) {
        a.classList.toggle('active', a.getAttribute('href') === '#' + id);
      });
    });
  }, { rootMargin: '-30% 0px -55% 0px', threshold: 0 });

  links.forEach(function (a) {
    var id = (a.getAttribute('href') || '').slice(1);
    var el = id && document.getElementById(id);
    if (el) obs.observe(el);
  });
})();
