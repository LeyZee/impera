// Jour before the first paint, if chosen in Réglages › Apparence (src/shell/appearance.ts keeps the same key).
// A file, not an inline script, so a Content-Security-Policy `script-src 'self'` needs no hash for it.
try {
  var appearance = localStorage.getItem('nirvana.appearance');
  if (
    appearance === 'day' ||
    (appearance === 'device' && matchMedia('(prefers-color-scheme: light)').matches)
  ) {
    document.documentElement.dataset.theme = 'light';
  }
} catch (e) {}
