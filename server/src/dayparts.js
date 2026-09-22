// Share of a day's (or a daypart's) sales normally earned by a given local hour, used to
// compare live, current-day sales with the part of the forecast that should be in by now.
//
// Sales don't arrive evenly across a daypart — a linear model over-counts a half-finished
// breakfast, so at 9:45am it expected ~79% of breakfast in when a diner's rush is really 7-10
// and only ~2/3 is done, which made every store look far behind all morning. Instead this uses
// a realistic hourly shape for a 24-hour diner: an overnight trough, a strong 7-10am breakfast,
// a noon lunch peak and a 6-7pm dinner bump. HOURLY_WEIGHTS[h] is the fraction of the full
// day's sales booked in clock hour h (0 = midnight). It sums to 1, and each daypart's hours
// sum to that daypart's share of the day (breakfast .46, lunch .27, dinner .18, late .09), so
// the whole-day and per-daypart curves stay consistent with each other.
const HOURLY_WEIGHTS = [
  /* 12a */ 0.0144, /* 1a */ 0.0126, /* 2a */ 0.0108, /* 3a */ 0.0099, /* 4a */ 0.0081,
  /* 5a */ 0.0184, /* 6a */ 0.0414, /* 7a */ 0.0736, /* 8a */ 0.1012, /* 9a */ 0.1104, /* 10a */ 0.1150,
  /* 11a */ 0.0594, /* 12p */ 0.0756, /* 1p */ 0.0594, /* 2p */ 0.0405, /* 3p */ 0.0351,
  /* 4p */ 0.0216, /* 5p */ 0.0324, /* 6p */ 0.0396, /* 7p */ 0.0360, /* 8p */ 0.0270, /* 9p */ 0.0234,
  /* 10p */ 0.0180, /* 11p */ 0.0162,
];
// Which clock hours make up each daypart (late night wraps midnight: 10pm-5am).
const DAYPART_HOURS = {
  breakfast: [5, 6, 7, 8, 9, 10],
  lunch: [11, 12, 13, 14, 15],
  dinner: [16, 17, 18, 19, 20, 21],
  late_night: [22, 23, 0, 1, 2, 3, 4],
};

// How much of clock hour `hr` has elapsed by `hourNow` (0..1), on a midnight-based business day.
const hourElapsed = (hr, hourNow) => Math.max(0, Math.min(1, hourNow - hr));

export function earnedShare(daypart, hourNow) {
  if (daypart === "all") {
    let sum = 0;
    for (let hr = 0; hr < 24; hr++) sum += hourElapsed(hr, hourNow) * HOURLY_WEIGHTS[hr];
    return Math.min(1, sum);
  }
  const hours = DAYPART_HOURS[daypart];
  if (!hours) return 0;
  const total = hours.reduce((t, hr) => t + HOURLY_WEIGHTS[hr], 0);
  if (!total) return 0;
  // Overnight hours (0-4) of a late-night daypart are already complete by the morning; future
  // hours count as 0; the current hour counts fractionally.
  const earned = hours.reduce((t, hr) => t + hourElapsed(hr, hourNow) * HOURLY_WEIGHTS[hr], 0);
  return Math.min(1, earned / total);
}

export function localHour(timezone) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone || "America/Chicago", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(new Date());
  const get = (t) => Number(parts.find((x) => x.type === t).value);
  return get("hour") + get("minute") / 60;
}

export function localDate(timezone) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone || "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
