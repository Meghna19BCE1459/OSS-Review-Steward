// Applies saved display preferences before first paint (loaded synchronously in <head>).
try {
  var p = JSON.parse(localStorage.getItem('ossrs.prefs.v1') || '{}');
  if (p.theme === 'light' || p.theme === 'dark') document.documentElement.dataset.theme = p.theme;
  if (p.text === 'lg' || p.text === 'xl') document.documentElement.dataset.text = p.text;
} catch (e) {}
