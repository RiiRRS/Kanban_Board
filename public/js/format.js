// SEGNAPOSTO

export const todayISO = () => new Date().toISOString().slice(0, 10);
export const formatDate = (d) => d;
export const formatShortDate = (d) => d;
export const formatTimeRange = (start, end) => `${start}–${end}`;
export const formatDateTime = (iso) => iso;
export const isToday = (d) => d === todayISO();
export const isOverdue = (task) => false;
