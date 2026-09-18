// An emailed vendor report the way back-office systems send them: title rows above the
// header, abbreviated column names, the business date only in the title, a totals line.
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import XLSX from "xlsx";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mailbox-test-"));
process.env.OPS_DB_PATH = path.join(dir, "ops.db");
process.env.IMPORT_DIR = path.join(dir, "reports");
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

function workbook(rows) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Report");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}
const mail = (from, filename, content) => ({ from: { value: [{ address: from }] }, subject: "Daily Sales Flash", attachments: [{ filename, content }] });

test("a scheduled report emailed from a trusted sender imports by itself", async () => {
  const { default: db } = await import("../src/db.js");
  const { ingestMessage } = await import("../src/mailbox.js");
  const report = workbook([
    ["Daily Sales Flash"],
    ["Business Date: 09/16/2026"],
    [],
    ["Store #", "Location", "Region", "Area", "Net Sls", "Fcst", "LY Sales", "Act Hours", "Allowed Hours"],
    [3100, "Plano", "North Texas", "Dallas", 8000, 8200, 7000, 160, 150],
    [3101, "Garland", "North Texas", "Dallas", 5500, 5400, 6000, 120, 125],
    ["Total", "", "", "", 13500, 13600, 13000, 280, 275],
  ]);

  const stranger = ingestMessage(mail("someone@example.org", "flash.xlsx", report), ["rosnet.com"]);
  assert.equal(stranger.ignored, true, "mail from an untrusted sender is not imported");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM daily_performance").get().n, 0);

  const out = ingestMessage(mail("reports@mail.rosnet.com", "Daily Sales Flash.xlsx", report), ["rosnet.com"]);
  assert.deepEqual(out.files.map((f) => [f.imported, f.status]), [[2, "ok"]], JSON.stringify(out.files));
  const plano = db.prepare("SELECT p.* FROM daily_performance p JOIN restaurant r USING (restaurant_id) WHERE r.store_number = '3100'").get();
  assert.equal(plano.date, "2026-09-16", "the date comes from the report title");
  assert.deepEqual([plano.actual_sales, plano.forecast_sales, plano.prior_year_sales, plano.actual_labor_hours, plano.allowable_labor_hours, plano.labor_variance], [8000, 8200, 7000, 160, 150, 10]);
});

test("a report in a layout nobody has mapped is kept, fixed once, and then imports by itself", async () => {
  const { default: db } = await import("../src/db.js");
  const { ingestMessage, importMailbox } = await import("../src/mailbox.js");
  const { listPending, importPending, retryPending, previewFile, readPending } = await import("../src/imports.js");
  // Column names the importer cannot guess.
  const odd = (date, sales) => workbook([["Code", "Bus Day", "Rgn", "Dist", "Revenue"], [3200, date, "Southeast", "Atlanta", sales]]);

  const first = ingestMessage(mail("reports@rosnet.com", "Unit Flash.xlsx", odd("2026-09-15", 9000)), ["rosnet.com"]);
  assert.equal(first.files[0].status, "needs_mapping");
  assert.equal(listPending().length, 1, "the file is kept");
  const kept = listPending()[0];
  assert.deepEqual([kept.channel, kept.filename], ["mailbox", "Unit Flash.xlsx"]);

  // From the dashboard: look at the kept file, choose the columns, save the layout.
  const preview = previewFile(readPending(kept.name));
  assert.deepEqual(preview.headers, ["Code", "Bus Day", "Rgn", "Dist", "Revenue"]);
  assert.deepEqual(preview.mapping, { date: "Bus Day", region: "Rgn", area: "Dist" }, "what it could guess is pre-filled");
  const fixed = importPending(kept.name, { kind: "performance", mapping: { store_number: "Code", date: "Bus Day", region: "Rgn", area: "Dist", actual_sales: "Revenue" }, saveProfileAs: "Rosnet Unit Flash" });
  assert.equal(fixed.imported, 1, JSON.stringify(fixed.errors));
  assert.equal(listPending().length, 0, "no longer waiting");

  // The next day's copy in the same layout arrives and needs nobody.
  const next = ingestMessage(mail("reports@rosnet.com", "Unit Flash.xlsx", odd("2026-09-16", 9100)), ["rosnet.com"]);
  assert.deepEqual([next.files[0].status, next.files[0].imported], ["ok", 1]);
  assert.equal(db.prepare("SELECT actual_sales FROM daily_performance p JOIN restaurant r USING (restaurant_id) WHERE r.store_number = '3200' AND date = '2026-09-16'").get().actual_sales, 9100);

  // A copy kept before the layout existed is picked up by the next refresh.
  ingestMessage(mail("reports@rosnet.com", "Other.xlsx", workbook([["Loc", "When", "Revenue"], [3200, "2026-09-14", 8800]])), ["rosnet.com"]);
  assert.equal(listPending().length, 1);
  assert.equal(retryPending().length, 0, "no layout for it yet, so it waits");
  importPending(listPending()[0].name, { kind: "performance", mapping: { store_number: "Loc", date: "When", actual_sales: "Revenue" }, saveProfileAs: "Other layout" });
  ingestMessage(mail("reports@rosnet.com", "Other.xlsx", workbook([["Loc", "When", "Revenue"], [3200, "2026-09-13", 8700]])), ["rosnet.com"]);
  assert.equal(listPending().length, 0);
  assert.equal(importMailbox.name, "importMailbox");
});

test("a report sent as a table in the email body is read like a file", async () => {
  const { default: db } = await import("../src/db.js");
  const { ingestMessage } = await import("../src/mailbox.js");
  const html = `<html><body><p>Hello</p><table><tr><th>Store Number</th><th>Region</th><th>Area</th><th>Net Sales</th><th>Forecast</th></tr><tr><td>3300</td><td>Gulf Coast</td><td>Mobile</td><td>$7,250.00</td><td>7,000</td></tr></table></body></html>`;
  const out = ingestMessage({ from: { value: [{ address: "reports@rosnet.com" }] }, subject: "Sales Flash 09/12/2026", html, attachments: [] }, ["rosnet.com"]);
  assert.deepEqual([out.files[0].status, out.files[0].imported], ["ok", 1], JSON.stringify(out));
  const row = db.prepare("SELECT date, actual_sales, forecast_sales FROM daily_performance p JOIN restaurant r USING (restaurant_id) WHERE r.store_number = '3300'").get();
  assert.deepEqual({ ...row }, { date: "2026-09-12", actual_sales: 7250, forecast_sales: 7000 }, "the date comes from the subject line");

  const pdfOnly = ingestMessage({ from: { value: [{ address: "reports@rosnet.com" }] }, subject: "Flash", html: "<p>See attached</p>", attachments: [{ filename: "flash.pdf", content: Buffer.from("%PDF") }] }, ["rosnet.com"]);
  assert.deepEqual(pdfOnly.unreadable, ["flash.pdf"]);
});
