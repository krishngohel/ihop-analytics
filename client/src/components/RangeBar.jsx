import { useApp } from "../appContext.jsx";
import { prettyRange } from "../format.js";

const PRESETS = [
  { key: "yesterday", label: "Yesterday" },
  { key: "today", label: "Today (live)" },
  { key: "wtd", label: "Week to date" },
  { key: "ptd", label: "Period to date" },
  { key: "last7", label: "Last 7 days" },
  { key: "last28", label: "Last 28 days" },
  { key: "last13w", label: "Last 13 weeks" },
];

// Filters sit in one row above the content and apply to everything on the page.
export default function RangeBar({ showDaypart = true, children }) {
  const { meta, range, setPreset, setCustomRange, setDaypart } = useApp();
  if (!range.from) return null;
  const isLive = range.to === meta.today && meta.bounds.live_day === meta.today;
  return (
    <div className="rangebar no-print">
      <div className="rangebar-row">
        <div className="pill-group" role="group" aria-label="Date range">
          {PRESETS.filter((p) => p.key !== "today" || meta.bounds.live_day).map((p) => (
            <button key={p.key} type="button" className={range.preset === p.key ? "active" : ""} onClick={() => setPreset(p.key)}>{p.label}</button>
          ))}
        </div>
        <label>From <input type="date" value={range.from} min={meta.bounds.first_day} max={meta.today} onChange={(e) => e.target.value && setCustomRange(e.target.value, range.to < e.target.value ? e.target.value : range.to)} /></label>
        <label>To <input type="date" value={range.to} min={meta.bounds.first_day} max={meta.today} onChange={(e) => e.target.value && setCustomRange(range.from, e.target.value)} /></label>
        {showDaypart && (
          <label>Daypart{" "}
            <select value={range.daypart} onChange={(e) => setDaypart(e.target.value)}>
              {meta.dayparts.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
            </select>
          </label>
        )}
        {children}
      </div>
      <div className="rangebar-caption">
        {prettyRange(range.from, range.to)}
        {range.preset === "ptd" && ` · Period ${meta.period.number}`}
        {isLive && " · live sales so far, compared with the forecast earned to this point in the day"}
        {range.daypart !== "all" && " · sales are for the selected daypart; labor is reported for the full day"}
      </div>
    </div>
  );
}
