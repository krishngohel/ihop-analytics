import { useMemo, useState } from "react";
import { useApp } from "../appContext.jsx";
import { weeklyReportUrl, excelExportUrl } from "../api.js";
import { DownloadIcon, ReportIcon } from "../components/Icons.jsx";
import { addDays, weekStart, prettyDay, prettyRange } from "../format.js";

// The weeks that have results on file, newest first: Monday-start, ending at the last final day.
function weeksOnFile(meta) {
  const first = meta.bounds.first_day; const last = meta.last_final_day;
  if (!first || !last) return [];
  const out = [];
  for (let w = weekStart(last); addDays(w, 6) >= first && out.length < 26; w = addDays(w, -7)) {
    const end = addDays(w, 6);
    out.push({ start: w, end: end > last ? last : end, partial: end > last });
  }
  return out;
}

function ScopeSelect({ meta, value, onChange }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">All restaurants</option>
      {meta.hierarchy.map((g) => (
        <optgroup key={g.region_id} label={g.region_name}>
          <option value={`region:${g.region_id}`}>{g.region_name} (whole region)</option>
          {g.areas.map((a) => <option key={a.area_id} value={`area:${a.area_id}`}>{a.area_name}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

const scopeParams = (scope) => { const [k, id] = scope.split(":"); return k === "region" ? { regionId: id } : k === "area" ? { areaId: id } : {}; };

export default function Reports() {
  const { meta, range, query } = useApp();
  const weeks = useMemo(() => weeksOnFile(meta), [meta]);
  const [week, setWeek] = useState(weeks[0]?.start || "");
  const [scope, setScope] = useState("");
  const chosen = weeks.find((w) => w.start === week) || weeks[0];
  const reportParams = { week: chosen?.start, ...scopeParams(scope) };

  return (
    <div>
      <div className="brief-card">
        <p className="verdict" style={{ margin: 0 }}>Reports and exports</p>
        <p className="muted" style={{ margin: "6px 0 0" }}>Files you can send on: a weekly PDF that tells the story of the week in plain language with its charts, and an Excel workbook with every number and the charts already drawn.</p>
      </div>

      <div className="card">
        <div className="card-header">
          <h3><ReportIcon size={16} style={{ verticalAlign: -3, marginRight: 6 }} />Weekly report (PDF)</h3>
        </div>
        <p className="muted card-sub">A full rundown of one week: sales against forecast and last year, labor, dayparts, every region ranked, the restaurants to look at and the ones outperforming. Weeks run Monday to Sunday.</p>
        {weeks.length ? (
          <>
            <div className="report-form">
              <label>Week
                <select value={chosen?.start || ""} onChange={(e) => setWeek(e.target.value)}>
                  {weeks.map((w) => <option key={w.start} value={w.start}>Week of {prettyDay(w.start, { month: "short", day: "numeric", year: "numeric" })}{w.partial ? ` (through ${prettyDay(w.end)})` : ""}</option>)}
                </select>
              </label>
              <label>Covering<ScopeSelect meta={meta} value={scope} onChange={setScope} /></label>
            </div>
            <div className="export-row">
              <a className="btn" href={weeklyReportUrl(reportParams)} download><DownloadIcon size={14} />Download PDF</a>
              <a className="btn secondary" href={weeklyReportUrl({ ...reportParams, inline: 1 })} target="_blank" rel="noopener">Open in a new tab</a>
              {chosen && <span className="muted">{prettyRange(chosen.start, chosen.end)}{chosen.partial ? " · this week is still in progress" : ""}</span>}
            </div>
            <div className="report-pages">
              <div className="report-page"><strong>Page 1 · The week in brief</strong>Headline figures, the week written out in sentences, and sales by day.</div>
              <div className="report-page"><strong>Page 2 · Where it happened</strong>Regions ranked, dayparts, the day-by-day table, labor by day.</div>
              <div className="report-page"><strong>Page 3 · Restaurants to look at</strong>Everything flagged and why, the outperformers, then every restaurant ranked.</div>
            </div>
          </>
        ) : <p className="empty-note">No results on file yet. Connect Rosnet under Data and refresh and the weeks will appear here.</p>}
      </div>

      <div className="card">
        <div className="card-header">
          <h3><DownloadIcon size={16} style={{ verticalAlign: -3, marginRight: 6 }} />Excel workbook with charts</h3>
        </div>
        <p className="muted card-sub">Uses the date range and daypart chosen at the top of the dashboard ({range.from ? prettyRange(range.from, range.to) : "…"}). Sheets: Summary, Daily, Weekly, Regions, Dayparts, Daypart mix, Weekday and every Restaurant, each with its charts drawn beside the numbers, ready to paste into a deck.</p>
        <div className="report-form">
          <label>Covering<ScopeSelect meta={meta} value={scope} onChange={setScope} /></label>
        </div>
        <div className="export-row">
          <a className="btn" href={excelExportUrl({ ...query, ...scopeParams(scope) })} download><DownloadIcon size={14} />Download Excel workbook</a>
          <span className="muted">Change the range with the date presets on the Overview or Trends page.</span>
        </div>
      </div>
    </div>
  );
}
