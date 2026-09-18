// Rosnet API connector (brief, "Data ingestion order": an official API comes first).
// Reads the documented REST API at https://api.rosnet.com (OpenAPI: /swagger/v1/swagger.json)
// with the API User ID and Key that Rosnet issues (api@rosnet.com). It never signs in to the
// Rosnet website. The key is entered under Data and refresh and stored encrypted (see
// connections.js), or comes from ROSNET_API_KEY; it never appears in a log or a response.
//
// What the API carries, per location and business date:
//   /general/locations      store list and time zones
//   /sales/totalSales       net sales (today's rows are live; the same call a year back gives last year)
//   /labor/shifts           worked shifts: hours, pay rate, job
//   /labor/shifts/Schedule  scheduled hours
// What it does not carry: forecast sales, allowable hours, region/area, daypart sales. Rows are
// saved with merge, so a forecast that arrives another way (a scheduled Rosnet report through
// the mailbox or folder, or an upload) stays in place beside the API's numbers.
import db, { audit, setSetting, transaction } from "../db.js";
import { addDays, comparableLastYear, eachDay, today } from "../dates.js";
import { savePerformance } from "../performance.js";
import { clearDemoData, logIngest } from "../imports.js";
import { connectionValue } from "../connections.js";

const PAGE = 500;
const MAX_WAIT_S = 90;
export const UNASSIGNED = "Unassigned";

export function rosnetConfig() {
  const user = connectionValue("rosnet_api_user");
  const key = connectionValue("rosnet_api_key");
  return {
    configured: Boolean(user && key),
    user, key,
    clientId: connectionValue("rosnet_client_id"),
    baseUrl: (process.env.ROSNET_API_URL || "https://api.rosnet.com").replace(/\/+$/, ""),
    backfillDays: Math.min(400, Math.max(1, Number(process.env.ROSNET_BACKFILL_DAYS) || 35)),
    managerJobs: new RegExp(process.env.ROSNET_MANAGER_JOBS || "manager|\\bmgr\\b|\\bgm\\b|\\bagm\\b", "i"),
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One GET. Rosnet answers 429 (rate limit) and 503 (maintenance) with Retry-After seconds.
async function request(cfg, path, params, stats) {
  const url = new URL(cfg.baseUrl + path);
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== "") url.searchParams.set(k, v);
  const headers = { Accept: "application/json", Authorization: `Basic ${Buffer.from(`${cfg.user}:${cfg.key}`).toString("base64")}` };
  if (cfg.clientId) headers.Client = cfg.clientId;
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(45000) });
    stats.calls++;
    if ((res.status === 429 || res.status === 503) && attempt < 4) {
      const wait = Math.min(MAX_WAIT_S, Math.max(1, Number(res.headers.get("retry-after")) || 5 * attempt));
      stats.waited += wait;
      await sleep(wait * 1000);
      continue;
    }
    if (res.status === 401 || res.status === 403) throw new Error(`Rosnet refused the API credentials (${res.status}). Check ROSNET_API_USER, ROSNET_API_KEY${cfg.clientId ? " and ROSNET_CLIENT_ID" : ""}.`);
    if (!res.ok) throw new Error(`Rosnet ${path} answered ${res.status}${res.status === 503 ? " (maintenance)" : ""}`);
    const body = await res.json();
    return { rows: Array.isArray(body) ? body : body ? [body] : [], cursor: res.headers.get("cursor") };
  }
}

// Follows the "cursor" response header until the list is exhausted.
async function list(cfg, path, params, stats, { paged = true } = {}) {
  const out = [];
  let cursor = null;
  for (let page = 0; page < 400; page++) {
    const r = await request(cfg, path, { ...params, ...(paged ? { limit: PAGE, cursor } : {}) }, stats);
    out.push(...r.rows);
    if (!paged || !r.cursor || !r.rows.length || r.cursor === cursor) break;
    cursor = r.cursor;
  }
  return out;
}

// Field names are PascalCase in the published schema; tolerate camelCase too.
const get = (o, name) => (o[name] !== undefined ? o[name] : o[name[0].toLowerCase() + name.slice(1)]);
const num = (v) => (v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
// Shift times are wall-clock times at the restaurant with no zone; read both ends the same
// way and the difference is right wherever the server runs.
const wallClock = (s) => (s ? Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${String(s).replace(" ", "T")}Z`) : NaN);
const wallClockNow = (zone) => Date.parse(`${new Date().toLocaleString("sv-SE", { timeZone: zone || "America/Chicago" }).replace(" ", "T")}Z`);

/**
 * Matches Rosnet locations to restaurants by store number (Rosnet's location id). A location
 * the dashboard has never seen is added under "Unassigned" so its results show at once; a
 * store list or report with Region and Area columns then files it where it belongs.
 */
export async function syncLocations(cfg, stats) {
  const locations = await list(cfg, "/general/locations", {}, stats);
  const open = locations.filter((l) => { const closed = get(l, "ClosedDate"); return !closed || String(closed).slice(0, 10) > today(); });
  const known = new Map(db.prepare("SELECT restaurant_id, store_number FROM restaurant WHERE is_demo = 0 AND store_number IS NOT NULL").all()
    .map((r) => [String(r.store_number).trim().replace(/^0+/, ""), r.restaurant_id]));
  // The real store list is here, so the demonstration restaurants go first (their names would collide).
  if (open.length) clearDemoData();
  const added = [];
  const map = new Map(); // Rosnet location id -> restaurant_id
  transaction(() => {
    for (const l of open) {
      const id = get(l, "Id");
      if (id === null || id === undefined) continue;
      const key = String(id).replace(/^0+/, "");
      const zone = get(l, "TimeZoneName") || null;
      if (known.has(key)) {
        if (zone) db.prepare("UPDATE restaurant SET timezone = ? WHERE restaurant_id = ? AND timezone != ?").run(zone, known.get(key), zone);
        map.set(Number(id), known.get(key));
        continue;
      }
      db.prepare("INSERT OR IGNORE INTO region (region_name) VALUES (?)").run(UNASSIGNED);
      const regionId = db.prepare("SELECT region_id FROM region WHERE region_name = ?").get(UNASSIGNED).region_id;
      db.prepare("INSERT OR IGNORE INTO area (area_name, region_id, area_manager) VALUES (?, ?, NULL)").run(UNASSIGNED, regionId);
      const areaId = db.prepare("SELECT area_id FROM area WHERE area_name = ? AND region_id = ?").get(UNASSIGNED, regionId).area_id;
      const name = `IHOP #${id}${get(l, "Name") ? ` ${String(get(l, "Name")).trim()}` : ""}`;
      const taken = db.prepare("SELECT 1 FROM restaurant WHERE restaurant_name = ?").get(name);
      const rid = Number(db.prepare("INSERT INTO restaurant (restaurant_name, store_number, region_id, area_id, timezone) VALUES (?, ?, ?, ?, ?)")
        .run(taken ? `${name} (Rosnet ${id})` : name, String(id), regionId, areaId, zone || "America/Chicago").lastInsertRowid);
      map.set(Number(id), rid);
      added.push(name);
    }
  });
  return { map, locations: open.length, added };
}

/** "Test connection": signs in to the API with the values given (or the saved ones) and counts the stores it can see. */
export async function testRosnet(override = {}) {
  const cfg = { ...rosnetConfig(), ...Object.fromEntries(Object.entries(override).filter(([, v]) => v)) };
  if (!cfg.user || !cfg.key) throw new Error("Enter the API User ID and API User Key that Rosnet sent.");
  const locations = await list(cfg, "/general/locations", {}, { calls: 0, waited: 0 });
  const open = locations.filter((l) => !get(l, "ClosedDate"));
  return { locations: open.length, sample: open.slice(0, 5).map((l) => `#${get(l, "Id")} ${get(l, "Name") || ""}`.trim()) };
}

let managerJobCache = null;
async function managerJobIds(cfg, stats) {
  if (managerJobCache && Date.now() - managerJobCache.at < 12 * 3600e3) return managerJobCache.ids;
  const jobs = await list(cfg, "/labor/definitions/jobs", {}, stats);
  const ids = new Set(jobs.filter((j) => cfg.managerJobs.test(String(get(j, "Name") ?? get(j, "Description") ?? ""))).map((j) => Number(get(j, "Id"))));
  managerJobCache = { at: Date.now(), ids };
  return ids;
}

const zones = () => new Map(db.prepare("SELECT restaurant_id, timezone FROM restaurant").all().map((r) => [r.restaurant_id, r.timezone]));
const hasPriorYear = db.prepare("SELECT COUNT(*) n FROM daily_performance WHERE date = ? AND daypart = 'all' AND prior_year_sales IS NOT NULL");

/** One business date for every location: sales, last year's comparable day, worked and scheduled labor. */
// The schedule is skipped on intraday runs: it rarely changes in the day and merge keeps the morning's figure.
async function syncDay(cfg, date, map, stats, { managers, withSchedule = true }) {
  const byLocation = new Map();
  const at = (locationId) => {
    const rid = map.get(Number(locationId));
    if (!rid) { stats.unknownLocations.add(Number(locationId)); return null; }
    if (!byLocation.has(rid)) byLocation.set(rid, { date, restaurant_id: rid, daypart: "all" });
    return byLocation.get(rid);
  };

  for (const s of await list(cfg, "/sales/totalSales", { businessDate: date }, stats, { paged: false })) {
    const row = at(get(s, "LocationId"));
    if (row) row.actual_sales = num(get(s, "NetAmount"));
  }
  // Last year never changes once it is on file, so it is fetched once per date.
  if (hasPriorYear.get(date).n < byLocation.size) {
    for (const s of await list(cfg, "/sales/totalSales", { businessDate: comparableLastYear(date) }, stats, { paged: false })) {
      const rid = map.get(Number(get(s, "LocationId")));
      if (rid && byLocation.has(rid)) byLocation.get(rid).prior_year_sales = num(get(s, "NetAmount"));
    }
  }

  const tz = zones();
  for (const sh of await list(cfg, "/labor/shifts", { businessDate: date }, stats)) {
    const row = at(get(sh, "LocationId"));
    if (!row) continue;
    const begin = wallClock(get(sh, "Begin"));
    // A shift with no end is still on the clock: count it up to now at the restaurant.
    const end = get(sh, "End") ? wallClock(get(sh, "End")) : wallClockNow(tz.get(row.restaurant_id));
    const hours = (end - begin) / 3600e3;
    if (!(hours > 0) || hours > 24) continue;
    row.actual_labor_hours = (row.actual_labor_hours || 0) + hours;
    row.actual_labor_cost = (row.actual_labor_cost || 0) + hours * (num(get(sh, "PayRate")) ?? num(get(sh, "BaseRate")) ?? 0);
    if (managers.has(Number(get(sh, "JobId")))) row.manager_hours = (row.manager_hours || 0) + hours;
  }
  if (withSchedule) {
    for (const sc of await list(cfg, "/labor/shifts/Schedule", { businessDate: date }, stats)) {
      const row = at(get(sc, "LocationId"));
      if (row) row.scheduled_labor_hours = (row.scheduled_labor_hours || 0) + (num(get(sc, "ShiftHours")) || 0);
    }
  }

  let saved = 0;
  transaction(() => {
    for (const row of byLocation.values()) {
      if (row.actual_sales === undefined && row.actual_labor_hours === undefined) continue;
      savePerformance(row, "rosnet", { merge: true });
      saved++;
    }
  });
  return saved;
}

/**
 * light (intraday): today only. Otherwise: today, plus every day from two days before the
 * latest complete Rosnet day (late clock-outs and corrections), or the backfill window on
 * the first run.
 */
export async function syncRosnet({ light = false } = {}) {
  const cfg = rosnetConfig();
  if (!cfg.configured) return { skipped: "ROSNET_API_USER and ROSNET_API_KEY are not set" };
  const stats = { calls: 0, waited: 0, unknownLocations: new Set() };
  const { map, locations, added } = await syncLocations(cfg, stats);
  if (!map.size) return { locations, rows: 0, note: "Rosnet returned no open locations for this API user" };

  const day = today();
  const lastFinal = db.prepare("SELECT MAX(date) d FROM daily_performance WHERE source = 'rosnet' AND is_final = 1").get().d;
  const from = light ? day : lastFinal ? addDays(lastFinal, -2) : addDays(day, -cfg.backfillDays);
  const managers = await managerJobIds(cfg, stats).catch(() => new Set());

  let rows = 0;
  const days = eachDay(from < addDays(day, -cfg.backfillDays) ? addDays(day, -cfg.backfillDays) : from, day);
  for (const d of days) rows += await syncDay(cfg, d, map, stats, { managers, withSchedule: !light });

  if (rows) setSetting("data_source", "import");
  const unknown = [...stats.unknownLocations];
  const detail = [added.length ? `${added.length} new restaurants filed under ${UNASSIGNED}` : null,
    unknown.length ? `closed or unlisted locations ignored: ${unknown.slice(0, 12).join(", ")}` : null,
    stats.waited ? `waited ${stats.waited}s on Rosnet rate limits` : null].filter(Boolean).join(" | ");
  if (!light || added.length) {
    logIngest({ channel: "rosnet_api", filename: "Sales, labor and schedules", sender: cfg.baseUrl.replace(/^https?:\/\//, ""), kind: "performance",
      imported: rows, first_date: days[0], last_date: day, status: rows ? "ok" : "rejected", detail: detail || (rows ? null : "Rosnet returned no sales or labor for these dates") });
    audit(null, "rosnet_api_sync", `${days[0]} to ${day}: ${rows} rows, ${stats.calls} calls`);
  }
  return { rows, days: days.length, from: days[0], to: day, locations, new_restaurants: added, api_calls: stats.calls };
}
