// Jour before the first paint, if chosen in Réglages › Apparence (src/shell/appearance.ts keeps the same key).
// A file, not an inline script, so a Content-Security-Policy `script-src 'self'` needs no hash for it.
// The browser's bar follows the theme too (installed app on a phone): same colours as `THEME_COLORS` there.
try {
  var appearance = localStorage.getItem('impera.appearance');
  if (
    appearance === 'day' ||
    (appearance === 'device' && matchMedia('(prefers-color-scheme: light)').matches)
  ) {
    document.documentElement.dataset.theme = 'light';
    var bar = document.querySelector('meta[name="theme-color"]');
    if (bar) bar.setAttribute('content', '#f6f1f3');
  }
} catch (e) {}
