// Read side for the Trends page and the Excel export: the same daily rows the rest of the
// dashboard uses, regrouped by week, by weekday, by daypart and by region / area / store so
// a pattern shows up that a single day's table would hide.
import db, { DAYPARTS, DAYPART_LABELS } from "./db.js";
import { metrics, companyTotals, dailySeries, restaurantFilter, daypartCoverage } from "./analytics.js";
import { pct } from "./performance.js";
import { addDays, dayOfWeek, weekStart } from "./dates.js";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const JOINS = "JOIN restaurant r ON r.restaurant_id = p.restaurant_id JOIN area a ON a.area_id = r.area_id JOIN region g ON g.region_id = r.region_id";

const sum = (rows, key) => rows.reduce((t, r) => t + (r[key] || 0), 0);
const hasAny = (rows, key) => rows.some((r) => r[key] !== null && r[key] !== undefined);
const round1 = (n) => Math.round(n * 10) / 10;

/** Totals for a set of daily rows, with the percentages re-divided from the sums. */
function rollDays(rows, extra = {}) {
  const actual = sum(rows, "actual_sales"); const basis = sum(rows, "forecast_basis");
  const covered = sum(rows, "forecast_covered_sales"); // sales on the days that also have a forecast
  const priorCovered = sum(rows, "prior_covered_sales"); const prior = sum(rows, "prior_year_sales");
  const hours = sum(rows, "actual_labor_hours"); const allowable = sum(rows, "allowable_labor_hours");
  const cost = sum(rows, "actual_labor_cost"); const laborSales = sum(rows, "labor_covered_sales");
  const surveys = sum(rows, "survey_count");
  return {
    ...extra, days: rows.length,
    actual_sales: hasAny(rows, "actual_sales") ? actual : null,
    forecast_sales: hasAny(rows, "forecast_sales") ? sum(rows, "forecast_sales") : null,
    forecast_basis: hasAny(rows, "forecast_basis") ? basis : null,
    prior_year_sales: hasAny(rows, "prior_year_sales") ? prior : null,
    sales_variance: hasAny(rows, "forecast_basis") ? covered - basis : null,
    sales_variance_pct: basis ? pct(covered - basis, basis) : null,
    prior_year_variance_pct: prior ? pct(priorCovered - prior, prior) : null,
    actual_labor_hours: hasAny(rows, "actual_labor_hours") ? hours : null,
    allowable_labor_hours: hasAny(rows, "allowable_labor_hours") ? allowable : null,
    labor_variance: hasAny(rows, "allowable_labor_hours") ? hours - allowable : null,
    labor_variance_pct: allowable ? pct(hours - allowable, allowable) : null,
    actual_labor_cost: hasAny(rows, "actual_labor_cost") ? cost : null,
    labor_cost_pct: cost && laborSales ? pct(cost, laborSales) : null,
    survey_count: surveys,
    average_rating: surveys ? Math.round((rows.reduce((t, r) => t + (r.average_rating || 0) * (r.survey_count || 0), 0) / surveys) * 100) / 100 : null,
  };
}

/** Week by week (Monday start), oldest first, with the change on the week before. */
export function weeklySeries(daily) {
  const byWeek = new Map();
  for (const d of daily) { const w = weekStart(d.date); if (!byWeek.has(w)) byWeek.set(w, []); byWeek.get(w).push(d); }
  const weeks = [...byWeek.entries()].map(([w, rows]) => rollDays(rows, { week_start: w, week_end: addDays(w, 6), partial: rows.length < 7 }));
  return weeks.map((w, i) => {
    const prev = weeks[i - 1];
    const comparable = prev && !prev.partial && !w.partial && prev.actual_sales;
    return { ...w, week_over_week_pct: comparable ? pct(w.actual_sales - prev.actual_sales, prev.actual_sales) : null };
  });
}

/** Average day by weekday, Monday first. Only days with sales on file count. */
export function weekdayPattern(daily) {
  const order = [1, 2, 3, 4, 5, 6, 0];
  return order.map((dow) => {
    const rows = daily.filter((d) => dayOfWeek(d.date) === dow && d.actual_sales !== null && d.actual_sales !== undefined);
    const finals = rows.filter((d) => d.is_final === 1);
    const avg = (set, key) => (set.length && hasAny(set, key) ? sum(set, key) / set.length : null);
    return {
      weekday: WEEKDAYS[dow], short: WEEKDAYS[dow].slice(0, 3), days: rows.length,
      avg_actual_sales: avg(rows, "actual_sales"), avg_forecast_sales: avg(finals, "forecast_sales"), avg_prior_year_sales: avg(finals, "prior_year_sales"),
      avg_labor_hours: avg(rows, "actual_labor_hours"), avg_allowable_hours: avg(rows, "allowable_labor_hours"),
      sales_variance_pct: (() => { const a = sum(finals, "forecast_covered_sales"); const f = sum(finals, "forecast_basis"); return f ? pct(a - f, f) : null; })(),
    };
  });
}

/** Sales by daypart for each day, for a stacked view of where the day's money came from. */
export function daypartByDay(user, { from, to, filters = {} }) {
  const f = restaurantFilter(user, filters);
  const rows = db.prepare(`
    SELECT p.date, p.daypart, SUM(p.actual_sales) AS actual_sales
    FROM daily_performance p ${JOINS}
    WHERE p.daypart != 'all' AND p.date BETWEEN ? AND ?${f.sql}
    GROUP BY p.date, p.daypart ORDER BY p.date`).all(from, to, ...f.params);
  const byDate = new Map();
  for (const r of rows) {
    if (!byDate.has(r.date)) byDate.set(r.date, { date: r.date, ...Object.fromEntries(DAYPARTS.map((d) => [d, null])) });
    byDate.get(r.date)[r.daypart] = r.actual_sales;
  }
  return [...byDate.values()];
}

/**
 * Sales against forecast for every region (or area, or restaurant, one level under the
 * selection) on every day: one line per group, so a market that is drifting stands out.
 */
export function groupsByDay(user, { from, to, daypart = "all", filters = {} }) {
  const level = filters.areaId ? "store" : filters.regionId ? "area" : "region";
  const key = level === "store" ? "r.restaurant_id" : level === "area" ? "r.area_id" : "r.region_id";
  const name = level === "store" ? "r.restaurant_name" : level === "area" ? "a.area_name" : "g.region_name";
  const f = restaurantFilter(user, filters);
  const rows = db.prepare(`
    SELECT p.date, ${key} AS id, ${name} AS name,
      SUM(p.actual_sales) AS actual_sales,
      SUM(CASE WHEN p.is_final = 0 THEN p.forecast_to_now ELSE p.forecast_sales END) AS forecast_basis,
      SUM(CASE WHEN p.is_final = 1 THEN p.actual_sales END) AS final_actual_sales,
      SUM(CASE WHEN p.is_final = 1 THEN p.prior_year_sales END) AS prior_year_sales
    FROM daily_performance p ${JOINS}
    WHERE p.daypart = ? AND p.date BETWEEN ? AND ?${f.sql}
    GROUP BY p.date, ${key} ORDER BY p.date, ${name}`).all(daypart, from, to, ...f.params);
  const groups = new Map();
  const byDate = new Map();
  for (const r of rows) {
    if (!groups.has(r.id)) groups.set(r.id, { id: r.id, name: r.name });
    if (!byDate.has(r.date)) byDate.set(r.date, { date: r.date });
    const day = byDate.get(r.date);
    day[`sales_${r.id}`] = r.actual_sales;
    day[`variance_${r.id}`] = r.forecast_basis ? pct(r.actual_sales - r.forecast_basis, r.forecast_basis) : null;
    day[`prior_${r.id}`] = r.prior_year_sales ? pct(r.final_actual_sales - r.prior_year_sales, r.prior_year_sales) : null;
  }
  return { level, groups: [...groups.values()], rows: [...byDate.values()] };
}

export function trendsData(user, { from, to, daypart = "all", filters = {} }) {
  const daily = dailySeries(user, { from, to, daypart, filters }).map((d) => ({ ...d, weekday: WEEKDAYS[dayOfWeek(d.date)] }));
  const level = filters.areaId ? "store" : filters.regionId ? "area" : "region";
  return {
    range: { from, to, daypart },
    totals: companyTotals(user, { from, to, daypart, filters }),
    daily,
    weekly: weeklySeries(daily),
    weekday: weekdayPattern(daily),
    dayparts: DAYPARTS.map((dp) => ({ daypart: dp, label: DAYPART_LABELS[dp], ...(companyTotals(user, { from, to, daypart: dp, filters }) || {}) })),
    daypartCoverage: daypartCoverage(user, { from, to, filters }),
    daypartByDay: daypartByDay(user, { from, to, filters }),
    groups: groupsByDay(user, { from, to, daypart, filters }),
    breakdown: metrics(user, { from, to, daypart, groupBy: level, filters }).sort((a, b) => (a.sales_variance_pct ?? 0) - (b.sales_variance_pct ?? 0)),
    breakdownLevel: level,
  };
}

export { WEEKDAYS, round1 };
