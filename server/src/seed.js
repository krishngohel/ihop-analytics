// Builds the demo organization: 120 restaurants, 120 days of results, real weather where
// it can be fetched, sign-in accounts for each access level, and a partly completed
// forecasting week. Safe to re-run: it only fills what is missing.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import db, { setSetting } from "./db.js";
import { addDays, today, yesterday } from "./dates.js";
import { seedOrganization, generateHistory, generateLive } from "./sources/demo.js";
import { refreshWeather } from "./weather.js";
import { createUser, generatePassword } from "./auth.js";
import { forecastForm, saveForecast, nextWeekStart, guideHours } from "./forecast.js";
import { storeDailySummary } from "./summary.js";

const HISTORY_DAYS = 120;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const created = seedOrganization();
if (created) setSetting("data_source", "demo");
console.log(created ? "Created 4 regions, 12 areas, 120 restaurants." : "Organization already exists, keeping it.");

const from = addDays(today(), -HISTORY_DAYS);
try {
  const wx = await refreshWeather(from, today());
  console.log(`Weather: ${wx.rows} rows from Open-Meteo for ${wx.points} locations${wx.errors.length ? ` (partial: ${wx.errors.join("; ")})` : ""}.`);
} catch (e) {
  console.log(`Weather fetch failed (${e.message}). Using generated weather instead.`);
}

const hist = generateHistory(from, yesterday());
generateLive();
console.log(`Results: ${hist.days} days for ${hist.restaurants} restaurants, plus today's live sales.`);

if (db.prepare("SELECT COUNT(*) n FROM app_user").get().n === 0) {
  const password = process.env.DEMO_PASSWORD || generatePassword();
  const region = db.prepare("SELECT region_id, region_name FROM region ORDER BY region_id LIMIT 1").get();
  const area = db.prepare("SELECT area_id, area_name, area_manager FROM area ORDER BY area_id LIMIT 1").get();
  const store = db.prepare("SELECT restaurant_id, restaurant_name FROM restaurant ORDER BY restaurant_id LIMIT 1").get();
  const users = [
    { email: "exec@demo.local", display_name: "Executive (company-wide)", role: "executive" },
    { email: "region@demo.local", display_name: `${region.region_name} regional lead`, role: "region", scope_id: region.region_id },
    { email: "area@demo.local", display_name: `${area.area_manager} (${area.area_name} area)`, role: "area", scope_id: area.area_id },
    { email: "store@demo.local", display_name: `${store.restaurant_name} manager`, role: "store", scope_id: store.restaurant_id },
  ];
  users.forEach((u) => createUser({ ...u, password }));
  const file = path.join(__dirname, "..", ".demo-credentials.txt");
  fs.writeFileSync(file, `Demo sign-ins (password is the same for all four):\n${users.map((u) => `  ${u.email}  [${u.role}]`).join("\n")}\nPassword: ${password}\n`);
  console.log(`Sign-in accounts created. Credentials saved to ${file}`);
}

// A forecasting week in progress: most stores submitted, some with issues, some missing.
const week = nextWeekStart();
if (db.prepare("SELECT COUNT(*) n FROM forecast_submission WHERE week_start = ?").get(week).n === 0) {
  const exec = { role: "executive", email: "seed" };
  const REASONS = ["Trailing four weeks running below last year; trimmed the system number", "Local high school homecoming weekend, expecting a stronger Saturday", "Road work on the frontage road is cutting morning traffic",
    "New apartment complex opened nearby, breakfast counts are climbing", "Competitor reopened across the street last week", "Holding close to system forecast; recent weeks match it"];
  let n = 0;
  for (const row of forecastForm(exec, week).rows) {
    const k = row.restaurant_id;
    if (k % 7 === 0) continue; // missing
    const adj = k % 5 === 0 ? 0 : (((k * 37) % 13) - 6) / 100;
    const managerForecast = Math.round(row.system_forecast * (1 + adj + (row.recent_trend || 0) / 250));
    const managerHours = 168 + (k % 4) * 6;
    const slack = k % 11 === 0 ? 1.07 : k % 9 === 0 ? 0.9 : 1 + ((k % 5) - 2) / 100;
    const body = {
      week_start: week, restaurant_id: k, manager_forecast: managerForecast, scheduled_hours: Math.round(guideHours(managerForecast) * slack), manager_hours: managerHours,
      forecast_adjustment_reason: k % 10 === 3 ? "" : REASONS[k % REASONS.length], notes: "", submit: k % 6 !== 1,
    };
    // A form that fails the reconciliation checks stays on file as an incomplete draft.
    if (saveForecast(exec, body).status === 422) saveForecast(exec, { ...body, submit: false });
    n++;
  }
  console.log(`Forecasting form for week of ${week}: ${n} stores started.`);
}

storeDailySummary(yesterday());
console.log("Done. Start the dashboard with: npm start");
