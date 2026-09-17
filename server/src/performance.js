// The single write path for performance and guest data. File imports, emailed reports,
// pushed files, the demo source and any future vendor API connector all call these, so
// variance math can't drift by source.
import db from "./db.js";
import { earnedShare, localHour, localDate } from "./dayparts.js";

const num = (v) => (v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
const round2 = (n) => (n === null ? null : Math.round(n * 100) / 100);

// Brief, "Initial Hotspot Logic":
//   sales miss            = (actual_sales - forecast_sales) / forecast_sales
//   prior-year sales miss = (actual_sales - prior_year_sales) / prior_year_sales
//   labor miss            = (actual_labor_hours - allowable_labor_hours) / allowable_labor_hours
// The stored *_variance columns hold the numerator; percentages are derived on read so
// rollups can re-divide summed dollars/hours instead of averaging percentages.
const upsertPerf = db.prepare(`
  INSERT INTO daily_performance (date, restaurant_id, daypart, actual_sales, forecast_sales, prior_year_sales,
    sales_variance_to_forecast, sales_variance_to_prior_year, actual_labor_hours, scheduled_labor_hours,
    allowable_labor_hours, manager_hours, actual_labor_cost, labor_variance, opening_time_status,
    is_final, forecast_to_now, source, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(date, restaurant_id, daypart) DO UPDATE SET
    actual_sales = excluded.actual_sales, forecast_sales = excluded.forecast_sales, prior_year_sales = excluded.prior_year_sales,
    sales_variance_to_forecast = excluded.sales_variance_to_forecast, sales_variance_to_prior_year = excluded.sales_variance_to_prior_year,
    actual_labor_hours = excluded.actual_labor_hours, scheduled_labor_hours = excluded.scheduled_labor_hours,
    allowable_labor_hours = excluded.allowable_labor_hours, manager_hours = excluded.manager_hours,
    actual_labor_cost = excluded.actual_labor_cost, labor_variance = excluded.labor_variance,
    opening_time_status = excluded.opening_time_status, is_final = excluded.is_final,
    forecast_to_now = excluded.forecast_to_now, source = excluded.source, updated_at = excluded.updated_at
`);
const existingPerf = db.prepare("SELECT * FROM daily_performance WHERE date = ? AND restaurant_id = ? AND daypart = ?");
const restaurantZone = db.prepare("SELECT timezone FROM restaurant WHERE restaurant_id = ?");

const MERGE_FIELDS = ["actual_sales", "forecast_sales", "prior_year_sales", "actual_labor_hours", "scheduled_labor_hours",
  "allowable_labor_hours", "manager_hours", "actual_labor_cost", "opening_time_status"];

/**
 * merge: true keeps whatever is already on file for fields this row doesn't carry. Vendor
 * reports arrive separately (a sales report, then a labor report), and the second must
 * add to the first, not blank it out.
 */
export function savePerformance(input, source = "import", { merge = false } = {}) {
  let row = input;
  if (merge) {
    const old = existingPerf.get(input.date, input.restaurant_id, input.daypart || "all");
    if (old) {
      row = { ...input };
      for (const f of MERGE_FIELDS) if (row[f] === null || row[f] === undefined || row[f] === "") row[f] = old[f];
    }
  }
  const actual = num(row.actual_sales);
  const forecast = num(row.forecast_sales);
  const prior = num(row.prior_year_sales);
  const hours = num(row.actual_labor_hours);
  const allowable = num(row.allowable_labor_hours);

  // Imported rows for the restaurant's current business day are live, not final.
  let isFinal = row.is_final === 0 || row.is_final === false ? 0 : 1;
  let toNow = num(row.forecast_to_now);
  if (row.is_final === undefined && source !== "demo") {
    const zone = restaurantZone.get(row.restaurant_id)?.timezone;
    if (row.date === localDate(zone)) {
      isFinal = 0;
      if (toNow === null && forecast !== null) toNow = forecast * earnedShare(row.daypart || "all", localHour(zone));
    }
  }
  // A live day is compared with the forecast earned so far, a final day with the full forecast.
  const forecastBasis = isFinal ? forecast : toNow ?? forecast;
  upsertPerf.run(
    row.date, row.restaurant_id, row.daypart || "all",
    round2(actual), round2(forecast), round2(prior),
    actual !== null && forecastBasis !== null ? round2(actual - forecastBasis) : null,
    actual !== null && prior !== null && isFinal ? round2(actual - prior) : null,
    round2(hours), round2(num(row.scheduled_labor_hours)), round2(allowable), round2(num(row.manager_hours)),
    round2(num(row.actual_labor_cost)),
    hours !== null && allowable !== null ? round2(hours - allowable) : null,
    row.opening_time_status || null,
    isFinal, round2(toNow), source, new Date().toISOString()
  );
}

const upsertGuest = db.prepare(`
  INSERT INTO guest_metrics (date, restaurant_id, survey_count, average_rating, google_review_count, google_rating, source)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(date, restaurant_id) DO UPDATE SET
    survey_count = COALESCE(excluded.survey_count, survey_count), average_rating = COALESCE(excluded.average_rating, average_rating),
    google_review_count = COALESCE(excluded.google_review_count, google_review_count), google_rating = COALESCE(excluded.google_rating, google_rating),
    source = excluded.source
`);

export function saveGuestMetrics(row, source = "import") {
  upsertGuest.run(row.date, row.restaurant_id, num(row.survey_count), num(row.average_rating),
    num(row.google_review_count), num(row.google_rating), source);
}

export const pct = (numerator, denominator) =>
  denominator ? Math.round((numerator / denominator) * 1000) / 10 : null;
