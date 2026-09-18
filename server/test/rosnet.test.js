// Runs the Rosnet connector against a stand-in for api.rosnet.com that follows the published
// OpenAPI description: Basic auth, the Client header, "cursor" paging, and a 429 with Retry-After.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rosnet-test-"));
process.env.OPS_DB_PATH = path.join(dir, "ops.db");
process.env.ROSNET_API_USER = "api-user";
process.env.ROSNET_API_KEY = "api-key";
process.env.ROSNET_CLIENT_ID = "client-42";
process.env.ROSNET_BACKFILL_DAYS = "2";

const seen = { auth: new Set(), client: new Set(), paths: [], throttled: 0 };
const LOCATIONS = [
  { Id: 3100, Name: "Plano", OpenDate: "2010-01-01", ClosedDate: null, TimeZoneName: "America/Chicago" },
  { Id: 3101, Name: "Garland", OpenDate: "2011-01-01", ClosedDate: null, TimeZoneName: "America/Chicago" },
  { Id: 2999, Name: "Closed Store", OpenDate: "2005-01-01", ClosedDate: "2020-01-01", TimeZoneName: "America/Chicago" },
];
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  seen.auth.add(req.headers.authorization); seen.client.add(req.headers.client); seen.paths.push(url.pathname);
  if (req.headers.authorization !== `Basic ${Buffer.from("api-user:api-key").toString("base64")}`) { res.writeHead(401); return res.end(); }
  const date = (url.searchParams.get("businessDate") || "").slice(0, 10);
  const json = (body, headers = {}) => { res.writeHead(200, { "content-type": "application/json", ...headers }); res.end(JSON.stringify(body)); };
  if (url.pathname === "/general/locations") {
    // Two pages, to exercise the cursor header.
    return url.searchParams.get("cursor") ? json(LOCATIONS.slice(2)) : json(LOCATIONS.slice(0, 2), { cursor: "page-2" });
  }
  if (url.pathname === "/labor/definitions/jobs") return json([{ Id: 1, Name: "Server" }, { Id: 2, Name: "General Manager" }]);
  if (url.pathname === "/sales/totalSales") {
    if (!seen.throttled) { seen.throttled++; res.writeHead(429, { "retry-after": "1" }); return res.end(); }
    const lastYear = date < "2026-01-01";
    return json([{ LocationId: 3100, BusinessDate: date, NetAmount: lastYear ? 7000 : 8000.5, GrossAmount: 9000, OverShort: 0 },
      { LocationId: 3101, BusinessDate: date, NetAmount: lastYear ? 6000 : 5500, GrossAmount: 6000, OverShort: 0 },
      { LocationId: 2999, BusinessDate: date, NetAmount: 1, GrossAmount: 1, OverShort: 0 }]);
  }
  if (url.pathname === "/labor/shifts") {
    return json([
      { LocationId: 3100, BusinessDate: date, EmployeeId: 1, Begin: `${date}T06:00:00`, End: `${date}T14:30:00`, JobId: 1, BaseRate: 10, PayRate: 10 },
      { LocationId: 3100, BusinessDate: date, EmployeeId: 2, Begin: `${date}T07:00:00`, End: `${date}T17:00:00`, JobId: 2, BaseRate: 25, PayRate: 25 },
      { LocationId: 3101, BusinessDate: date, EmployeeId: 3, Begin: `${date}T22:00:00`, End: `${date.slice(0, 8)}${String(Number(date.slice(8)) + 1).padStart(2, "0")}T02:00:00`, JobId: 1, BaseRate: 12, PayRate: 12 },
    ]);
  }
  if (url.pathname === "/labor/shifts/Schedule") return json([{ LocationId: 3100, EmployeeId: 1, ScheduleBusinessDate: date, ShiftHours: 8 }, { LocationId: 3100, EmployeeId: 2, ScheduleBusinessDate: date, ShiftHours: 9.5 }]);
  res.writeHead(404); res.end();
});

test.before(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  process.env.ROSNET_API_URL = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test("pulls locations, sales, last year and labor from the Rosnet API", async () => {

  const { default: db } = await import("../src/db.js");
  const { syncRosnet } = await import("../src/sources/rosnet.js");
  const { ingestFile } = await import("../src/imports.js");
  const { addDays } = await import("../src/dates.js");
  const { localDate } = await import("../src/dayparts.js");
  // "Today" is the restaurants' calendar day, which is what decides live against final.
  const today = () => localDate("America/Chicago");

  const out = await syncRosnet();
  assert.equal(out.locations, 2, "the closed location is left out");
  assert.equal(out.new_restaurants.length, 2);
  assert.equal(out.days, 3);
  assert.equal(out.rows, 6);
  assert.equal(seen.throttled, 1, "a 429 was retried after Retry-After");
  assert.deepEqual([...seen.client], ["client-42"]);

  const day = addDays(today(), -1);
  const plano = db.prepare("SELECT p.*, r.restaurant_name, a.area_name FROM daily_performance p JOIN restaurant r USING (restaurant_id) JOIN area a ON a.area_id = r.area_id WHERE r.store_number = '3100' AND p.date = ? AND p.daypart = 'all'").get(day);
  assert.equal(plano.restaurant_name, "IHOP #3100 Plano");
  assert.equal(plano.area_name, "Unassigned");
  assert.equal(plano.actual_sales, 8000.5);
  assert.equal(plano.prior_year_sales, 7000);
  assert.equal(plano.actual_labor_hours, 18.5);
  assert.equal(plano.manager_hours, 10);
  assert.equal(plano.actual_labor_cost, 8.5 * 10 + 10 * 25);
  assert.equal(plano.scheduled_labor_hours, 17.5);
  assert.equal(plano.source, "rosnet");
  assert.equal(plano.is_final, 1);
  const garland = db.prepare("SELECT p.* FROM daily_performance p JOIN restaurant r USING (restaurant_id) WHERE r.store_number = '3101' AND p.date = ?").get(day);
  assert.equal(garland.actual_labor_hours, 4, "a shift past midnight counts its full length");
  assert.equal(db.prepare("SELECT is_final FROM daily_performance WHERE date = ? LIMIT 1").get(today()).is_final, 0, "today is live");

  // A forecast report for the same day adds to the API row instead of replacing it, and
  // its Region and Area columns move the restaurant out of "Unassigned".
  const csv = `Store Number,Date,Region,Area,Forecast Sales,Allowable Hours\n3100,${day},North Texas,Dallas,8200,17\n`;
  const r = ingestFile(Buffer.from(csv), { channel: "upload", filename: "forecast.csv" });
  assert.equal(r.imported, 1, JSON.stringify(r.errors));
  const after = db.prepare("SELECT p.actual_sales, p.forecast_sales, p.allowable_labor_hours, p.labor_variance, a.area_name FROM daily_performance p JOIN restaurant r USING (restaurant_id) JOIN area a ON a.area_id = r.area_id WHERE r.store_number = '3100' AND p.date = ?").get(day);
  assert.deepEqual({ ...after }, { actual_sales: 8000.5, forecast_sales: 8200, allowable_labor_hours: 17, labor_variance: 1.5, area_name: "Dallas" });

  // The next run keeps the forecast, and does not ask for last year again.
  const before = seen.paths.length;
  await syncRosnet();
  assert.equal(db.prepare("SELECT forecast_sales f FROM daily_performance p JOIN restaurant r USING (restaurant_id) WHERE r.store_number = '3100' AND p.date = ?").get(day).f, 8200);
  assert.equal(seen.paths.slice(before).filter((p) => p === "/sales/totalSales").length, 3, "one sales call per day, none for last year");
});

test("bad credentials give a clear error and no key in the message", async () => {
  process.env.ROSNET_API_KEY = "wrong-key";
  const { syncRosnet } = await import("../src/sources/rosnet.js");
  await assert.rejects(() => syncRosnet(), (e) => /refused the API credentials \(401\)/.test(e.message) && !e.message.includes("wrong-key"));
});
