import test from "node:test";
import assert from "node:assert/strict";
import { inUSBox, nameMatches, distinctiveCity } from "../src/geo.js";

test("the US box accepts CONUS/Alaska/Hawaii and rejects Canada and the Caribbean territories", () => {
  assert.equal(inUSBox(30.3, -97.6), true, "Austin, TX");
  assert.equal(inUSBox(34.0, -118.2), true, "Los Angeles, CA");
  assert.equal(inUSBox(21.3, -157.8), true, "Honolulu, HI");
  assert.equal(inUSBox(61.2, -149.9), true, "Anchorage, AK");
  assert.equal(inUSBox(54.3, -125.84), false, "Decker Lake, British Columbia (Canada)");
  assert.equal(inUSBox(17.74, -64.7), false, "US Virgin Islands");
  assert.equal(inUSBox(6.8, -58.16), false, "Georgetown, Guyana");
  assert.equal(inUSBox(41.66, -0.88), false, "Zaragoza, Spain");
  assert.equal(inUSBox(null, null), false);
});

test("a geocode is accepted only when its name genuinely matches the store", () => {
  assert.equal(nameMatches("Decker Lake", "Decker Creek Dam"), true, "shares 'Decker'");
  assert.equal(nameMatches("South San Francisco", "South San Francisco"), true, "exact");
  assert.equal(nameMatches("Santa Rosa Fulton", "Santa Rosa"), true, "shares 'Santa'/'Rosa'");
  assert.equal(nameMatches("Amarillo", "Amarillo"), true);
  assert.equal(nameMatches("Market Place", "New Haven Green"), false, "no shared distinctive word");
  assert.equal(nameMatches("Research Blvd", "Richmond"), false);
});

test("a name that is only generic place words can't be geocoded confidently", () => {
  assert.equal(distinctiveCity("Amarillo"), true);
  assert.equal(distinctiveCity("Decker Lake"), true, "'Decker' is distinctive");
  assert.equal(distinctiveCity("Grand Forks"), true, "'Forks' is distinctive");
  assert.equal(distinctiveCity("Market Place"), false, "both words are generic");
  assert.equal(distinctiveCity("The Commons"), false);
});
