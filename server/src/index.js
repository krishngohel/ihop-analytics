import express from "express";
import cors from "cors";
import multer from "multer";
import XLSX from "xlsx";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import db from "./db.js";
import { MENU } from "./menu.js";
import reportRouter from "./report.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json());
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// ---- helpers ----
function range(req) {
  const to = req.query.to || new Date().toISOString().slice(0, 10);
  const from = req.query.from || new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10);
  return { from: `${from}T00:00:00`, to: `${to}T23:59:59` };
}

// ---- analytics ----
app.get("/api/summary", (req, res) => {
  const { from, to } = range(req);
  const cur = db.prepare(`
    SELECT COALESCE(SUM(total),0) revenue,
           COUNT(DISTINCT sold_at || payment_method) orders,
           COALESCE(SUM(quantity),0) units
    FROM sales WHERE sold_at BETWEEN ? AND ?`).get(from, to);
  const top = db.prepare(`
    SELECT item, SUM(total) revenue FROM sales
    WHERE sold_at BETWEEN ? AND ? GROUP BY item ORDER BY revenue DESC LIMIT 1`).get(from, to);
  res.json({
    revenue: +cur.revenue.toFixed(2),
    orders: cur.orders,
    units: cur.units,
    avgTicket: cur.orders ? +(cur.revenue / cur.orders).toFixed(2) : 0,
    topItem: top ? top.item : null
  });
});

app.get("/api/revenue-trend", (req, res) => {
  const { from, to } = range(req);
  const rows = db.prepare(`
    SELECT substr(sold_at,1,10) day, ROUND(SUM(total),2) revenue,
           COUNT(DISTINCT sold_at || payment_method) orders
    FROM sales WHERE sold_at BETWEEN ? AND ?
    GROUP BY day ORDER BY day`).all(from, to);
  res.json(rows);
});

app.get("/api/top-items", (req, res) => {
  const { from, to } = range(req);
  const by = req.query.by === "quantity" ? "SUM(quantity)" : "SUM(total)";
  const limit = Math.min(parseInt(req.query.limit) || 10, 50);
  const rows = db.prepare(`
    SELECT item, category, ROUND(SUM(total),2) revenue, SUM(quantity) quantity
    FROM sales WHERE sold_at BETWEEN ? AND ?
    GROUP BY item ORDER BY ${by} DESC LIMIT ?`).all(from, to, limit);
  res.json(rows);
});

app.get("/api/categories", (req, res) => {
  const { from, to } = range(req);
  const rows = db.prepare(`
    SELECT category, ROUND(SUM(total),2) revenue, SUM(quantity) quantity
    FROM sales WHERE sold_at BETWEEN ? AND ?
    GROUP BY category ORDER BY revenue DESC`).all(from, to);
  res.json(rows);
});

app.get("/api/dayparts", (req, res) => {
  const { from, to } = range(req);
  const rows = db.prepare(`
    SELECT CASE
      WHEN CAST(substr(sold_at,12,2) AS INT) BETWEEN 5 AND 10 THEN 'Breakfast (5-11)'
      WHEN CAST(substr(sold_at,12,2) AS INT) BETWEEN 11 AND 14 THEN 'Lunch (11-15)'
      WHEN CAST(substr(sold_at,12,2) AS INT) BETWEEN 15 AND 17 THEN 'Afternoon (15-18)'
      WHEN CAST(substr(sold_at,12,2) AS INT) BETWEEN 18 AND 21 THEN 'Dinner (18-22)'
      ELSE 'Late Night (22-5)'
    END daypart, ROUND(SUM(total),2) revenue, SUM(quantity) quantity
    FROM sales WHERE sold_at BETWEEN ? AND ?
    GROUP BY daypart ORDER BY revenue DESC`).all(from, to);
  res.json(rows);
});

// ---- Excel upload ----
app.post("/api/upload", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  let wb;
  try {
    wb = XLSX.read(req.file.buffer, { type: "buffer", cellDates: true });
  } catch {
    return res.status(400).json({ error: "Could not read file - is it a valid .xlsx?" });
  }
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
  const insert = db.prepare(`
    INSERT INTO sales (sold_at, item, category, quantity, unit_price, total, payment_method, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'upload')`);

  let imported = 0;
  const errors = [];
  // First real upload replaces seed/sample data; subsequent uploads append.
  const hasUploads = db.prepare("SELECT COUNT(*) c FROM sales WHERE source='upload'").get().c > 0;
  const replace = !hasUploads;
  db.exec("BEGIN");
  try {
    if (replace) db.exec("DELETE FROM sales");
    rows.forEach((r, i) => {
      const norm = {};
      for (const k of Object.keys(r)) norm[k.toLowerCase().trim().replace(/\s+/g, "_")] = r[k];
      const item = norm.item;
      if (!item) { if (Object.values(r).some(v => v != null)) errors.push(`Row ${i + 2}: missing Item`); return; }
      const qty = Number(norm.quantity) || 1;
      const price = Number(norm.unit_price ?? norm.price) || 0;
      const total = Number(norm.total) || +(qty * price).toFixed(2);
      if (!total) { errors.push(`Row ${i + 2}: no price/total`); return; }
      let soldAt;
      const d = norm.date;
      if (d instanceof Date) {
        soldAt = new Date(d);
        const t = norm.time;
        if (typeof t === "string" && /^\d{1,2}:\d{2}/.test(t)) {
          const [h, m] = t.split(":").map(Number);
          soldAt.setHours(h, m, 0, 0);
        } else if (t instanceof Date) {
          soldAt.setHours(t.getHours(), t.getMinutes(), 0, 0);
        }
      } else if (typeof d === "string" && !isNaN(Date.parse(d))) {
        soldAt = new Date(`${d} ${norm.time || "12:00"}`);
        if (isNaN(soldAt)) soldAt = new Date(d);
      } else {
        errors.push(`Row ${i + 2}: bad Date`);
        return;
      }
      insert.run(
        soldAt.toISOString(),
        String(item),
        String(norm.category || "Uncategorized"),
        qty, price || +(total / qty).toFixed(2), total,
        String(norm.payment_method || "card")
      );
      imported++;
    });
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    return res.status(500).json({ error: e.message });
  }
  res.json({ imported, replaced: replace, skipped: errors.length, errors: errors.slice(0, 20) });
});

// ---- Excel template download ----
app.get("/api/template", (req, res) => {
  const sample = MENU.slice(0, 3).map((m, i) => ({
    Date: new Date().toISOString().slice(0, 10),
    Time: `0${8 + i}:30`,
    Item: m.item,
    Category: m.category,
    Quantity: 1,
    "Unit Price": m.price,
    Total: m.price,
    "Payment Method": "card"
  }));
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
  res.json(db.prepare("SELECT * FROM entries ORDER BY entry_date DESC, id DESC LIMIT 100").all());
});

app.post("/api/entries", (req, res) => {
  const { entry_date, type = "note", text, amount = null } = req.body || {};
  if (!entry_date || !text) return res.status(400).json({ error: "entry_date and text are required" });
  const info = db.prepare(
    "INSERT INTO entries (entry_date, type, text, amount) VALUES (?, ?, ?, ?)"
  ).run(entry_date, type, text, amount);
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
