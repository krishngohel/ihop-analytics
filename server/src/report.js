// The weekly PDF: the week in plain sentences first, then the charts and tables that back
// them up. Everything here is derived from the same rollups the dashboard shows, so the
// report never disagrees with the screen.
import { PdfDocument, lineChart, columnChart, barChart } from "./pdf-writer.js";
import { trendsData } from "./trends.js";
import { metrics, weatherSummary } from "./analytics.js";
import { evaluateHotspots } from "./hotspots.js";
import { prettyDate, addDays, dayOfWeek, eachDay } from "./dates.js";

const PAGE = { w: 612, h: 792, margin: 40 };
const INK = { text: "1F2937", muted: "6B7280", faint: "9CA3AF", line: "E5E7EB", band: "EEF3FB", accent: "1F56D8", good: "16803C", bad: "D03B3B" };
const COLOR = { actual: "2A78D6", forecast: "EB6834", lastYear: "1BAF7A" };
const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const has = (v) => v !== null && v !== undefined && !Number.isNaN(Number(v));
const money = (n) => (has(n) ? `${n < 0 ? "-" : ""}$${Math.round(Math.abs(n)).toLocaleString("en-US")}` : "–");
const moneyShort = (n) => (Math.abs(n) >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : Math.abs(n) >= 1e3 ? `$${Math.round(n / 1e3)}k` : `$${Math.round(n)}`);
const pctS = (n) => (has(n) ? `${n > 0 ? "+" : ""}${Number(n).toFixed(Math.abs(n) >= 100 ? 0 : 1)}%` : "–");
const pctPlain = (n) => `${Math.abs(Number(n)).toFixed(1)}%`;
const hours = (n) => (has(n) ? `${Math.round(n).toLocaleString("en-US")} hrs` : "–");
const num = (n) => (has(n) ? Math.round(n).toLocaleString("en-US") : "–");
const shortName = (s) => String(s || "").replace(/^IHOP /, "");
const dayLabel = (d) => `${DAY[dayOfWeek(d)]} ${Number(d.slice(8, 10))}`;
const longDate = (d) => prettyDate(d).replace(/^\w+, /, "");

// ---- the words -----------------------------------------------------------------------------
function narrative(t, hs, weather, { scopeName, from, to, partial }) {
  const tot = t.totals || {};
  const lines = [];
  const n = tot.restaurants || 0;
  if (!has(tot.actual_sales)) return [`No sales are on file for ${scopeName} in the week of ${longDate(from)}.`];

  // Sales
  let s = `${scopeName} took ${money(tot.actual_sales)} in sales across ${n} restaurant${n === 1 ? "" : "s"}`;
  if (has(tot.sales_variance_pct)) s += `, ${Math.abs(tot.sales_variance_pct) < 0.1 ? "right on forecast" : `${tot.sales_variance_pct > 0 ? "ahead of" : "behind"} forecast by ${pctPlain(tot.sales_variance_pct)} (${money(Math.abs(tot.sales_variance))})`}`;
  if (has(tot.prior_year_variance_pct)) s += ` and ${tot.prior_year_variance_pct >= 0 ? "up" : "down"} ${pctPlain(tot.prior_year_variance_pct)} on the same week last year`;
  lines.push(s + ".");

  // Best and worst day
  const days = t.daily.filter((d) => has(d.actual_sales));
  if (days.length > 1) {
    const top = [...days].sort((a, b) => b.actual_sales - a.actual_sales)[0];
    const withVar = days.filter((d) => has(d.sales_variance_pct));
    let line = `${DAY_LONG[dayOfWeek(top.date)]} was the biggest day at ${money(top.actual_sales)}`;
    if (withVar.length > 1) {
      const worst = [...withVar].sort((a, b) => a.sales_variance_pct - b.sales_variance_pct)[0];
      const best = [...withVar].sort((a, b) => b.sales_variance_pct - a.sales_variance_pct)[0];
      line += worst.sales_variance_pct < 0 ? `; ${DAY_LONG[dayOfWeek(worst.date)]} came in furthest below forecast (${pctS(worst.sales_variance_pct)})` : `; every day landed at or above forecast`;
      if (best.sales_variance_pct > 0 && best !== worst) line += `, and ${DAY_LONG[dayOfWeek(best.date)]} beat it by the most (${pctS(best.sales_variance_pct)})`;
    }
    lines.push(line + ".");
  }

  // Labor
  if (has(tot.actual_labor_hours)) {
    let l = `Labor ran ${hours(tot.actual_labor_hours)} against ${hours(tot.allowable_labor_hours)} allowable`;
    if (has(tot.labor_variance_pct)) l += `, ${Math.abs(tot.labor_variance_pct) < 0.1 ? "exactly on plan" : `${tot.labor_variance_pct > 0 ? "over" : "under"} by ${pctPlain(tot.labor_variance_pct)}`}`;
    if (has(tot.labor_cost_pct)) l += `; labor cost was ${tot.labor_cost_pct}% of sales (${money(tot.actual_labor_cost)})`;
    lines.push(l + ".");
  } else lines.push("No labor figures are on file for this week yet.");

  // Groups
  const groups = t.breakdown.filter((g) => has(g.sales_variance_pct));
  if (groups.length > 1) {
    const best = groups[groups.length - 1]; const worst = groups[0];
    const level = t.breakdownLevel === "store" ? "restaurant" : t.breakdownLevel;
    lines.push(`Among ${level}s, ${shortName(best.name)} led at ${pctS(best.sales_variance_pct)} against forecast while ${shortName(worst.name)} trailed at ${pctS(worst.sales_variance_pct)}.`);
  }

  // Dayparts
  const dps = t.dayparts.filter((d) => has(d.actual_sales) && d.actual_sales > 0);
  if (dps.length) {
    const total = dps.reduce((a, d) => a + d.actual_sales, 0);
    const biggest = [...dps].sort((a, b) => b.actual_sales - a.actual_sales)[0];
    let d = `${biggest.label} was the largest daypart at ${Math.round((biggest.actual_sales / total) * 100)}% of sales`;
    const withVar = dps.filter((x) => has(x.sales_variance_pct));
    if (withVar.length) { const off = [...withVar].sort((a, b) => Math.abs(b.sales_variance_pct) - Math.abs(a.sales_variance_pct))[0]; d += `; ${off.label.toLowerCase()} was the daypart furthest from forecast (${pctS(off.sales_variance_pct)})`; }
    lines.push(d + ".");
  }

  // Hotspots
  if (hs.hotspots.length) {
    const crit = hs.hotspots.filter((h) => h.severity === "critical");
    const names = hs.hotspots.slice(0, 4).map((h) => shortName(h.name));
    lines.push(`${hs.hotspots.length} restaurant${hs.hotspots.length === 1 ? "" : "s"} need${hs.hotspots.length === 1 ? "s" : ""} attention${crit.length ? ` (${crit.length} critical)` : ""}: ${names.join(", ")}${hs.hotspots.length > 4 ? ` and ${hs.hotspots.length - 4} more` : ""}. Details are on the last page.`);
  } else lines.push("No restaurants were flagged for attention this week.");
  if (hs.positives.length) lines.push(`On the bright side, ${hs.positives.slice(0, 3).map((p) => `${shortName(p.name)} (${pctS(p.sales_variance_pct)})`).join(", ")} outperformed forecast.`);

  // Guest and weather
  lines.push(tot.survey_count ? `Guests rated the week ${Number(tot.average_rating).toFixed(1)} out of 5 across ${num(tot.survey_count)} surveys.` : "No guest surveys are on file for this week.");
  const rainy = weather.filter((w) => w.rain > 0);
  if (rainy.length) lines.push(`Rain reached ${Math.max(...rainy.map((w) => w.rain))} restaurants on the wettest day (${DAY_LONG[dayOfWeek(rainy.sort((a, b) => b.rain - a.rain)[0].date)]}); ${rainy.length} of ${weather.length} days had rain somewhere. Weather is shown as context, not as an explanation.`);
  else if (weather.some((w) => w.restaurants)) lines.push("No rain was recorded at any restaurant this week.");

  // Coverage
  const covered = t.daily.filter((d) => has(d.forecast_basis)).length;
  if (partial) lines.push(`This week is still in progress: results run through ${longDate(to)}.`);
  if (covered && covered < t.daily.length) lines.push(`Forecast and last-year comparisons are on file for ${covered} of the ${t.daily.length} days, and only those days are compared.`);
  return lines;
}

// ---- layout helpers -------------------------------------------------------------------------
class Layout {
  constructor(doc, title, subtitle) { this.doc = doc; this.title = title; this.subtitle = subtitle; this.n = 0; this.page = null; this.y = 0; this.newPage(); }
  newPage() {
    this.n += 1;
    const p = this.doc.addPage(); this.page = p;
    p.rect(0, 0, PAGE.w, 6, { fill: INK.accent });
    p.text(this.title, PAGE.margin, 30, { size: 8.5, bold: true, color: INK.muted });
    p.text(this.subtitle, PAGE.w - PAGE.margin, 30, { size: 8.5, color: INK.muted, align: "right" });
    p.line(PAGE.margin, 38, PAGE.w - PAGE.margin, 38, { color: INK.line });
    p.text(`Page ${this.n}`, PAGE.w - PAGE.margin, PAGE.h - 22, { size: 8, color: INK.faint, align: "right" });
    p.text("IHOP Operations · generated from Rosnet results, weather from Open-Meteo", PAGE.margin, PAGE.h - 22, { size: 8, color: INK.faint });
    this.y = 56;
  }
  need(h) { if (this.y + h > PAGE.h - 40) this.newPage(); }
  heading(text, sub) {
    this.need(90);
    this.page.text(text, PAGE.margin, this.y + 12, { size: 14, bold: true, color: INK.text });
    if (sub) this.page.text(sub, PAGE.margin, this.y + 26, { size: 9, color: INK.muted });
    this.y += sub ? 36 : 24;
  }
  gap(h = 10) { this.y += h; }
}

/** A table with right-aligned numbers and a header band; breaks across pages. */
function table(L, columns, rows, { rowH = 16, zebra = true } = {}) {
  const x0 = PAGE.margin; const width = PAGE.w - PAGE.margin * 2;
  const totalW = columns.reduce((a, c) => a + c.w, 0);
  const cols = columns.map((c) => ({ ...c, w: (c.w / totalW) * width }));
  const header = () => {
    L.page.rect(x0, L.y, width, rowH, { fill: INK.band });
    let cx = x0;
    for (const c of cols) { L.page.text(c.label, c.align === "right" ? cx + c.w - 6 : cx + 6, L.y + rowH * 0.68, { size: 8, bold: true, color: INK.text, align: c.align || "left", maxWidth: c.w - 10 }); cx += c.w; }
    L.y += rowH;
  };
  L.need(rowH * Math.min(rows.length + 1, 12) + 4); header(); // short tables stay on one page
  rows.forEach((r, i) => {
    if (L.y + rowH > PAGE.h - 40) { L.newPage(); header(); }
    if (zebra && i % 2 === 1) L.page.rect(x0, L.y, width, rowH, { fill: "F9FAFB" });
    let cx = x0;
    for (const c of cols) {
      const cell = c.get(r);
      const v = cell && typeof cell === "object" ? cell : { text: cell };
      const lines = v.lines || [v.text ?? "–"];
      lines.forEach((text, k) => L.page.text(text, c.align === "right" ? cx + c.w - 6 : cx + 6, L.y + (lines.length > 1 ? 10.5 + k * 10 : rowH * 0.68), { size: 8, bold: Boolean(v.bold), color: v.color || INK.text, align: c.align || "left", maxWidth: c.w - 10 }));
      cx += c.w;
    }
    L.page.line(x0, L.y + rowH, x0 + width, L.y + rowH, { color: INK.line, width: 0.3 });
    L.y += rowH;
  });
}

const toneOf = (v, goodWhenPositive = true) => (!has(v) ? INK.muted : (v >= 0) === goodWhenPositive ? INK.good : INK.bad);
const cell = (v, fmt, goodWhenPositive = true) => ({ text: fmt(v), color: toneOf(v, goodWhenPositive), bold: has(v) });

function tiles(L, items) {
  const width = PAGE.w - PAGE.margin * 2; const gap = 10; const tw = (width - gap * (items.length - 1)) / items.length; const th = 62;
  L.need(th + 6);
  items.forEach((it, i) => {
    const x = PAGE.margin + i * (tw + gap);
    L.page.rect(x, L.y, tw, th, { fill: "FFFFFF", stroke: INK.line, radius: 6 });
    L.page.text(it.label, x + 10, L.y + 16, { size: 8, color: INK.muted });
    L.page.text(it.value, x + 10, L.y + 38, { size: 17, bold: true, color: INK.text, maxWidth: tw - 20 });
    if (it.delta) L.page.text(it.delta, x + 10, L.y + 53, { size: 8.5, bold: true, color: it.deltaColor || INK.muted, maxWidth: tw - 20 });
  });
  L.y += th + 6;
}

// ---- the report -----------------------------------------------------------------------------
export function buildWeeklyReport(user, { from, to, filters = {} }, { scopeName }) {
  const t = trendsData(user, { from, to, daypart: "all", filters });
  const hs = evaluateHotspots(user, { from, to, filters });
  const weather = eachDay(from, to).map((d) => weatherSummary(user, d, filters));
  const partial = to < addDays(from, 6);
  const weekLabel = `Week of ${longDate(from)}${partial ? ` (through ${longDate(to)})` : ""}`;
  const doc = new PdfDocument({ title: `IHOP Weekly Report – ${scopeName} – ${weekLabel}` });
  const L = new Layout(doc, "IHOP Operations · Weekly report", `${scopeName} · ${weekLabel}`);
  const tot = t.totals || {};
  const p = L.page;

  // Title block
  p.text("Weekly operations report", PAGE.margin, L.y + 20, { size: 22, bold: true, color: INK.text });
  p.text(`${scopeName} · ${weekLabel} · prepared ${new Date().toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}`, PAGE.margin, L.y + 38, { size: 9.5, color: INK.muted });
  L.y += 52;

  tiles(L, [
    { label: "Sales", value: has(tot.actual_sales) ? money(tot.actual_sales) : "–", delta: has(tot.sales_variance_pct) ? `${pctS(tot.sales_variance_pct)} vs. forecast` : "no forecast on file", deltaColor: toneOf(tot.sales_variance_pct) },
    { label: "Against last year", value: has(tot.prior_year_variance_pct) ? pctS(tot.prior_year_variance_pct) : "–", delta: has(tot.prior_year_sales) ? `last year ${money(tot.prior_year_sales)}` : "no prior year on file", deltaColor: INK.muted },
    { label: "Labor vs. allowable", value: has(tot.labor_variance_pct) ? pctS(tot.labor_variance_pct) : "–", delta: has(tot.actual_labor_hours) ? `${hours(tot.actual_labor_hours)} of ${hours(tot.allowable_labor_hours)}` : "no labor on file", deltaColor: toneOf(tot.labor_variance_pct, false) },
    { label: "Need attention", value: String(hs.hotspots.length), delta: (() => { const c = hs.hotspots.filter((h) => h.severity === "critical").length; return c ? `${c} critical · of ${hs.restaurants}` : `of ${hs.restaurants} restaurants`; })(), deltaColor: hs.hotspots.length ? INK.bad : INK.good },
  ]);

  L.heading("The week in brief");
  for (const line of narrative(t, hs, weather, { scopeName, from, to, partial })) {
    L.need(30);
    L.page.circle(PAGE.margin + 4, L.y - 3, 1.6, INK.accent);
    L.y = L.page.paragraph(line, PAGE.margin + 14, L.y, PAGE.w - PAGE.margin * 2 - 14, { size: 9.5, leading: 13.5 });
    L.y += 3;
  }

  // Daily sales chart
  L.gap(6); L.need(190);
  const cats = t.daily.map((d) => dayLabel(d.date));
  lineChart(L.page, { x: PAGE.margin, y: L.y, w: PAGE.w - PAGE.margin * 2, h: 180, categories: cats, format: moneyShort, title: "Sales by day: actual against forecast and last year", series: [
    { label: "Actual", values: t.daily.map((d) => (has(d.actual_sales) ? d.actual_sales : null)), color: COLOR.actual, width: 2 },
    { label: "Forecast", values: t.daily.map((d) => (has(d.forecast_basis) ? d.forecast_basis : null)), color: COLOR.forecast, dashed: true },
    { label: "Last year", values: t.daily.map((d) => (d.is_final === 1 && has(d.prior_year_sales) ? d.prior_year_sales : null)), color: COLOR.lastYear },
  ] });
  L.y += 188;

  // Groups ranked + dayparts, side by side
  L.need(200);
  const half = (PAGE.w - PAGE.margin * 2 - 16) / 2;
  const levelName = t.breakdownLevel === "store" ? "Restaurants" : t.breakdownLevel === "area" ? "Areas" : "Regions";
  const ranked = t.breakdown.slice(0, 12);
  barChart(L.page, { x: PAGE.margin, y: L.y, w: half, h: 190, title: `${levelName} against forecast`, format: pctS, good: (v) => v >= 0, rows: ranked.map((g) => ({ label: shortName(g.name), value: has(g.sales_variance_pct) ? g.sales_variance_pct : null })) });
  columnChart(L.page, { x: PAGE.margin + half + 16, y: L.y, w: half, h: 190, title: "Sales by daypart", format: moneyShort, categories: t.dayparts.map((d) => d.label), series: [
    { label: "Actual", values: t.dayparts.map((d) => (has(d.actual_sales) ? d.actual_sales : null)), color: COLOR.actual },
    { label: "Forecast", values: t.dayparts.map((d) => (has(d.forecast_basis) ? d.forecast_basis : null)), color: COLOR.forecast },
    { label: "Last year", values: t.dayparts.map((d) => (has(d.prior_year_sales) ? d.prior_year_sales : null)), color: COLOR.lastYear },
  ] });
  L.y += 198;

  // ---- Day by day and the groups ------------------------------------------------------------
  L.gap(10);
  L.heading("Day by day", "Sales compare with the forecast for that day; last year is the same weekday 52 weeks earlier. Labor is against allowable hours.");
  table(L, [
    { label: "Day", w: 16, get: (d) => `${DAY_LONG[dayOfWeek(d.date)]} ${longDate(d.date).replace(/, \d{4}$/, "")}` },
    { label: "Sales", w: 12, align: "right", get: (d) => money(d.actual_sales) },
    { label: "Forecast", w: 12, align: "right", get: (d) => money(d.forecast_basis) },
    { label: "vs. forecast", w: 11, align: "right", get: (d) => cell(d.sales_variance_pct, pctS) },
    { label: "vs. last year", w: 11, align: "right", get: (d) => cell(d.prior_year_variance_pct, pctS) },
    { label: "Labor hrs", w: 10, align: "right", get: (d) => num(d.actual_labor_hours) },
    { label: "Labor var.", w: 10, align: "right", get: (d) => cell(d.labor_variance_pct, pctS, false) },
    { label: "Labor cost", w: 10, align: "right", get: (d) => (has(d.labor_cost_pct) ? `${d.labor_cost_pct}%` : "–") },
    { label: "Rain", w: 9, align: "right", get: (d) => { const w = weather.find((x) => x.date === d.date); return w?.restaurants ? `${w.rain} of ${w.restaurants}` : "–"; } },
  ], t.daily);

  L.gap(14); L.need(170);
  lineChart(L.page, { x: PAGE.margin, y: L.y, w: PAGE.w - PAGE.margin * 2, h: 160, categories: cats, format: (v) => `${Math.round(v / 1000)}k`, title: "Labor hours by day against allowable", zero: false, series: [
    { label: "Actual hours", values: t.daily.map((d) => (has(d.actual_labor_hours) ? d.actual_labor_hours : null)), color: COLOR.actual, width: 2 },
    { label: "Allowable hours", values: t.daily.map((d) => (has(d.allowable_labor_hours) ? d.allowable_labor_hours : null)), color: COLOR.forecast, dashed: true },
  ] });
  L.y += 170;

  L.gap(8);
  L.heading(`${levelName} this week`, "Ranked from furthest below forecast to furthest above.");
  const hotspotBy = new Map();
  for (const h of hs.hotspots) { const k = t.breakdownLevel === "store" ? h.id : t.breakdownLevel === "area" ? h.area_id : h.region_id; hotspotBy.set(k, (hotspotBy.get(k) || 0) + 1); }
  table(L, [
    { label: levelName.replace(/s$/, ""), w: 22, get: (g) => shortName(g.name) },
    { label: "Rest.", w: 7, align: "right", get: (g) => num(g.restaurants) },
    { label: "Sales", w: 13, align: "right", get: (g) => money(g.actual_sales) },
    { label: "vs. forecast", w: 11, align: "right", get: (g) => cell(g.sales_variance_pct, pctS) },
    { label: "vs. last year", w: 11, align: "right", get: (g) => cell(g.prior_year_variance_pct, pctS) },
    { label: "Labor var.", w: 10, align: "right", get: (g) => cell(g.labor_variance_pct, pctS, false) },
    { label: "Labor cost", w: 10, align: "right", get: (g) => (has(g.labor_cost_pct) ? `${g.labor_cost_pct}%` : "–") },
    { label: "Rating", w: 8, align: "right", get: (g) => (has(g.average_rating) ? Number(g.average_rating).toFixed(1) : "–") },
    { label: "Flagged", w: 8, align: "right", get: (g) => String(hotspotBy.get(g.id) || 0) },
  ], t.breakdown);

  // ---- Page 3: restaurants to look at ---------------------------------------------------------
  L.newPage();
  L.heading("Restaurants to look at", `The bottom ${Math.round(hs.share * 100)}% by sales and labor, plus any unusual drop or possible opening-time issue. ${hs.hotspots.length} of ${hs.restaurants} this week.`);
  const SEV = { critical: { text: "Critical", color: INK.bad }, needs_review: { text: "Review", color: "B45309" }, watch: { text: "Watch", color: INK.muted } };
  if (hs.hotspots.length) {
    table(L, [
      { label: "Restaurant", w: 17, get: (h) => ({ text: shortName(h.name), bold: true }) },
      { label: "Area", w: 12, get: (h) => h.area_name },
      { label: "Status", w: 8, get: (h) => ({ text: SEV[h.severity]?.text || "", color: SEV[h.severity]?.color, bold: true }) },
      { label: "Sales", w: 9, align: "right", get: (h) => money(h.actual_sales) },
      { label: "Forecast", w: 9, align: "right", get: (h) => cell(h.sales_variance_pct, pctS) },
      { label: "Last yr", w: 8, align: "right", get: (h) => cell(h.prior_year_variance_pct, pctS) },
      { label: "Labor", w: 8, align: "right", get: (h) => cell(h.labor_variance_pct, pctS, false) },
      { label: "Why", w: 36, get: (h) => ({ lines: (h.flags || []).slice(0, 2) }) },
    ], hs.hotspots.slice(0, 40), { rowH: 24 });
  } else { L.page.text("Nothing flagged this week.", PAGE.margin, L.y + 10, { size: 9.5, color: INK.muted }); L.y += 20; }

  if (hs.positives.length) {
    L.gap(16);
    L.heading("Outperformers", "Restaurants furthest above forecast this week.");
    table(L, [
      { label: "Restaurant", w: 22, get: (h) => ({ text: shortName(h.name), bold: true }) },
      { label: "Area", w: 16, get: (h) => h.area_name },
      { label: "Sales", w: 12, align: "right", get: (h) => money(h.actual_sales) },
      { label: "vs. forecast", w: 11, align: "right", get: (h) => cell(h.sales_variance_pct, pctS) },
      { label: "vs. last year", w: 11, align: "right", get: (h) => cell(h.prior_year_variance_pct, pctS) },
      { label: "Labor var.", w: 10, align: "right", get: (h) => cell(h.labor_variance_pct, pctS, false) },
    ], hs.positives.slice(0, 10));
  }

  // Every restaurant, for the reader who wants the full list.
  const stores = t.breakdownLevel === "store" ? t.breakdown : metrics(user, { from, to, daypart: "all", groupBy: "store", filters }).sort((a, b) => (a.sales_variance_pct ?? 0) - (b.sales_variance_pct ?? 0));
  if (stores.length > 1 && t.breakdownLevel !== "store") {
    L.newPage();
    L.heading("Every restaurant", `All ${stores.length}, ranked from furthest below forecast to furthest above.`);
    const sev = new Map(hs.evaluated.map((s) => [s.id, s.severity]));
    table(L, [
      { label: "Restaurant", w: 20, get: (s) => shortName(s.name) },
      { label: "Area", w: 15, get: (s) => s.area_name },
      { label: "Sales", w: 11, align: "right", get: (s) => money(s.actual_sales) },
      { label: "vs. forecast", w: 10, align: "right", get: (s) => cell(s.sales_variance_pct, pctS) },
      { label: "vs. last year", w: 10, align: "right", get: (s) => cell(s.prior_year_variance_pct, pctS) },
      { label: "Labor hrs", w: 9, align: "right", get: (s) => num(s.actual_labor_hours) },
      { label: "vs. allow.", w: 9, align: "right", get: (s) => cell(s.labor_variance_pct, pctS, false) },
      { label: "Rating", w: 7, align: "right", get: (s) => (has(s.average_rating) ? Number(s.average_rating).toFixed(1) : "–") },
      { label: "Status", w: 10, get: (s) => ({ text: SEV[sev.get(s.id)]?.text || (sev.get(s.id) === "positive_outlier" ? "Outperforming" : ""), color: SEV[sev.get(s.id)]?.color || INK.good }) },
    ], stores, { rowH: 14 });
  }

  L.gap(14); L.need(60);
  L.page.text("How to read this", PAGE.margin, L.y + 10, { size: 9, bold: true, color: INK.text });
  L.y = L.page.paragraph("Sales compare with Rosnet's forecast for the same days and with the same weekday 52 weeks earlier, so a Saturday is never compared with a Friday. Labor compares actual hours with allowable hours. Percentages are re-divided from totals, never averaged, so a region's figure always matches its restaurants. Only days that have both sides of a comparison on file are compared.", PAGE.margin, L.y + 24, PAGE.w - PAGE.margin * 2, { size: 8.5, color: INK.muted, leading: 12 });

  return doc.toBuffer();
}
