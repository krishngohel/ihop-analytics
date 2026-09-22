// Read side: company / region / area / store rollups. Percentages are always re-divided
// from summed dollars and hours, never averaged, so a rollup matches its parts.
import db from "./db.js";
import { pct } from "./performance.js";
import { addDays, daysBetween } from "./dates.js";

/** WHERE fragment (on restaurant alias r) limiting rows to what a user may see, plus optional filters. */
export function restaurantFilter(user, { regionId, areaId, restaurantId } = {}) {
  const clauses = [];
  const params = [];
  if (user?.role === "region") { clauses.push("r.region_id = ?"); params.push(user.scope_id); }
  if (user?.role === "area") { clauses.push("r.area_id = ?"); params.push(user.scope_id); }
  if (user?.role === "store") { clauses.push("r.restaurant_id = ?"); params.push(user.scope_id); }
  if (regionId) { clauses.push("r.region_id = ?"); params.push(Number(regionId)); }
  if (areaId) { clauses.push("r.area_id = ?"); params.push(Number(areaId)); }
  if (restaurantId) { clauses.push("r.restaurant_id = ?"); params.push(Number(restaurantId)); }
  return { sql: clauses.length ? ` AND ${clauses.join(" AND ")}` : "", params };
}

const GROUPS = {
  company: { key: "'company'", cols: "" },
  region: { key: "r.region_id", cols: ", g.region_name AS name" },
  area: { key: "r.area_id", cols: ", a.area_name AS name, a.area_manager, g.region_name, r.region_id" },
  store: { key: "r.restaurant_id", cols: ", r.restaurant_name AS name, r.city, r.state, r.region_id, r.area_id, a.area_name, g.region_name, a.area_manager" },
  date: { key: "p.date", cols: "" },
};
const JOINS = "JOIN restaurant r ON r.restaurant_id = p.restaurant_id JOIN area a ON a.area_id = r.area_id JOIN region g ON g.region_id = r.region_id";

// A variance only counts the days that have both sides. Sales history can reach further
// back than forecasts or last-year figures do, and a comparison of eight days of sales
// with two days of forecast would be meaningless, so each one uses the "covered" sales.
export function derive(row) {
  const out = { ...row };
  const covered = row.forecast_covered_sales ?? row.actual_sales;
  out.sales_variance = covered !== null && covered !== undefined && row.forecast_basis !== null && row.forecast_basis !== undefined ? covered - row.forecast_basis : null;
  out.sales_variance_pct = out.sales_variance === null ? null : pct(out.sales_variance, row.forecast_basis);
  const priorCovered = row.prior_covered_sales ?? row.final_actual_sales;
  out.prior_year_variance = priorCovered !== null && priorCovered !== undefined && row.prior_year_sales ? priorCovered - row.prior_year_sales : null;
  out.prior_year_variance_pct = out.prior_year_variance === null ? null : pct(out.prior_year_variance, row.prior_year_sales);
  out.labor_variance = row.actual_labor_hours !== null && row.allowable_labor_hours ? row.actual_labor_hours - row.allowable_labor_hours : null;
  out.labor_variance_pct = out.labor_variance === null ? null : pct(out.labor_variance, row.allowable_labor_hours);
  out.scheduled_variance = row.scheduled_labor_hours !== null && row.allowable_labor_hours ? row.scheduled_labor_hours - row.allowable_labor_hours : null;
  const laborSales = row.labor_covered_sales ?? row.day_sales;
  out.labor_cost_pct = row.actual_labor_cost && laborSales ? pct(row.actual_labor_cost, laborSales) : null;
  return out;
}

/**
 * Sales come from the requested daypart; labor always comes from the full-day row because
 * the source systems report hours per day, not per daypart.
 */
export function metrics(user, { from, to, daypart = "all", groupBy = "company", filters = {} }) {
  const group = GROUPS[groupBy];
  const f = restaurantFilter(user, filters);
  const sales = db.prepare(`
    SELECT ${group.key} AS id${group.cols},
      COUNT(DISTINCT p.restaurant_id) AS restaurants,
      SUM(p.actual_sales) AS actual_sales,
      SUM(p.forecast_sales) AS forecast_sales,
      SUM(CASE WHEN p.is_final = 0 THEN p.forecast_to_now ELSE p.forecast_sales END) AS forecast_basis,
      SUM(CASE WHEN (CASE WHEN p.is_final = 0 THEN p.forecast_to_now ELSE p.forecast_sales END) IS NOT NULL THEN p.actual_sales END) AS forecast_covered_sales,
      SUM(CASE WHEN p.is_final = 1 THEN p.actual_sales END) AS final_actual_sales,
      SUM(CASE WHEN p.is_final = 1 THEN p.prior_year_sales END) AS prior_year_sales,
      SUM(CASE WHEN p.is_final = 1 AND p.prior_year_sales IS NOT NULL THEN p.actual_sales END) AS prior_covered_sales,
      MIN(p.is_final) AS is_final
    FROM daily_performance p ${JOINS}
    WHERE p.daypart = ? AND p.date BETWEEN ? AND ?${f.sql}
    GROUP BY ${group.key}`).all(daypart, from, to, ...f.params);
  const labor = db.prepare(`
    SELECT ${group.key} AS id,
      SUM(p.actual_sales) AS day_sales,
      SUM(CASE WHEN p.actual_labor_cost IS NOT NULL THEN p.actual_sales END) AS labor_covered_sales,
      SUM(p.actual_labor_hours) AS actual_labor_hours,
      SUM(p.scheduled_labor_hours) AS scheduled_labor_hours,
      SUM(p.allowable_labor_hours) AS allowable_labor_hours,
      SUM(p.manager_hours) AS manager_hours,
      SUM(p.actual_labor_cost) AS actual_labor_cost,
      SUM(CASE WHEN p.opening_time_status IN ('late','disrupted') THEN 1 ELSE 0 END) AS opening_issues
    FROM daily_performance p ${JOINS}
    WHERE p.daypart = 'all' AND p.date BETWEEN ? AND ?${f.sql}
    GROUP BY ${group.key}`).all(from, to, ...f.params);
  const guest = db.prepare(`
    SELECT ${group.key.replace("p.date", "m.date")} AS id,
      SUM(m.survey_count) AS survey_count,
      SUM(m.average_rating * m.survey_count) / NULLIF(SUM(m.survey_count), 0) AS average_rating,
      SUM(m.google_review_count) AS google_review_count,
      SUM(m.google_rating * m.google_review_count) / NULLIF(SUM(m.google_review_count), 0) AS google_rating
    FROM guest_metrics m JOIN restaurant r ON r.restaurant_id = m.restaurant_id
    WHERE m.date BETWEEN ? AND ?${f.sql}
    GROUP BY ${group.key.replace("p.date", "m.date")}`).all(from, to, ...f.params);

  const laborById = new Map(labor.map((r) => [r.id, r]));
  const guestById = new Map(guest.map((r) => [r.id, r]));
  const emptyLabor = { day_sales: null, labor_covered_sales: null, actual_labor_hours: null, scheduled_labor_hours: null, allowable_labor_hours: null, manager_hours: null, actual_labor_cost: null, opening_issues: 0 };
  const emptyGuest = { survey_count: 0, average_rating: null, google_review_count: 0, google_rating: null };
  return sales.map((s) => {
    const g = guestById.get(s.id) || emptyGuest;
    return derive({
      ...s, ...(laborById.get(s.id) || emptyLabor), ...g,
      average_rating: g.average_rating === null ? null : Math.round(g.average_rating * 100) / 100,
      google_rating: g.google_rating === null ? null : Math.round(g.google_rating * 100) / 100,
    });
  });
}

export const companyTotals = (user, opts) => metrics(user, { ...opts, groupBy: "company" })[0] || null;

export function dailySeries(user, { from, to, daypart = "all", filters = {} }) {
  return metrics(user, { from, to, daypart, groupBy: "date", filters }).sort((a, b) => (a.id < b.id ? -1 : 1)).map((r) => ({ ...r, date: r.id }));
}

/** Guest ratings over the trailing week, so one quiet day doesn't decide a store's score. */
export function trailingGuest(user, toDay, filters = {}) {
  const f = restaurantFilter(user, filters);
  return db.prepare(`
    SELECT m.restaurant_id AS id, SUM(m.survey_count) AS survey_count,
      SUM(m.average_rating * m.survey_count) / NULLIF(SUM(m.survey_count), 0) AS average_rating,
      SUM(m.google_review_count) AS google_review_count,
      SUM(m.google_rating * m.google_review_count) / NULLIF(SUM(m.google_review_count), 0) AS google_rating
    FROM guest_metrics m JOIN restaurant r ON r.restaurant_id = m.restaurant_id
    WHERE m.date BETWEEN ? AND ?${f.sql} GROUP BY m.restaurant_id`).all(addDays(toDay, -6), toDay, ...f.params);
}

export function weatherSummary(user, day, filters = {}) {
  const f = restaurantFilter(user, filters);
  const row = db.prepare(`
    SELECT COUNT(*) AS restaurants, SUM(w.rain_flag) AS rain, SUM(w.thunderstorm_flag) AS thunderstorms,
      AVG(w.temperature_high) AS avg_high, AVG(w.temperature_low) AS avg_low
    FROM weather w JOIN restaurant r ON r.restaurant_id = w.restaurant_id
    WHERE w.date = ?${f.sql}`).get(day, ...f.params);
  const byArea = db.prepare(`
    SELECT a.area_name, COUNT(*) AS restaurants, SUM(w.rain_flag) AS rain, SUM(w.thunderstorm_flag) AS thunderstorms,
      AVG(w.temperature_high) AS avg_high, MAX(w.weather_description) AS description
    FROM weather w JOIN restaurant r ON r.restaurant_id = w.restaurant_id JOIN area a ON a.area_id = r.area_id
    WHERE w.date = ?${f.sql} GROUP BY a.area_id ORDER BY rain DESC, a.area_name`).all(day, ...f.params);
  return { date: day, ...row, byArea };
}

export function hierarchy(user) {
  const f = restaurantFilter(user);
  const restaurants = db.prepare(`
    SELECT r.restaurant_id, r.restaurant_name, r.store_number, r.city, r.state, r.region_id, r.area_id, a.area_name, a.area_manager, g.region_name
    FROM restaurant r JOIN area a ON a.area_id = r.area_id JOIN region g ON g.region_id = r.region_id
    WHERE 1 = 1${f.sql} ORDER BY g.region_name, a.area_name, r.restaurant_name`).all(...f.params);
  const regions = new Map();
  for (const r of restaurants) {
    if (!regions.has(r.region_id)) regions.set(r.region_id, { region_id: r.region_id, region_name: r.region_name, areas: new Map() });
    const region = regions.get(r.region_id);
    if (!region.areas.has(r.area_id)) region.areas.set(r.area_id, { area_id: r.area_id, area_name: r.area_name, area_manager: r.area_manager, restaurants: [] });
    region.areas.get(r.area_id).restaurants.push({ restaurant_id: r.restaurant_id, restaurant_name: r.restaurant_name, city: r.city, state: r.state });
  }
  return [...regions.values()].map((g) => ({ ...g, areas: [...g.areas.values()] }));
}

/**
 * How much of a range's sales has a forecast on file. The portal seeds older history as
 * sales-only (no forecast), so on a multi-day range the total sales can span more days than
 * the forecast. Every "sales vs. forecast" figure compares only the covered days (see
 * `derive`), so the UI needs this to show the covered sales alongside the forecast — otherwise
 * a reader sees the full total next to a partial forecast and a small variance, which reads as
 * broken math. coveredSales is the actual on the days that have a forecast; totalSales is all of it.
 */
export function forecastCoverage(user, { from, to, filters = {} }) {
  const f = restaurantFilter(user, filters);
  const row = db.prepare(`
    SELECT SUM(p.actual_sales) AS totalSales,
      SUM(CASE WHEN (CASE WHEN p.is_final = 0 THEN p.forecast_to_now ELSE p.forecast_sales END) IS NOT NULL THEN p.actual_sales END) AS coveredSales,
      COUNT(DISTINCT p.date) AS salesDays,
      COUNT(DISTINCT CASE WHEN (CASE WHEN p.is_final = 0 THEN p.forecast_to_now ELSE p.forecast_sales END) IS NOT NULL THEN p.date END) AS forecastDays
    FROM daily_performance p ${JOINS}
    WHERE p.daypart = 'all' AND p.actual_sales IS NOT NULL AND p.date BETWEEN ? AND ?${f.sql}`).get(from, to, ...f.params);
  const totalSales = row.totalSales || 0; const coveredSales = row.coveredSales || 0;
  return { totalSales, coveredSales, salesDays: row.salesDays || 0, forecastDays: row.forecastDays || 0,
    partial: row.forecastDays > 0 && row.salesDays > row.forecastDays && (totalSales - coveredSales) > Math.max(1, totalSales * 0.005) };
}

/**
 * How much of a range's sales the daypart breakdown actually covers. The portal seeds several
 * days of history as sales-only (no daypart split), so a multi-day daypart card can cover only
 * part of the range; the UI uses this to say so instead of quietly understating each daypart.
 */
export function daypartCoverage(user, { from, to, daypart = "all", filters = {} }) {
  const f = restaurantFilter(user, filters);
  const rangeSales = db.prepare(`SELECT SUM(p.actual_sales) AS s FROM daily_performance p ${JOINS}
    WHERE p.daypart = 'all' AND p.date BETWEEN ? AND ?${f.sql}`).get(from, to, ...f.params).s || 0;
  // All-day sales on the dates that actually have a daypart breakdown on file.
  const coveredSales = db.prepare(`SELECT SUM(p.actual_sales) AS s FROM daily_performance p ${JOINS}
    WHERE p.daypart = 'all'${f.sql} AND p.date IN (SELECT DISTINCT date FROM daily_performance WHERE daypart != 'all' AND date BETWEEN ? AND ?)
    AND p.date BETWEEN ? AND ?`).get(...f.params, from, to, from, to).s || 0;
  const days = db.prepare("SELECT COUNT(DISTINCT date) AS n FROM daily_performance WHERE daypart != 'all' AND date BETWEEN ? AND ?").get(from, to).n;
  const rangeDays = daysBetween(from, to) + 1;
  return { coveredSales, rangeSales, days, rangeDays, partial: rangeSales > 0 && coveredSales < rangeSales * 0.995 };
}

export function dataBounds() {
  const row = db.prepare("SELECT MIN(date) AS first_day, MAX(CASE WHEN is_final = 1 THEN date END) AS last_final_day, MAX(CASE WHEN is_final = 0 THEN date END) AS live_day, MAX(updated_at) AS updated_at FROM daily_performance WHERE daypart = 'all'").get();
  return row;
}
