export const fmt$ = (n) => {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "-";
  const v = Number(n);
  return `${v < 0 ? "-" : ""}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
};

export const fmt$signed = (n) => (n === null || n === undefined ? "-" : `${Number(n) > 0 ? "+" : ""}${fmt$(n)}`);

export const fmtPct = (n) => {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "-";
  const v = Number(n);
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
};

export const fmtNum = (n, digits = 0) =>
  (n === null || n === undefined ? "-" : Number(n).toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits }));

export const fmtHours = (n) => (n === null || n === undefined ? "-" : `${fmtNum(n)} hrs`);
export const fmtHoursSigned = (n) => (n === null || n === undefined ? "-" : `${Number(n) > 0 ? "+" : ""}${fmtNum(n)} hrs`);
export const fmtRating = (n) => (n === null || n === undefined ? "-" : Number(n).toFixed(1));
export const fmtTemp = (n) => (n === null || n === undefined ? "-" : `${Math.round(n)}°`);

const p2 = (n) => String(n).padStart(2, "0");
export const isoDate = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
export const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
export const weekStart = (day) => { const dow = new Date(`${day}T00:00:00Z`).getUTCDay(); return addDays(day, dow === 0 ? -6 : 1 - dow); };

export const prettyDay = (day, opts = { weekday: "short", month: "short", day: "numeric" }) =>
  (day ? new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { ...opts, timeZone: "UTC" }) : "");
export const prettyRange = (from, to) => (from === to ? prettyDay(from, { weekday: "long", month: "long", day: "numeric", year: "numeric" }) : `${prettyDay(from)} to ${prettyDay(to, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}`);
export const prettyTime = (iso) => (iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "never");

// For sales, above zero is good. For labor, above allowable is bad.
export const salesTone = (n) => (n === null || n === undefined ? "neutral" : Number(n) >= 0 ? "positive" : "negative");
export const laborTone = (n) => (n === null || n === undefined ? "neutral" : Number(n) <= 0 ? "positive" : "negative");
