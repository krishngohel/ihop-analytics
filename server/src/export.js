// The Excel workbook behind "Download for Excel": one sheet per view (daily, weekly, by
// region, by daypart, by weekday, every restaurant) with the numbers in cells and the
// charts already drawn beside them, so nobody has to rebuild a chart to put it in a deck.
import { Workbook, excelDate } from "./xlsx-writer.js";
import { trendsData } from "./trends.js";
import { metrics } from "./analytics.js";
import { evaluateHotspots } from "./hotspots.js";
import { DAYPARTS, DAYPART_LABELS } from "./db.js";
import { prettyDate } from "./dates.js";

// Same colors as the dashboard's light theme, so a chart pasted from Excel matches the screen.
const COLOR = { actual: "2A78D6", forecast: "EB6834", lastYear: "1BAF7A", good: "16803C", bad: "D03B3B", neutral: "9AA5B5", labor: "2A78D6", allowable: "EB6834", cost: "6D5BD0" };
const DAYPART_COLOR = { breakfast: "F2A93B", lunch: "2A78D6", dinner: "6D5BD0", late_night: "3BA99C" };

const p = (v) => (v === null || v === undefined ? null : Math.round(v * 100) / 10000); // dashboard percents are 0-100; Excel wants 0-1
const n = (v) => (v === null || v === undefined ? null : Number(v));
const shortName = (s) => String(s || "").replace(/^IHOP /, "");

/** A header row plus data rows, returning the row indexes charts need. */
function table(sheet, columns, rows, { totals } = {}) {
  sheet.addRow(columns.map((c) => ({ v: c.label, s: c.left ? "headerLeft" : "header" })));
  const first = sheet.rowCount;
  for (const r of rows) sheet.addRow(columns.map((c) => ({ v: c.get(r), s: c.style })));
  const last = sheet.rowCount - 1;
  if (totals) sheet.addRow(columns.map((c, i) => ({ v: i === 0 ? "Total" : c.total ? c.total(totals) : null, s: i === 0 ? "bold" : c.style ? `bold${c.style[0].toUpperCase()}${c.style.slice(1)}` : "bold" })));
  return { first, last };
}

const seriesRef = (sheet, col, r) => ({ name: sheet.cellRef(col, r.first - 1), values: sheet.colRange(col, r.first, r.last) });

export function buildWorkbook(user, { from, to, daypart, filters }, { scopeName }) {
  const t = trendsData(user, { from, to, daypart, filters });
  const wb = new Workbook();
  const rangeLabel = from === to ? prettyDate(from) : `${prettyDate(from)} to ${prettyDate(to)}`;
  const daypartLabel = DAYPART_LABELS[daypart] || "All day";
  const lastYearOnly = (rows, key) => rows.map((r) => (r.is_final === 1 ? n(r[key]) : null));

  // ---- Summary ----------------------------------------------------------------------
  const summary = wb.sheet("Summary");
  summary.columns([30, 18, 16, 16, 16]);
  summary.addRow([{ v: "IHOP Operations", s: "title" }]);
  summary.addRow([{ v: `${scopeName} · ${rangeLabel} · ${daypartLabel}`, s: "note" }]);
  summary.addRow([{ v: `Exported ${new Date().toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}. Sales are compared with forecast; labor with allowable hours. Percentages are re-divided from totals, never averaged.`, s: "note" }]);
  summary.blank();
  const tot = t.totals || {};
  summary.addRow([{ v: "Measure", s: "headerLeft" }, { v: "Value", s: "header" }, { v: "Variance", s: "header" }, { v: "Compared with", s: "header" }, { v: "", s: "header" }]);
  const kpi = (label, value, style, variance, compare, compareStyle, against) =>
    summary.addRow([{ v: label, s: "bold" }, { v: value, s: style }, { v: variance, s: "pct" }, { v: compare, s: compareStyle }, { v: against, s: "note" }]);
  kpi("Sales", n(tot.actual_sales), "money", p(tot.sales_variance_pct), n(tot.forecast_basis), "money", "forecast");
  kpi("Sales, final days", n(tot.final_actual_sales), "money", p(tot.prior_year_variance_pct), n(tot.prior_year_sales), "money", "last year");
  kpi("Labor hours", n(tot.actual_labor_hours), "num1", p(tot.labor_variance_pct), n(tot.allowable_labor_hours), "num1", "allowable hours");
  kpi("Labor cost", n(tot.actual_labor_cost), "money", p(tot.labor_cost_pct), null, "money", "share of sales");
  kpi("Guest rating", n(tot.average_rating), "rating", null, n(tot.survey_count), "int", "surveys");
  kpi("Restaurants", n(tot.restaurants), "int", null, null, "int", "");
  summary.blank();
  summary.addRow([{ v: "Sheets in this workbook", s: "bold" }]);
  for (const line of ["Daily — every business day with sales, labor and guest figures", "Weekly — the same rolled up by week (Monday start)", `${t.breakdownLevel === "store" ? "Restaurants" : t.breakdownLevel === "area" ? "Areas" : "Regions"} — ranked by sales against forecast`, "Dayparts — breakfast, lunch, dinner and late night", "Daypart mix — sales by daypart for each day", "Weekday — the average day for each day of the week", "Restaurants — every restaurant in the selection"]) summary.addRow([{ v: line, s: "note" }]);

  // ---- Daily ------------------------------------------------------------------------
  const daily = wb.sheet("Daily");
  daily.columns([16, 11, 13, 13, 13, 12, 12, 11, 11, 12, 13, 11, 10, 9]);
  daily.freeze(1);
  const dRows = table(daily, [
    { label: "Date", left: true, get: (r) => excelDate(r.date), style: "date" },
    { label: "Weekday", left: true, get: (r) => r.weekday },
    { label: "Sales", get: (r) => n(r.actual_sales), style: "money", total: (x) => n(x.actual_sales) },
    { label: "Forecast", get: (r) => n(r.forecast_basis), style: "money", total: (x) => n(x.forecast_basis) },
    { label: "Last year", get: (r) => (r.is_final === 1 ? n(r.prior_year_sales) : null), style: "money", total: (x) => n(x.prior_year_sales) },
    { label: "vs. forecast", get: (r) => p(r.sales_variance_pct), style: "pct", total: (x) => p(x.sales_variance_pct) },
    { label: "vs. last year", get: (r) => p(r.prior_year_variance_pct), style: "pct", total: (x) => p(x.prior_year_variance_pct) },
    { label: "Labor hrs", get: (r) => n(r.actual_labor_hours), style: "num1", total: (x) => n(x.actual_labor_hours) },
    { label: "Allowable hrs", get: (r) => n(r.allowable_labor_hours), style: "num1", total: (x) => n(x.allowable_labor_hours) },
    { label: "Labor vs. allowable", get: (r) => p(r.labor_variance_pct), style: "pct", total: (x) => p(x.labor_variance_pct) },
    { label: "Labor cost", get: (r) => n(r.actual_labor_cost), style: "money", total: (x) => n(x.actual_labor_cost) },
    { label: "Labor cost %", get: (r) => p(r.labor_cost_pct), style: "pct", total: (x) => p(x.labor_cost_pct) },
    { label: "Guest rating", get: (r) => n(r.average_rating), style: "rating", total: (x) => n(x.average_rating) },
    { label: "Surveys", get: (r) => n(r.survey_count), style: "int", total: (x) => n(x.survey_count) },
  ], t.daily, { totals: t.totals });
  if (t.daily.length) {
    const cats = { ref: daily.colRange(0, dRows.first, dRows.last), values: t.daily.map((r) => excelDate(r.date)), numeric: true, format: "date" };
    daily.chart({ type: "line", title: "Daily sales: actual, forecast and last year", categories: cats, valueFormat: "money", series: [
      { name: "Sales", ref: seriesRef(daily, 2, dRows), values: t.daily.map((r) => n(r.actual_sales)), color: COLOR.actual },
      { name: "Forecast", ref: seriesRef(daily, 3, dRows), values: t.daily.map((r) => n(r.forecast_basis)), color: COLOR.forecast, dashed: true },
      { name: "Last year", ref: seriesRef(daily, 4, dRows), values: lastYearOnly(t.daily, "prior_year_sales"), color: COLOR.lastYear },
    ] }, { col: 15, row: 0, width: 11, height: 20 });
    daily.chart({ type: "line", title: "Labor hours against allowable", categories: cats, valueFormat: "num1", series: [
      { name: "Labor hrs", ref: seriesRef(daily, 7, dRows), values: t.daily.map((r) => n(r.actual_labor_hours)), color: COLOR.labor },
      { name: "Allowable hrs", ref: seriesRef(daily, 8, dRows), values: t.daily.map((r) => n(r.allowable_labor_hours)), color: COLOR.allowable, dashed: true },
    ] }, { col: 15, row: 21, width: 11, height: 18 });
    daily.chart({ type: "col", title: "Variance by day: sales vs. forecast and labor vs. allowable", categories: cats, valueFormat: "pct", series: [
      { name: "Sales vs. forecast", ref: seriesRef(daily, 5, dRows), values: t.daily.map((r) => p(r.sales_variance_pct)), color: COLOR.actual },
      { name: "Labor vs. allowable", ref: seriesRef(daily, 9, dRows), values: t.daily.map((r) => p(r.labor_variance_pct)), color: COLOR.forecast },
    ] }, { col: 15, row: 40, width: 11, height: 18 });
  }

  // ---- Weekly -----------------------------------------------------------------------
  const weekly = wb.sheet("Weekly");
  weekly.columns([16, 7, 13, 13, 13, 12, 12, 13, 11, 11, 12, 12]);
  weekly.freeze(1);
  const wRows = table(weekly, [
    { label: "Week of", left: true, get: (r) => excelDate(r.week_start), style: "week" },
    { label: "Days", get: (r) => r.days, style: "int" },
    { label: "Sales", get: (r) => n(r.actual_sales), style: "money" },
    { label: "Forecast", get: (r) => n(r.forecast_basis), style: "money" },
    { label: "Last year", get: (r) => n(r.prior_year_sales), style: "money" },
    { label: "vs. forecast", get: (r) => p(r.sales_variance_pct), style: "pct" },
    { label: "vs. last year", get: (r) => p(r.prior_year_variance_pct), style: "pct" },
    { label: "Week over week", get: (r) => p(r.week_over_week_pct), style: "pct" },
    { label: "Labor hrs", get: (r) => n(r.actual_labor_hours), style: "num1" },
    { label: "Allowable hrs", get: (r) => n(r.allowable_labor_hours), style: "num1" },
    { label: "Labor vs. allowable", get: (r) => p(r.labor_variance_pct), style: "pct" },
    { label: "Labor cost %", get: (r) => p(r.labor_cost_pct), style: "pct" },
  ], t.weekly);
  if (t.weekly.length) {
    const cats = { ref: weekly.colRange(0, wRows.first, wRows.last), values: t.weekly.map((r) => excelDate(r.week_start)), numeric: true, format: "week" };
    weekly.chart({ type: "col", title: "Weekly sales: actual, forecast and last year", categories: cats, valueFormat: "money", series: [
      { name: "Sales", ref: seriesRef(weekly, 2, wRows), values: t.weekly.map((r) => n(r.actual_sales)), color: COLOR.actual },
      { name: "Forecast", ref: seriesRef(weekly, 3, wRows), values: t.weekly.map((r) => n(r.forecast_basis)), color: COLOR.forecast },
      { name: "Last year", ref: seriesRef(weekly, 4, wRows), values: t.weekly.map((r) => n(r.prior_year_sales)), color: COLOR.lastYear },
    ] }, { col: 13, row: 0, width: 10, height: 18 });
    weekly.chart({ type: "col", title: "Weekly labor hours against allowable", categories: cats, valueFormat: "num1", series: [
      { name: "Labor hrs", ref: seriesRef(weekly, 8, wRows), values: t.weekly.map((r) => n(r.actual_labor_hours)), color: COLOR.labor },
      { name: "Allowable hrs", ref: seriesRef(weekly, 9, wRows), values: t.weekly.map((r) => n(r.allowable_labor_hours)), color: COLOR.allowable },
    ] }, { col: 13, row: 19, width: 10, height: 16 });
  }

  // ---- Regions / Areas / Restaurants (one level under the selection) --------------------
  const levelName = t.breakdownLevel === "store" ? "Restaurants" : t.breakdownLevel === "area" ? "Areas" : "Regions";
  const groups = wb.sheet(t.breakdownLevel === "store" ? "Restaurants" : levelName);
  groups.columns([28, 11, 13, 13, 12, 13, 12, 11, 11, 12, 12, 10, 10]);
  groups.freeze(1);
  const gRows = table(groups, [
    { label: levelName.replace(/s$/, ""), left: true, get: (r) => shortName(r.name) },
    { label: "Restaurants", get: (r) => r.restaurants, style: "int" },
    { label: "Sales", get: (r) => n(r.actual_sales), style: "money" },
    { label: "Forecast", get: (r) => n(r.forecast_basis), style: "money" },
    { label: "vs. forecast", get: (r) => p(r.sales_variance_pct), style: "pct" },
    { label: "Last year", get: (r) => n(r.prior_year_sales), style: "money" },
    { label: "vs. last year", get: (r) => p(r.prior_year_variance_pct), style: "pct" },
    { label: "Labor hrs", get: (r) => n(r.actual_labor_hours), style: "num1" },
    { label: "Allowable hrs", get: (r) => n(r.allowable_labor_hours), style: "num1" },
    { label: "Labor vs. allowable", get: (r) => p(r.labor_variance_pct), style: "pct" },
    { label: "Labor cost %", get: (r) => p(r.labor_cost_pct), style: "pct" },
    { label: "Guest rating", get: (r) => n(r.average_rating), style: "rating" },
    { label: "Surveys", get: (r) => n(r.survey_count), style: "int" },
  ], t.breakdown);
  if (t.breakdown.length) {
    const cats = { ref: groups.colRange(0, gRows.first, gRows.last), values: t.breakdown.map((r) => shortName(r.name)) };
    const barH = Math.max(14, Math.min(40, t.breakdown.length + 6));
    groups.chart({ type: "bar", title: `${levelName} ranked: sales vs. forecast`, categories: cats, valueFormat: "pct", legend: false, series: [
      { name: "vs. forecast", ref: seriesRef(groups, 4, gRows), values: t.breakdown.map((r) => p(r.sales_variance_pct)), color: COLOR.neutral, labels: true,
        pointColors: t.breakdown.map((r) => (r.sales_variance_pct === null || r.sales_variance_pct === undefined ? COLOR.neutral : r.sales_variance_pct >= 0 ? COLOR.good : COLOR.bad)) },
    ] }, { col: 14, row: 0, width: 9, height: barH });
    groups.chart({ type: "bar", title: `${levelName} ranked: labor vs. allowable`, categories: cats, valueFormat: "pct", legend: false, series: [
      { name: "Labor vs. allowable", ref: seriesRef(groups, 9, gRows), values: t.breakdown.map((r) => p(r.labor_variance_pct)), color: COLOR.neutral, labels: true,
        pointColors: t.breakdown.map((r) => (r.labor_variance_pct === null || r.labor_variance_pct === undefined ? COLOR.neutral : r.labor_variance_pct <= 0 ? COLOR.good : COLOR.bad)) },
    ] }, { col: 14, row: barH + 1, width: 9, height: barH });
  }

  // ---- Dayparts -----------------------------------------------------------------------
  const dp = wb.sheet("Dayparts");
  dp.columns([14, 13, 13, 12, 13, 12]);
  const dpRows = table(dp, [
    { label: "Daypart", left: true, get: (r) => r.label },
    { label: "Sales", get: (r) => n(r.actual_sales), style: "money" },
    { label: "Forecast", get: (r) => n(r.forecast_basis), style: "money" },
    { label: "vs. forecast", get: (r) => p(r.sales_variance_pct), style: "pct" },
    { label: "Last year", get: (r) => n(r.prior_year_sales), style: "money" },
    { label: "vs. last year", get: (r) => p(r.prior_year_variance_pct), style: "pct" },
  ], t.dayparts);
  dp.blank();
  dp.addRow([{ v: "Labor is reported for the whole day, so it has no daypart split.", s: "note" }]);
  {
    const cats = { ref: dp.colRange(0, dpRows.first, dpRows.last), values: t.dayparts.map((r) => r.label) };
    dp.chart({ type: "col", title: "Sales by daypart", categories: cats, valueFormat: "money", series: [
      { name: "Sales", ref: seriesRef(dp, 1, dpRows), values: t.dayparts.map((r) => n(r.actual_sales)), color: COLOR.actual },
      { name: "Forecast", ref: seriesRef(dp, 2, dpRows), values: t.dayparts.map((r) => n(r.forecast_basis)), color: COLOR.forecast },
      { name: "Last year", ref: seriesRef(dp, 4, dpRows), values: t.dayparts.map((r) => n(r.prior_year_sales)), color: COLOR.lastYear },
    ] }, { col: 7, row: 0, width: 9, height: 16 });
  }

  // ---- Daypart mix by day ------------------------------------------------------------------
  const mix = wb.sheet("Daypart mix");
  mix.columns([16, 13, 13, 13, 13, 13]);
  mix.freeze(1);
  const mixRows = table(mix, [
    { label: "Date", left: true, get: (r) => excelDate(r.date), style: "date" },
    ...DAYPARTS.map((d) => ({ label: DAYPART_LABELS[d], get: (r) => n(r[d]), style: "money" })),
    { label: "Day total", get: (r) => (DAYPARTS.some((d) => r[d] !== null) ? DAYPARTS.reduce((s, d) => s + (r[d] || 0), 0) : null), style: "money" },
  ], t.daypartByDay);
  if (t.daypartByDay.length) {
    const cats = { ref: mix.colRange(0, mixRows.first, mixRows.last), values: t.daypartByDay.map((r) => excelDate(r.date)), numeric: true, format: "date" };
    mix.chart({ type: "stacked", title: "Where each day's sales came from", categories: cats, valueFormat: "money",
      series: DAYPARTS.map((d, i) => ({ name: DAYPART_LABELS[d], ref: seriesRef(mix, i + 1, mixRows), values: t.daypartByDay.map((r) => n(r[d])), color: DAYPART_COLOR[d] })) },
    { col: 7, row: 0, width: 11, height: 20 });
  }

  // ---- Weekday pattern ----------------------------------------------------------------------
  const wd = wb.sheet("Weekday");
  wd.columns([12, 7, 14, 14, 14, 12, 12, 13]);
  const wdRows = table(wd, [
    { label: "Weekday", left: true, get: (r) => r.weekday },
    { label: "Days", get: (r) => r.days, style: "int" },
    { label: "Average sales", get: (r) => n(r.avg_actual_sales), style: "money" },
    { label: "Average forecast", get: (r) => n(r.avg_forecast_sales), style: "money" },
    { label: "Average last year", get: (r) => n(r.avg_prior_year_sales), style: "money" },
    { label: "vs. forecast", get: (r) => p(r.sales_variance_pct), style: "pct" },
    { label: "Avg labor hrs", get: (r) => n(r.avg_labor_hours), style: "num1" },
    { label: "Avg allowable hrs", get: (r) => n(r.avg_allowable_hours), style: "num1" },
  ], t.weekday);
  wd.blank();
  wd.addRow([{ v: "An average day for each weekday across the selected range. Days without sales on file are left out.", s: "note" }]);
  {
    const cats = { ref: wd.colRange(0, wdRows.first, wdRows.last), values: t.weekday.map((r) => r.weekday) };
    wd.chart({ type: "col", title: "The average day, by weekday", categories: cats, valueFormat: "money", series: [
      { name: "Average sales", ref: seriesRef(wd, 2, wdRows), values: t.weekday.map((r) => n(r.avg_actual_sales)), color: COLOR.actual },
      { name: "Average forecast", ref: seriesRef(wd, 3, wdRows), values: t.weekday.map((r) => n(r.avg_forecast_sales)), color: COLOR.forecast },
      { name: "Average last year", ref: seriesRef(wd, 4, wdRows), values: t.weekday.map((r) => n(r.avg_prior_year_sales)), color: COLOR.lastYear },
    ] }, { col: 9, row: 0, width: 10, height: 16 });
  }

  // ---- Every restaurant ----------------------------------------------------------------------
  if (t.breakdownLevel !== "store") {
    const stores = wb.sheet("Restaurants");
    stores.columns([26, 8, 16, 18, 14, 13, 13, 12, 13, 12, 11, 11, 12, 12, 10, 9, 14]);
    stores.freeze(1);
    const hs = evaluateHotspots(user, { from, to, daypart, filters });
    const severity = new Map(hs.evaluated.map((s) => [s.id, s.severity]));
    const rows = metrics(user, { from, to, daypart, groupBy: "store", filters }).sort((a, b) => (a.sales_variance_pct ?? 0) - (b.sales_variance_pct ?? 0));
    const SEV = { critical: "Critical", needs_review: "Needs review", watch: "Watch", positive_outlier: "Positive outlier" };
    table(stores, [
      { label: "Restaurant", left: true, get: (r) => shortName(r.name) },
      { label: "Store #", get: (r) => r.store_number ?? null, style: "int" },
      { label: "City", left: true, get: (r) => r.city ? `${r.city}${r.state ? `, ${r.state}` : ""}` : null },
      { label: "Area", left: true, get: (r) => r.area_name },
      { label: "Region", left: true, get: (r) => r.region_name },
      { label: "Sales", get: (r) => n(r.actual_sales), style: "money" },
      { label: "Forecast", get: (r) => n(r.forecast_basis), style: "money" },
      { label: "vs. forecast", get: (r) => p(r.sales_variance_pct), style: "pct" },
      { label: "Last year", get: (r) => n(r.prior_year_sales), style: "money" },
      { label: "vs. last year", get: (r) => p(r.prior_year_variance_pct), style: "pct" },
      { label: "Labor hrs", get: (r) => n(r.actual_labor_hours), style: "num1" },
      { label: "Allowable hrs", get: (r) => n(r.allowable_labor_hours), style: "num1" },
      { label: "Labor vs. allowable", get: (r) => p(r.labor_variance_pct), style: "pct" },
      { label: "Labor cost %", get: (r) => p(r.labor_cost_pct), style: "pct" },
      { label: "Guest rating", get: (r) => n(r.average_rating), style: "rating" },
      { label: "Surveys", get: (r) => n(r.survey_count), style: "int" },
      { label: "Status", left: true, get: (r) => SEV[severity.get(r.id)] || "" },
    ], rows);
  }

  return wb.toBuffer();
}
