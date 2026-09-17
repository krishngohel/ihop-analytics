// Weekly forecasting form. The point is not data collection: a manager has to reconcile
// the system forecast with the recent trend, and show that the labor schedule fits the
// sales they are projecting. Store inputs roll up to area and region.
import db, { getSetting } from "./db.js";
import { restaurantFilter } from "./analytics.js";
import { addDays, weekStart, today, comparableLastYear } from "./dates.js";
import { demoWeekOutlook } from "./sources/demo.js";

const ADJUSTMENT_GAP_PCT = 3; // system forecast vs. trend-implied forecast gap that demands a decision
const ACCEPTED_AS_IS_PCT = 0.5; // manager forecast this close to the system number counts as "accepted unchanged"
const FORECAST_OUTLIER_PCT = 10;
const SCHEDULE_OVER_PCT = 3;
const SCHEDULE_UNDER_PCT = -8;
const LABOR_PCT_HIGH = 36;

const r0 = (n) => (n === null || n === undefined ? null : Math.round(n));
const r1 = (n) => (n === null || n === undefined ? null : Math.round(n * 10) / 10);
const pctOf = (a, b) => (b ? r1(((a - b) / b) * 100) : null);

export const nextWeekStart = () => addDays(weekStart(today()), 7);

export function guideHours(weeklySales) {
  if (weeklySales === null || weeklySales === undefined) return null;
  return 7 * Number(getSetting("labor_guide_fixed_daily_hours")) + weeklySales / Number(getSetting("labor_guide_sales_per_hour"));
}

function recentTrend(restaurantId, beforeDay) {
  const row = db.prepare(`SELECT SUM(actual_sales) a, SUM(prior_year_sales) p FROM daily_performance
    WHERE restaurant_id = ? AND daypart = 'all' AND is_final = 1 AND prior_year_sales IS NOT NULL AND date BETWEEN ? AND ?`)
    .get(restaurantId, addDays(beforeDay, -28), addDays(beforeDay, -1));
  return row?.p ? ((row.a - row.p) / row.p) * 100 : null;
}

/** Last-year sales and the system forecast for a week, from imported data when it exists. */
function systemNumbers(restaurant, week) {
  const end = addDays(week, 6);
  const onFile = db.prepare(`SELECT COUNT(*) n, SUM(forecast_sales) f, SUM(prior_year_sales) p FROM daily_performance
    WHERE restaurant_id = ? AND daypart = 'all' AND date BETWEEN ? AND ?`).get(restaurant.restaurant_id, week, end);
  if (onFile.n === 7 && onFile.f) return { system_forecast: onFile.f, last_year_sales: onFile.p };
  const lastYear = db.prepare(`SELECT COUNT(*) n, SUM(actual_sales) a FROM daily_performance
    WHERE restaurant_id = ? AND daypart = 'all' AND is_final = 1 AND date BETWEEN ? AND ?`)
    .get(restaurant.restaurant_id, comparableLastYear(week), comparableLastYear(end));
  if (restaurant.is_demo) return demoWeekOutlook(restaurant, week);
  return { system_forecast: null, last_year_sales: lastYear.n === 7 ? lastYear.a : null };
}

function evaluate(row, rate) {
  const trendImplied = row.last_year_sales !== null && row.recent_trend !== null ? row.last_year_sales * (1 + row.recent_trend / 100) : null;
  const systemVsTrend = trendImplied && row.system_forecast ? pctOf(row.system_forecast, trendImplied) : null;
  const adjustmentExpected = systemVsTrend !== null && Math.abs(systemVsTrend) > ADJUSTMENT_GAP_PCT;
  const mf = row.manager_forecast;
  const vsSystem = mf && row.system_forecast ? pctOf(mf, row.system_forecast) : null;
  const acceptedAsIs = vsSystem !== null && Math.abs(vsSystem) <= ACCEPTED_AS_IS_PCT;
  const allowable = row.allowable_hours ?? (mf ? guideHours(mf) + (row.manager_hours || 0) : null);
  const totalScheduled = row.scheduled_hours !== null && row.scheduled_hours !== undefined ? row.scheduled_hours + (row.manager_hours || 0) : null;
  const laborVariance = totalScheduled !== null && allowable ? totalScheduled - allowable : null;
  const laborVariancePct = laborVariance !== null ? r1((laborVariance / allowable) * 100) : null;
  const laborPct = totalScheduled !== null && mf ? r1(((totalScheduled * rate) / mf) * 100) : null;
  const hasReason = Boolean(row.forecast_adjustment_reason && row.forecast_adjustment_reason.trim().length >= 8);

  const problems = [];
  if (!mf) problems.push("Projected sales forecast is required");
  if (row.scheduled_hours === null || row.scheduled_hours === undefined) problems.push("Scheduled labor hours are required");
  if (row.manager_hours === null || row.manager_hours === undefined) problems.push("Manager hours are required");
  if (mf && !acceptedAsIs && !hasReason) problems.push("Give a reason for adjusting the system forecast");
  if (mf && acceptedAsIs && adjustmentExpected && !hasReason) {
    problems.push(`Recent trend points ${systemVsTrend > 0 ? "below" : "above"} the system forecast by ${Math.abs(systemVsTrend)}%. Adjust the forecast or explain why the system number still holds`);
  }

  const flags = [];
  if (mf && trendImplied && Math.abs(pctOf(mf, trendImplied)) > FORECAST_OUTLIER_PCT) flags.push(`Forecast is ${Math.abs(pctOf(mf, trendImplied))}% ${mf > trendImplied ? "above" : "below"} what the recent trend implies`);
  if (laborVariancePct !== null && laborVariancePct > SCHEDULE_OVER_PCT) flags.push(`Scheduled ${laborVariancePct}% above allowable hours for the projected sales`);
  if (laborVariancePct !== null && laborVariancePct < SCHEDULE_UNDER_PCT) flags.push(`Scheduled ${Math.abs(laborVariancePct)}% under allowable hours. Check the schedule can cover projected sales`);
  if (laborPct !== null && laborPct > LABOR_PCT_HIGH) flags.push(`Labor at ${laborPct}% of projected sales`);

  const started = Boolean(mf || row.scheduled_hours || row.forecast_adjustment_reason || row.notes);
  const status = row.submitted_at ? "submitted" : started ? "incomplete" : "missing";
  return {
    trend_implied_forecast: r0(trendImplied), system_vs_trend_pct: systemVsTrend, adjustment_expected: adjustmentExpected,
    projected_vs_last_year_pct: mf && row.last_year_sales ? pctOf(mf, row.last_year_sales) : null,
    projected_vs_system_pct: vsSystem,
    total_allowable_hours: r1(allowable), total_scheduled_hours: r1(totalScheduled),
    labor_variance: r1(laborVariance), labor_variance_pct: laborVariancePct, labor_pct: laborPct,
    problems, flags, status,
  };
}

function loadRows(user, week, filters) {
  const f = restaurantFilter(user, filters);
  const restaurants = db.prepare(`
    SELECT r.*, a.area_name, a.area_manager, g.region_name FROM restaurant r
    JOIN area a ON a.area_id = r.area_id JOIN region g ON g.region_id = r.region_id
    WHERE 1 = 1${f.sql} ORDER BY g.region_name, a.area_name, r.restaurant_name`).all(...f.params);
  const saved = new Map(db.prepare("SELECT * FROM forecast_submission WHERE week_start = ?").all(week).map((s) => [s.restaurant_id, s]));
  return restaurants.map((rest) => {
    const s = saved.get(rest.restaurant_id);
    const sys = s?.system_forecast ? { system_forecast: s.system_forecast, last_year_sales: s.last_year_sales } : systemNumbers(rest, week);
    const row = {
      restaurant_id: rest.restaurant_id, restaurant_name: rest.restaurant_name, region_id: rest.region_id, region_name: rest.region_name,
      area_id: rest.area_id, area_name: rest.area_name, area_manager: rest.area_manager, week_start: week,
      last_year_sales: r0(sys.last_year_sales), recent_trend: r1(s?.recent_trend ?? recentTrend(rest.restaurant_id, week > today() ? today() : week)),
      system_forecast: r0(sys.system_forecast), manager_forecast: s?.manager_forecast ?? null,
      forecast_adjustment_reason: s?.forecast_adjustment_reason ?? "",
      labor_plan: r1(sys.system_forecast ? guideHours(sys.system_forecast) : null),
      scheduled_hours: s?.scheduled_hours ?? null, manager_hours: s?.manager_hours ?? null, allowable_hours: s?.allowable_hours ?? null,
      notes: s?.notes ?? "", submitted_by: s?.submitted_by ?? null, submitted_at: s?.submitted_at ?? null,
      avg_hourly_rate: rest.avg_hourly_rate,
    };
    return { ...row, ...evaluate(row, rest.avg_hourly_rate) };
  });
}

function rollupRows(rows, keyId, keyName, extra = () => ({})) {
  const groups = new Map();
  for (const r of rows) {
    if (!groups.has(r[keyId])) groups.set(r[keyId], { id: r[keyId], name: r[keyName], ...extra(r), restaurants: 0, submitted: 0, incomplete: 0, missing: 0, flagged: 0,
      last_year_sales: 0, system_forecast: 0, manager_forecast: 0, system_forecast_submitted: 0, scheduled_hours: 0, allowable_hours: 0 });
    const g = groups.get(r[keyId]);
    g.restaurants++;
    g[r.status]++;
    if (r.flags.length) g.flagged++;
    g.last_year_sales += r.last_year_sales || 0;
    g.system_forecast += r.system_forecast || 0;
    if (r.status === "submitted") {
      g.manager_forecast += r.manager_forecast || 0;
      g.system_forecast_submitted += r.system_forecast || 0;
      g.scheduled_hours += r.total_scheduled_hours || 0;
      g.allowable_hours += r.total_allowable_hours || 0;
    }
  }
  return [...groups.values()].map((g) => ({
    ...g, scheduled_hours: r0(g.scheduled_hours), allowable_hours: r0(g.allowable_hours),
    projected_vs_system_pct: g.submitted ? pctOf(g.manager_forecast, g.system_forecast_submitted) : null,
    labor_variance: g.submitted ? r0(g.scheduled_hours - g.allowable_hours) : null,
    labor_variance_pct: g.submitted && g.allowable_hours ? pctOf(g.scheduled_hours, g.allowable_hours) : null,
  }));
}

export function forecastForm(user, week, filters = {}) {
  const rows = loadRows(user, week, filters);
  const guide = { fixed_daily_hours: Number(getSetting("labor_guide_fixed_daily_hours")), sales_per_hour: Number(getSetting("labor_guide_sales_per_hour")) };
  return { week_start: week, week_end: addDays(week, 6), guide, rows };
}

export function forecastRollup(user, week) {
  const rows = loadRows(user, week, {});
  return {
    week_start: week, week_end: addDays(week, 6),
    regions: rollupRows(rows, "region_id", "region_name"),
    areas: rollupRows(rows, "area_id", "area_name", (r) => ({ area_manager: r.area_manager, region_name: r.region_name, region_id: r.region_id })),
    outliers: rows.filter((r) => r.flags.length).map((r) => ({ restaurant_id: r.restaurant_id, restaurant_name: r.restaurant_name, area_name: r.area_name, flags: r.flags })),
    missing: rows.filter((r) => r.status !== "submitted").map((r) => ({ restaurant_id: r.restaurant_id, restaurant_name: r.restaurant_name, area_name: r.area_name, area_manager: r.area_manager, status: r.status })),
  };
}

const numOrNull = (v) => (v === "" || v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));

/** Saves a draft, or submits when body.submit is true and the row passes every check. */
export function saveForecast(user, body) {
  const week = body.week_start;
  const allowed = loadRows(user, week, { restaurantId: body.restaurant_id })[0];
  if (!allowed) return { status: 404, error: "Restaurant not found or outside your access" };
  const rest = db.prepare("SELECT avg_hourly_rate FROM restaurant WHERE restaurant_id = ?").get(body.restaurant_id);
  const row = {
    ...allowed,
    manager_forecast: numOrNull(body.manager_forecast), forecast_adjustment_reason: String(body.forecast_adjustment_reason || "").slice(0, 600),
    scheduled_hours: numOrNull(body.scheduled_hours), manager_hours: numOrNull(body.manager_hours),
    allowable_hours: numOrNull(body.allowable_hours), notes: String(body.notes || "").slice(0, 1000), submitted_at: null,
  };
  const check = evaluate(row, rest.avg_hourly_rate);
  if (body.submit && check.problems.length) return { status: 422, error: "The form is not ready to submit", problems: check.problems };
  const submittedAt = body.submit ? new Date().toISOString() : null;
  db.prepare(`INSERT INTO forecast_submission (week_start, restaurant_id, last_year_sales, recent_trend, system_forecast, manager_forecast,
      forecast_adjustment_reason, labor_plan, scheduled_hours, manager_hours, allowable_hours, notes, submitted_by, submitted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(week_start, restaurant_id) DO UPDATE SET last_year_sales = excluded.last_year_sales, recent_trend = excluded.recent_trend,
      system_forecast = excluded.system_forecast, manager_forecast = excluded.manager_forecast,
      forecast_adjustment_reason = excluded.forecast_adjustment_reason, labor_plan = excluded.labor_plan, scheduled_hours = excluded.scheduled_hours,
      manager_hours = excluded.manager_hours, allowable_hours = excluded.allowable_hours, notes = excluded.notes,
      submitted_by = excluded.submitted_by, submitted_at = excluded.submitted_at`)
    .run(week, body.restaurant_id, row.last_year_sales, row.recent_trend, row.system_forecast, row.manager_forecast, row.forecast_adjustment_reason,
      row.labor_plan, row.scheduled_hours, row.manager_hours, row.allowable_hours, row.notes, user?.email || null, submittedAt);
  return { status: 200, row: loadRows(user, week, { restaurantId: body.restaurant_id })[0] };
}
