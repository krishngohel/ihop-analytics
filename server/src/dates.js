// Business-date math. Dates are plain "YYYY-MM-DD" strings on the restaurant's calendar;
// arithmetic goes through UTC midnight so daylight-saving changes can't shift a day.
import { getSetting } from "./db.js";

const p2 = (n) => String(n).padStart(2, "0");

export function isoDate(d) {
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

export const today = () => isoDate(new Date());

export function addDays(day, n) {
  const d = new Date(Date.parse(`${day}T00:00:00Z`) + n * 864e5);
  return d.toISOString().slice(0, 10);
}

export const yesterday = () => addDays(today(), -1);

export function daysBetween(fromDay, toDay) {
  return Math.round((Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`)) / 864e5);
}

export function dayOfWeek(day) {
  return new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 = Sunday
}

// Restaurants compare against the same weekday a year ago (52 weeks back), not the
// same calendar date, so a Saturday is never compared with a Friday.
export const comparableLastYear = (day) => addDays(day, -364);

export function weekStart(day) {
  const dow = dayOfWeek(day);
  return addDays(day, dow === 0 ? -6 : 1 - dow); // Monday
}

export function eachDay(fromDay, toDay) {
  const out = [];
  for (let d = fromDay; d <= toDay; d = addDays(d, 1)) out.push(d);
  return out;
}

// 4-week fiscal periods counted from the configured fiscal-year start (a Monday).
export function fiscalPeriod(day) {
  let start = getSetting("fiscal_year_start");
  while (daysBetween(start, day) < 0) start = addDays(start, -364);
  while (daysBetween(start, day) >= 364) start = addDays(start, 364);
  const index = Math.floor(daysBetween(start, day) / 28);
  const from = addDays(start, index * 28);
  return { number: index + 1, from, to: addDays(from, 27), fiscalYearStart: start };
}

export function prettyDate(day) {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export const isDay = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
