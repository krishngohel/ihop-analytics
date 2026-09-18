// Refresh pipeline and scheduler (brief: "Refresh and Data Timing").
//   - scheduled daily refresh early each morning: final prior-day data, weather, morning summary
//   - optional intraday refresh every N minutes during operating hours: live sales
//   - manual refresh from the dashboard
// Every run is recorded with per-step results so failures are visible, not silent.
import db, { getSetting, audit } from "./db.js";
import { addDays, isoDate, today, yesterday } from "./dates.js";
import { refreshWeather } from "./weather.js";
import { importDropFolder, ingestLog, importFolder, listPending } from "./imports.js";
import { importMailbox, mailboxConfig } from "./mailbox.js";
import { catchUp, generateLive } from "./sources/demo.js";
import { syncRosnet, rosnetConfig } from "./sources/rosnet.js";
import { storeDailySummary, storedDailySummary } from "./summary.js";

let running = null;
let lastWeatherAt = 0;

async function geocodeMissing() {
  const missing = db.prepare("SELECT restaurant_id, city, state FROM restaurant WHERE (latitude IS NULL OR longitude IS NULL) AND city IS NOT NULL LIMIT 40").all();
  let found = 0;
  for (const r of missing) {
    const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(r.city)}&count=10&country=US&language=en`, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) continue;
    const hits = (await res.json()).results || [];
    const hit = hits.find((h) => !r.state || [h.admin1, h.admin1_code].some((a) => a && (a.toLowerCase() === String(r.state).toLowerCase() || STATE_NAMES[String(r.state).toUpperCase()] === a))) || (r.state ? null : hits[0]);
    if (hit) {
      db.prepare("UPDATE restaurant SET latitude = ?, longitude = ?, timezone = COALESCE(?, timezone) WHERE restaurant_id = ?").run(hit.latitude, hit.longitude, hit.timezone || null, r.restaurant_id);
      found++;
    }
  }
  return { missing: missing.length, found };
}
const STATE_NAMES = { AL: "Alabama", AR: "Arkansas", AZ: "Arizona", CA: "California", CO: "Colorado", FL: "Florida", GA: "Georgia", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", MO: "Missouri", MS: "Mississippi", NC: "North Carolina", NM: "New Mexico", NV: "Nevada", OK: "Oklahoma", SC: "South Carolina", TN: "Tennessee", TX: "Texas", VA: "Virginia" };

async function step(steps, name, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    steps.push({ name, ok: true, ms: Date.now() - started, detail });
  } catch (e) {
    steps.push({ name, ok: false, ms: Date.now() - started, error: e.message });
    audit(null, "refresh_error", `${name}: ${e.message}`);
  }
}

/** trigger: manual | scheduled_daily | intraday | startup */
export function runRefresh(trigger, { userEmail = null } = {}) {
  if (running) return running;
  running = (async () => {
    const runId = Number(db.prepare("INSERT INTO refresh_run (started_at, trigger) VALUES (?, ?)").run(new Date().toISOString(), trigger).lastInsertRowid);
    const steps = [];
    const light = trigger === "intraday";
    await step(steps, "Import exported files", () => importDropFolder());
    if (mailboxConfig().configured) await step(steps, "Import emailed reports", () => importMailbox());
    // After the files, so on a first run a store list has already put restaurants in their areas.
    if (rosnetConfig().configured) await step(steps, "Rosnet API: sales and labor", () => syncRosnet({ light }));
    if (!light) await step(steps, "Locate restaurants for weather", () => geocodeMissing());

    // Weather first: in demo mode the day's sales respond to it.
    if (!light || Date.now() - lastWeatherAt > 55 * 60000) {
      const lastFinal = db.prepare("SELECT MAX(date) d FROM daily_performance WHERE is_final = 1").get().d;
      const from = light ? today() : (lastFinal && lastFinal > addDays(today(), -14) ? addDays(lastFinal, -1) : addDays(today(), -3));
      await step(steps, "Weather: current and same day last year", async () => {
        const out = await refreshWeather(from, today());
        lastWeatherAt = Date.now();
        return out;
      });
    }
    // Read after the imports: the first real data switches the dashboard out of demonstration mode.
    if (getSetting("data_source") === "demo") {
      if (!light) await step(steps, "Prior-day results (demo source)", () => catchUp());
      await step(steps, "Live sales (demo source)", () => generateLive());
    }
    // Reports can land after the scheduled run, so any run that brought in new rows rewrites the summary.
    const newRows = steps.flatMap((s) => [...(s.detail?.files || []), ...(s.detail?.messages || []).flatMap((m) => m.files || [])]).reduce((t, f) => t + (f.imported || 0), 0)
      + steps.reduce((t, s) => t + (s.detail?.rows || 0), 0);
    if (newRows > 0 || (!light && (trigger === "scheduled_daily" || !storedDailySummary(yesterday())))) {
      await step(steps, "Daily morning summary", () => {
        const s = storeDailySummary(yesterday());
        return s ? { date: s.date, hotspots: s.hotspot_count } : { skipped: "no prior-day data yet" };
      });
    }

    const failed = steps.filter((s) => !s.ok);
    const status = failed.length === 0 ? "ok" : failed.length === steps.length ? "failed" : "partial";
    db.prepare("UPDATE refresh_run SET finished_at = ?, status = ?, steps = ?, error = ? WHERE run_id = ?")
      .run(new Date().toISOString(), status, JSON.stringify(steps), failed.map((s) => `${s.name}: ${s.error}`).join(" | ") || null, runId);
    audit(userEmail, "refresh", `${trigger}: ${status}`);
    return { run_id: runId, trigger, status, steps };
  })().finally(() => { running = null; });
  return running;
}

/**
 * Has the prior business day arrived? Automatic inputs fail quietly (a vendor schedule gets
 * switched off, a mailbox password changes), so the dashboard says so on every page rather
 * than showing yesterday's hotspots as if they were today's.
 */
export function dataFreshness() {
  const expected = yesterday();
  const lastFinal = db.prepare("SELECT MAX(date) d FROM daily_performance WHERE is_final = 1 AND daypart = 'all'").get().d;
  const lastGuest = db.prepare("SELECT MAX(date) d FROM guest_metrics").get().d;
  const lastFile = db.prepare("SELECT received_at, channel, filename, status FROM ingest_file ORDER BY ingest_id DESC LIMIT 1").get() || null;
  const needsMapping = listPending().length;
  const now = new Date();
  const clock = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const due = clock >= getSetting("daily_refresh_time");
  const demo = getSetting("data_source") === "demo";
  // Only once results have been arriving: a new install with nothing on file is being set up, not failing.
  const missingDay = !demo && due && Boolean(lastFinal) && lastFinal < expected;
  return {
    expected_day: expected, last_final_day: lastFinal, last_guest_day: lastGuest, last_file: lastFile,
    stale: missingDay, files_needing_mapping: needsMapping,
    message: missingDay ? `Results for ${expected} have not arrived. The latest complete day on file is ${lastFinal || "none"}.` : null,
  };
}

export function refreshStatus() {
  const runs = db.prepare("SELECT * FROM refresh_run ORDER BY run_id DESC LIMIT 20").all().map((r) => ({ ...r, steps: r.steps ? JSON.parse(r.steps) : [] }));
  return {
    running: Boolean(running),
    last: runs.find((r) => r.finished_at) || null,
    runs,
    settings: {
      daily_refresh_time: getSetting("daily_refresh_time"),
      intraday_refresh_enabled: getSetting("intraday_refresh_enabled") === "1",
      intraday_refresh_minutes: Number(getSetting("intraday_refresh_minutes")),
      operating_hours_start: getSetting("operating_hours_start"),
      operating_hours_end: getSetting("operating_hours_end"),
    },
    data_source: getSetting("data_source"),
    import_folder: importFolder(),
    mailbox: (({ configured, host, user, folder, allowed }) => ({ configured, host, user, folder, allowed }))(mailboxConfig()),
    push_enabled: Boolean(process.env.INGEST_TOKEN),
    rosnet_api: (({ configured, user, clientId, baseUrl }) => ({ configured, user: configured ? user : null, client_id: clientId || null, host: baseUrl.replace(/^https?:\/\//, "") }))(rosnetConfig()),
    freshness: dataFreshness(),
    files: ingestLog(30),
  };
}

const hhmm = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

/**
 * Decides what a scheduler tick should run. The daily refresh is due from its set time until
 * the end of the day, not only at that exact minute: a Mac that was asleep, shut, or started
 * late catches up as soon as it is running again. Exported so the rule can be tested.
 */
export function dueRefresh(state, now, settings) {
  const clock = hhmm(now);
  const day = isoDate(now);
  if (clock >= settings.daily_refresh_time && state.lastDailyRun !== day) return "scheduled_daily";
  const minutes = Math.max(5, Number(settings.intraday_refresh_minutes) || 15);
  const open = clock >= settings.operating_hours_start && clock <= settings.operating_hours_end;
  if (settings.intraday_refresh_enabled === "1" && open && now.getTime() - state.lastIntraday >= minutes * 60000) return "intraday";
  return null;
}

const schedulerSettings = () => ({
  daily_refresh_time: getSetting("daily_refresh_time"), intraday_refresh_enabled: getSetting("intraday_refresh_enabled"),
  intraday_refresh_minutes: getSetting("intraday_refresh_minutes"), operating_hours_start: getSetting("operating_hours_start"), operating_hours_end: getSetting("operating_hours_end"),
});

/**
 * The refresh that runs as the server starts is a full one, so it stands in for today's
 * daily refresh when the start comes after the scheduled time.
 */
export function startScheduler() {
  const now = new Date();
  const state = { lastDailyRun: hhmm(now) >= getSetting("daily_refresh_time") ? isoDate(now) : null, lastIntraday: now.getTime() };
  const tick = () => {
    const at = new Date();
    const trigger = dueRefresh(state, at, schedulerSettings());
    if (!trigger) return;
    if (trigger === "scheduled_daily") state.lastDailyRun = isoDate(at);
    state.lastIntraday = at.getTime();
    runRefresh(trigger).catch(() => {});
  };
  return setInterval(tick, 30000);
}
