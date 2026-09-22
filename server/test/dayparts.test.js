import test from "node:test";
import assert from "node:assert/strict";
import { earnedShare } from "../src/dayparts.js";

test("the earned-share curve is bounded, monotonic and complete over the day", () => {
  assert.equal(earnedShare("all", 0), 0, "nothing earned at midnight");
  assert.ok(Math.abs(earnedShare("all", 24) - 1) < 1e-9, "the whole day is earned by midnight");
  let prev = -1;
  for (let h = 0; h <= 24; h += 0.25) {
    const v = earnedShare("all", h);
    assert.ok(v >= prev - 1e-9, `earned share never goes backwards (h=${h})`);
    assert.ok(v >= -1e-9 && v <= 1 + 1e-9, `earned share stays in [0,1] (h=${h})`);
    prev = v;
  }
});

test("the whole-day curve equals the daypart-mix-weighted sum of the daypart curves", () => {
  const MIX = { breakfast: 0.46, lunch: 0.27, dinner: 0.18, late_night: 0.09 };
  for (const h of [3, 7, 9.75, 13, 18, 23]) {
    const composed = Object.entries(MIX).reduce((t, [dp, m]) => t + m * earnedShare(dp, h), 0);
    assert.ok(Math.abs(composed - earnedShare("all", h)) < 1e-6, `consistent at h=${h}`);
  }
});

test("breakfast is back-loaded, not linear, so mid-morning isn't over-counted", () => {
  // Linear would put breakfast (5-11) at (9.75-5)/6 = 79% by 9:45; the real rush is 7-10, so a
  // realistic curve is lower — this is what stopped every store reading ~-50% all morning.
  const bf = earnedShare("breakfast", 9.75);
  assert.ok(bf > 0.55 && bf < 0.75, `breakfast at 9:45 is ${(bf * 100).toFixed(0)}%, below the 79% a linear model gives`);
  // Early morning is where the old model was worst: 7am should be well under a linear 33%.
  assert.ok(earnedShare("breakfast", 7) < 0.25, "only a small share of breakfast is in by 7am");
});

test("a late-night daypart counts its overnight hours as done in the morning", () => {
  const morning = earnedShare("late_night", 9.75); // 12-5am booked, 10pm-12am not yet
  assert.ok(morning > 0.5 && morning < 0.75, `overnight portion done by 9:45 (${(morning * 100).toFixed(0)}%)`);
  assert.ok(earnedShare("late_night", 23.5) > earnedShare("late_night", 9.75), "more is booked by late evening");
});
