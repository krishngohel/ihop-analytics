// Demo data source: a fictional 120-restaurant organization (4 regions, 12 areas) with
// deterministic sales, labor and guest data. Every value is a pure function of
// (restaurant, date), so the daily refresh can extend history, re-run safely, and "live"
// sales grow through the day. Stands in for the Rosnet and guest-metrics feeds until
// real exports or API access are connected. All names and figures are made up.
import db, { DAYPARTS, transaction } from "../db.js";
import { addDays, comparableLastYear, dayOfWeek, eachDay, today } from "../dates.js";
import { savePerformance, saveGuestMetrics } from "../performance.js";
import { saveWeatherRow } from "../weather.js";

const ORG = [
  { region: "North Texas", areas: [
    { area: "Dallas", manager: "Renee Calloway", state: "TX", tz: "America/Chicago", lat: 32.78, lon: -96.8,
      cities: ["Plano", "Garland", "Irving", "Mesquite", "Richardson", "Carrollton", "Frisco", "McKinney", "Lewisville", "Rockwall"] },
    { area: "Fort Worth", manager: "Marcus Delgado", state: "TX", tz: "America/Chicago", lat: 32.75, lon: -97.33,
      cities: ["Arlington", "Hurst", "Keller", "Burleson", "Weatherford", "Mansfield", "Grapevine", "Saginaw", "Benbrook", "Cleburne"] },
    { area: "Oklahoma City", manager: "Tessa Whitlock", state: "OK", tz: "America/Chicago", lat: 35.47, lon: -97.52,
      cities: ["Edmond", "Norman", "Moore", "Midwest City", "Yukon", "Mustang", "Del City", "Shawnee", "Bethany", "El Reno"] },
  ] },
  { region: "South Texas", areas: [
    { area: "Houston", manager: "Andre Boudreaux", state: "TX", tz: "America/Chicago", lat: 29.76, lon: -95.37,
      cities: ["Katy", "Pasadena", "Sugar Land", "Pearland", "Spring", "Humble", "Baytown", "Cypress", "Tomball", "League City"] },
    { area: "San Antonio", manager: "Lucia Navarro", state: "TX", tz: "America/Chicago", lat: 29.42, lon: -98.49,
      cities: ["Alamo Heights", "Schertz", "New Braunfels", "Converse", "Live Oak", "Leon Valley", "Seguin", "Boerne", "Universal City", "Helotes"] },
    { area: "Austin", manager: "Grant Ellison", state: "TX", tz: "America/Chicago", lat: 30.27, lon: -97.74,
      cities: ["Round Rock", "Cedar Park", "Pflugerville", "Georgetown", "San Marcos", "Kyle", "Leander", "Buda", "Lakeway", "Bastrop"] },
  ] },
  { region: "Gulf Coast", areas: [
    { area: "New Orleans", manager: "Camille Fontenot", state: "LA", tz: "America/Chicago", lat: 29.95, lon: -90.07,
      cities: ["Metairie", "Kenner", "Slidell", "Gretna", "Harvey", "Chalmette", "Covington", "Mandeville", "Marrero", "LaPlace"] },
    { area: "Baton Rouge", manager: "Owen Thibodeaux", state: "LA", tz: "America/Chicago", lat: 30.45, lon: -91.19,
      cities: ["Denham Springs", "Gonzales", "Zachary", "Baker", "Prairieville", "Central", "Port Allen", "Walker", "Hammond", "Plaquemine"] },
    { area: "Mobile", manager: "Hannah Prescott", state: "AL", tz: "America/Chicago", lat: 30.69, lon: -88.04,
      cities: ["Daphne", "Fairhope", "Saraland", "Prichard", "Foley", "Spanish Fort", "Theodore", "Tillmans Corner", "Gulf Shores", "Semmes"] },
  ] },
  { region: "Southeast", areas: [
    { area: "Atlanta", manager: "Jerome Whitfield", state: "GA", tz: "America/New_York", lat: 33.75, lon: -84.39,
      cities: ["Marietta", "Decatur", "Roswell", "Alpharetta", "Smyrna", "Duluth", "Lawrenceville", "Kennesaw", "Stockbridge", "Peachtree City"] },
    { area: "Nashville", manager: "Paige Sutherland", state: "TN", tz: "America/Chicago", lat: 36.16, lon: -86.78,
      cities: ["Franklin", "Murfreesboro", "Hendersonville", "Smyrna TN", "Brentwood", "Gallatin", "Lebanon", "Mount Juliet", "Spring Hill", "La Vergne"] },
    { area: "Birmingham", manager: "Dwight Pemberton", state: "AL", tz: "America/Chicago", lat: 33.52, lon: -86.81,
      cities: ["Hoover", "Vestavia Hills", "Bessemer", "Homewood", "Trussville", "Pelham", "Alabaster", "Gardendale", "Fultondale", "Leeds"] },
  ] },
];
const STREETS = ["Main St", "Commerce Blvd", "Highway 6", "Market St", "Interstate Dr", "Parkway Dr", "Oak Ridge Rd", "Frontage Rd", "Town Center Dr", "Veterans Blvd"];

// --- deterministic randomness -------------------------------------------------------
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  // Avalanche so neighbouring seeds ("...|35|...", "...|36|...") don't produce related streams.
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
}
function rng(seed) {
  let a = hash(seed);
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const between = (r, lo, hi) => lo + r() * (hi - lo);
const gauss = (r) => (r() + r() + r() + r() - 2) / 0.58; // ~N(0,1)

export function seedOrganization() {
  if (db.prepare("SELECT COUNT(*) n FROM restaurant").get().n > 0) return false;
  const insRegion = db.prepare("INSERT INTO region (region_name) VALUES (?)");
  const insArea = db.prepare("INSERT INTO area (area_name, region_id, area_manager) VALUES (?, ?, ?)");
  const insRestaurant = db.prepare(`INSERT INTO restaurant (restaurant_name, store_number, address, city, state, region_id, area_id,
    timezone, latitude, longitude, avg_hourly_rate, is_demo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`);
  let n = 0;
  transaction(() => {
    for (const reg of ORG) {
      const regionId = Number(insRegion.run(reg.region).lastInsertRowid);
      for (const a of reg.areas) {
        const areaId = Number(insArea.run(a.area, regionId, a.manager).lastInsertRowid);
        a.cities.forEach((city, i) => {
          const r = rng(`loc|${a.area}|${city}`);
          const number = String(3100 + n);
          insRestaurant.run(`IHOP #${number} ${city}`, number, `${Math.floor(between(r, 100, 9800))} ${STREETS[i % STREETS.length]}`,
            city.replace(/ TN$/, ""), a.state, regionId, areaId, a.tz,
            +(a.lat + between(r, -0.1, 0.1)).toFixed(4), +(a.lon + between(r, -0.1, 0.1)).toFixed(4), +between(r, 13.25, 16.5).toFixed(2));
          n++;
        });
      }
    }
  });
  return true;
}

// --- store personality --------------------------------------------------------------
const profileCache = new Map();
function profile(restaurant) {
  if (profileCache.has(restaurant.restaurant_id)) return profileCache.get(restaurant.restaurant_id);
  const r = rng(`profile|${restaurant.restaurant_name}`);
  const idx = restaurant.restaurant_id;
  const p = {
    baseDaily: between(r, 5600, 10400),
    yoy: between(r, -0.03, 0.06),
    laborBias: between(r, -0.015, 0.03),
    surveyMean: between(r, 4.15, 4.7),
    googleMean: between(r, 3.9, 4.6),
    mix: { breakfast: between(r, 0.42, 0.5), lunch: between(r, 0.25, 0.29), dinner: between(r, 0.16, 0.2) },
  };
  p.mix.late_night = 1 - p.mix.breakfast - p.mix.lunch - p.mix.dinner;
  // A handful of chronic outliers so every hotspot category has real examples.
  if (idx % 17 === 3) p.laborBias = between(r, 0.09, 0.14);
  if (idx % 23 === 5) p.yoy = between(r, -0.14, -0.09);
  if (idx % 19 === 7) { p.surveyMean = between(r, 3.4, 3.8); p.googleMean = between(r, 3.1, 3.6); }
  if (idx % 13 === 1) p.yoy = between(r, 0.09, 0.13);
  profileCache.set(restaurant.restaurant_id, p);
  return p;
}

const DOW_INDEX = [1.32, 0.86, 0.84, 0.87, 0.92, 1.02, 1.3]; // Sunday first

// Rain keeps breakfast guests home more than any other daypart.
function weatherEffect(w, daypart) {
  if (!w) return 1;
  if (w.thunderstorm_flag) return daypart === "breakfast" ? 0.8 : 0.92;
  if (w.rain_flag) return daypart === "breakfast" ? 0.88 : 0.96;
  return 1;
}

function syntheticWeather(areaName, lat, day) {
  const r = rng(`wx|${areaName}|${day}`);
  const month = Number(day.slice(5, 7));
  const seasonal = Math.cos(((month - 7) / 12) * 2 * Math.PI); // 1 in July, -1 in January
  const high = 74 - (lat - 30) * 1.6 + seasonal * 19 + gauss(r) * 4;
  const roll = r();
  const thunder = roll < 0.07;
  const rain = roll < 0.24;
  const precip = thunder ? between(r, 0.5, 1.9) : rain ? between(r, 0.1, 0.8) : 0;
  return {
    date: day, temperature_high: +high.toFixed(1), temperature_low: +(high - between(r, 14, 22)).toFixed(1),
    precipitation_amount: +precip.toFixed(2), morning_precipitation: +(precip * between(r, 0.2, 0.7)).toFixed(2),
    precipitation_hours: rain ? Math.round(between(r, 2, 9)) : 0,
    rain_flag: rain ? 1 : 0, thunderstorm_flag: thunder ? 1 : 0,
    weather_description: thunder ? "Thunderstorms" : rain ? "Rain" : roll < 0.55 ? "Partly cloudy" : "Clear",
  };
}

const getWeather = db.prepare("SELECT * FROM weather WHERE restaurant_id = ? AND date = ?");
function weatherFor(restaurant, day) {
  let w = getWeather.get(restaurant.restaurant_id, day);
  if (!w) {
    w = syntheticWeather(restaurant.area_name, restaurant.latitude, day);
    saveWeatherRow(restaurant.restaurant_id, w, "demo");
  }
  return w;
}

// Operational disruptions: rare, and deliberately unexplained in the data. The dashboard
// should flag them for review, not diagnose them.
function incident(restaurant, day) {
  const roll = rng(`incident|${restaurant.restaurant_id}|${day}`)();
  if (roll < 0.004) return "major"; // closure / equipment failure: sales collapse
  if (roll < 0.016) return "late_open";
  return null;
}

function baseSales(restaurant, day, daypart) {
  const p = profile(restaurant);
  const noise = 1 + gauss(rng(`sales|${restaurant.restaurant_id}|${day}|${daypart}`)) * 0.045;
  return p.baseDaily * DOW_INDEX[dayOfWeek(day)] * p.mix[daypart] * noise;
}

/** Full-day figures for one restaurant and business date, by daypart. */
function fullDay(restaurant, day, { future = false } = {}) {
  const p = profile(restaurant);
  const lyDay = comparableLastYear(day);
  const w = future ? null : weatherFor(restaurant, day); // no weather on file for days that haven't happened
  const wLy = weatherFor(restaurant, lyDay);
  const what = incident(restaurant, day);
  const weekWobble = gauss(rng(`fc|${restaurant.restaurant_id}|${day.slice(0, 7)}`)) * 0.012;

  const parts = {};
  for (const dp of DAYPARTS) {
    const prior = baseSales(restaurant, lyDay, dp) * weatherEffect(wLy, dp);
    // The system forecast trends off last year and knows nothing about weather or incidents.
    const forecast = prior * (1 + p.yoy * 0.7 + weekWobble);
    let actual = baseSales(restaurant, day, dp) * (1 + p.yoy) * weatherEffect(w, dp);
    if (what === "major") actual *= dp === "breakfast" ? 0.22 : 0.45;
    if (what === "late_open" && dp === "breakfast") actual *= 0.55;
    parts[dp] = { actual, forecast, prior };
  }
  const sum = (k) => DAYPARTS.reduce((s, dp) => s + parts[dp][k], 0);
  const actual = sum("actual");
  const forecast = sum("forecast");

  const r = rng(`labor|${restaurant.restaurant_id}|${day}`);
  const allowable = 50 + actual / 70; // earned hours from actual sales
  const scheduled = (50 + forecast / 70) * (1 + p.laborBias * 0.6 + gauss(r) * 0.01);
  // Managers cut some hours when sales come in light, but never all of the gap.
  const overage = Math.max(0, scheduled - allowable);
  const hours = (scheduled - overage * 0.4) * (1 + p.laborBias * 0.4 + gauss(r) * 0.015);
  const managerHours = between(r, 22, 30);

  const g = rng(`guest|${restaurant.restaurant_id}|${day}`);
  const penalty = what ? 0.5 : 0;
  const guest = {
    survey_count: Math.max(0, Math.round(between(g, 2, 9))),
    average_rating: Math.min(5, Math.max(1, +(p.surveyMean - penalty + gauss(g) * 0.22).toFixed(2))),
    google_review_count: Math.round(between(g, 0, 3.4)),
    google_rating: Math.min(5, Math.max(1, +(p.googleMean - penalty + gauss(g) * 0.3).toFixed(2))),
  };

  return {
    parts, actual, forecast, prior: sum("prior"), allowable, scheduled, hours, managerHours,
    cost: hours * restaurant.avg_hourly_rate, opening: what === "late_open" ? "late" : what === "major" ? "disrupted" : "on_time", guest,
  };
}

// Share of each daypart's sales earned by a given local hour.
const WINDOWS = { breakfast: [5, 11], lunch: [11, 16], dinner: [16, 22] };
function earnedShare(daypart, hourNow) {
  if (daypart === "late_night") {
    const elapsed = Math.min(hourNow, 5) + Math.max(0, hourNow - 22);
    return Math.min(1, elapsed / 7);
  }
  const [start, end] = WINDOWS[daypart];
  return Math.min(1, Math.max(0, (hourNow - start) / (end - start)));
}

function localHour(timezone) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(new Date());
  const get = (t) => Number(parts.find((x) => x.type === t).value);
  return get("hour") + get("minute") / 60;
}

function writeDay(restaurant, day, live) {
  const d = fullDay(restaurant, day);
  const hourNow = live ? localHour(restaurant.timezone) : 24;
  let actualAll = 0;
  let toNowAll = 0;
  for (const dp of DAYPARTS) {
    const share = live ? earnedShare(dp, hourNow) : 1;
    const part = d.parts[dp];
    actualAll += part.actual * share;
    toNowAll += part.forecast * share;
    savePerformance({
      date: day, restaurant_id: restaurant.restaurant_id, daypart: dp,
      actual_sales: part.actual * share, forecast_sales: part.forecast, prior_year_sales: part.prior,
      is_final: live ? 0 : 1, forecast_to_now: live ? part.forecast * share : null,
    }, "demo");
  }
  const dayShare = live ? actualAll / (d.actual || 1) : 1;
  savePerformance({
    date: day, restaurant_id: restaurant.restaurant_id, daypart: "all",
    actual_sales: actualAll, forecast_sales: d.forecast, prior_year_sales: d.prior,
    actual_labor_hours: d.hours * dayShare, scheduled_labor_hours: d.scheduled * dayShare,
    allowable_labor_hours: live ? (50 * Math.min(1, hourNow / 24) + actualAll / 70) : d.allowable,
    manager_hours: d.managerHours * dayShare, actual_labor_cost: d.cost * dayShare,
    opening_time_status: live && hourNow < 5 ? null : d.opening,
    is_final: live ? 0 : 1, forecast_to_now: live ? toNowAll : null,
  }, "demo");
  if (!live) saveGuestMetrics({ date: day, restaurant_id: restaurant.restaurant_id, ...d.guest }, "demo");
}

function demoRestaurants() {
  return db.prepare(`SELECT r.*, a.area_name FROM restaurant r JOIN area a ON a.area_id = r.area_id WHERE r.is_demo = 1`).all();
}

/** Final results for every demo restaurant over [fromDay, toDay]. */
export function generateHistory(fromDay, toDay) {
  const restaurants = demoRestaurants();
  for (const day of eachDay(fromDay, toDay)) {
    transaction(() => restaurants.forEach((r) => writeDay(r, day, false)));
  }
  return { restaurants: restaurants.length, days: eachDay(fromDay, toDay).length };
}

/** Current-day sales so far. */
export function generateLive() {
  const restaurants = demoRestaurants();
  const day = today();
  transaction(() => restaurants.forEach((r) => writeDay(r, day, true)));
  return { restaurants: restaurants.length, date: day };
}

/** Finalizes any days between the last final day on file and yesterday. */
export function catchUp(historyDays = 120) {
  const last = db.prepare("SELECT MAX(date) d FROM daily_performance WHERE is_final = 1 AND source = 'demo'").get().d;
  const end = addDays(today(), -1);
  const start = last ? addDays(last, 1) : addDays(end, -(historyDays - 1));
  if (start > end) return { restaurants: 0, days: 0 };
  return generateHistory(start, end);
}

/** System forecast and labor plan for a future week, used to pre-fill the forecasting form. */
export function demoWeekOutlook(restaurant, weekStartDay) {
  let forecast = 0;
  let lastYear = 0;
  for (let i = 0; i < 7; i++) {
    const d = fullDay(restaurant, addDays(weekStartDay, i), { future: true });
    forecast += d.forecast;
    lastYear += d.prior;
  }
  return { system_forecast: forecast, last_year_sales: lastYear };
}
