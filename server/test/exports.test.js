import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { inflateRawSync } from "node:zlib";
import XLSX from "xlsx";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "exports-test-"));
process.env.OPS_DB_PATH = path.join(dir, "ops.db");
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

const user = { user_id: 0, email: "operator@localhost", role: "executive" };

// Two regions, two restaurants, ten days. Sales exist for every day; forecast, last year
// and labor only for the last four, the way a fresh Rosnet connection looks.
async function seed() {
  const { default: db } = await import("../src/db.js");
  const { savePerformance } = await import("../src/performance.js");
  db.exec("DELETE FROM daily_performance; DELETE FROM restaurant; DELETE FROM area; DELETE FROM region;");
  for (const [region, area, store, number] of [["North", "Area N1", "IHOP #1 Alpha", "1"], ["South", "Area S1", "IHOP #2 Beta", "2"]]) {
    db.prepare("INSERT INTO region (region_name) VALUES (?)").run(region);
    const regionId = db.prepare("SELECT region_id FROM region WHERE region_name = ?").get(region).region_id;
    db.prepare("INSERT INTO area (area_name, region_id) VALUES (?, ?)").run(area, regionId);
    const areaId = db.prepare("SELECT area_id FROM area WHERE area_name = ?").get(area).area_id;
    db.prepare("INSERT INTO restaurant (restaurant_name, store_number, region_id, area_id) VALUES (?, ?, ?, ?)").run(store, number, regionId, areaId);
  }
  const ids = db.prepare("SELECT restaurant_id FROM restaurant ORDER BY restaurant_id").all().map((r) => r.restaurant_id);
  const days = Array.from({ length: 10 }, (_, i) => `2026-09-${String(7 + i).padStart(2, "0")}`);
  days.forEach((date, i) => {
    ids.forEach((restaurant_id, k) => {
      const covered = i >= 6;
      savePerformance({
        date, restaurant_id, daypart: "all", actual_sales: 1000 + k * 100,
        forecast_sales: covered ? 900 : null, prior_year_sales: covered ? 1100 : null,
        actual_labor_hours: covered ? 90 : null, allowable_labor_hours: covered ? 100 : null, actual_labor_cost: covered ? 200 : null, is_final: 1,
      }, "test");
      for (const dp of ["breakfast", "lunch", "dinner", "late_night"]) savePerformance({ date, restaurant_id, daypart: dp, actual_sales: 250 + k * 25, is_final: 1 }, "test");
    });
  });
  return { db, days };
}

test("variances only count the days that have both sides on file", async () => {
  const { days } = await seed();
  const { companyTotals } = await import("../src/analytics.js");
  const t = companyTotals(user, { from: days[0], to: days[9] });
  assert.equal(t.actual_sales, 21000); // ten days of sales
  assert.equal(t.forecast_basis, 7200); // four days of forecast
  assert.equal(t.forecast_covered_sales, 8400); // the sales on those four days
  assert.equal(t.sales_variance_pct, 16.7); // 8400 vs 7200, not 21000 vs 7200
  assert.equal(t.prior_year_variance_pct, -4.5); // 8400 vs 8800
  assert.equal(t.labor_cost_pct, 19); // 1600 cost against the 8400 of covered sales
});

test("forecast coverage reports the partial window so the UI never divides a total by a partial forecast", async () => {
  const { days } = await seed();
  const { forecastCoverage } = await import("../src/analytics.js");
  const partial = forecastCoverage(user, { from: days[0], to: days[9] }); // 10 sales days, 4 forecast days
  assert.equal(partial.partial, true);
  assert.equal(partial.salesDays, 10);
  assert.equal(partial.forecastDays, 4);
  assert.equal(partial.totalSales, 21000);
  assert.equal(partial.coveredSales, 8400);
  // The variance shown must reconcile against the covered sales, not the total: (8400-7200)/7200 = +16.7%.
  const full = forecastCoverage(user, { from: days[6], to: days[9] }); // only forecasted days
  assert.equal(full.partial, false); // every day in this window has a forecast
});

test("weekly and weekday rollups follow the same rule", async () => {
  const { days } = await seed();
  const { trendsData } = await import("../src/trends.js");
  const t = trendsData(user, { from: days[0], to: days[9] });
  assert.equal(t.daily.length, 10);
  assert.deepEqual(t.weekly.map((w) => [w.week_start, w.days, w.partial]), [["2026-09-07", 7, false], ["2026-09-14", 3, true]]);
  assert.equal(t.weekly[0].sales_variance_pct, 16.7); // Sep 13 is the one covered day of that week
  assert.equal(t.weekly[1].week_over_week_pct, null); // a partial week is never compared with a full one
  assert.equal(t.weekday.find((w) => w.short === "Mon").days, 2);
  assert.deepEqual(t.groups.groups.map((g) => g.name), ["North", "South"]);
  assert.equal(t.daypartByDay.length, 10);
  assert.equal(t.daypartByDay[0].breakfast, 525);
});

test("a store with a broken too-low forecast is kept in the tables but never highlighted as an outperformer", async () => {
  const { db, days } = await seed();
  const { savePerformance } = await import("../src/performance.js");
  const { evaluateHotspots } = await import("../src/hotspots.js");
  // A third store whose Rosnet forecast is absurdly low ($50 against $3,000 in sales) on the
  // forecasted days — the shape of a broken forecast, which reads as +5,900%.
  db.prepare("INSERT INTO region (region_name) VALUES ('West')").run();
  const rid3 = db.prepare("SELECT region_id FROM region WHERE region_name='West'").get().region_id;
  db.prepare("INSERT INTO area (area_name, region_id) VALUES ('Area W1', ?)").run(rid3);
  const aid3 = db.prepare("SELECT area_id FROM area WHERE area_name='Area W1'").get().area_id;
  db.prepare("INSERT INTO restaurant (restaurant_name, store_number, region_id, area_id) VALUES ('IHOP #9 Broken Forecast', '9', ?, ?)").run(rid3, aid3);
  const brokenId = db.prepare("SELECT restaurant_id FROM restaurant WHERE store_number='9'").get().restaurant_id;
  for (const date of days.slice(6)) savePerformance({ date, restaurant_id: brokenId, daypart: "all", actual_sales: 3000, forecast_sales: 50, prior_year_sales: 2900, is_final: 1 }, "test");

  const hs = evaluateHotspots(user, { from: days[6], to: days[9] });
  const broken = hs.evaluated.find((s) => s.id === brokenId);
  assert.ok(broken.sales_variance_pct > 1000, "the real (broken) variance is still computed and kept in the ranked data");
  assert.equal(hs.positives.some((p) => p.id === brokenId), false, "it is not highlighted as an outperformer");
  assert.notEqual(broken.severity, "positive_outlier", "it does not get the positive-outlier badge");
});

test("the Excel workbook is a valid package with charts that point at its cells", async () => {
  const { days } = await seed();
  const { buildWorkbook } = await import("../src/export.js");
  const buffer = buildWorkbook(user, { from: days[0], to: days[9], daypart: "all", filters: {} }, { scopeName: "All restaurants" });
  assert.equal(buffer.readUInt32LE(0), 0x04034b50); // zip local header
  const wb = XLSX.read(buffer, { type: "buffer" });
  assert.deepEqual(wb.SheetNames, ["Summary", "Daily", "Weekly", "Regions", "Dayparts", "Daypart mix", "Weekday", "Restaurants"]);
  const daily = wb.Sheets.Daily;
  assert.equal(daily.A1.v, "Date");
  assert.equal(daily.C2.v, 2100); // day one sales
  assert.equal(daily.C12.v, 21000); // totals row
  assert.equal(daily.F12.v, 0.167); // stored as a fraction so Excel's 0.0% format shows 16.7%
  // The chart parts are inside the package and reference the Daily sheet.
  const names = listZip(buffer);
  assert.ok(names.includes("xl/charts/chart1.xml") && names.includes("xl/drawings/drawing1.xml"));
  const chart = readZip(buffer, "xl/charts/chart1.xml");
  assert.match(chart, /<c:f>'Daily'!\$C\$2:\$C\$11<\/c:f>/);
  assert.match(chart, /<c:lineChart>/);
  const types = readZip(buffer, "[Content_Types].xml");
  assert.match(types, /drawingml\.chart\+xml/);
});

test("the weekly PDF is well formed and covers the week", async () => {
  const { days } = await seed();
  const { buildWeeklyReport } = await import("../src/report.js");
  const buffer = buildWeeklyReport(user, { from: "2026-09-07", to: "2026-09-13", filters: {} }, { scopeName: "All restaurants" });
  const text = buffer.toString("latin1");
  assert.ok(text.startsWith("%PDF-1.4"));
  assert.ok(text.trimEnd().endsWith("%%EOF"));
  assert.equal((text.match(/\/Type \/Page\b/g) || []).length, Number(text.match(/\/Count (\d+)/)[1]));
  assert.match(text, /Weekly operations report/);
  assert.match(text, /\(All restaurants took \$/); // the narrative made it in
  // xref offsets must point at "N 0 obj" for every object.
  const xref = Number(text.match(/startxref\n(\d+)/)[1]);
  const lines = text.slice(xref).split("\n").slice(2);
  const count = Number(text.slice(xref).split("\n")[1].split(" ")[1]);
  for (let i = 1; i < count; i++) {
    const offset = Number(lines[i].slice(0, 10));
    assert.ok(text.slice(offset).startsWith(`${i} 0 obj`), `object ${i} offset`);
  }
  const { default: db } = await import("../src/db.js");
  const north = db.prepare("SELECT region_id FROM region WHERE region_name = 'North'").get().region_id;
  const region = buildWeeklyReport(user, { from: "2026-09-07", to: "2026-09-13", filters: { regionId: north } }, { scopeName: "North" });
  assert.match(region.toString("latin1"), /North took/);
});

// Minimal zip reader for the assertions above: walks the central directory.
function entries(buffer) {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buffer.readUInt16LE(end + 10); let p = buffer.readUInt32LE(end + 16);
  const out = [];
  for (let i = 0; i < count; i++) {
    const nameLen = buffer.readUInt16LE(p + 28); const extra = buffer.readUInt16LE(p + 30); const comment = buffer.readUInt16LE(p + 32);
    out.push({ name: buffer.toString("utf8", p + 46, p + 46 + nameLen), size: buffer.readUInt32LE(p + 20), offset: buffer.readUInt32LE(p + 42) });
    p += 46 + nameLen + extra + comment;
  }
  return out;
}
const listZip = (buffer) => entries(buffer).map((e) => e.name);
function readZip(buffer, name) {
  const e = entries(buffer).find((x) => x.name === name);
  const nameLen = buffer.readUInt16LE(e.offset + 26); const extra = buffer.readUInt16LE(e.offset + 28);
  const start = e.offset + 30 + nameLen + extra;
  return inflateRawSync(buffer.subarray(start, start + e.size)).toString("utf8");
}
