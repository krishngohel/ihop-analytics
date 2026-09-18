import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import XLSX from "xlsx";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "imports-test-"));
process.env.OPS_DB_PATH = path.join(dir, "ops.db");
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

// Each way a report can spell a business date must land on that date, whatever zone the server is in.
test("a report's business date is kept as written", async () => {
  const { default: db } = await import("../src/db.js");
  const { ingestFile } = await import("../src/imports.js");
  const head = "Store Number,Restaurant,Region,Area,Date,Net Sales\n";
  const xlsx = () => {
    const ws = XLSX.utils.aoa_to_sheet([["Store Number", "Restaurant", "Region", "Area", "Date", "Net Sales"], [4, "Store D", "R", "A", new Date(2026, 8, 16), 400]], { cellDates: true });
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Report");
    return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  };
  const files = [
    Buffer.from(`${head}1,Store A,R,A,2026-09-16,100\n`),
    Buffer.from(`${head}2,Store B,R,A,9/16/2026,200\n`),
    Buffer.from(`${head}3,Store C,R,A,09/16/26,300\n`),
    xlsx(),
  ];
  for (const f of files) assert.equal(ingestFile(f, { channel: "upload", filename: "report" }).imported, 1);
  assert.deepEqual(db.prepare("SELECT DISTINCT date FROM daily_performance").all().map((r) => r.date), ["2026-09-16"]);
});
