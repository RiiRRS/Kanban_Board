// Applica il tema prima del primo disegno, per evitare il lampo di colore sbagliato
try {
  var p = JSON.parse(localStorage.getItem('kanban.prefs') || '{}');
  var t = p.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = t;
} catch (e) {}
