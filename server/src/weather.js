// Weather context layer (Open-Meteo: free, no API key, current + historical archive).
// Weather is stored per restaurant and business date so every screen can put the
// relevant day next to the comparable day a year earlier.
import db, { transaction } from "./db.js";
import { addDays, today, daysBetween, comparableLastYear } from "./dates.js";

const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive";
const RECENT_WINDOW_DAYS = 85; // forecast API serves roughly the last 3 months; older dates come from the archive
const BATCH = 10;

// WMO weather interpretation codes
export function describeWeatherCode(code) {
  const c = Number(code);
  if (c === 0) return { description: "Clear", rain: 0, thunder: 0 };
  if (c <= 2) return { description: "Partly cloudy", rain: 0, thunder: 0 };
  if (c === 3) return { description: "Overcast", rain: 0, thunder: 0 };
  if (c === 45 || c === 48) return { description: "Fog", rain: 0, thunder: 0 };
  if (c >= 51 && c <= 57) return { description: "Drizzle", rain: 1, thunder: 0 };
  if (c >= 61 && c <= 67) return { description: c >= 65 ? "Heavy rain" : "Rain", rain: 1, thunder: 0 };
  if (c >= 71 && c <= 77) return { description: "Snow", rain: 0, thunder: 0 };
  if (c >= 80 && c <= 82) return { description: "Rain showers", rain: 1, thunder: 0 };
  if (c === 85 || c === 86) return { description: "Snow showers", rain: 0, thunder: 0 };
  if (c >= 95) return { description: "Thunderstorms", rain: 1, thunder: 1 };
  return { description: "Unknown", rain: 0, thunder: 0 };
}

// Nearby restaurants share a grid point so 120 stores don't mean 120 API lookups.
const gridKey = (lat, lon) => `${(Math.round(lat * 4) / 4).toFixed(2)},${(Math.round(lon * 4) / 4).toFixed(2)}`;

async function fetchBatch(url, points, fromDay, toDay) {
  const params = new URLSearchParams({
    latitude: points.map((p) => p.lat).join(","),
    longitude: points.map((p) => p.lon).join(","),
    start_date: fromDay,
    end_date: toDay,
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_hours",
    hourly: "precipitation",
    temperature_unit: "fahrenheit",
    precipitation_unit: "inch",
    timezone: "auto",
  });
  const res = await fetch(`${url}?${params}`, { signal: AbortSignal.timeout(45000) });
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  return Array.isArray(json) ? json : [json];
}

function rowsFromLocation(loc) {
  const morningByDay = new Map();
  const hours = loc.hourly?.time || [];
  for (let i = 0; i < hours.length; i++) {
    const hour = Number(hours[i].slice(11, 13));
    if (hour >= 5 && hour <= 10) {
      const day = hours[i].slice(0, 10);
      morningByDay.set(day, (morningByDay.get(day) || 0) + (loc.hourly.precipitation[i] || 0));
    }
  }
  return (loc.daily?.time || []).map((day, i) => {
    const info = describeWeatherCode(loc.daily.weather_code[i]);
    const precip = loc.daily.precipitation_sum[i] ?? 0;
    return {
      date: day,
      temperature_high: loc.daily.temperature_2m_max[i],
      temperature_low: loc.daily.temperature_2m_min[i],
      precipitation_amount: precip,
      morning_precipitation: +(morningByDay.get(day) || 0).toFixed(3),
      precipitation_hours: loc.daily.precipitation_hours?.[i] ?? null,
      // A trace of drizzle is not a rain day: require measurable precipitation.
      rain_flag: info.thunder || precip >= 0.05 ? 1 : 0,
      thunderstorm_flag: info.thunder,
      weather_description: info.description,
    };
  }).filter((r) => r.temperature_high !== null && r.temperature_high !== undefined);
}

/** Weather rows for a set of { lat, lon } points over a date range. Returns Map(gridKey -> rows[]). */
export async function fetchWeatherForPoints(points, fromDay, toDay) {
  const out = new Map();
  const cutoff = addDays(today(), -RECENT_WINDOW_DAYS);
  const spans = [];
  if (toDay < cutoff) spans.push([ARCHIVE_URL, fromDay, toDay]);
  else if (fromDay >= cutoff) spans.push([FORECAST_URL, fromDay, toDay]);
  else spans.push([ARCHIVE_URL, fromDay, addDays(cutoff, -1)], [FORECAST_URL, cutoff, toDay]);

  for (const [url, from, to] of spans) {
    for (let i = 0; i < points.length; i += BATCH) {
      const batch = points.slice(i, i + BATCH);
      const locations = await fetchBatch(url, batch, from, to);
      locations.forEach((loc, idx) => {
        const key = batch[idx].key;
        out.set(key, [...(out.get(key) || []), ...rowsFromLocation(loc)]);
      });
    }
  }
  return out;
}

const upsertWeather = db.prepare(`
  INSERT INTO weather (date, restaurant_id, temperature_high, temperature_low, precipitation_amount, morning_precipitation,
    precipitation_hours, rain_flag, thunderstorm_flag, weather_description, source)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(date, restaurant_id) DO UPDATE SET
    temperature_high = excluded.temperature_high, temperature_low = excluded.temperature_low,
    precipitation_amount = excluded.precipitation_amount, morning_precipitation = excluded.morning_precipitation,
    precipitation_hours = excluded.precipitation_hours, rain_flag = excluded.rain_flag,
    thunderstorm_flag = excluded.thunderstorm_flag, weather_description = excluded.weather_description, source = excluded.source
`);

export function saveWeatherRow(restaurantId, r, source = "open-meteo") {
  upsertWeather.run(r.date, restaurantId, r.temperature_high, r.temperature_low, r.precipitation_amount, r.morning_precipitation ?? null,
    r.precipitation_hours ?? null, r.rain_flag ? 1 : 0, r.thunderstorm_flag ? 1 : 0, r.weather_description, source);
}

export function restaurantPoints() {
  const restaurants = db.prepare("SELECT restaurant_id, latitude, longitude FROM restaurant WHERE latitude IS NOT NULL AND longitude IS NOT NULL").all();
  const byKey = new Map();
  for (const r of restaurants) {
    const key = gridKey(r.latitude, r.longitude);
    if (!byKey.has(key)) byKey.set(key, { key, lat: r.latitude, lon: r.longitude, restaurantIds: [] });
    byKey.get(key).restaurantIds.push(r.restaurant_id);
  }
  return [...byKey.values()];
}

/**
 * Pulls weather for [fromDay, toDay] and for the comparable days one year earlier, for
 * every restaurant with coordinates. Returns counts; throws only if nothing could be fetched.
 */
export async function refreshWeather(fromDay, toDay) {
  const points = restaurantPoints();
  if (!points.length) return { points: 0, rows: 0 };
  const ranges = [[fromDay, toDay], [comparableLastYear(fromDay), comparableLastYear(toDay)]];
  let rows = 0;
  const errors = [];
  for (const [from, to] of ranges) {
    try {
      const fetched = await fetchWeatherForPoints(points, from, to);
      transaction(() => {
        for (const point of points) {
          for (const row of fetched.get(point.key) || []) {
            for (const id of point.restaurantIds) { saveWeatherRow(id, row); rows++; }
          }
        }
      });
    } catch (e) {
      errors.push(`${from}..${to}: ${e.message}`);
    }
  }
  if (errors.length === ranges.length) throw new Error(`Weather refresh failed: ${errors.join("; ")}`);
  return { points: points.length, rows, days: daysBetween(fromDay, toDay) + 1, errors };
}

export function weatherPair(restaurantId, day) {
  const get = db.prepare("SELECT * FROM weather WHERE restaurant_id = ? AND date = ?");
  return { current: get.get(restaurantId, day) || null, lastYear: get.get(restaurantId, comparableLastYear(day)) || null };
}

/**
 * Neutral context sentence comparing the day with the comparable day last year.
 * States what the weather was; never claims it caused a variance.
 */
export function weatherContext(current, lastYear) {
  if (!current || !lastYear) return null;
  const wet = (w) => (w.thunderstorm_flag ? "rain/thunderstorms" : w.rain_flag ? "rain" : null);
  const cur = wet(current);
  const ly = wet(lastYear);
  if (ly && !cur) return `Prior-year comparable day had ${ly}; current day was dry. Weather may be a contributing context factor.`;
  if (cur && !ly) return `Current day had ${cur}; prior-year comparable day was dry. Weather may be a contributing context factor.`;
  if (cur && ly) return `Both the current day and the prior-year comparable day had ${cur === ly ? cur : "wet weather"}.`;
  const swing = current.temperature_high - lastYear.temperature_high;
  if (Math.abs(swing) >= 15) return `High of ${Math.round(current.temperature_high)}°F vs ${Math.round(lastYear.temperature_high)}°F on the prior-year comparable day.`;
  return null;
}
