// Applica il tema prima del primo disegno, per evitare il lampo di colore sbagliato
try {
  var p = JSON.parse(localStorage.getItem('kanban.prefs') || '{}');
  var t = p.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = t;
  var d = { text: 'normal', contrast: 'normal', motion: 'system', focus: 'normal' };
  for (var k in d) document.documentElement.dataset[k] = p[k] || d[k];
} catch (e) {}
