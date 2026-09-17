// Daily morning summary, in the format the client asked for. Generated after prior-day
// data lands (scheduled refresh) and on demand. Short enough to read in a minute.
import db from "./db.js";
import { companyTotals, metrics } from "./analytics.js";
import { evaluateHotspots } from "./hotspots.js";
import { prettyDate } from "./dates.js";

const money = (n) => `$${Math.round(n || 0).toLocaleString("en-US")}`;
const hours = (n) => `${Math.round(n || 0).toLocaleString("en-US")} hours`;
const signed = (n) => (n === null || n === undefined ? "n/a" : `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`);

export function buildDailySummary(user, day, filters = {}) {
  const totals = companyTotals(user, { from: day, to: day, filters });
  if (!totals) return null;
  const hs = evaluateHotspots(user, { from: day, to: day, filters });
  const regions = metrics(user, { from: day, to: day, groupBy: "region", filters });
  const areas = metrics(user, { from: day, to: day, groupBy: "area", filters });

  const byForecast = [...hs.evaluated].filter((s) => s.sales_variance_pct > 0).sort((a, b) => b.sales_variance_pct - a.sales_variance_pct).slice(0, 3);
  const taken = new Set(byForecast.map((s) => s.id));
  const byPriorYear = [...hs.evaluated].filter((s) => s.prior_year_variance_pct > 0 && !taken.has(s.id)).sort((a, b) => b.prior_year_variance_pct - a.prior_year_variance_pct).slice(0, 2);
  const topPerformers = [
    ...byForecast.map((s) => ({ restaurant_id: s.id, name: s.name, text: `sales ${signed(s.sales_variance_pct)} vs. forecast` })),
    ...byPriorYear.map((s) => ({ restaurant_id: s.id, name: s.name, text: `sales ${signed(s.prior_year_variance_pct)} vs. prior year` })),
  ];

  const hotspots = hs.hotspots.slice(0, 8).map((s) => ({
    restaurant_id: s.id, name: s.name, severity: s.severity, area: s.area_name, region: s.region_name,
    text: (s.flags.length ? s.flags.map((f) => f.charAt(0).toLowerCase() + f.slice(1)).join("; ") : "in the bottom group on combined sales and labor rank")
      + (s.weather_note ? `. ${s.weather_note}` : ""),
  }));

  const regionalNotes = [];
  const worstSalesRegion = [...regions].filter((r) => r.sales_variance < 0).sort((a, b) => a.sales_variance - b.sales_variance)[0];
  if (worstSalesRegion) regionalNotes.push(`${worstSalesRegion.name} had the largest sales miss: ${money(Math.abs(worstSalesRegion.sales_variance))} below forecast (${signed(worstSalesRegion.sales_variance_pct)})`);
  const bestSalesRegion = [...regions].filter((r) => r.sales_variance > 0).sort((a, b) => b.sales_variance_pct - a.sales_variance_pct)[0];
  if (bestSalesRegion) regionalNotes.push(`${bestSalesRegion.name} led on sales vs. forecast (${signed(bestSalesRegion.sales_variance_pct)})`);
  const worstLaborArea = [...areas].filter((a) => a.labor_variance > 0).sort((a, b) => b.labor_variance - a.labor_variance)[0];
  if (worstLaborArea) regionalNotes.push(`${worstLaborArea.name} area (${worstLaborArea.area_manager}) had the largest labor miss: ${hours(worstLaborArea.labor_variance)} over allowable (${signed(worstLaborArea.labor_variance_pct)})`);
  const worstSalesArea = [...areas].filter((a) => a.sales_variance < 0).sort((a, b) => a.sales_variance_pct - b.sales_variance_pct)[0];
  if (worstSalesArea) regionalNotes.push(`${worstSalesArea.name} area had the weakest sales vs. forecast (${signed(worstSalesArea.sales_variance_pct)})`);

  const company = {
    sales: { actual: totals.actual_sales, forecast: totals.forecast_sales, variance: totals.sales_variance, variance_pct: totals.sales_variance_pct,
      prior_year: totals.prior_year_sales, prior_year_variance_pct: totals.prior_year_variance_pct },
    labor: { actual_hours: totals.actual_labor_hours, allowable_hours: totals.allowable_labor_hours, variance: totals.labor_variance, variance_pct: totals.labor_variance_pct,
      cost: totals.actual_labor_cost, cost_pct: totals.labor_cost_pct },
    guest: { survey_count: totals.survey_count, average_rating: totals.average_rating, google_review_count: totals.google_review_count, google_rating: totals.google_rating },
  };

  const lines = [
    "Yesterday's Business Summary",
    prettyDate(day),
    "",
    "Company performance",
    `- Sales: ${money(company.sales.actual)} actual vs. ${money(company.sales.forecast)} forecast, variance: ${signed(company.sales.variance_pct)}`,
    `- Labor: ${hours(company.labor.actual_hours)} actual vs. ${hours(company.labor.allowable_hours)} allowable, variance: ${signed(company.labor.variance_pct)}`,
    `- Guest experience: ${company.guest.survey_count || 0} surveys, ${company.guest.average_rating ? company.guest.average_rating.toFixed(1) : "n/a"} average rating`,
    "",
    "Top performers",
    ...(topPerformers.length ? topPerformers.map((t) => `- ${t.name}: ${t.text}`) : ["- None beat forecast"]),
    "",
    "Priority hotspots",
    ...(hotspots.length ? hotspots.map((h) => `- ${h.name}: ${h.text}`) : ["- None"]),
    "",
    "Regional notes",
    ...(regionalNotes.length ? regionalNotes.map((n) => `- ${n}`) : ["- No regional misses"]),
  ];

  return {
    date: day, generated_at: new Date().toISOString(), restaurants: totals.restaurants, hotspot_count: hs.hotspots.length,
    company, topPerformers, hotspots, regionalNotes, text: lines.join("\n"),
  };
}

/** Stores the company-wide summary so the morning version is on file even if data is later restated. */
export function storeDailySummary(day) {
  const summary = buildDailySummary(null, day);
  if (!summary) return null;
  db.prepare("INSERT INTO daily_summary (date, generated_at, body) VALUES (?, ?, ?) ON CONFLICT(date) DO UPDATE SET generated_at = excluded.generated_at, body = excluded.body")
    .run(day, summary.generated_at, JSON.stringify(summary));
  return summary;
}

export function storedDailySummary(day) {
  const row = db.prepare("SELECT body FROM daily_summary WHERE date = ?").get(day);
  return row ? JSON.parse(row.body) : null;
}
