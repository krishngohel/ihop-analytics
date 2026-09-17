// Report ingestion for the two source systems: the sales/labor platform (Rosnet) and the
// guest-metrics / Google review platform. One function, ingestFile(), serves every
// channel: manual upload, the watched export folder, the reports mailbox and the push
// endpoint. Vendor exports are messy (title rows above the header, their own column
// names, sales and labor in separate reports), so this:
//   - finds the header row by itself
//   - maps columns by known aliases, then by a saved mapping profile for that layout
//   - works out whether a file is sales/labor or guest metrics from its columns
//   - merges partial reports into what is already on file
//   - logs every file received, and says why when one can't be used
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import XLSX from "xlsx";
import db, { transaction, setSetting, audit, DAYPARTS } from "./db.js";
import { savePerformance, saveGuestMetrics } from "./performance.js";
import { isoDate, isDay, addDays, today } from "./dates.js";

const norm = (k) => String(k ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Vendor reports abbreviate ("Net Sls", "Fcst", "Avg Rtg"). Expand before matching column names.
const ABBREVIATIONS = { sls: "sales", sale: "sales", fcst: "forecast", fcast: "forecast", proj: "projected", act: "actual", actl: "actual", sched: "scheduled", schd: "scheduled",
  hrs: "hours", hr: "hours", mgr: "manager", mgmt: "management", lbr: "labor", avg: "average", rtg: "rating", cnt: "count", qty: "count", num: "number", no: "number",
  loc: "location", rest: "restaurant", dt: "date", yr: "year", pct: "percent", amt: "amount", tot: "total", rev: "review", revs: "reviews" };
const canon = (k) => norm(k).split(" ").map((w) => ABBREVIATIONS[w] || w).join(" ").replace(/^ly/, "last year").replace(/^py/, "prior year");

const STORE_NUMBER = ["store number", "store", "store no", "store id", "unit", "unit number", "unit no", "restaurant number", "location number", "location id", "site", "site number"];
const STORE_NAME = ["restaurant", "restaurant name", "store name", "location", "location name", "unit name", "site name"];

export const FIELDS = {
  performance: {
    date: { label: "Business date", aliases: ["date", "business date", "day", "bus date", "sales date"] },
    store_number: { label: "Store number", aliases: STORE_NUMBER },
    restaurant_name: { label: "Restaurant name", aliases: STORE_NAME },
    region: { label: "Region", aliases: ["region", "region name"] },
    area: { label: "Area", aliases: ["area", "area name", "district", "market", "dm area"] },
    area_manager: { label: "Area manager", aliases: ["area manager", "area director", "district manager", "dm", "area coach"] },
    daypart: { label: "Daypart", aliases: ["daypart", "day part", "meal period", "shift"] },
    actual_sales: { label: "Actual sales", aliases: ["actual sales", "net sales", "sales", "actual net sales", "total net sales", "actual"] },
    forecast_sales: { label: "Forecast sales", aliases: ["forecast sales", "forecast", "sales forecast", "projected sales", "fcst sales", "fcst", "projection"] },
    prior_year_sales: { label: "Last year sales", aliases: ["prior year sales", "last year sales", "ly sales", "py sales", "last year", "ly net sales", "ly"] },
    actual_labor_hours: { label: "Actual labor hours", aliases: ["actual labor hours", "actual hours", "labor hours", "hours worked", "act hours", "actual hrs"] },
    scheduled_labor_hours: { label: "Scheduled labor hours", aliases: ["scheduled labor hours", "scheduled hours", "scheduled labor", "sched hours", "sched hrs"] },
    allowable_labor_hours: { label: "Allowable labor hours", aliases: ["allowable labor hours", "allowable hours", "allowed hours", "labor plan", "earned hours", "ideal hours", "guide hours", "target hours"] },
    manager_hours: { label: "Manager hours", aliases: ["manager hours", "mgr hours", "management hours", "mgmt hours"] },
    actual_labor_cost: { label: "Labor cost", aliases: ["actual labor cost", "labor cost", "labor dollars", "labor $", "total labor"] },
    opening_time_status: { label: "Opening time status", aliases: ["opening time status", "opening status", "open status", "opened on time"] },
    address: { label: "Address", aliases: ["address", "street"] },
    city: { label: "City", aliases: ["city"] },
    state: { label: "State", aliases: ["state", "st"] },
    timezone: { label: "Time zone", aliases: ["timezone", "time zone"] },
    latitude: { label: "Latitude", aliases: ["latitude", "lat"] },
    longitude: { label: "Longitude", aliases: ["longitude", "lon", "lng", "long"] },
  },
  guest: {
    date: { label: "Date", aliases: ["date", "business date", "day", "survey date", "review date"] },
    store_number: { label: "Store number", aliases: STORE_NUMBER },
    restaurant_name: { label: "Restaurant name", aliases: STORE_NAME },
    survey_count: { label: "Survey count", aliases: ["survey count", "surveys", "survey responses", "responses", "total surveys"] },
    average_rating: { label: "Survey rating", aliases: ["average rating", "survey rating", "overall satisfaction", "osat", "average score", "survey score"] },
    google_review_count: { label: "Google review count", aliases: ["google review count", "google reviews", "review count", "reviews", "total reviews"] },
    google_rating: { label: "Google rating", aliases: ["google rating", "google star rating", "google stars", "google average rating", "average star rating"] },
    // Review-level exports (Merchant Centric STARS and similar): one row per review. These two
    // columns are rolled up into the daily counts and averages above.
    review_rating: { label: "Rating of one review (one row per review)", aliases: ["rating", "stars", "star rating", "review rating", "score", "review score"] },
    review_source: { label: "Review site (Google, Yelp, survey...)", aliases: ["source", "site", "review site", "platform", "review source", "channel", "network"] },
  },
};
const PERFORMANCE_METRICS = ["actual_sales", "forecast_sales", "prior_year_sales", "actual_labor_hours", "scheduled_labor_hours", "allowable_labor_hours", "manager_hours", "actual_labor_cost"];
const GUEST_METRICS = ["survey_count", "average_rating", "google_review_count", "google_rating", "review_rating"];
const ALL_ALIASES = new Set(Object.values(FIELDS).flatMap((k) => Object.values(k).flatMap((f) => f.aliases.map(canon))));

// ---- reading -------------------------------------------------------------------------
function cellText(v) {
  if (v instanceof Date) return isoDate(v);
  return String(v ?? "").trim();
}

/** First sheet as rows of cells, with the header row found by looking for known column names. */
export function readTable(buffer) {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const grid = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "", blankrows: true });
  let headerRow = 0;
  let best = -1;
  grid.slice(0, 30).forEach((row, i) => {
    const cells = row.map(cellText).filter(Boolean);
    const known = cells.filter((c) => ALL_ALIASES.has(canon(c))).length;
    // Known column names win; failing that, the first row that looks like labels.
    const score = known * 10 + (cells.length >= 3 && cells.every((c) => Number.isNaN(Number(c.replace(/[$,%]/g, "")))) ? 1 : 0);
    if (score > best) { best = score; headerRow = i; }
  });
  const headers = (grid[headerRow] || []).map((h, i) => cellText(h) || `Column ${i + 1}`);
  const rows = grid.slice(headerRow + 1)
    .filter((r) => r.some((c) => cellText(c) !== ""))
    .map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])));
  const titleText = grid.slice(0, headerRow).flat().map(cellText).filter(Boolean).join(" ");
  return { headers, rows, headerRow, titleText };
}

// ---- mapping ---------------------------------------------------------------------------
const signature = (headers) => [...new Set(headers.map(norm).filter(Boolean))].sort().join("|");

function autoMapping(kind, headers) {
  const byNorm = new Map(headers.map((h) => [canon(h), h]));
  const mapping = {};
  for (const [field, def] of Object.entries(FIELDS[kind])) {
    const hit = def.aliases.map(canon).find((a) => byNorm.has(a));
    if (hit) mapping[field] = byNorm.get(hit);
  }
  return mapping;
}

function detectKind(headers) {
  const g = autoMapping("guest", headers);
  const p = autoMapping("performance", headers);
  const guestHits = GUEST_METRICS.filter((f) => g[f]).length;
  const perfHits = PERFORMANCE_METRICS.filter((f) => p[f]).length;
  return guestHits > perfHits ? "guest" : "performance";
}

function findProfile(headers, kind = null) {
  const sig = signature(headers);
  const present = new Set(headers);
  const profiles = db.prepare(`SELECT * FROM import_profile ${kind ? "WHERE kind = ?" : ""} ORDER BY last_used_at DESC`).all(...(kind ? [kind] : []));
  const exact = profiles.find((p) => p.header_signature === sig);
  // A report with an extra or missing optional column still matches if every mapped column is there.
  const loose = exact || profiles.find((p) => Object.values(JSON.parse(p.mapping)).every((col) => present.has(col)));
  return loose ? { ...loose, mapping: JSON.parse(loose.mapping) } : null;
}

export function listProfiles() {
  return db.prepare("SELECT profile_id, name, kind, mapping, created_by, created_at, last_used_at FROM import_profile ORDER BY created_at DESC").all()
    .map((p) => ({ ...p, mapping: JSON.parse(p.mapping) }));
}

export function deleteProfile(id) {
  db.prepare("DELETE FROM import_profile WHERE profile_id = ?").run(Number(id));
}

function saveProfile({ name, kind, headers, mapping, userEmail }) {
  db.prepare(`INSERT INTO import_profile (name, kind, header_signature, mapping, created_by, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(kind, header_signature) DO UPDATE SET name = excluded.name, mapping = excluded.mapping, last_used_at = excluded.last_used_at`)
    .run(name, kind, signature(headers), JSON.stringify(mapping), userEmail || null, new Date().toISOString(), new Date().toISOString());
}

function missingRequirements(kind, mapping) {
  const missing = [];
  if (!mapping.store_number && !mapping.restaurant_name) missing.push("a store number or restaurant name column");
  const metrics = kind === "guest" ? GUEST_METRICS : PERFORMANCE_METRICS;
  if (!metrics.some((f) => mapping[f])) missing.push(kind === "guest" ? "at least one guest metric column" : "at least one sales or labor column");
  return missing;
}

// ---- values ------------------------------------------------------------------------------
function toDay(v) {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return isoDate(v);
  const s = String(v ?? "").trim();
  if (isDay(s.slice(0, 10))) return s.slice(0, 10);
  const us = s.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (us) {
    const day = `${us[3].length === 2 ? "20" + us[3] : us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
    return isDay(day) ? day : null;
  }
  const parsed = s && /[a-z]/i.test(s) ? new Date(s) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? isoDate(parsed) : null;
}

function dayInText(text) {
  const iso = String(text || "").match(/\d{4}-\d{2}-\d{2}/);
  if (iso && isDay(iso[0])) return iso[0];
  const us = String(text || "").match(/\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/);
  return us ? toDay(us[0]) : null;
}

const number = (v) => {
  if (v === undefined || v === null || v === "") return null;
  const s = String(v).trim();
  const n = Number(s.replace(/[$,%\s]/g, "").replace(/^\((.*)\)$/, "-$1"));
  return Number.isNaN(n) ? null : n;
};

function normDaypart(v) {
  const s = norm(v || "");
  if (!s || ["all", "all day", "total", "day", "daily"].includes(s)) return "all";
  if (s.startsWith("break") || s === "am") return "breakfast";
  if (s.startsWith("lunch") || s === "mid") return "lunch";
  if (s.startsWith("dinner") || s === "pm" || s === "afternoon" || s === "evening") return "dinner";
  if (s.includes("late") || s.includes("overnight") || s.includes("graveyard")) return "late_night";
  return null;
}

/** Demo restaurants and everything attached to them go away when real data first arrives. */
export function clearDemoData() {
  const demo = db.prepare("SELECT COUNT(*) n FROM restaurant WHERE is_demo = 1").get().n;
  if (!demo) return false;
  transaction(() => {
    for (const t of ["daily_performance", "guest_metrics", "weather", "forecast_submission"]) {
      db.exec(`DELETE FROM ${t} WHERE restaurant_id IN (SELECT restaurant_id FROM restaurant WHERE is_demo = 1)`);
    }
    db.exec("DELETE FROM app_user WHERE email LIKE '%@demo.local' AND role != 'executive'");
    db.exec("DELETE FROM restaurant WHERE is_demo = 1");
    db.exec("DELETE FROM area WHERE area_id NOT IN (SELECT DISTINCT area_id FROM restaurant)");
    db.exec("DELETE FROM region WHERE region_id NOT IN (SELECT DISTINCT region_id FROM restaurant)");
    db.exec("DELETE FROM daily_summary");
  });
  setSetting("data_source", "import");
  return true;
}

function restaurantResolver({ allowCreate }) {
  const byNumber = new Map();
  const byName = new Map();
  for (const r of db.prepare("SELECT restaurant_id, store_number, restaurant_name FROM restaurant WHERE is_demo = 0").all()) {
    if (r.store_number) byNumber.set(String(r.store_number).trim().toLowerCase().replace(/^0+/, ""), r.restaurant_id);
    byName.set(r.restaurant_name.trim().toLowerCase(), r.restaurant_id);
  }
  const created = [];
  return {
    created,
    resolve(m) {
      const number = m.store_number !== undefined && m.store_number !== "" ? String(m.store_number).trim().toLowerCase().replace(/^0+/, "") : null;
      const name = m.restaurant_name ? String(m.restaurant_name).trim() : null;
      if (number && byNumber.has(number)) return byNumber.get(number);
      if (name && byName.has(name.toLowerCase())) return byName.get(name.toLowerCase());
      // Another system's location name often carries the store number ("IHOP - Plano #3100").
      for (const digits of (name || "").match(/\d{3,}/g) || []) {
        const key = digits.replace(/^0+/, "");
        if (byNumber.has(key)) return byNumber.get(key);
      }
      if (!allowCreate || !(name || number) || !m.region || !m.area) return null;
      const regionName = String(m.region).trim();
      const areaName = String(m.area).trim();
      db.prepare("INSERT OR IGNORE INTO region (region_name) VALUES (?)").run(regionName);
      const regionId = db.prepare("SELECT region_id FROM region WHERE region_name = ?").get(regionName).region_id;
      db.prepare("INSERT OR IGNORE INTO area (area_name, region_id, area_manager) VALUES (?, ?, ?)").run(areaName, regionId, m.area_manager ? String(m.area_manager).trim() : null);
      const areaId = db.prepare("SELECT area_id FROM area WHERE area_name = ? AND region_id = ?").get(areaName, regionId).area_id;
      const finalName = name || `Store ${m.store_number}`;
      const id = Number(db.prepare(`INSERT INTO restaurant (restaurant_name, store_number, address, city, state, region_id, area_id, timezone, latitude, longitude)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(finalName, number ? String(m.store_number).trim() : null, m.address || null, m.city || null, m.state || null,
        regionId, areaId, m.timezone || "America/Chicago", number_(m.latitude), number_(m.longitude)).lastInsertRowid);
      if (number) byNumber.set(number, id);
      byName.set(finalName.toLowerCase(), id);
      created.push(finalName);
      return id;
    },
  };
}
const number_ = number;

// When a file only has daypart rows, build the full-day row from them.
function fillAllDayRows(keys) {
  const sum = db.prepare(`SELECT SUM(actual_sales) a, SUM(forecast_sales) f, SUM(prior_year_sales) p FROM daily_performance WHERE date = ? AND restaurant_id = ? AND daypart != 'all'`);
  const allRow = db.prepare("SELECT actual_sales FROM daily_performance WHERE date = ? AND restaurant_id = ? AND daypart = 'all'");
  for (const key of keys) {
    const [date, id] = key.split("|");
    const existing = allRow.get(date, Number(id));
    if (existing && existing.actual_sales !== null) continue;
    const s = sum.get(date, Number(id));
    if (s.a === null && s.f === null) continue;
    savePerformance({ date, restaurant_id: Number(id), daypart: "all", actual_sales: s.a, forecast_sales: s.f, prior_year_sales: s.p }, "import", { merge: true });
  }
}

// ---- the one entry point ---------------------------------------------------------------------
function logIngest(entry) {
  db.prepare(`INSERT INTO ingest_file (received_at, channel, filename, sender, kind, profile_name, imported, skipped, first_date, last_date, status, detail)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(new Date().toISOString(), entry.channel, entry.filename || null, entry.sender || null, entry.kind || null,
    entry.profile_name || null, entry.imported || 0, entry.skipped || 0, entry.first_date || null, entry.last_date || null, entry.status, entry.detail ? String(entry.detail).slice(0, 1500) : null);
}

/** Looks at a file without importing it: layout found, columns mapped, what's missing, sample rows. */
export function previewFile(buffer, { kind = null } = {}) {
  const table = readTable(buffer);
  const profile = findProfile(table.headers, kind);
  const useKind = kind || profile?.kind || detectKind(table.headers);
  const mapping = { ...autoMapping(useKind, table.headers), ...(profile?.mapping || {}) };
  return {
    kind: useKind, headers: table.headers, header_row: table.headerRow + 1, row_count: table.rows.length,
    mapping, profile: profile ? { profile_id: profile.profile_id, name: profile.name } : null,
    missing: missingRequirements(useKind, mapping),
    date_fallback: mapping.date ? null : dayInText(table.titleText),
    fields: Object.entries(FIELDS[useKind]).map(([key, def]) => ({ key, label: def.label })),
    sample: table.rows.slice(0, 6).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, cellText(v)]))),
  };
}

/**
 * Imports one file from any channel.
 * opts: { channel, filename, sender, userEmail, kind, mapping, saveProfileAs }
 * An unattended channel with no date column takes the date from the report title, then the
 * file name, then assumes the report covers the prior business day.
 */
export function ingestFile(buffer, opts = {}) {
  const channel = opts.channel || "upload";
  const base = { channel, filename: opts.filename, sender: opts.sender };
  let table;
  try {
    table = readTable(buffer);
  } catch (e) {
    logIngest({ ...base, status: "rejected", detail: `Unreadable file: ${e.message}` });
    return { imported: 0, skipped: 0, status: "rejected", errors: [`Couldn't read that file: ${e.message}`] };
  }
  if (opts.mapping && !Object.keys(opts.mapping).length) opts = { ...opts, mapping: null }; // nothing chosen: match columns automatically
  const profile = opts.mapping ? null : findProfile(table.headers, opts.kind || null);
  const kind = opts.kind || profile?.kind || detectKind(table.headers);
  const mapping = opts.mapping ? Object.fromEntries(Object.entries(opts.mapping).filter(([f, col]) => FIELDS[kind][f] && table.headers.includes(col)))
    : { ...autoMapping(kind, table.headers), ...(profile?.mapping || {}) };
  const missing = missingRequirements(kind, mapping);
  if (!table.rows.length || missing.length) {
    const why = !table.rows.length ? "The file has no data rows" : `Couldn't find ${missing.join(" and ")}. Map the columns once under Data and refresh and this layout will import by itself from then on.`;
    logIngest({ ...base, kind, status: "needs_mapping", detail: `${why} Columns seen: ${table.headers.join(", ")}` });
    audit(opts.userEmail, "import_needs_mapping", `${opts.filename || channel}: ${why}`);
    return { imported: 0, skipped: table.rows.length, status: "needs_mapping", kind, errors: [why], headers: table.headers };
  }

  const fallbackDay = mapping.date ? null : dayInText(table.titleText) || dayInText(opts.filename) || (channel === "upload" ? null : addDays(today(), -1));
  const pick = (raw) => Object.fromEntries(Object.entries(mapping).map(([f, col]) => [f, raw[col]]));
  const errors = [];
  let imported = 0;
  let firstDate = null;
  let lastDate = null;
  const touched = new Set();
  const clearedDemoData = kind === "performance" ? clearDemoData() : false;
  const resolver = restaurantResolver({ allowCreate: kind === "performance" });

  const reviews = new Map(); // "date|restaurant" -> ratings by site, for one-row-per-review exports
  const reviewLevel = kind === "guest" && mapping.review_rating && !mapping.survey_count && !mapping.google_review_count;

  transaction(() => {
    table.rows.forEach((raw, i) => {
      const m = pick(raw);
      const label = norm(m.restaurant_name ?? m.store_number ?? "");
      if (!label || /^(grand )?totals?$|^sub ?total|^average|^company|^all stores/.test(label)) return; // report total lines
      const rowNo = table.headerRow + i + 2;
      const date = mapping.date ? toDay(m.date) : fallbackDay;
      if (!date) return errors.push(`Row ${rowNo}: no readable date`);
      const id = resolver.resolve(m);
      if (!id) return errors.push(`Row ${rowNo}: unknown restaurant "${m.restaurant_name ?? m.store_number}"${kind === "performance" ? " (new restaurants need Region and Area columns)" : ""}`);
      if (reviewLevel) {
        const rating = number(m.review_rating);
        if (rating === null) return errors.push(`Row ${rowNo}: no rating`);
        const key = `${date}|${id}`;
        if (!reviews.has(key)) reviews.set(key, { google: [], other: [] });
        // With no site column every row is treated as a Google review, the platform's main source.
        const site = norm(m.review_source || "google");
        reviews.get(key)[site.includes("google") ? "google" : "other"].push(rating);
      } else if (kind === "guest") {
        // A review-platform summary has one rating column beside a review count: that rating is
        // the review rating, not a survey score, whatever the column happens to be called.
        const reviewsOnly = mapping.google_review_count && !mapping.survey_count && !mapping.google_rating;
        saveGuestMetrics({ date, restaurant_id: id, survey_count: number(m.survey_count), average_rating: reviewsOnly ? null : number(m.average_rating),
          google_review_count: number(m.google_review_count), google_rating: number(m.google_rating ?? m.review_rating ?? (reviewsOnly ? m.average_rating : null)) }, "import");
      } else {
        const daypart = normDaypart(m.daypart);
        if (!daypart) return errors.push(`Row ${rowNo}: unknown daypart "${m.daypart}"`);
        const status = norm(m.opening_time_status || "");
        savePerformance({
          date, restaurant_id: id, daypart, actual_sales: number(m.actual_sales), forecast_sales: number(m.forecast_sales), prior_year_sales: number(m.prior_year_sales),
          actual_labor_hours: number(m.actual_labor_hours), scheduled_labor_hours: number(m.scheduled_labor_hours), allowable_labor_hours: number(m.allowable_labor_hours),
          manager_hours: number(m.manager_hours), actual_labor_cost: number(m.actual_labor_cost),
          opening_time_status: !status ? null : /late|no|delay/.test(status) ? "late" : /on|yes/.test(status) ? "on_time" : status.replace(/ /g, "_"),
        }, "import", { merge: true });
        touched.add(`${date}|${id}`);
      }
      imported++;
      if (!firstDate || date < firstDate) firstDate = date;
      if (!lastDate || date > lastDate) lastDate = date;
    });
    if (kind === "performance") fillAllDayRows(touched);
    const mean = (a) => (a.length ? a.reduce((t, x) => t + x, 0) / a.length : null);
    for (const [key, r] of reviews) {
      const [date, id] = key.split("|");
      saveGuestMetrics({ date, restaurant_id: Number(id), survey_count: r.other.length || null, average_rating: mean(r.other),
        google_review_count: r.google.length || null, google_rating: mean(r.google) }, "import");
    }
  });

  // Real results on file: from here on the dashboard is no longer in demonstration mode.
  if (kind === "performance" && imported) setSetting("data_source", "import");
  if (opts.saveProfileAs && imported) saveProfile({ name: opts.saveProfileAs, kind, headers: table.headers, mapping, userEmail: opts.userEmail });
  if (profile && imported) db.prepare("UPDATE import_profile SET last_used_at = ? WHERE profile_id = ?").run(new Date().toISOString(), profile.profile_id);

  const status = imported === 0 ? "rejected" : errors.length ? "partial" : "ok";
  logIngest({ ...base, kind, profile_name: opts.saveProfileAs || profile?.name, imported, skipped: errors.length, first_date: firstDate, last_date: lastDate, status, detail: errors.slice(0, 8).join(" | ") });
  audit(opts.userEmail, `import_${kind}`, `${channel} ${opts.filename || ""}: ${imported} rows, ${errors.length} skipped`);
  return { imported, skipped: errors.length, status, kind, first_date: firstDate, last_date: lastDate, errors: errors.slice(0, 25), newRestaurants: resolver.created, clearedDemoData, profile: opts.saveProfileAs || profile?.name || null };
}

/**
 * Picks up exports dropped into IMPORT_DIR (brief: "Scheduled CSV/Excel export placed in a
 * secure location"). Used files move to ./processed, unusable ones to ./rejected.
 */
export function importDropFolder() {
  const dir = importFolder();
  fs.mkdirSync(dir, { recursive: true });
  // Sales/labor files first: they are what introduces restaurants a guest file refers to.
  const looksGuest = (f) => /guest|review|survey/i.test(f);
  const files = fs.readdirSync(dir).filter((f) => /\.(csv|xlsx|xls)$/i.test(f)).sort((a, b) => looksGuest(a) - looksGuest(b) || a.localeCompare(b));
  const results = [];
  for (const file of files) {
    const full = path.join(dir, file);
    try {
      const result = ingestFile(fs.readFileSync(full), { channel: "folder", filename: file });
      const target = path.join(dir, result.imported > 0 ? "processed" : "rejected");
      fs.mkdirSync(target, { recursive: true });
      fs.renameSync(full, path.join(target, `${new Date().toISOString().replace(/[:.]/g, "-")}_${file}`));
      results.push({ file, imported: result.imported, skipped: result.skipped, status: result.status, errors: result.errors.slice(0, 3) });
    } catch (e) {
      audit(null, "import_error", `${file}: ${e.message}`);
      results.push({ file, error: e.message });
    }
  }
  return { configured: true, files: results };
}

/** Watched folder: IMPORT_DIR if set (relative paths are relative to the server folder), otherwise server/import. */
export function importFolder() {
  const serverDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  return path.resolve(serverDir, process.env.IMPORT_DIR || "import");
}

export function ingestLog(limit = 40) {
  return db.prepare("SELECT * FROM ingest_file ORDER BY ingest_id DESC LIMIT ?").all(limit);
}

export function templateWorkbook(kind) {
  const wb = XLSX.utils.book_new();
  const rows = kind === "guest"
    ? [{ Date: "2026-09-16", "Store Number": "3100", "Survey Count": 7, "Average Rating": 4.4, "Google Review Count": 2, "Google Rating": 4.2 }]
    : [
      { Date: "2026-09-16", "Store Number": "3100", Restaurant: "IHOP #3100 Plano", Region: "North Texas", Area: "Dallas", "Area Manager": "Name", City: "Plano", State: "TX",
        Daypart: "All", "Actual Sales": 8450.25, "Forecast Sales": 8900, "Prior Year Sales": 8720.4, "Actual Labor Hours": 201.5, "Scheduled Labor Hours": 205,
        "Allowable Labor Hours": 194.3, "Manager Hours": 26, "Labor Cost": 2980.1, "Opening Time Status": "On time" },
      { Date: "2026-09-16", "Store Number": "3100", Restaurant: "IHOP #3100 Plano", Region: "North Texas", Area: "Dallas", "Area Manager": "Name", City: "Plano", State: "TX",
        Daypart: "Breakfast", "Actual Sales": 3890.1, "Forecast Sales": 4100, "Prior Year Sales": 4010.75 },
    ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), kind === "guest" ? "Guest metrics" : "Sales and labor");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

export { DAYPARTS };
