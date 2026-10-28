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

export function isToday(date) {
  return date === todayISO();
}

// scaduta = non fatta e già finita
export function isOverdue(task) {
  if (task.status === 'done') return false;
  const today = todayISO();
  if (task.date < today) return true;
  if (task.date > today) return false;
  const now = new Date();
  return task.endTime < `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}
