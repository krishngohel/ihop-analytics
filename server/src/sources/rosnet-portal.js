// Rosnet PowerCenter portal connector — the "bridge" route for a client who has a portal
// login but no api.rosnet.com key yet. It signs in the way the portal's own web app does
// (POST account.rosnet.com/api/login with the username and password, which returns a ~24h
// token), then reads the same per-store data widgets the dashboard renders. Nothing is
// written back to Rosnet; only its read-only report widgets are called.
//
// Unlike the official API (sources/rosnet.js), the portal exposes forecast sales, allowable
// (forecast/earned) hours, region+area and daypart sales, so this route fills the dashboard
// on its own. When an API key later arrives, that connector takes over and this one can be
// left switched off.
//
// The portal login stores the client's website password (encrypted, see connections.js). It
// only works while their account has MFA off; if Rosnet enforces MFA this route stops and the
// emailed-report or API-key routes should be used instead.
import db, { audit, setSetting, transaction } from "../db.js";
import { addDays, comparableLastYear, today, yesterday } from "../dates.js";
import { savePerformance } from "../performance.js";
import { clearDemoData, logIngest } from "../imports.js";
import { connectionValue } from "../connections.js";

const ACCOUNT_URL = process.env.ROSNET_PORTAL_ACCOUNT_URL || "https://account.rosnet.com";
const PORTAL_URL = process.env.ROSNET_PORTAL_URL || "https://portal.rosnet.com";
// Backend services the gateway forwards to, by role. Overridable only for the test double.
const SVC = process.env.ROSNET_PORTAL_SVC || "http://portal.rosnet.com:61021/api/v1.0/";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0 Safari/537.36";

export function portalConfig() {
  const username = connectionValue("rosnet_portal_user");
  const password = connectionValue("rosnet_portal_password");
  return {
    configured: Boolean(username && password),
    username, password,
    client: connectionValue("rosnet_portal_client"),      // e.g. "ACGTX"
    clientId: connectionValue("rosnet_portal_client_id"), // e.g. "95"
    backfillDays: Math.min(90, Math.max(1, Number(process.env.ROSNET_PORTAL_BACKFILL_DAYS) || 14)),
  };
}

/** Signs in and returns the access token. Throws a clear, specific message on failure. */
async function login(cfg) {
  const username = String(cfg.username || "").trim(); // a pasted email often carries a trailing space
  const password = String(cfg.password || "");
  const hdrs = { "Content-Type": "application/json", Accept: "application/json", "User-Agent": UA, Origin: ACCOUNT_URL, Referer: `${ACCOUNT_URL}/` };

  // Accounts that sign in through single sign-on can't use the password endpoint at all.
  try {
    const sso = await fetch(`${ACCOUNT_URL}/api/sso-scheme`, { method: "POST", headers: hdrs, body: JSON.stringify({ username }), signal: AbortSignal.timeout(20000) });
    if (sso.ok) {
      const s = await sso.json().catch(() => ({}));
      if (s.scheme || s.authUrl) throw new Error("This Rosnet account signs in through single sign-on (SSO / Microsoft), which can't be automated. Use the reports mailbox or an API key instead.");
    }
  } catch (e) { if (/single sign-on/.test(e.message)) throw e; /* a network hiccup on the SSO check shouldn't block the login attempt */ }

  let res;
  try {
    res = await fetch(`${ACCOUNT_URL}/api/login`, { method: "POST", headers: hdrs, body: JSON.stringify({ username, password }), signal: AbortSignal.timeout(30000) });
  } catch (e) {
    throw new Error(`Couldn't reach the Rosnet portal sign-in: ${e.message}`);
  }
  const text = await res.text();
  let body = {};
  try { body = JSON.parse(text); } catch { /* non-JSON (a Cloudflare page, say) */ }
  const token = body.access_token || body.accessToken;
  if (token) return token;

  if (body.message && /mfa|verif|\bcode\b|two.?factor|otp/i.test(body.message)) {
    throw new Error("This login needs a verification code (MFA), so it can't run unattended. Use the reports mailbox or an API key instead.");
  }
  if (res.status === 401 || res.status === 403) {
    // Surface Rosnet's own message when it gives one; otherwise a specific, actionable hint.
    throw new Error(body.message ? `Rosnet rejected the sign-in: ${body.message}`
      : "Rosnet rejected the sign-in. Check the username and password are exactly what works on portal.rosnet.com — watch for a trailing space, caps lock, or a saved/autofilled password that differs.");
  }
  if (res.ok) throw new Error("Rosnet signed in but returned no access token — this login may use SSO or need a code. Use the reports mailbox or an API key.");
  throw new Error(`Rosnet portal sign-in failed (${res.status}).`);
}

// One gateway data call. The portal reads auth from an access_token cookie shared across
// .rosnet.com and picks the client from clientCode; the endpoint header names the backend.
async function gateway(cfg, token, label, endpoint, body = null) {
  const res = await fetch(`${PORTAL_URL}/api/gateway?${label}`, {
    method: body ? "POST" : "GET",
    headers: {
      Accept: "application/json", "User-Agent": UA, endpoint,
      clientId: cfg.clientId || "", "Content-Type": "application/json",
      Cookie: `access_token=${token}; clientCode=${cfg.client || ""}`,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`Rosnet portal ${label} answered ${res.status}`);
  return res.json();
}

/**
 * The data gateway needs the numeric client id (e.g. 95) in a header, which most operators
 * don't know — only the client code (ACGTX). The token's ACLs list the client id(s) this
 * login can read, so a single-client login resolves automatically. Returns a session (cfg
 * with clientId filled in) to pass to the gateway.
 */
async function resolveSession(cfg, token) {
  if (cfg.clientId) return cfg;
  let acls = [];
  try {
    const v = await gateway({ ...cfg, clientId: "" }, token, "validate-token", `${ACCOUNT_URL}/api/validate-token`);
    acls = Array.isArray(v.acls) ? v.acls : JSON.parse(String(v.acls || "[]"));
  } catch { /* fall through to the clear error below */ }
  if (acls.length === 1) return { ...cfg, clientId: String(acls[0]) };
  if (acls.length > 1) throw new Error(`This login can see ${acls.length} Rosnet clients (ids ${acls.join(", ")}). It needs one client id — tell me which and I'll set it.`);
  throw new Error("Signed in, but Rosnet didn't report which client this login can read. The account may need a client selected first.");
}

const svc = (path) => SVC + path;
const num = (v) => (v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
// Shared filter body: every location, one aggregate for the chosen period.
const filter = (period, extra = {}) => ({
  level1: [], level2: [], level3: [], level4: [], level5: [], displayBy: "level1",
  displayPeriod: period, netGross: "net", daypartIds: [], salesCategoryIds: [], salesSubCategoryIds: [],
  departmentIds: [], storeCompType: "all", ...extra,
});
const laborFilter = (period, extra = {}) => filter(period, { laborCategoryIds: [], laborJobIds: [], laborTypeName: "direct", ...extra });

// Widget label -> {store id: value}. Bar widgets return labels[] like "1404 - Garland".
const storeId = (label) => Number(String(label).match(/^\s*(\d+)/)?.[1]);
function byStoreFromBars(widget, datasetLabel) {
  const out = new Map();
  const ds = (widget.datasets || []).find((d) => d.label === datasetLabel) || widget.datasets?.[0];
  (widget.labels || []).forEach((lbl, i) => { const id = storeId(lbl); if (id) out.set(id, num(ds?.data[i])); });
  return out;
}
function pairFromBars(widget, aLabel, bLabel) {
  const a = byStoreFromBars(widget, aLabel);
  const bDs = (widget.datasets || []).find((d) => d.label === bLabel);
  const b = new Map();
  (widget.labels || []).forEach((lbl, i) => { const id = storeId(lbl); if (id) b.set(id, num(bDs?.data[i])); });
  return { a, b };
}

/**
 * Locations with their region and area, matched to restaurants by store number. Rosnet's own
 * labels are inverted from the dashboard's: Rosnet's top grouping (level3, "Area", e.g. "ACGTX
 * North") is the dashboard's REGION, and its middle grouping (level2, "Region") is the
 * dashboard's AREA. A store's parentValue is its level2; that level2's parent is its level3.
 */
async function syncLocations(cfg, token) {
  const f = await gateway(cfg, token, "getLocationFilters", svc("LocationFilter"));
  // The store's real number is the prefix of its label ("648 - South San Francisco"), NOT the
  // internal `value` (an unrelated location id) — every data widget keys on that store number.
  // Rosnet keeps housekeeping buckets (Delete, Office, Historical, Do Not Use) and closed
  // stores in the hierarchy; they are not real operating restaurants, so drop them — they are
  // what makes the dashboard read like a raw Rosnet export (a "Delete" region, -100% ghosts).
  const JUNK = /\b(delete|office|historical|do not use|inactive|closed|test)\b/i;
  const stores = (f.level1?.choices || []).map((c) => {
    const number = Number(String(c.label).match(/^\s*(\d+)/)?.[1]);
    return {
      id: number, number: String(number),
      name: String(c.label).replace(/^\s*\d+\s*-\s*/, "").trim() || `Store ${number}`,
      area: c.parentValue || null, // level2
    };
  }).filter((s) => s.id && !JUNK.test(s.name)); // skip non-stores and closed/junk locations
  const areaToRegion = new Map((f.level2?.choices || []).map((c) => [c.value, c.parentValue || null])); // level2 -> level3
  const known = new Map(db.prepare("SELECT restaurant_id, store_number FROM restaurant WHERE is_demo = 0 AND store_number IS NOT NULL").all()
    .map((r) => [String(r.store_number).trim().replace(/^0+/, ""), r.restaurant_id]));
  if (stores.length) clearDemoData();

  const map = new Map();
  const added = [];
  transaction(() => {
    // Remove any junk restaurants a previous sync created before this filter existed.
    const junkRows = db.prepare("SELECT r.restaurant_id, r.restaurant_name, a.area_name, reg.region_name FROM restaurant r JOIN area a ON a.area_id = r.area_id JOIN region reg ON reg.region_id = r.region_id WHERE r.is_demo = 0").all()
      .filter((r) => JUNK.test(r.restaurant_name) || JUNK.test(r.area_name) || JUNK.test(r.region_name));
    for (const j of junkRows) {
      for (const tbl of ["daily_performance", "guest_metrics", "weather", "forecast_submission"]) {
        db.prepare(`DELETE FROM ${tbl} WHERE restaurant_id = ?`).run(j.restaurant_id);
      }
      db.prepare("DELETE FROM restaurant WHERE restaurant_id = ?").run(j.restaurant_id);
    }
    db.exec("DELETE FROM area WHERE area_id NOT IN (SELECT DISTINCT area_id FROM restaurant)");
    db.exec("DELETE FROM region WHERE region_id NOT IN (SELECT DISTINCT region_id FROM restaurant)");

    for (const s of stores) {
      const key = s.number.replace(/^0+/, "");
      const areaName = s.area || "Rosnet";
      const regionName = areaToRegion.get(s.area) || s.area || "Rosnet";
      if (JUNK.test(areaName) || JUNK.test(regionName)) continue; // store parked under a housekeeping group
      db.prepare("INSERT OR IGNORE INTO region (region_name) VALUES (?)").run(regionName);
      const regionId = db.prepare("SELECT region_id FROM region WHERE region_name = ?").get(regionName).region_id;
      db.prepare("INSERT OR IGNORE INTO area (area_name, region_id, area_manager) VALUES (?, ?, NULL)").run(areaName, regionId);
      const areaId = db.prepare("SELECT area_id FROM area WHERE area_name = ? AND region_id = ?").get(areaName, regionId).area_id;
      if (known.has(key)) {
        db.prepare("UPDATE restaurant SET region_id = ?, area_id = ?, city = COALESCE(NULLIF(city, ''), ?) WHERE restaurant_id = ?").run(regionId, areaId, s.name, known.get(key));
        map.set(s.id, known.get(key));
        continue;
      }
      const name = `IHOP #${s.id} ${s.name}`.trim();
      const taken = db.prepare("SELECT 1 FROM restaurant WHERE restaurant_name = ?").get(name);
      // The store name is usually its city, which is what the weather geocoder needs.
      const rid = Number(db.prepare("INSERT INTO restaurant (restaurant_name, store_number, region_id, area_id, city, timezone) VALUES (?, ?, ?, ?, ?, 'America/Chicago')")
        .run(taken ? `${name} (#${s.id})` : name, s.number, regionId, areaId, s.name).lastInsertRowid);
      map.set(s.id, rid);
      added.push(name);
    }
  });
  return { map, count: stores.length, added };
}

// Merges one period's widgets into a per-store row for one business date.
async function syncPeriod(cfg, token, date, map, { live }) {
  const period = live ? "RT" : "DAY";
  const rows = new Map(); // restaurant_id -> row
  // No is_final here: savePerformance treats a row dated today as live and derives the
  // forecast earned to this point from the full-day forecast, exactly as the other sources do.
  const at = (id) => {
    const rid = map.get(Number(id));
    if (!rid) return null;
    if (!rows.has(rid)) rows.set(rid, { date, restaurant_id: rid, daypart: "all" });
    return rows.get(rid);
  };

  // Sales: actual + full-day forecast (one widget), and last year (comp widget) — for the live
  // day as well, so the live view has a forecast-to-now and a last-year comparison, not blanks.
  const fc = await gateway(cfg, token, "AvF", svc("ActualVsForecastSales/widget"), filter(period));
  const { a: actual, b: forecast } = pairFromBars(fc, "Actual Sales", "Forecast Sales");
  for (const [id, v] of actual) { const r = at(id); if (r) r.actual_sales = v; }
  for (const [id, v] of forecast) { const r = at(id); if (r && v !== null) r.forecast_sales = v; }
  const comp = await gateway(cfg, token, "Comp", svc("CompSalesByLocation/widget"), filter(period, { compPeriod: "comp", rtComp: "whole" }));
  for (const [id, v] of byStoreFromBars(comp, "Comp")) { const r = at(id); if (r && v !== null) r.prior_year_sales = v; }

  // Labor: forecast(=allowable), scheduled, actual hours; and labor cost.
  const hrs = await gateway(cfg, token, "Hrs", svc("LaborByLocation/ForecastActualTheoHoursByLocation/widget"), laborFilter(period));
  for (const h of hrs.data || []) {
    const r = at(h.locationNumber);
    if (!r) continue;
    r.actual_labor_hours = num(h.totalLaborHours);
    r.scheduled_labor_hours = num(h.scheduledHours);
    r.allowable_labor_hours = num(h.forecastHours) ?? num(h.scheduledHours); // earned/forecast hours = the plan
  }
  const cost = await gateway(cfg, token, "Cost", svc("LaborCostByLocation/widget"), laborFilter(period));
  for (const c of cost.data || []) { const r = at(c.locationNumber); if (r) r.actual_labor_cost = num(c.laborAmout); }

  let saved = 0;
  transaction(() => {
    for (const r of rows.values()) {
      if (r.actual_sales === undefined && r.actual_labor_hours === undefined) continue;
      savePerformance(r, "rosnet", { merge: true });
      saved++;
    }
  });
  return saved;
}

// The by-date sales report seeds several days of net sales in one call (one column per date).
async function seedSalesHistory(cfg, token, map) {
  const rep = await gateway(cfg, token, "ByDate", svc("SalesByLocationBusinessDate/report"), filter("7DR"));
  const dateCols = (rep.headings || []).filter((h) => /^\d{2}\/\d{2}\/\d{4}$/.test(h));
  let saved = 0;
  transaction(() => {
    for (const row of rep.data || []) {
      const rid = map.get(Number(row.LocationNumber ?? row.locationNumber));
      if (!rid) continue;
      for (const col of dateCols) {
        const [m, d, y] = col.split("/");
        const iso = `${y}-${m}-${d}`;
        if (iso >= today()) continue; // today is handled live, with its full metric set
        savePerformance({ date: iso, restaurant_id: rid, daypart: "all", actual_sales: num(row[col]) }, "rosnet", { merge: true });
        saved++;
      }
    }
  });
  return saved;
}

/** "Test connection": signs in and reports how many locations the portal shows. */
export async function testPortal(override = {}) {
  const cfg = { ...portalConfig(), ...Object.fromEntries(Object.entries(override).filter(([, v]) => v)) };
  if (!cfg.username || !cfg.password) throw new Error("Enter the Rosnet portal username and password.");
  const token = await login(cfg);
  const session = await resolveSession(cfg, token);
  const f = await gateway(session, token, "getLocationFilters", svc("LocationFilter"));
  const stores = f.level1?.choices || [];
  return { locations: stores.length, client: session.client || null, client_id: session.clientId || null, sample: stores.slice(0, 5).map((c) => c.label.trim()) };
}

/**
 * light (intraday): today's live sales only. Otherwise: yesterday's full snapshot, today's
 * live sales, and — on the first run — a few days of net-sales history for the trend charts.
 */
export async function syncPortal({ light = false } = {}) {
  const cfg = portalConfig();
  if (!cfg.configured) return { skipped: "Rosnet portal username and password are not set" };
  const token = await login(cfg);
  const session = await resolveSession(cfg, token);
  const { map, count, added } = await syncLocations(session, token);
  if (!map.size) return { locations: count, rows: 0, note: "The portal returned no locations for this login" };

  let rows = 0;
  if (!light) rows += await syncPeriod(session, token, yesterday(), map, { live: false });
  rows += await syncPeriod(session, token, today(), map, { live: true });
  const seededHistory = !light && !db.prepare("SELECT 1 FROM daily_performance WHERE source = 'rosnet' AND date < ? LIMIT 1").get(yesterday());
  if (seededHistory) rows += await seedSalesHistory(session, token, map);

  if (rows) setSetting("data_source", "import");
  const detail = [added.length ? `${added.length} restaurants added` : null, seededHistory ? "seeded recent sales history" : null].filter(Boolean).join(" | ");
  if (!light || added.length) {
    logIngest({ channel: "rosnet_portal", filename: "Portal sales and labor", sender: PORTAL_URL.replace(/^https?:\/\//, ""), kind: "performance",
      imported: rows, first_date: seededHistory ? addDays(today(), -cfg.backfillDays) : yesterday(), last_date: today(), status: rows ? "ok" : "rejected", detail: detail || null });
    audit(null, "rosnet_portal_sync", `${rows} rows${added.length ? `, ${added.length} new restaurants` : ""}`);
  }
  return { rows, locations: count, new_restaurants: added };
}
