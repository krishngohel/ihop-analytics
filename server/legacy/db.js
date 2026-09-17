// Uses Node's built-in SQLite (node:sqlite). Requires Node >= 22.5.
// package.json scripts pass --experimental-sqlite (harmless no-op on Node 23.4+).
import { DatabaseSync } from "node:sqlite";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.IHOP_DB_PATH || path.join(__dirname, "..", "ihop.db");
const db = new DatabaseSync(dbPath);

try {
  db.exec("PRAGMA journal_mode = WAL");
} catch {
  // WAL unsupported on some filesystems (network mounts); default journal is fine
}

function hasColumn(table, column) {
  try {
    return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  } catch {
    return false;
  }
}

const salesExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sales'").get();
if (salesExists && !hasColumn("sales", "store_id")) {
  // Pre-multi-store schema. Only mock/seed data has ever lived here (confirmed no real
  // POS export was ever loaded), so a one-time drop+recreate is safe and far simpler
  // than an ALTER-based migration. This block only fires once, on the first boot after
  // the upgrade — once tables have store_id, this branch is skipped forever.
  db.exec(`
    DROP TABLE IF EXISTS sales;
    DROP TABLE IF EXISTS entries;
    DROP TABLE IF EXISTS duty_logs;
    DROP TABLE IF EXISTS stores;
    DROP TABLE IF EXISTS ingest_batches;
  `);
}

db.exec(`
CREATE TABLE IF NOT EXISTS stores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  code TEXT,
  monthly_revenue_target REAL,
  gm_name TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ingest_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  filename TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  row_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL,
  ingest_batch_id INTEGER,
  sold_at TEXT NOT NULL,
  item TEXT NOT NULL,
  category TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price REAL NOT NULL,
  total REAL NOT NULL,
  payment_method TEXT DEFAULT 'card',
  line_type TEXT NOT NULL DEFAULT 'sale',
  source TEXT DEFAULT 'seed',
  is_demo INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sales_store_sold_at ON sales(store_id, sold_at);
CREATE INDEX IF NOT EXISTS idx_sales_sold_at ON sales(sold_at);
CREATE INDEX IF NOT EXISTS idx_sales_item ON sales(item);
CREATE INDEX IF NOT EXISTS idx_sales_item_sold_at ON sales(item, sold_at);

CREATE TABLE IF NOT EXISTS duty_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL,
  duty_date TEXT NOT NULL,
  manager_name TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  is_demo INTEGER NOT NULL DEFAULT 0,
  UNIQUE(store_id, duty_date)
);
CREATE INDEX IF NOT EXISTS idx_duty_store_date ON duty_logs(store_id, duty_date);

CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  entry_date TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'note',
  text TEXT NOT NULL,
  amount REAL,
  is_demo INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_entries_store_date ON entries(store_id, entry_date);
`);

// line_type rows: comp/void/discount store the POSITIVE dollar amount taken off the
// top (not negative totals) — net = gross sale total minus the sum of these.
export const GROSS_SQL = "COALESCE(SUM(CASE WHEN line_type='sale' THEN total ELSE 0 END),0)";
export const LEAKAGE_SQL = "COALESCE(SUM(CASE WHEN line_type IN ('discount','comp','void') THEN total ELSE 0 END),0)";
export const NET_SQL = `(${GROSS_SQL} - ${LEAKAGE_SQL})`;
export const UNITS_SQL = "COALESCE(SUM(CASE WHEN line_type='sale' THEN quantity ELSE 0 END),0)";
// Orders have no explicit id in the POS export; distinct (store, timestamp, payment)
// approximates one order the same way the original single-store app did, just scoped
// per store now so two stores can't collide on the same minute+payment-method.
export const ORDER_COUNT_SQL = "COUNT(DISTINCT store_id || 'x' || sold_at || 'x' || payment_method)";
export const DAYPART_SQL = `CASE
  WHEN CAST(substr(sold_at,12,2) AS INT) BETWEEN 5 AND 10 THEN 'Breakfast (5-11)'
  WHEN CAST(substr(sold_at,12,2) AS INT) BETWEEN 11 AND 14 THEN 'Lunch (11-15)'
  WHEN CAST(substr(sold_at,12,2) AS INT) BETWEEN 15 AND 17 THEN 'Afternoon (15-18)'
  WHEN CAST(substr(sold_at,12,2) AS INT) BETWEEN 18 AND 21 THEN 'Dinner (18-22)'
  ELSE 'Late Night (22-5)' END`;

export default db;
