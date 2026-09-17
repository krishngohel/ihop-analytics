// Shared period/date-range math used by index.js, report.js, and opportunities.js
// so "what counts as the prior period" can't drift between them.

export function periodDays(fromDay, toDay) {
  return Math.max(1, Math.round((Date.parse(toDay) - Date.parse(fromDay)) / 864e5) + 1);
}

export function priorPeriod(fromDay, toDay) {
  const days = periodDays(fromDay, toDay);
  const prevToDay = new Date(Date.parse(fromDay) - 864e5).toISOString().slice(0, 10);
  const prevFromDay = new Date(Date.parse(fromDay) - days * 864e5).toISOString().slice(0, 10);
  return { fromDay: prevFromDay, toDay: prevToDay, days };
}

export function pctChange(cur, prev) {
  return prev > 0 ? +(((cur - prev) / prev) * 100).toFixed(1) : null;
}

export function toRange(fromDay, toDay) {
  return { from: `${fromDay}T00:00:00`, to: `${toDay}T23:59:59` };
}

export function round2(n) {
  return +(Number(n) || 0).toFixed(2);
}

// Store-local wall-clock timestamp ("2026-09-16T08:30:00", no Z). The SQL buckets days
// and dayparts by reading substrings of sold_at, so it must hold the time on the
// store's clock. toISOString() would shift it to UTC and file breakfast under lunch.
export function toLocalIso(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
