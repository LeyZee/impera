// Jour before the first paint, if chosen in Réglages › Apparence (src/shell/appearance.ts keeps the same key).
// A file, not an inline script, so a Content-Security-Policy `script-src 'self'` needs no hash for it.
// The browser's bar follows the theme too (installed app on a phone): same colours as `THEME_COLORS` there.
// It also carries the device's choices over from the names they had before the rename (ADR 0062), once: the theme
// first, since it is read just below, then the followed creator, Suivi's order and the install refusals.
try {
  [
    ['nirvana.appearance', 'impera.appearance'], // ADR 0062
    ['nirvana.followed-creator', 'impera.followed-creator'], // ADR 0062
    ['nirvana.suivi.order', 'impera.suivi.order'], // ADR 0062
    ['nirvana.install.refusals', 'impera.install.refusals'], // ADR 0062
  ].forEach(function (pair) {
    var old = localStorage.getItem(pair[0]);
    if (old === null) return;
    if (localStorage.getItem(pair[1]) === null) localStorage.setItem(pair[1], old);
    localStorage.removeItem(pair[0]);
  });
} catch (e) {}
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
