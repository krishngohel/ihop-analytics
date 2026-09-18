import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scheduler-test-"));
process.env.OPS_DB_PATH = path.join(dir, "ops.db");
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

const settings = { daily_refresh_time: "05:30", intraday_refresh_enabled: "1", intraday_refresh_minutes: "15", operating_hours_start: "05:00", operating_hours_end: "23:59" };
const at = (h, m) => new Date(2026, 8, 17, h, m);

test("the daily refresh catches up after sleep or a late start, and runs once a day", async () => {
  const { dueRefresh } = await import("../src/refresh.js");
  const state = { lastDailyRun: null, lastIntraday: at(5, 20).getTime() };
  assert.equal(dueRefresh(state, at(5, 29), settings), null, "not yet");
  assert.equal(dueRefresh(state, at(9, 12), settings), "scheduled_daily", "the Mac woke at 9:12: the 5:30 refresh still happens");
  state.lastDailyRun = "2026-09-17";
  state.lastIntraday = at(9, 12).getTime();
  assert.equal(dueRefresh(state, at(9, 20), settings), null, "done for today, and the intraday interval has not passed");
  assert.equal(dueRefresh(state, at(9, 30), settings), "intraday", "live sales every 15 minutes while open");
  assert.equal(dueRefresh(state, new Date(2026, 8, 18, 5, 31), settings), "scheduled_daily", "a new day");
  assert.equal(dueRefresh({ lastDailyRun: "2026-09-17", lastIntraday: at(1, 0).getTime() }, at(2, 0), settings), null, "closed overnight: nothing runs");
  assert.equal(dueRefresh({ lastDailyRun: "2026-09-17", lastIntraday: at(9, 0).getTime() }, at(9, 30), { ...settings, intraday_refresh_enabled: "0" }), null, "intraday switched off");
});
