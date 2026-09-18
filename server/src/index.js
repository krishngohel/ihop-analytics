import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import db, { DAYPARTS, DAYPART_LABELS, allSettings, setSetting, audit } from "./db.js";
import { attachUser, requireAuth, requireRole, login, logout, publicUser, canAccess, createUser, generatePassword } from "./auth.js";
import { metrics, companyTotals, dailySeries, weatherSummary, hierarchy, dataBounds } from "./analytics.js";
import { evaluateHotspots, hotspotsByCategory, hotspotCounts, CATEGORIES, UNUSUAL_DROP_PCT, CRITICAL_SALES_PCT, CRITICAL_LABOR_PCT } from "./hotspots.js";
import { buildDailySummary, storedDailySummary } from "./summary.js";
import { forecastForm, forecastRollup, saveForecast, nextWeekStart } from "./forecast.js";
import crypto from "crypto";
import { ingestFile, previewFile, listProfiles, deleteProfile, templateWorkbook, listPending, readPending, removePending, importPending } from "./imports.js";
import { runRefresh, refreshStatus, startScheduler, dataFreshness } from "./refresh.js";
import { describeConnections, saveConnectionValues } from "./connections.js";
import { testRosnet, rosnetConfig } from "./sources/rosnet.js";
import { testMailbox, mailboxConfig } from "./mailbox.js";
import { storeDailySummary } from "./summary.js";
import { weatherContext } from "./weather.js";
import { addDays, comparableLastYear, fiscalPeriod, isDay, today, weekStart, yesterday, prettyDate } from "./dates.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  next();
});
app.use(attachUser);

// ---- auth -------------------------------------------------------------------------
app.post("/api/auth/login", login);
app.post("/api/auth/logout", logout);
const noUsersYet = () => db.prepare("SELECT COUNT(*) n FROM app_user").get().n === 0;
app.get("/api/auth/me", (req, res) => res.json({ user: publicUser(req.user), needs_setup: noUsersYet() }));

// Only works while there are no accounts at all. After that, executives add people under Data and refresh.
app.post("/api/auth/setup", (req, res, next) => {
  if (!noUsersYet()) return res.status(403).json({ error: "Setup is already complete. Sign in instead." });
  const { email, display_name, password } = req.body || {};
  if (!email || !display_name || String(password || "").length < 10) return res.status(400).json({ error: "Enter a name, an email and a password of at least 10 characters" });
  createUser({ email, display_name, role: "executive", password });
  audit(email, "first_administrator_created");
  login(req, res, next);
});

// ---- push endpoint for the vendor system (or a scheduled job on the client's side) -------
// POST /api/ingest with "Authorization: Bearer <INGEST_TOKEN>". Send report files as
// multipart form data (any field name) or a single CSV as the raw request body. Disabled
// unless INGEST_TOKEN is set. The token only allows adding data, never reading it.
app.post("/api/ingest", upload.any(), express.raw({ type: ["text/csv", "text/plain", "application/octet-stream", "application/vnd.ms-excel"], limit: "25mb" }), (req, res) => {
  const expected = process.env.INGEST_TOKEN;
  if (!expected) return res.status(404).json({ error: "Not found" });
  const given = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const ok = given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  if (!ok) { audit(null, "ingest_rejected", `bad token from ${req.ip}`); return res.status(401).json({ error: "Invalid token" }); }
  const files = (req.files || []).map((f) => ({ buffer: f.buffer, name: f.originalname }));
  if (!files.length && Buffer.isBuffer(req.body) && req.body.length) files.push({ buffer: req.body, name: String(req.query.filename || "pushed.csv") });
  if (!files.length) return res.status(400).json({ error: "Send at least one CSV or Excel file" });
  const results = files.map((f) => ({ file: f.name, ...ingestFile(f.buffer, { channel: "push", filename: f.name, sender: req.ip }) }));
  if (results.some((r) => r.imported > 0)) { try { storeDailySummary(yesterday()); } catch { /* summary is rebuilt on the next refresh */ } }
  res.status(results.every((r) => r.imported > 0) ? 200 : 207).json({ results: results.map(({ file, imported, skipped, status, errors }) => ({ file, imported, skipped, status, errors })) });
});

app.use("/api", requireAuth);

// ---- helpers ----------------------------------------------------------------------
function lastFinalDay() {
  return dataBounds().last_final_day || yesterday();
}

function readRange(req) {
  const fallback = lastFinalDay();
  const to = isDay(req.query.to) ? req.query.to : isDay(req.query.date) ? req.query.date : fallback;
  let from = isDay(req.query.from) ? req.query.from : isDay(req.query.date) ? req.query.date : to;
  if (from > to) from = to;
  const daypart = ["all", ...DAYPARTS].includes(req.query.daypart) ? req.query.daypart : "all";
  const filters = { regionId: req.query.regionId || null, areaId: req.query.areaId || null };
  return { from, to, daypart, filters };
}

const withHotspotCounts = (rows, counts) => rows.map((r) => ({ ...r, hotspot_count: counts.get(r.id) || 0 }));

// ---- meta -------------------------------------------------------------------------
app.get("/api/meta", (req, res) => {
  const bounds = dataBounds();
  const lastFinal = bounds.last_final_day || yesterday();
  res.json({
    user: publicUser(req.user),
    hierarchy: hierarchy(req.user),
    dayparts: ["all", ...DAYPARTS].map((d) => ({ key: d, label: DAYPART_LABELS[d] })),
    hotspot_categories: CATEGORIES,
    hotspot_share: Number(allSettings().hotspot_share),
    unusual_drop_pct: UNUSUAL_DROP_PCT, critical_sales_pct: CRITICAL_SALES_PCT, critical_labor_pct: CRITICAL_LABOR_PCT,
    bounds, today: today(), last_final_day: lastFinal,
    period: fiscalPeriod(lastFinal),
    data_source: allSettings().data_source,
    next_forecast_week: nextWeekStart(),
    freshness: dataFreshness(),
  });
});

// ---- 1. company-level overview ------------------------------------------------------
app.get("/api/overview", (req, res) => {
  const { from, to, daypart, filters } = readRange(req);
  const lastFinal = lastFinalDay();
  const period = fiscalPeriod(lastFinal);
  const live = dataBounds().live_day;
  const hs = evaluateHotspots(req.user, { from, to, daypart, filters });
  const level = filters.areaId ? "store" : filters.regionId ? "area" : "region";
  const trendFrom = addDays(to, -27) < from ? addDays(to, -27) : from;
  res.json({
    range: { from, to, daypart },
    selected: companyTotals(req.user, { from, to, daypart, filters }),
    today: live ? { date: live, ...(companyTotals(req.user, { from: live, to: live, daypart, filters }) || {}) } : null,
    yesterday: { date: lastFinal, ...(companyTotals(req.user, { from: lastFinal, to: lastFinal, daypart, filters }) || {}) },
    periodToDate: { ...period, through: lastFinal, ...(companyTotals(req.user, { from: period.from, to: lastFinal, daypart, filters }) || {}) },
    trend: dailySeries(req.user, { from: trendFrom, to, daypart, filters }),
    breakdownLevel: level,
    breakdown: withHotspotCounts(metrics(req.user, { from, to, daypart, groupBy: level, filters }), hotspotCounts(hs, level === "region" ? "region_id" : level === "area" ? "area_id" : "id"))
      .sort((a, b) => (a.sales_variance_pct ?? 0) - (b.sales_variance_pct ?? 0)),
    dayparts: DAYPARTS.map((dp) => ({ daypart: dp, label: DAYPART_LABELS[dp], ...(companyTotals(req.user, { from, to, daypart: dp, filters }) || {}) })),
    weather: { current: weatherSummary(req.user, to, filters), lastYear: weatherSummary(req.user, comparableLastYear(to), filters) },
    hotspots: { count: hs.hotspots.length, restaurants: hs.restaurants, share: hs.share, critical: hs.hotspots.filter((h) => h.severity === "critical").length, top: hs.hotspots.slice(0, 6), positives: hs.positives.slice(0, 4) },
  });
});

// ---- 2. hotspots --------------------------------------------------------------------
app.get("/api/hotspots", (req, res) => {
  const { from, to, daypart, filters } = readRange(req);
  const hs = evaluateHotspots(req.user, { from, to, daypart, filters });
  const category = CATEGORIES[req.query.category] ? req.query.category : "overall";
  const counts = Object.fromEntries(Object.keys(CATEGORIES).map((c) => [c, hotspotsByCategory(hs, c).length]));
  res.json({
    from, to, daypart, category, share: hs.share, restaurants: hs.restaurants, listSize: hs.listSize, counts,
    lastYearFrom: comparableLastYear(from), lastYearTo: comparableLastYear(to),
    hotspots: hotspotsByCategory(hs, category), watch: category === "overall" ? hs.watch : [], positives: hs.positives,
  });
});

// ---- 3. drill-down: region -> area -> store ---------------------------------------------
app.get("/api/rollup", (req, res) => {
  const { from, to, daypart, filters } = readRange(req);
  const level = ["region", "area", "store"].includes(req.query.level) ? req.query.level : "region";
  const hs = evaluateHotspots(req.user, { from, to, daypart, filters });
  const key = level === "region" ? "region_id" : level === "area" ? "area_id" : "id";
  const rows = withHotspotCounts(metrics(req.user, { from, to, daypart, groupBy: level, filters }), hotspotCounts(hs, key));
  const evalById = new Map(hs.evaluated.map((s) => [s.id, s]));
  res.json({
    from, to, daypart, level,
    parent: filters.areaId ? db.prepare("SELECT a.*, g.region_name FROM area a JOIN region g ON g.region_id = a.region_id WHERE a.area_id = ?").get(Number(filters.areaId))
      : filters.regionId ? db.prepare("SELECT * FROM region WHERE region_id = ?").get(Number(filters.regionId)) : null,
    totals: companyTotals(req.user, { from, to, daypart, filters }),
    rows: rows.map((r) => (level === "store" ? { ...r, severity: evalById.get(r.id)?.severity || null, flags: evalById.get(r.id)?.flags || [], weather_note: evalById.get(r.id)?.weather_note || null } : r)),
  });
});

app.get("/api/stores/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!canAccess(req.user, { restaurantId: id })) return res.status(404).json({ error: "Restaurant not found" });
  const { from, to, daypart } = readRange(req);
  const filters = { restaurantId: id };
  const restaurant = db.prepare(`SELECT r.*, a.area_name, a.area_manager, g.region_name FROM restaurant r
    JOIN area a ON a.area_id = r.area_id JOIN region g ON g.region_id = r.region_id WHERE r.restaurant_id = ?`).get(id);
  const lastFinal = lastFinalDay();
  const period = fiscalPeriod(lastFinal);
  const live = dataBounds().live_day;

  const weatherRows = new Map(db.prepare("SELECT * FROM weather WHERE restaurant_id = ?").all(id).map((w) => [w.date, w]));
  const withWeather = (d) => {
    const current = weatherRows.get(d.date) || null;
    const lastYear = weatherRows.get(comparableLastYear(d.date)) || null;
    return { ...d, weather: current, weatherLastYear: lastYear, weatherContext: weatherContext(current, lastYear) };
  };
  const opening = new Map(db.prepare("SELECT date, opening_time_status FROM daily_performance WHERE restaurant_id = ? AND daypart = 'all'").all(id).map((r) => [r.date, r.opening_time_status]));
  const daily = dailySeries(req.user, { from, to, daypart, filters }).map((d) => withWeather({ ...d, opening_time_status: opening.get(d.date) || null }));

  // Weekly view: the last 13 full or partial weeks ending at the latest final day.
  const history = dailySeries(req.user, { from: addDays(weekStart(lastFinal), -84), to: lastFinal, daypart, filters });
  const sumGroup = (rows, label, extra = {}) => {
    const s = (k) => rows.reduce((t, r) => t + (r[k] || 0), 0);
    const actual = s("actual_sales"); const basis = s("forecast_basis"); const prior = s("prior_year_sales"); const finalActual = s("final_actual_sales");
    const hrs = s("actual_labor_hours"); const allow = s("allowable_labor_hours");
    const surveys = s("survey_count");
    return { label, ...extra, days: rows.length, actual_sales: actual, forecast_sales: s("forecast_sales"), prior_year_sales: prior,
      sales_variance: actual - basis, sales_variance_pct: basis ? Math.round(((actual - basis) / basis) * 1000) / 10 : null,
      prior_year_variance_pct: prior ? Math.round(((finalActual - prior) / prior) * 1000) / 10 : null,
      actual_labor_hours: hrs, allowable_labor_hours: allow, labor_variance: hrs - allow, labor_variance_pct: allow ? Math.round(((hrs - allow) / allow) * 1000) / 10 : null,
      survey_count: surveys, average_rating: surveys ? Math.round((rows.reduce((t, r) => t + (r.average_rating || 0) * (r.survey_count || 0), 0) / surveys) * 100) / 100 : null };
  };
  const byWeek = new Map();
  for (const d of history) { const w = weekStart(d.date); if (!byWeek.has(w)) byWeek.set(w, []); byWeek.get(w).push(d); }
  const weekly = [...byWeek.entries()].map(([w, rows]) => sumGroup(rows, w, { week_start: w, week_end: addDays(w, 6) }));
  const allHistory = dailySeries(req.user, { from: dataBounds().first_day || from, to: lastFinal, daypart, filters });
  const byPeriod = new Map();
  for (const d of allHistory) { const p = fiscalPeriod(d.date); const k = `${p.fiscalYearStart}|${p.number}`; if (!byPeriod.has(k)) byPeriod.set(k, { p, rows: [] }); byPeriod.get(k).rows.push(d); }
  const periods = [...byPeriod.values()].map(({ p, rows }) => sumGroup(rows, `Period ${p.number}`, { from: p.from, to: p.to }));

  // Recent anomalies: days in the last 28 that crossed a plain threshold.
  const recent = dailySeries(req.user, { from: addDays(lastFinal, -27), to: lastFinal, daypart: "all", filters }).map((d) => withWeather({ ...d, opening_time_status: opening.get(d.date) || null }));
  const anomalies = [];
  for (const d of recent) {
    const flags = [];
    if (d.sales_variance_pct !== null && d.sales_variance_pct <= -10) flags.push(`Sales down ${Math.abs(d.sales_variance_pct)}% vs. forecast`);
    if (d.prior_year_variance_pct !== null && d.prior_year_variance_pct <= -12) flags.push(`Sales down ${Math.abs(d.prior_year_variance_pct)}% vs. prior year`);
    if (d.labor_variance_pct !== null && d.labor_variance_pct >= 8) flags.push(`Labor ${d.labor_variance_pct}% above allowable hours`);
    if (["late", "disrupted"].includes(d.opening_time_status)) flags.push("Possible opening-time issue: needs review");
    if (d.sales_variance_pct !== null && d.sales_variance_pct >= 12) flags.push(`Sales up ${d.sales_variance_pct}% vs. forecast`);
    if (!flags.length) continue;
    const severe = d.sales_variance_pct <= UNUSUAL_DROP_PCT || d.prior_year_variance_pct <= UNUSUAL_DROP_PCT;
    anomalies.push({ date: d.date, label: prettyDate(d.date), flags, weather_note: d.weatherContext, positive: flags.length === 1 && flags[0].startsWith("Sales up"), severe,
      actual_sales: d.actual_sales, forecast_sales: d.forecast_sales, sales_variance_pct: d.sales_variance_pct, labor_variance_pct: d.labor_variance_pct });
  }

  const hsDay = evaluateHotspots(req.user, { from: lastFinal, to: lastFinal, filters: { areaId: restaurant.area_id } }).evaluated.find((s) => s.id === id);
  res.json({
    restaurant, range: { from, to, daypart },
    selected: companyTotals(req.user, { from, to, daypart, filters }),
    today: live ? { date: live, ...(companyTotals(req.user, { from: live, to: live, daypart, filters }) || {}) } : null,
    yesterday: { date: lastFinal, ...(companyTotals(req.user, { from: lastFinal, to: lastFinal, daypart, filters }) || {}) },
    periodToDate: { ...period, through: lastFinal, ...(companyTotals(req.user, { from: period.from, to: lastFinal, daypart, filters }) || {}) },
    areaAverage: (() => { const a = companyTotals(req.user, { from, to, daypart, filters: { areaId: restaurant.area_id } }); return a ? { sales_variance_pct: a.sales_variance_pct, labor_variance_pct: a.labor_variance_pct, prior_year_variance_pct: a.prior_year_variance_pct, average_rating: a.average_rating } : null; })(),
    daily, weekly, periods,
    dayparts: DAYPARTS.map((dp) => ({ daypart: dp, label: DAYPART_LABELS[dp], ...(companyTotals(req.user, { from, to, daypart: dp, filters }) || {}) })),
    anomalies: anomalies.reverse(),
    latestStatus: hsDay ? { severity: hsDay.severity, flags: hsDay.flags, weather_note: hsDay.weather_note, date: lastFinal } : null,
  });
});

// ---- daily morning summary -----------------------------------------------------------
app.get("/api/summary/daily", (req, res) => {
  const day = isDay(req.query.date) ? req.query.date : lastFinalDay();
  // Executives get the stored morning version when there is one; scoped users get their slice.
  const stored = req.user.role === "executive" && !req.query.fresh ? storedDailySummary(day) : null;
  const summary = stored || buildDailySummary(req.user, day);
  if (!summary) return res.status(404).json({ error: `No results on file for ${day}` });
  res.json({ ...summary, stored: Boolean(stored), scope: publicUser(req.user).scope_name });
});

// ---- weekly forecasting form ----------------------------------------------------------
const readWeek = (v) => (isDay(v) ? weekStart(v) : nextWeekStart());

app.get("/api/forecast/form", (req, res) => {
  res.json(forecastForm(req.user, readWeek(req.query.weekStart), { regionId: req.query.regionId || null, areaId: req.query.areaId || null }));
});

app.get("/api/forecast/rollup", (req, res) => res.json(forecastRollup(req.user, readWeek(req.query.weekStart))));

app.put("/api/forecast/submission", (req, res) => {
  if (!isDay(req.body?.week_start) || !req.body?.restaurant_id) return res.status(400).json({ error: "week_start and restaurant_id are required" });
  const out = saveForecast(req.user, { ...req.body, week_start: weekStart(req.body.week_start), restaurant_id: Number(req.body.restaurant_id) });
  if (out.status !== 200) return res.status(out.status).json({ error: out.error, problems: out.problems || [] });
  audit(req.user.email, req.body.submit ? "forecast_submitted" : "forecast_draft_saved", `week ${req.body.week_start}, restaurant ${req.body.restaurant_id}`);
  res.json(out.row);
});

// ---- refresh --------------------------------------------------------------------------
app.get("/api/refresh/status", (_req, res) => res.json(refreshStatus()));

app.post("/api/refresh", async (req, res) => {
  try {
    res.json(await runRefresh("manual", { userEmail: req.user.email }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put("/api/refresh/settings", requireRole("executive"), (req, res) => {
  const b = req.body || {};
  const time = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (b.daily_refresh_time !== undefined) { if (!time.test(b.daily_refresh_time)) return res.status(400).json({ error: "Daily refresh time must be HH:MM" }); setSetting("daily_refresh_time", b.daily_refresh_time); }
  if (b.operating_hours_start !== undefined && time.test(b.operating_hours_start)) setSetting("operating_hours_start", b.operating_hours_start);
  if (b.operating_hours_end !== undefined && time.test(b.operating_hours_end)) setSetting("operating_hours_end", b.operating_hours_end);
  if (b.intraday_refresh_enabled !== undefined) setSetting("intraday_refresh_enabled", b.intraday_refresh_enabled ? "1" : "0");
  if (b.intraday_refresh_minutes !== undefined) setSetting("intraday_refresh_minutes", Math.min(240, Math.max(5, Number(b.intraday_refresh_minutes) || 15)));
  audit(req.user.email, "refresh_settings_changed", JSON.stringify(b));
  res.json(refreshStatus());
});

// ---- connections (executive only): the automatic inputs, set up in the dashboard ---------
// Secrets are write-only: responses say whether one is on file, never what it is.
const setupStatus = () => {
  const count = (sql) => db.prepare(sql).get().n;
  const realStores = count("SELECT COUNT(*) n FROM restaurant WHERE is_demo = 0");
  // Reports landing by folder or push in the last few days count as connected too.
  const arriving = count("SELECT COUNT(*) n FROM ingest_file WHERE channel IN ('folder', 'push', 'mailbox') AND imported > 0 AND received_at > datetime('now', '-3 days')") > 0;
  return {
    connected: rosnetConfig().configured || (mailboxConfig().configured && mailboxConfig().allowed.length > 0) || arriving,
    rosnet_api: rosnetConfig().configured,
    mailbox: mailboxConfig().configured,
    trusted_senders: mailboxConfig().allowed.length > 0,
    restaurants: realStores,
    unassigned: count("SELECT COUNT(*) n FROM restaurant r JOIN area a ON a.area_id = r.area_id WHERE r.is_demo = 0 AND a.area_name = 'Unassigned'"),
    results: count("SELECT COUNT(*) n FROM daily_performance p JOIN restaurant r USING (restaurant_id) WHERE r.is_demo = 0 AND p.actual_sales IS NOT NULL") > 0,
    forecasts: count("SELECT COUNT(*) n FROM daily_performance p JOIN restaurant r USING (restaurant_id) WHERE r.is_demo = 0 AND p.forecast_sales IS NOT NULL") > 0,
    layouts: count("SELECT COUNT(*) n FROM import_profile"),
    pending: listPending().length,
  };
};

app.get("/api/connections", requireRole("executive"), (_req, res) => res.json({ fields: describeConnections(), setup: setupStatus() }));

app.put("/api/connections", requireRole("executive"), (req, res) => {
  const saved = saveConnectionValues(req.body || {});
  audit(req.user.email, "connections_changed", saved.join(", ")); // names only, never values
  res.json({ fields: describeConnections(), setup: setupStatus() });
});

app.post("/api/connections/test/:which", requireRole("executive"), async (req, res) => {
  const b = req.body || {};
  try {
    if (req.params.which === "rosnet") return res.json({ ok: true, ...(await testRosnet({ user: b.rosnet_api_user, key: b.rosnet_api_key, clientId: b.rosnet_client_id })) });
    if (req.params.which === "mailbox") return res.json({ ok: true, ...(await testMailbox({ user: b.reports_imap_user, password: b.reports_imap_password, host: b.reports_imap_host, port: b.reports_imap_port })) });
    return res.status(404).json({ error: "Unknown connection" });
  } catch (e) {
    return res.json({ ok: false, error: e.message });
  }
});

// ---- imports (executive only) -----------------------------------------------------------
// Step 1: look at a file. Returns the layout found, the column mapping and what is missing.
app.post("/api/import/preview", requireRole("executive"), upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Choose a CSV or Excel file" });
  try {
    res.json(previewFile(req.file.buffer, { kind: ["performance", "guest"].includes(req.body?.kind) ? req.body.kind : null }));
  } catch (e) {
    res.status(400).json({ error: `Couldn't read that file: ${e.message}` });
  }
});

// Step 2: import it. With a mapping and a profile name, that layout imports unattended from then on.
app.post("/api/import/commit", requireRole("executive"), upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Choose a CSV or Excel file" });
  try {
    let mapping = null;
    if (req.body?.mapping) mapping = JSON.parse(req.body.mapping);
    res.json(ingestFile(req.file.buffer, {
      channel: "upload", filename: req.file.originalname, userEmail: req.user.email,
      kind: ["performance", "guest"].includes(req.body?.kind) ? req.body.kind : null,
      mapping, saveProfileAs: req.body?.profileName ? String(req.body.profileName).slice(0, 80) : null,
    }));
  } catch (e) {
    audit(req.user.email, "import_error", e.message);
    res.status(400).json({ error: `Couldn't import that file: ${e.message}` });
  }
});

// Files that arrived by email, folder or push in a layout nobody has mapped yet. They are fixed
// here with the same two steps, so nobody has to export the report again.
app.get("/api/import/pending", requireRole("executive"), (_req, res) => res.json(listPending()));
app.post("/api/import/pending/:name/preview", requireRole("executive"), (req, res) => {
  try {
    res.json(previewFile(readPending(req.params.name), { kind: ["performance", "guest"].includes(req.body?.kind) ? req.body.kind : null }));
  } catch (e) {
    res.status(400).json({ error: `Couldn't read that file: ${e.message}` });
  }
});
app.post("/api/import/pending/:name/commit", requireRole("executive"), (req, res) => {
  try {
    res.json(importPending(req.params.name, {
      userEmail: req.user.email, kind: ["performance", "guest"].includes(req.body?.kind) ? req.body.kind : null,
      mapping: req.body?.mapping || null, saveProfileAs: req.body?.profileName ? String(req.body.profileName).slice(0, 80) : null,
    }));
  } catch (e) {
    audit(req.user.email, "import_error", e.message);
    res.status(400).json({ error: `Couldn't import that file: ${e.message}` });
  }
});
app.delete("/api/import/pending/:name", requireRole("executive"), (req, res) => {
  try { removePending(req.params.name); res.json({ ok: true }); } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get("/api/import/profiles", requireRole("executive"), (_req, res) => res.json(listProfiles()));
app.delete("/api/import/profiles/:id", requireRole("executive"), (req, res) => {
  deleteProfile(req.params.id);
  audit(req.user.email, "import_profile_deleted", req.params.id);
  res.json({ ok: true });
});

app.get("/api/import/template/:kind", (req, res) => {
  const kind = req.params.kind === "guest" ? "guest" : "performance";
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${kind === "guest" ? "guest-metrics" : "sales-labor"}-template.xlsx"`);
  res.send(templateWorkbook(kind));
});

// ---- administration (executive only) ------------------------------------------------------
app.get("/api/admin/users", requireRole("executive"), (_req, res) => {
  res.json(db.prepare("SELECT * FROM app_user ORDER BY role, email").all().map((u) => ({ ...publicUser(u), is_active: u.is_active, created_at: u.created_at })));
});

app.post("/api/admin/users", requireRole("executive"), (req, res) => {
  const { email, display_name, role, scope_id } = req.body || {};
  if (!email || !display_name || !["executive", "region", "area", "store"].includes(role)) return res.status(400).json({ error: "Email, name and role are required" });
  if (role !== "executive" && !scope_id) return res.status(400).json({ error: "Choose what this user can see" });
  const password = generatePassword();
  try {
    createUser({ email, display_name, role, scope_id, password });
  } catch {
    return res.status(409).json({ error: "A user with that email already exists" });
  }
  audit(req.user.email, "user_created", `${email} (${role})`);
  // Shown once so the admin can pass it on; only the hash is stored.
  res.json({ email: String(email).trim().toLowerCase(), temporary_password: password });
});

app.patch("/api/admin/users/:id", requireRole("executive"), (req, res) => {
  if (Number(req.params.id) === req.user.user_id) return res.status(400).json({ error: "You can't deactivate your own account" });
  db.prepare("UPDATE app_user SET is_active = ? WHERE user_id = ?").run(req.body?.is_active ? 1 : 0, Number(req.params.id));
  if (!req.body?.is_active) db.prepare("DELETE FROM session WHERE user_id = ?").run(Number(req.params.id));
  audit(req.user.email, "user_updated", `user ${req.params.id} active=${Boolean(req.body?.is_active)}`);
  res.json({ ok: true });
});

app.get("/api/admin/audit", requireRole("executive"), (_req, res) => {
  res.json(db.prepare("SELECT * FROM audit_log ORDER BY audit_id DESC LIMIT 200").all());
});

app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

// ---- frontend -----------------------------------------------------------------------------
const dist = path.join(__dirname, "..", "..", "client", "dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

app.use((err, _req, res, _next) => {
  console.error(err);
  audit(null, "server_error", err.message);
  res.status(500).json({ error: "Something went wrong on the server" });
});

const PORT = process.env.PORT || 4000;
// OPS_HOST=127.0.0.1 keeps the dashboard to this computer, which is how the installed apps
// start (no firewall prompt). Unset, it is reachable from the network, as a hosted copy must be.
app.listen(PORT, process.env.OPS_HOST || undefined, () => {
  console.log(`IHOP Operations Dashboard running at http://localhost:${PORT}`);
  if (db.prepare("SELECT COUNT(*) n FROM app_user").get().n === 0) console.log("No accounts yet. Open the address above in a browser to create the administrator account.");
  startScheduler();
  runRefresh("startup").catch((e) => console.error("Startup refresh failed:", e.message));
});
