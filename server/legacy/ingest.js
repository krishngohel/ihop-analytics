// Single choke point for getting sales/duty rows into the database. The Excel upload
// path calls this today; a future direct POS connection would call the exact same
// function with source: 'pos_api' — no schema or analytics code needs to change.
import db from "./db.js";

const LINE_TYPES = new Set(["sale", "discount", "comp", "void"]);

export function ensureStore(name, code = null) {
  const existing = db.prepare("SELECT id FROM stores WHERE name = ?").get(name);
  if (existing) return existing.id;
  const info = db.prepare(
    "INSERT INTO stores (name, code, is_demo) VALUES (?, ?, 0)"
  ).run(name, code);
  return Number(info.lastInsertRowid);
}

function hasRealData() {
  return db.prepare("SELECT COUNT(*) c FROM ingest_batches WHERE source != 'seed'").get().c > 0;
}

const insertSale = db.prepare(`
  INSERT INTO sales (store_id, ingest_batch_id, sold_at, item, category, quantity, unit_price, total, payment_method, line_type, source, is_demo)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const upsertDuty = db.prepare(`
  INSERT INTO duty_logs (store_id, duty_date, manager_name, source, is_demo)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(store_id, duty_date) DO UPDATE SET manager_name = excluded.manager_name, source = excluded.source, is_demo = excluded.is_demo
`);

/**
 * @param {object} opts
 * @param {Array} opts.sales - [{ storeId?, storeName?, soldAt, item, category, quantity, unitPrice, total, paymentMethod, lineType }]
 * @param {Array} opts.duty - [{ storeId?, storeName?, dutyDate, managerName }]
 * @param {'seed'|'upload'|'pos_api'} opts.source
 * @param {string|null} opts.filename
 *
 * storeName (when present) is resolved to an id INSIDE this transaction, strictly
 * after the demo wipe below — resolving names before the wipe let a real row bind to
 * a demo store's id right before that same id got deleted, orphaning the row. Always
 * resolve names here, never in the caller.
 */
export function ingest({ sales = [], duty = [], source, filename = null }) {
  const isDemo = source === "seed" ? 1 : 0;
  const wipe = !isDemo && !hasRealData();

  db.exec("BEGIN");
  try {
    if (wipe) {
      db.exec("DELETE FROM sales WHERE is_demo = 1");
      db.exec("DELETE FROM duty_logs WHERE is_demo = 1");
      db.exec("DELETE FROM entries WHERE is_demo = 1");
      db.exec("DELETE FROM ingest_batches WHERE source = 'seed'");
      db.exec("DELETE FROM stores WHERE is_demo = 1");
    }

    const nameToId = new Map();
    const newStoreNames = new Set();
    const rowsByStoreId = new Map();
    function resolveStoreId(storeName, fallbackId) {
      if (!storeName) return fallbackId;
      if (nameToId.has(storeName)) return nameToId.get(storeName);
      const existing = db.prepare("SELECT id FROM stores WHERE name = ?").get(storeName);
      const id = existing ? existing.id : ensureStore(storeName);
      if (!existing) newStoreNames.add(storeName);
      nameToId.set(storeName, id);
      return id;
    }

    const batchInfo = db.prepare(
      "INSERT INTO ingest_batches (source, filename, row_count) VALUES (?, ?, ?)"
    ).run(source, filename, sales.length);
    const batchId = Number(batchInfo.lastInsertRowid);

    for (const s of sales) {
      const storeId = resolveStoreId(s.storeName, s.storeId);
      rowsByStoreId.set(storeId, (rowsByStoreId.get(storeId) || 0) + 1);
      insertSale.run(
        storeId, batchId, s.soldAt, s.item, s.category, s.quantity, s.unitPrice, s.total,
        s.paymentMethod || "card", LINE_TYPES.has(s.lineType) ? s.lineType : "sale", source, isDemo
      );
    }
    for (const d of duty) {
      const storeId = resolveStoreId(d.storeName, d.storeId);
      if (!storeId || !d.dutyDate || !d.managerName) continue;
      upsertDuty.run(storeId, d.dutyDate, d.managerName, source, isDemo);
    }

    db.exec("COMMIT");
    return {
      batchId, wiped: wipe, imported: sales.length,
      stores: [...nameToId.entries()].map(([name, id]) => ({
        name, id, rows: rowsByStoreId.get(id) || 0, isNew: newStoreNames.has(name)
      }))
    };
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
