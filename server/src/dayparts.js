// Share of a day's (or a daypart's) sales normally earned by a given local hour. Used to
// compare live, current-day sales with the part of the forecast that should be in by now.
export const WINDOWS = { breakfast: [5, 11], lunch: [11, 16], dinner: [16, 22] };
const DEFAULT_MIX = { breakfast: 0.46, lunch: 0.27, dinner: 0.18, late_night: 0.09 };

export function earnedShare(daypart, hourNow) {
  if (daypart === "all") return Object.entries(DEFAULT_MIX).reduce((t, [dp, mix]) => t + mix * earnedShare(dp, hourNow), 0);
  if (daypart === "late_night") {
    const elapsed = Math.min(hourNow, 5) + Math.max(0, hourNow - 22);
    return Math.min(1, elapsed / 7);
  }
  const [start, end] = WINDOWS[daypart];
  return Math.min(1, Math.max(0, (hourNow - start) / (end - start)));
}

export function localHour(timezone) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone || "America/Chicago", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(new Date());
  const get = (t) => Number(parts.find((x) => x.type === t).value);
  return get("hour") + get("minute") / 60;
}

export function localDate(timezone) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone || "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
