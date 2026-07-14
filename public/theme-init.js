// Stamps data-theme on <html> BEFORE first paint.
//
// Without this, every night-time load flashes a full white screen for a frame while
// the module bundle boots — which is precisely the thing dark mode exists to prevent.
//
// It is a separate file rather than an inline <script> on purpose: our CSP is
// `script-src 'self'`, which blocks inline scripts. A same-origin file is allowed, and
// costs nothing extra in practice (a few hundred bytes, cached).
//
// It is loaded WITHOUT defer/async so it blocks parsing and runs before the body paints.
// Keep it dependency-free and synchronous. Duplicated logic with src/theme.js is
// intentional and unavoidable — this must run before any module loads.
(function () {
  try {
    var mode = localStorage.getItem('ht_theme');
    if (mode !== 'light' && mode !== 'dark' && mode !== 'auto') mode = 'auto';
    var dark = mode === 'dark' ||
      (mode === 'auto' && window.matchMedia &&
       window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'light');
  }
})();
