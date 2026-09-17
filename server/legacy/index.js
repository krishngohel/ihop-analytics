import express from "express";
import cors from "cors";
import multer from "multer";
import XLSX from "xlsx";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import db, { NET_SQL, GROSS_SQL, LEAKAGE_SQL, UNITS_SQL, ORDER_COUNT_SQL, DAYPART_SQL } from "./db.js";
import { MENU } from "./menu.js";
import reportRouter from "./report.js";
import { ingest, ensureStore } from "./ingest.js";
import { parseSpreadsheet } from "./parseSpreadsheet.js";
import { computeOpportunities } from "./opportunities.js";
import { periodDays, priorPeriod, pctChange, toRange, round2 } from "./period.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json());
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// ---- helpers ----
function dayRange(req) {
  const toDay = req.query.to || new Date().toISOString().slice(0, 10);
  const fromDay = req.query.from || new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10);
  return { fromDay, toDay };
}
function range(req) {
  const { fromDay, toDay } = dayRange(req);
  return toRange(fromDay, toDay);
}
function storeFilter(req, params) {
  const storeId = req.query.storeId ? Number(req.query.storeId) : null;
  if (!storeId) return { clause: "", params };
  return { clause: " AND store_id = ?", params: [...params, storeId] };
}

// ---- stores ----
app.get("/api/stores", (req, res) => {
  res.json(db.prepare("SELECT id, name, code, monthly_revenue_target, gm_name, is_demo FROM stores ORDER BY name").all());
});

app.patch("/api/stores/:id", (req, res) => {
  const id = Number(req.params.id);
  const store = db.prepare("SELECT id FROM stores WHERE id=?").get(id);
  if (!store) return res.status(404).json({ error: "Store not found" });
  const { monthly_revenue_target, gm_name } = req.body || {};
  db.prepare("UPDATE stores SET monthly_revenue_target = COALESCE(?, monthly_revenue_target), gm_name = COALESCE(?, gm_name) WHERE id=?")
    .run(monthly_revenue_target ?? null, gm_name ?? null, id);
  res.json(db.prepare("SELECT id, name, code, monthly_revenue_target, gm_name, is_demo FROM stores WHERE id=?").get(id));
});

// ---- region-level analytics ----
app.get("/api/region/summary", (req, res) => {
  const { fromDay, toDay } = dayRange(req);
  const { from, to } = toRange(fromDay, toDay);
  const cur = db.prepare(`SELECT ${NET_SQL} net, ${GROSS_SQL} gross, ${LEAKAGE_SQL} leakage, ${ORDER_COUNT_SQL} orders, ${UNITS_SQL} units FROM sales WHERE sold_at BETWEEN ? AND ?`).get(from, to);
  const prev = priorPeriod(fromDay, toDay);
  const prevRange = toRange(prev.fromDay, prev.toDay);
  const prevNet = db.prepare(`SELECT ${NET_SQL} net FROM sales WHERE sold_at BETWEEN ? AND ?`).get(prevRange.from, prevRange.to).net;
  const targetSum = db.prepare("SELECT COALESCE(SUM(monthly_revenue_target),0) t FROM stores").get().t;
  const days = periodDays(fromDay, toDay);
  const targetForPeriod = targetSum * (days / 30);
  const trend = db.prepare(`SELECT substr(sold_at,1,10) day, ${NET_SQL} revenue FROM sales WHERE sold_at BETWEEN ? AND ? GROUP BY day ORDER BY day`).all(from, to);

  res.json({
    revenue: round2(cur.net), gross: round2(cur.gross), leakage: round2(cur.leakage),
    orders: cur.orders, units: cur.units,
    avgTicket: cur.orders ? round2(cur.net / cur.orders) : 0,
    priorRevenue: round2(prevNet),
    vsPrior: pctChange(cur.net, prevNet),
    targetForPeriod: round2(targetForPeriod),
    vsTarget: targetForPeriod ? round2(cur.net - targetForPeriod) : null,
    trend: trend.map((r) => ({ day: r.day, revenue: round2(r.revenue) }))
  });
});

app.get("/api/revenue", (req, res) => {
  const { from, to } = range(req);
  const grain = ["day", "week", "month"].includes(req.query.grain) ? req.query.grain : "day";
  const bucket = grain === "day" ? "substr(sold_at,1,10)"
    : grain === "week" ? "strftime('%Y-W%W', sold_at)"
    : "substr(sold_at,1,7)";
  const { clause, params } = storeFilter(req, [from, to]);
  const rows = db.prepare(`
    SELECT ${bucket} period, ${NET_SQL} revenue, ${GROSS_SQL} gross, ${LEAKAGE_SQL} leakage, ${ORDER_COUNT_SQL} orders, ${UNITS_SQL} units
    FROM sales WHERE sold_at BETWEEN ? AND ?${clause} GROUP BY period ORDER BY period
  `).all(...params);
  res.json(rows.map((r) => ({
    period: r.period, revenue: round2(r.revenue), gross: round2(r.gross), leakage: round2(r.leakage),
    orders: r.orders, units: r.units, avgTicket: r.orders ? round2(r.revenue / r.orders) : 0
  })));
});

app.get("/api/stores/ranking", (req, res) => {
  const { fromDay, toDay } = dayRange(req);
  const { from, to } = toRange(fromDay, toDay);
  const prev = priorPeriod(fromDay, toDay);
  const prevRange = toRange(prev.fromDay, prev.toDay);
  const days = periodDays(fromDay, toDay);

  const stores = db.prepare("SELECT id, name, monthly_revenue_target, gm_name FROM stores ORDER BY name").all();
  const cur = db.prepare(`SELECT store_id, ${NET_SQL} net, ${GROSS_SQL} gross, ${LEAKAGE_SQL} leakage, ${ORDER_COUNT_SQL} orders, ${UNITS_SQL} units FROM sales WHERE sold_at BETWEEN ? AND ? GROUP BY store_id`).all(from, to);
  const prevRows = db.prepare(`SELECT store_id, ${NET_SQL} net FROM sales WHERE sold_at BETWEEN ? AND ? GROUP BY store_id`).all(prevRange.from, prevRange.to);
  const curByStore = Object.fromEntries(cur.map((r) => [r.store_id, r]));
  const prevByStore = Object.fromEntries(prevRows.map((r) => [r.store_id, r.net]));
  const activeStores = cur.length;
  const regionTotal = cur.reduce((s, r) => s + r.net, 0);
  const regionAvg = activeStores ? regionTotal / activeStores : 0;

  const ranking = stores.map((s) => {
    const c = curByStore[s.id] || { net: 0, gross: 0, leakage: 0, orders: 0, units: 0 };
    const priorNet = prevByStore[s.id] || 0;
    const targetForPeriod = s.monthly_revenue_target ? s.monthly_revenue_target * (days / 30) : null;
    return {
      storeId: s.id, name: s.name, gmName: s.gm_name,
      revenue: round2(c.net), gross: round2(c.gross), comps: round2(c.leakage),
      orders: c.orders, units: c.units,
      avgTicket: c.orders ? round2(c.net / c.orders) : 0,
      vsOwnPrior: pctChange(c.net, priorNet),
      vsRegionAvg: regionAvg ? round2(c.net - regionAvg) : null,
      vsTarget: targetForPeriod != null ? round2(c.net - targetForPeriod) : null,
      targetForPeriod: targetForPeriod != null ? round2(targetForPeriod) : null,
      belowAverage: regionAvg > 0 && c.net < regionAvg
    };
  }).sort((a, b) => b.revenue - a.revenue);

  res.json(ranking);
});

app.get("/api/stores/dayparts", (req, res) => {
  const { from, to } = range(req);
  const rows = db.prepare(`SELECT store_id, ${DAYPART_SQL} daypart, ${GROSS_SQL} revenue, ${UNITS_SQL} quantity FROM sales WHERE sold_at BETWEEN ? AND ? GROUP BY store_id, daypart`).all(from, to);
  res.json(rows.map((r) => ({ ...r, revenue: round2(r.revenue) })));
});

app.get("/api/stores/categories", (req, res) => {
  const { from, to } = range(req);
  const rows = db.prepare(`SELECT store_id, category, ${GROSS_SQL} revenue, ${UNITS_SQL} quantity FROM sales WHERE sold_at BETWEEN ? AND ? GROUP BY store_id, category`).all(from, to);
  res.json(rows.map((r) => ({ ...r, revenue: round2(r.revenue) })));
});

app.get("/api/opportunities", (req, res) => {
  const { from, to } = range(req);
  const storeId = req.query.storeId ? Number(req.query.storeId) : null;
  const findings = computeOpportunities({ from, to });
  res.json(storeId ? findings.filter((f) => f.storeId === storeId) : findings);
});

// ---- manager on duty ----
app.get("/api/duty", (req, res) => {
  const { fromDay, toDay } = dayRange(req);
  const storeId = req.query.storeId ? Number(req.query.storeId) : null;
  let where = "duty_date BETWEEN ? AND ?";
  const params = [fromDay, toDay];
  if (storeId) { where += " AND store_id = ?"; params.push(storeId); }
  res.json(db.prepare(`SELECT store_id, duty_date, manager_name, source FROM duty_logs WHERE ${where} ORDER BY duty_date DESC`).all(...params));
});

app.put("/api/duty", (req, res) => {
  const { storeId, dutyDate, managerName } = req.body || {};
  if (!storeId || !dutyDate || !managerName) return res.status(400).json({ error: "storeId, dutyDate, managerName are required" });
  db.prepare(`
    INSERT INTO duty_logs (store_id, duty_date, manager_name, source, is_demo)
    VALUES (?, ?, ?, 'manual', 0)
    ON CONFLICT(store_id, duty_date) DO UPDATE SET manager_name=excluded.manager_name, source='manual', is_demo=0
  `).run(storeId, dutyDate, managerName);
  res.json({ ok: true });
});

// ---- single-store analytics (existing endpoints, now store-aware) ----
app.get("/api/summary", (req, res) => {
  const { from, to } = range(req);
  const { clause, params } = storeFilter(req, [from, to]);
  const cur = db.prepare(`SELECT ${NET_SQL} revenue, ${ORDER_COUNT_SQL} orders, ${UNITS_SQL} units FROM sales WHERE sold_at BETWEEN ? AND ?${clause}`).get(...params);
  const top = db.prepare(`SELECT item, ${GROSS_SQL} revenue FROM sales WHERE line_type='sale' AND sold_at BETWEEN ? AND ?${clause} GROUP BY item ORDER BY revenue DESC LIMIT 1`).get(...params);
  res.json({
    revenue: round2(cur.revenue), orders: cur.orders, units: cur.units,
    avgTicket: cur.orders ? round2(cur.revenue / cur.orders) : 0,
    topItem: top ? top.item : null
  });
});

app.get("/api/revenue-trend", (req, res) => {
  const { from, to } = range(req);
  const { clause, params } = storeFilter(req, [from, to]);
  const rows = db.prepare(`SELECT substr(sold_at,1,10) day, ${NET_SQL} revenue, ${ORDER_COUNT_SQL} orders FROM sales WHERE sold_at BETWEEN ? AND ?${clause} GROUP BY day ORDER BY day`).all(...params);
  res.json(rows.map((r) => ({ ...r, revenue: round2(r.revenue) })));
});

app.get("/api/top-items", (req, res) => {
  const { from, to } = range(req);
  const by = req.query.by === "quantity" ? "SUM(quantity)" : "SUM(total)";
  const limit = Math.min(parseInt(req.query.limit) || 10, 50);
  const { clause, params } = storeFilter(req, [from, to]);
  const rows = db.prepare(`SELECT item, category, ${GROSS_SQL} revenue, ${UNITS_SQL} quantity FROM sales WHERE line_type='sale' AND sold_at BETWEEN ? AND ?${clause} GROUP BY item ORDER BY ${by} DESC LIMIT ?`).all(...params, limit);
  res.json(rows.map((r) => ({ ...r, revenue: round2(r.revenue) })));
});

app.get("/api/categories", (req, res) => {
  const { from, to } = range(req);
  const { clause, params } = storeFilter(req, [from, to]);
  const rows = db.prepare(`SELECT category, ${GROSS_SQL} revenue, ${UNITS_SQL} quantity FROM sales WHERE line_type='sale' AND sold_at BETWEEN ? AND ?${clause} GROUP BY category ORDER BY revenue DESC`).all(...params);
  res.json(rows.map((r) => ({ ...r, revenue: round2(r.revenue) })));
});

app.get("/api/dayparts", (req, res) => {
  const { from, to } = range(req);
  const { clause, params } = storeFilter(req, [from, to]);
  const rows = db.prepare(`SELECT ${DAYPART_SQL} daypart, ${GROSS_SQL} revenue, ${UNITS_SQL} quantity FROM sales WHERE line_type='sale' AND sold_at BETWEEN ? AND ?${clause} GROUP BY daypart ORDER BY revenue DESC`).all(...params);
  res.json(rows.map((r) => ({ ...r, revenue: round2(r.revenue) })));
});

// ---- Excel upload ----
app.post("/api/upload", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  let bodyStoreId = req.body.storeId ? Number(req.body.storeId) : null;
  const bodyStoreName = req.body.storeName ? String(req.body.storeName).trim() : null;
  if (bodyStoreId && !db.prepare("SELECT id FROM stores WHERE id=?").get(bodyStoreId)) {
    return res.status(400).json({ error: "Selected store does not exist" });
  }
  if (!bodyStoreId && bodyStoreName) {
    bodyStoreId = ensureStore(bodyStoreName);
  }

  const parsed = parseSpreadsheet(req.file.buffer);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  if (!parsed.hasStoreColumn && !bodyStoreId) {
    return res.status(400).json({ error: "No Store column in file and no store selected. Pick a store or include a Store/Location column." });
  }

  const sales = parsed.sales.map((s) => ({ ...s, storeId: bodyStoreId }));
  const duty = parsed.duty.map((d) => ({ ...d, storeId: bodyStoreId }));

  try {
    const result = ingest({ sales, duty, source: "upload", filename: req.file.originalname });
    res.json({
      imported: result.imported,
      wiped: result.wiped,
      skipped: parsed.errors.length,
      errors: parsed.errors.slice(0, 20),
      stores: result.stores,
      detectedStoreColumn: parsed.hasStoreColumn,
      managerColumnUsed: parsed.duty.length > 0,
      lineTypeColumnUsed: parsed.sales.some((s) => s.lineType !== "sale")
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- Excel template download ----
app.get("/api/template", (req, res) => {
  const sample = [
    ...MENU.slice(0, 2).map((m, i) => ({
      Date: new Date().toISOString().slice(0, 10),
      Time: `0${8 + i}:30`,
      Store: "Westfield",
      Item: m.item,
      Category: m.category,
      Quantity: 1,
      "Unit Price": m.price,
      Total: m.price,
      "Payment Method": "card",
      "Line Type": "sale",
      Manager: "Alex Rivera"
    })),
    {
      Date: new Date().toISOString().slice(0, 10),
      Time: "12:15",
      Store: "Westfield",
      Item: MENU[0].item,
      Category: MENU[0].category,
      Quantity: 1,
      "Unit Price": MENU[0].price,
      Total: MENU[0].price,
      "Payment Method": "card",
      "Line Type": "comp",
      Manager: "Alex Rivera"
    },
    {
      Date: new Date().toISOString().slice(0, 10),
      Time: "18:40",
      Store: "Westfield",
      Item: MENU[1].item,
      Category: MENU[1].category,
      Quantity: 1,
      "Unit Price": MENU[1].price,
      Total: MENU[1].price,
      "Payment Method": "card",
      "Line Type": "void",
      Manager: "Alex Rivera"
    }
  ];
  const ws = XLSX.utils.json_to_sheet(sample);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sales");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  res.setHeader("Content-Disposition", "attachment; filename=ihop-sales-template.xlsx");
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.send(buf);
});

// ---- manual entries (staff inputs) ----
app.get("/api/entries", (req, res) => {
  const storeId = req.query.storeId ? Number(req.query.storeId) : null;
  if (storeId) {
    return res.json(db.prepare("SELECT * FROM entries WHERE store_id=? ORDER BY entry_date DESC, id DESC LIMIT 100").all(storeId));
  }
  res.json(db.prepare("SELECT * FROM entries ORDER BY entry_date DESC, id DESC LIMIT 100").all());
});

app.post("/api/entries", (req, res) => {
  const { storeId, entry_date, type = "note", text, amount = null } = req.body || {};
  if (!storeId || !entry_date || !text) return res.status(400).json({ error: "storeId, entry_date and text are required" });
  const info = db.prepare(
    "INSERT INTO entries (store_id, entry_date, type, text, amount) VALUES (?, ?, ?, ?, ?)"
  ).run(storeId, entry_date, type, text, amount);
  res.json({ id: Number(info.lastInsertRowid) });
});

app.use(reportRouter);

// ---- serve the built dashboard (client/dist) ----
const dist = path.join(__dirname, "..", "..", "client", "dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(dist, "index.html")));
} else {
  app.get("/", (req, res) =>
    res.send("Dashboard not built yet. Run: cd client && npm install && npm run build"));
}

const PORT = process.env.PORT || 4000;
app.listen(PORT, () =>
  console.log(`IHOP Sales Analytics running at http://localhost:${PORT}`));
