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

db.exec(`
CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sold_at TEXT NOT NULL,
  item TEXT NOT NULL,
  category TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price REAL NOT NULL,
  total REAL NOT NULL,
  payment_method TEXT DEFAULT 'card',
  source TEXT DEFAULT 'seed'
);
CREATE INDEX IF NOT EXISTS idx_sales_sold_at ON sales(sold_at);
CREATE INDEX IF NOT EXISTS idx_sales_item ON sales(item);

CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  entry_date TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'note',
  text TEXT NOT NULL,
  amount REAL
);
`);

export default db;
