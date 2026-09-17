// Hotspot logic. Simple, transparent rules (brief: "Initial Hotspot Logic"): rank stores on
// three variances, flag stores that land in more than one list, and surface the bottom
// share (15% by default). The system says where to look and shows context; it never
// states a cause that the data doesn't support.
import db, { getSetting } from "./db.js";
import { metrics, trailingGuest, restaurantFilter } from "./analytics.js";
import { comparableLastYear } from "./dates.js";
import { weatherContext } from "./weather.js";

export const UNUSUAL_DROP_PCT = -40; // "unusually large changes, such as sales down 60%"
// Critical needs both misses to be material, not just present.
export const CRITICAL_SALES_PCT = -8;
export const CRITICAL_LABOR_PCT = 8;
const FLAG_SALES_PCT = -5;
const FLAG_LABOR_PCT = 5;
const WEAK_GUEST_RATING = 4.0;
const MIN_SURVEYS = 5;

export const CATEGORIES = {
  overall: "All hotspots",
  sales_vs_forecast: "Sales vs. forecast",
  sales_vs_prior_year: "Sales vs. prior year",
  labor: "Labor vs. allowable",
  sales_and_labor: "Sales and labor misses",
  unusual_change: "Unusually large changes",
  operational: "Possible operational issue",
  guest: "Guest metrics",
};

const abs1 = (n) => Math.abs(n).toFixed(Math.abs(n) >= 10 ? 0 : 1);

function worst(rows, value, k, { descending = false, qualifies = () => true } = {}) {
  const ranked = rows.filter((r) => value(r) !== null && value(r) !== undefined)
    .sort((a, b) => (descending ? value(b) - value(a) : value(a) - value(b)));
  const rank = new Map(ranked.map((r, i) => [r.id, i + 1]));
  const list = new Set(ranked.filter(qualifies).slice(0, k).map((r) => r.id));
  return { rank, list, size: ranked.length };
}

function weatherByRestaurant(from, to, f) {
  const load = (a, b) => db.prepare(`
    SELECT w.restaurant_id AS id, COUNT(*) AS days, SUM(w.rain_flag) AS rain_days, SUM(w.thunderstorm_flag) AS thunderstorm_days,
      AVG(w.temperature_high) AS temperature_high, AVG(w.temperature_low) AS temperature_low,
      SUM(w.precipitation_amount) AS precipitation_amount, SUM(w.morning_precipitation) AS morning_precipitation,
      MAX(w.weather_description) AS weather_description, MAX(w.rain_flag) AS rain_flag, MAX(w.thunderstorm_flag) AS thunderstorm_flag
    FROM weather w JOIN restaurant r ON r.restaurant_id = w.restaurant_id
    WHERE w.date BETWEEN ? AND ?${f.sql} GROUP BY w.restaurant_id`).all(a, b, ...f.params);
  const single = from === to;
  // For a single day use that day's own description rather than an aggregate.
  const describe = (a) => (single ? db.prepare(`SELECT w.restaurant_id AS id, w.weather_description FROM weather w JOIN restaurant r ON r.restaurant_id = w.restaurant_id WHERE w.date = ?${f.sql}`).all(a, ...f.params) : []);
  const toMap = (rows, desc) => {
    const d = new Map(desc.map((x) => [x.id, x.weather_description]));
    return new Map(rows.map((r) => [r.id, { ...r, weather_description: single ? d.get(r.id) : (r.thunderstorm_days ? `${r.rain_days} rain days, ${r.thunderstorm_days} with thunderstorms` : r.rain_days ? `${r.rain_days} rain days` : "Dry") }]));
  };
  return {
    current: toMap(load(from, to), describe(from)),
    lastYear: toMap(load(comparableLastYear(from), comparableLastYear(to)), describe(comparableLastYear(from))),
  };
}

function rangeWeatherContext(cur, ly) {
  if (!cur || !ly) return null;
  if (cur.rain_days === ly.rain_days) return null;
  return `${cur.rain_days} rain day${cur.rain_days === 1 ? "" : "s"} this period vs. ${ly.rain_days} on the comparable days last year. Weather may be a contributing context factor.`;
}

function buildFlags(s, single) {
  const flags = [];
  if (s.sales_variance_pct !== null && s.sales_variance_pct <= FLAG_SALES_PCT) flags.push(`Sales down ${abs1(s.sales_variance_pct)}% vs. forecast`);
  if (s.prior_year_variance_pct !== null && s.prior_year_variance_pct <= FLAG_SALES_PCT) flags.push(`Sales down ${abs1(s.prior_year_variance_pct)}% vs. prior year`);
  if (s.labor_variance_pct !== null && s.labor_variance_pct >= FLAG_LABOR_PCT) flags.push(`Labor ${abs1(s.labor_variance_pct)}% above allowable hours`);
  if (s.opening_issues > 0) flags.push(single ? "Possible opening-time issue: needs review" : `Possible opening-time issue on ${s.opening_issues} day${s.opening_issues === 1 ? "" : "s"}: needs review`);
  if (s.guest.average_rating !== null && s.guest.survey_count >= MIN_SURVEYS && s.guest.average_rating < WEAK_GUEST_RATING) {
    flags.push(`Guest rating ${s.guest.average_rating.toFixed(1)} across ${s.guest.survey_count} surveys (trailing 7 days)`);
  } else if (s.guest.survey_count < MIN_SURVEYS && s.guest.google_rating !== null && s.guest.google_review_count >= MIN_SURVEYS && s.guest.google_rating < WEAK_GUEST_RATING) {
    flags.push(`Review rating ${s.guest.google_rating.toFixed(1)} across ${s.guest.google_review_count} reviews (trailing 7 days)`);
  }
  return flags;
}

// Weather sits beside the flags as context; it is never listed as a reason.
function weatherNote(s, single) {
  return single ? weatherContext(s.weather.current, s.weather.lastYear) : rangeWeatherContext(s.weather.current, s.weather.lastYear);
}

/**
 * Hotspots for a date or date range. filters: { regionId, areaId }.
 * Returns every store's evaluation (so callers can count hotspots per region / area)
 * plus the ranked hotspot and positive-outlier lists.
 */
export function evaluateHotspots(user, opts) {
  // A single restaurant can't be ranked against itself: rank a store-level user's
  // restaurant among its area, then hand back only their own row.
  if (user?.role === "store") {
    const areaId = db.prepare("SELECT area_id FROM restaurant WHERE restaurant_id = ?").get(user.scope_id)?.area_id;
    const area = evaluateHotspotsFor({ role: "area", scope_id: areaId }, { ...opts, filters: {} });
    const own = (list) => list.filter((s) => s.id === user.scope_id);
    return { ...area, restaurants: 1, evaluated: own(area.evaluated), hotspots: own(area.hotspots), watch: own(area.watch), positives: own(area.positives) };
  }
  return evaluateHotspotsFor(user, opts);
}

function evaluateHotspotsFor(user, { from, to, daypart = "all", filters = {} }) {
  const share =Number(getSetting("hotspot_share")) || 0.15;
  const f = restaurantFilter(user, filters);
  const stores = metrics(user, { from, to, daypart, groupBy: "store", filters });
  const k = Math.max(1, Math.ceil(stores.length * share));
  const single = from === to;

  const guestRows = new Map(trailingGuest(user, to, filters).map((g) => [g.id, g]));
  const wx = weatherByRestaurant(from, to, f);

  const vsForecast = worst(stores, (s) => s.sales_variance_pct, k, { qualifies: (s) => s.sales_variance_pct < 0 });
  const vsPriorYear = worst(stores, (s) => s.prior_year_variance_pct, k, { qualifies: (s) => s.prior_year_variance_pct < 0 });
  const labor = worst(stores, (s) => s.labor_variance_pct, k, { descending: true, qualifies: (s) => s.labor_variance_pct > 0 });
  // Survey scores when the guest platform supplies them, otherwise review ratings (Merchant Centric STARS / Google).
  const guestPool = stores.map((s) => {
    const g = guestRows.get(s.id);
    const useSurveys = (g?.survey_count ?? 0) >= MIN_SURVEYS && g?.average_rating !== null && g?.average_rating !== undefined;
    return { id: s.id, rating: useSurveys ? g.average_rating : g?.google_rating ?? null, surveys: useSurveys ? g.survey_count : g?.google_review_count ?? 0 };
  });
  const guest = worst(guestPool.filter((g) => g.surveys >= MIN_SURVEYS), (g) => g.rating, k, { qualifies: (g) => g.rating < WEAK_GUEST_RATING + 0.2 });

  const evaluated = stores.map((s) => {
    const g = guestRows.get(s.id);
    const lists = [];
    if (vsForecast.list.has(s.id)) lists.push("sales_vs_forecast");
    if (vsPriorYear.list.has(s.id)) lists.push("sales_vs_prior_year");
    if (labor.list.has(s.id)) lists.push("labor");
    const salesMiss = lists.includes("sales_vs_forecast") || lists.includes("sales_vs_prior_year");
    if (salesMiss && lists.includes("labor")) lists.push("sales_and_labor");
    const unusual = (s.sales_variance_pct !== null && s.sales_variance_pct <= UNUSUAL_DROP_PCT) || (s.prior_year_variance_pct !== null && s.prior_year_variance_pct <= UNUSUAL_DROP_PCT);
    if (unusual) lists.push("unusual_change");
    if (s.opening_issues > 0) lists.push("operational");
    if (guest.list.has(s.id)) lists.push("guest");
    // Rank sum: 1 = worst in each list, so the smallest total is the store to look at first.
    const rankSum = (vsForecast.rank.get(s.id) ?? vsForecast.size) + (vsPriorYear.rank.get(s.id) ?? vsPriorYear.size) + (labor.rank.get(s.id) ?? labor.size);
    return {
      ...s,
      guest: {
        survey_count: g?.survey_count ?? 0,
        average_rating: g?.average_rating === null || g?.average_rating === undefined ? null : Math.round(g.average_rating * 100) / 100,
        google_review_count: g?.google_review_count ?? 0,
        google_rating: g?.google_rating === null || g?.google_rating === undefined ? null : Math.round(g.google_rating * 100) / 100,
      },
      weather: { current: wx.current.get(s.id) || null, lastYear: wx.lastYear.get(s.id) || null },
      lists, rankSum, unusual,
      ranks: { sales_vs_forecast: vsForecast.rank.get(s.id) ?? null, sales_vs_prior_year: vsPriorYear.rank.get(s.id) ?? null, labor: labor.rank.get(s.id) ?? null },
    };
  });

  // Overall bottom share: unusual drops and possible operational issues always make the
  // list; the remaining places go to the worst rank sums among stores with a real miss.
  const forced = evaluated.filter((s) => s.unusual || s.lists.includes("operational"));
  const forcedIds = new Set(forced.map((s) => s.id));
  const hasMiss = (s) => s.lists.some((l) => ["sales_vs_forecast", "sales_vs_prior_year", "labor"].includes(l));
  const byRankSum = evaluated.filter((s) => !forcedIds.has(s.id) && hasMiss(s)).sort((a, b) => a.rankSum - b.rankSum);
  const overallIds = new Set([...forcedIds, ...byRankSum.slice(0, Math.max(0, k - forced.length)).map((s) => s.id)]);

  const positive = worst(stores, (s) => s.sales_variance_pct, k, { descending: true, qualifies: (s) => s.sales_variance_pct > 0 });

  for (const s of evaluated) {
    s.is_hotspot = overallIds.has(s.id);
    const worstSales = Math.min(s.sales_variance_pct ?? 0, s.prior_year_variance_pct ?? 0);
    const bothMaterial = s.lists.includes("sales_and_labor") && worstSales <= CRITICAL_SALES_PCT && (s.labor_variance_pct ?? 0) >= CRITICAL_LABOR_PCT;
    if (s.is_hotspot && (s.unusual || bothMaterial)) s.severity = "critical";
    else if (s.is_hotspot) s.severity = "needs_review";
    else if (s.lists.length) s.severity = "watch";
    else if (positive.list.has(s.id)) s.severity = "positive_outlier";
    else s.severity = null;
    s.flags = buildFlags(s, single);
    s.weather_note = weatherNote(s, single);
  }

  const severityOrder = { critical: 0, needs_review: 1, watch: 2 };
  const hotspots = evaluated.filter((s) => s.is_hotspot).sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity] || a.rankSum - b.rankSum);
  const watch = evaluated.filter((s) => s.severity === "watch").sort((a, b) => a.rankSum - b.rankSum);
  const positives = evaluated.filter((s) => positive.list.has(s.id)).sort((a, b) => b.sales_variance_pct - a.sales_variance_pct)
    .map((s) => ({ ...s, flags: [`Sales up ${abs1(s.sales_variance_pct)}% vs. forecast`, ...(s.prior_year_variance_pct > 0 ? [`Sales up ${abs1(s.prior_year_variance_pct)}% vs. prior year`] : [])] }));

  return { from, to, daypart, share, restaurants: stores.length, listSize: k, evaluated, hotspots, watch, positives };
}

export function hotspotsByCategory(result, category) {
  if (!category || category === "overall") return result.hotspots;
  const sorters = {
    sales_vs_forecast: (a, b) => a.sales_variance_pct - b.sales_variance_pct,
    sales_vs_prior_year: (a, b) => a.prior_year_variance_pct - b.prior_year_variance_pct,
    labor: (a, b) => b.labor_variance_pct - a.labor_variance_pct,
    guest: (a, b) => (a.guest.average_rating ?? 9) - (b.guest.average_rating ?? 9),
  };
  return result.evaluated.filter((s) => s.lists.includes(category)).sort(sorters[category] || ((a, b) => a.rankSum - b.rankSum));
}

export function hotspotCounts(result, key) {
  const counts = new Map();
  for (const s of result.hotspots) counts.set(s[key], (counts.get(s[key]) || 0) + 1);
  return counts;
}
