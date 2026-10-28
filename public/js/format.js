const pad = (n) => String(n).padStart(2, '0');

// data di oggi in ora locale (toISOString è in UTC: di sera sbaglierebbe giorno)
export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// '2026-10-28' -> '28/10/2026'
export function formatDate(date) {
  if (!date) return '';
  const [y, m, d] = date.split('-');
  return `${d}/${m}/${y}`;
}

const shortDate = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short' });

// '2026-10-28' -> '28 ott'
export function formatShortDate(date) {
  if (!date) return '';
  const [y, m, d] = date.split('-').map(Number);
  return shortDate.format(new Date(y, m - 1, d)).replace('.', '');
}

// '09:00', '10:30' -> '09:00–10:30'
export function formatTimeRange(start, end) {
  return `${start}–${end}`;
}

const dateTime = new Intl.DateTimeFormat('it-IT', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

// '2026-10-23T14:05:00Z' -> '23/10/2026, 16:05' (ora locale)
export function formatDateTime(iso) {
  return iso ? dateTime.format(new Date(iso)) : '';
}

// "3 min fa", "2 h fa", "ieri", oppure la data per le cose più vecchie
export function formatRelative(iso) {
  if (!iso) return '';
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 45) return 'adesso';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min fa`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h fa`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'ieri';
  if (days < 7) return `${days} giorni fa`;
  return formatDateTime(iso);
}

export function isToday(date) {
  return date === todayISO();
}

// scaduta = non completata e già finita
export function isOverdue(task) {
  if (task.isDone) return false;
  const today = todayISO();
  if (task.date < today) return true;
  if (task.date > today) return false;
  const now = new Date();
  return task.endTime < `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

// lunedì della settimana che contiene la data (le settimane italiane iniziano di lunedì)
export function startOfWeek(date) {
  const [y, m, d] = date.split('-').map(Number);
  const day = new Date(y, m - 1, d);
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}

export function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const day = new Date(y, m - 1, d + n);
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}
