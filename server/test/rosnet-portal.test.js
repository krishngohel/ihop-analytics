// Runs the portal connector against a stand-in for account.rosnet.com + portal.rosnet.com that
// mirrors the real shapes captured from PowerCenter: a login that returns access_token, and the
// LocationFilter / ActualVsForecastSales / ForecastActualTheoHours / LaborCost / Comp / by-date
// widgets. Confirms sign-in, location placement with region+area, and the merged per-store rows.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "portal-test-"));
process.env.OPS_DB_PATH = path.join(dir, "ops.db");
process.env.ROSNET_PORTAL_CLIENT = "ACGTX";
process.env.ROSNET_PORTAL_CLIENT_ID = "95";

const seen = { loginCreds: [], cookies: new Set(), clientIds: new Set() };
const LOCATIONS = {
  level3: { label: "Area", choices: [{ label: "ACGTX North", value: "ACGTX North", parentValue: "" }] },
  level2: { label: "Region", choices: [{ label: "Dallas", value: "Dallas", parentValue: "ACGTX North" }] },
  level1: { label: "Locations", choices: [
    // value is an internal id, deliberately NOT the store number in the label.
    { label: "1404 -  Garland", value: "94", parentValue: "Dallas" },
    { label: "1413 -  Plano", value: "97", parentValue: "Dallas" },
  ] },
};
const bars = (a, b) => ({ labels: ["1404 -  Garland", "1413 -  Plano"], datasets: [a, b].filter(Boolean) });

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const json = (b) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(b)); };
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (url.pathname === "/api/sso-scheme") return json({ client: null, scheme: null, authUrl: null });
    if (url.pathname === "/api/login") {
      const creds = JSON.parse(body || "{}");
      seen.loginCreds.push(creds);
      if (creds.password !== "portal-pass") { res.writeHead(401); return res.end("{}"); }
      return json({ message: "OK", access_token: "tok-abc123" });
    }
    // Everything else is the gateway.
    seen.cookies.add(req.headers.cookie);
    seen.clientIds.add(req.headers.clientid);
    if (!/access_token=tok-abc123/.test(req.headers.cookie || "")) { res.writeHead(401); return res.end("{}"); }
    const label = url.search.replace(/^\?/, "");
    if (label === "validate-token") return json({ status: 200, acls: "[95]" });
    if (label === "getLocationFilters") return json(LOCATIONS);
    if (label === "AvF") return json(bars({ label: "Actual Sales", data: [8000, 5500] }, { label: "Forecast Sales", data: [8200, 5400] }));
    if (label === "Comp") return json(bars({ label: "Sales", data: [8000, 5500] }, { label: "Comp", data: [7000, 6000] }));
    if (label === "Hrs") return json({ headings: [], data: [
      { locationNumber: 1404, location: "Garland", forecastHours: 150, scheduledHours: 148, totalLaborHours: 160, theoHours: 145 },
      { locationNumber: 1413, location: "Plano", forecastHours: 120, scheduledHours: 122, totalLaborHours: 118, theoHours: 119 },
    ] });
    if (label === "Cost") return json({ data: [
      { locationNumber: 1404, laborAmout: 1780.5 }, { locationNumber: 1413, laborAmout: 1300 },
    ] });
    if (label === "ByDate") {
      const d = new Date(); d.setDate(d.getDate() - 2);
      const col = `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
      return json({ headings: ["LocationNumber", "LocationName", col, "Total"], data: [
        { LocationNumber: 1404, LocationName: "Garland", [col]: 7800, Total: 7800 },
        { LocationNumber: 1413, LocationName: "Plano", [col]: 5100, Total: 5100 },
      ] });
    }
    res.writeHead(404); res.end("{}");
  });
});

test.before(() => new Promise((r) => server.listen(0, "127.0.0.1", () => {
  const port = server.address().port;
  process.env.ROSNET_PORTAL_ACCOUNT_URL = `http://127.0.0.1:${port}`;
  process.env.ROSNET_PORTAL_URL = `http://127.0.0.1:${port}`;
  process.env.ROSNET_PORTAL_SVC = `http://127.0.0.1:${port}/`;
  r();
})));
test.after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test("signs in to the portal and pulls sales, forecast, last year and labor by store", async () => {
  const { default: db } = await import("../src/db.js");
  const { saveConnectionValues } = await import("../src/connections.js");
  const { syncPortal, testPortal, portalConfig } = await import("../src/sources/rosnet-portal.js");
  const { yesterday, addDays, today } = await import("../src/dates.js");

  assert.equal(portalConfig().configured, false);
  saveConnectionValues({ rosnet_portal_user: "mo@acgtexas.com", rosnet_portal_password: "portal-pass" });
  assert.equal(portalConfig().configured, true);

  const probe = await testPortal();
  assert.equal(probe.locations, 2);
  assert.equal(seen.clientIds.has("95"), true, "the client id is sent");

  const out = await syncPortal();
  assert.equal(out.new_restaurants.length, 2);
  assert.ok(out.rows >= 2);

  const garland = db.prepare(`SELECT p.*, r.restaurant_name, a.area_name, reg.region_name
    FROM daily_performance p JOIN restaurant r USING (restaurant_id)
    JOIN area a ON a.area_id = r.area_id JOIN region reg ON reg.region_id = r.region_id
    WHERE r.store_number = '1404' AND p.date = ? AND p.daypart = 'all'`).get(yesterday());
  assert.equal(garland.restaurant_name, "IHOP #1404 Garland");
  assert.equal(garland.region_name, "ACGTX North", "level3 is the region");
  assert.equal(garland.area_name, "Dallas", "level2 is the area");
  assert.equal(garland.actual_sales, 8000);
  assert.equal(garland.forecast_sales, 8200);
  assert.equal(garland.prior_year_sales, 7000);
  assert.equal(garland.actual_labor_hours, 160);
  assert.equal(garland.scheduled_labor_hours, 148);
  assert.equal(garland.allowable_labor_hours, 150, "allowable = forecast/earned hours");
  assert.equal(garland.actual_labor_cost, 1780.5);
  assert.equal(garland.source, "rosnet");

  assert.equal(db.prepare("SELECT is_final FROM daily_performance WHERE date = ? LIMIT 1").get(today()).is_final, 0, "today is live");
  const seeded = db.prepare("SELECT actual_sales FROM daily_performance p JOIN restaurant r USING (restaurant_id) WHERE r.store_number = '1404' AND date = ?").get(addDays(today(), -2));
  assert.equal(seeded?.actual_sales, 7800, "the by-date report seeded history");

  // With no client id supplied, it resolves from the token's ACLs (validate-token) instead of 403ing.
  delete process.env.ROSNET_PORTAL_CLIENT_ID;
  const probe2 = await testPortal();
  assert.equal(probe2.client_id, "95", "client id resolved from the token ACLs");
  assert.equal(probe2.locations, 2);
  process.env.ROSNET_PORTAL_CLIENT_ID = "95";
});

test("a bad portal password gives a clear error and never appears in the message", async () => {
  const { saveConnectionValues } = await import("../src/connections.js");
  const { testPortal } = await import("../src/sources/rosnet-portal.js");
  saveConnectionValues({ rosnet_portal_password: "wrong-pass" });
  await assert.rejects(() => testPortal(), (e) => /rejected the sign-in/i.test(e.message) && !e.message.includes("wrong-pass"));
});
