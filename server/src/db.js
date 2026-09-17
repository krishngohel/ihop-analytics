// Operations dashboard database. Node's built-in SQLite (node:sqlite, Node >= 22.5).
// Table and column names follow the client's build brief ("Suggested Data Model").
import { DatabaseSync } from "node:sqlite";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.OPS_DB_PATH || path.join(__dirname, "..", "ops.db");
const db = new DatabaseSync(dbPath);

try {
  db.exec("PRAGMA journal_mode = WAL");
} catch {
  // WAL unsupported on some filesystems (network mounts); default journal is fine
}
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS region (
  region_id INTEGER PRIMARY KEY AUTOINCREMENT,
  region_name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS area (
  area_id INTEGER PRIMARY KEY AUTOINCREMENT,
  area_name TEXT NOT NULL,
  region_id INTEGER NOT NULL REFERENCES region(region_id),
  area_manager TEXT,
  UNIQUE (region_id, area_name)
);

CREATE TABLE IF NOT EXISTS restaurant (
  restaurant_id INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_name TEXT NOT NULL UNIQUE,
  store_number TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  region_id INTEGER NOT NULL REFERENCES region(region_id),
  area_id INTEGER NOT NULL REFERENCES area(area_id),
  timezone TEXT NOT NULL DEFAULT 'America/Chicago',
  latitude REAL,
  longitude REAL,
  avg_hourly_rate REAL NOT NULL DEFAULT 14.5,
  is_demo INTEGER NOT NULL DEFAULT 0
);

-- One row per restaurant, business date and daypart. daypart = 'all' is the full-day
-- row and the only one that carries labor; the named dayparts carry sales only.
CREATE TABLE IF NOT EXISTS daily_performance (
  date TEXT NOT NULL,
  restaurant_id INTEGER NOT NULL REFERENCES restaurant(restaurant_id),
  daypart TEXT NOT NULL DEFAULT 'all',
  actual_sales REAL,
  forecast_sales REAL,
  prior_year_sales REAL,
  sales_variance_to_forecast REAL,
  sales_variance_to_prior_year REAL,
  actual_labor_hours REAL,
  scheduled_labor_hours REAL,
  allowable_labor_hours REAL,
  manager_hours REAL,
  actual_labor_cost REAL,
  labor_variance REAL,
  opening_time_status TEXT,
  -- Live (current-day) rows: is_final = 0 and forecast_to_now holds the share of the
  -- day's forecast that should have been earned by the time of the last refresh.
  is_final INTEGER NOT NULL DEFAULT 1,
  forecast_to_now REAL,
  source TEXT NOT NULL DEFAULT 'import',
  updated_at TEXT,
  PRIMARY KEY (date, restaurant_id, daypart)
);
CREATE INDEX IF NOT EXISTS idx_perf_restaurant ON daily_performance (restaurant_id, daypart, date);
CREATE INDEX IF NOT EXISTS idx_perf_daypart_date ON daily_performance (daypart, date);

CREATE TABLE IF NOT EXISTS guest_metrics (
  date TEXT NOT NULL,
  restaurant_id INTEGER NOT NULL REFERENCES restaurant(restaurant_id),
  survey_count INTEGER,
  average_rating REAL,
  google_review_count INTEGER,
  google_rating REAL,
  source TEXT NOT NULL DEFAULT 'import',
  PRIMARY KEY (date, restaurant_id)
);

CREATE TABLE IF NOT EXISTS weather (
  date TEXT NOT NULL,
  restaurant_id INTEGER NOT NULL REFERENCES restaurant(restaurant_id),
  temperature_high REAL,
  temperature_low REAL,
  precipitation_amount REAL,
  morning_precipitation REAL,
  precipitation_hours REAL,
  rain_flag INTEGER NOT NULL DEFAULT 0,
  thunderstorm_flag INTEGER NOT NULL DEFAULT 0,
  weather_description TEXT,
  source TEXT NOT NULL DEFAULT 'open-meteo',
  PRIMARY KEY (date, restaurant_id)
);

CREATE TABLE IF NOT EXISTS forecast_submission (
  week_start TEXT NOT NULL,
  restaurant_id INTEGER NOT NULL REFERENCES restaurant(restaurant_id),
  last_year_sales REAL,
  recent_trend REAL,
  system_forecast REAL,
  manager_forecast REAL,
  forecast_adjustment_reason TEXT,
  labor_plan REAL,
  scheduled_hours REAL,
  manager_hours REAL,
  allowable_hours REAL,
  notes TEXT,
  submitted_by TEXT,
  submitted_at TEXT,
  PRIMARY KEY (week_start, restaurant_id)
);

-- Access control. role: executive | region | area | store. scope_id is the
-- region_id / area_id / restaurant_id the user is limited to (NULL for executive).
CREATE TABLE IF NOT EXISTS app_user (
  user_id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('executive','region','area','store')),
  scope_id INTEGER,
  password_hash TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS session (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES app_user(user_id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  audit_id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  user_email TEXT,
  action TEXT NOT NULL,
  detail TEXT
);

CREATE TABLE IF NOT EXISTS refresh_run (
  run_id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  trigger TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  steps TEXT,
  error TEXT
);

CREATE TABLE IF NOT EXISTS daily_summary (
  date TEXT PRIMARY KEY,
  generated_at TEXT NOT NULL,
  body TEXT NOT NULL
);

-- Saved column mappings, so a vendor report in a known layout imports with no one present.
CREATE TABLE IF NOT EXISTS import_profile (
  profile_id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('performance','guest')),
  header_signature TEXT NOT NULL,
  mapping TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  UNIQUE (kind, header_signature)
);

-- Every file received, from any channel: upload, watched folder, mailbox or push.
CREATE TABLE IF NOT EXISTS ingest_file (
  ingest_id INTEGER PRIMARY KEY AUTOINCREMENT,
  received_at TEXT NOT NULL,
  channel TEXT NOT NULL,
  filename TEXT,
  sender TEXT,
  kind TEXT,
  profile_name TEXT,
  imported INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  first_date TEXT,
  last_date TEXT,
  status TEXT NOT NULL,
  detail TEXT
);

CREATE TABLE IF NOT EXISTS setting (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

const DEFAULT_SETTINGS = {
  // Refresh behavior (brief: "Refresh and Data Timing")
  daily_refresh_time: "05:30",
  intraday_refresh_enabled: "1",
  intraday_refresh_minutes: "15",
  operating_hours_start: "05:00",
  operating_hours_end: "23:59",
  // Fiscal calendar used for period-to-date: 4-week periods from this Monday.
  fiscal_year_start: "2025-12-29",
  // Share of restaurants shown as hotspots.
  hotspot_share: "0.15",
  // Labor guide used by the weekly forecasting form: allowable crew hours per week =
  // 7 x fixed daily hours + projected sales / sales per labor hour.
  labor_guide_fixed_daily_hours: "50",
  labor_guide_sales_per_hour: "70",
  data_source: "import",
};

const insertSetting = db.prepare("INSERT OR IGNORE INTO setting (key, value) VALUES (?, ?)");
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insertSetting.run(k, v);

export function getSetting(key) {
  return db.prepare("SELECT value FROM setting WHERE key = ?").get(key)?.value ?? DEFAULT_SETTINGS[key] ?? null;
}

export function setSetting(key, value) {
  db.prepare("INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, String(value));
}

export function allSettings() {
  return Object.fromEntries(db.prepare("SELECT key, value FROM setting").all().map((r) => [r.key, r.value]));
}

export function audit(userEmail, action, detail = null) {
  db.prepare("INSERT INTO audit_log (at, user_email, action, detail) VALUES (?, ?, ?, ?)")
    .run(new Date().toISOString(), userEmail || null, action, detail ? String(detail).slice(0, 2000) : null);
}

export function transaction(fn) {
  db.exec("BEGIN");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export const DAYPARTS = ["breakfast", "lunch", "dinner", "late_night"];
export const DAYPART_LABELS = { all: "All day", breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", late_night: "Late night" };

export default db;
