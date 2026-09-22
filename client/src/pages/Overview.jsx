import { Link, useNavigate } from "react-router-dom";
import { useApp, useData } from "../appContext.jsx";
import { getOverview } from "../api.js";
import RangeBar from "../components/RangeBar.jsx";
import PerfTable from "../components/PerfTable.jsx";
import HotspotCard from "../components/HotspotCard.jsx";
import { SalesTrend, VarianceBars } from "../components/Charts.jsx";
import { Snapshot, StatusPill, ScoreTile, SalesTile, CoverageNote, Delta, Loading, DaypartNote } from "../components/Bits.jsx";
import { fmt$, fmtPct, fmtNum, fmtRating, fmtHoursSigned, fmtTemp, fmtHours, prettyDay } from "../format.js";

// One glance: is the company fine, worth watching, or on fire? Criticals or a real miss
// escalate; a small wobble is a watch; otherwise on track.
function overallTone(o) {
  const t = o.selected;
  if (!t || t.actual_sales === null || t.actual_sales === undefined) return "neutral";
  if (o.hotspots.critical > 0) return "attention";
  const sv = t.sales_variance_pct, lv = t.labor_variance_pct;
  if ((sv !== null && sv < -2) || (lv !== null && lv > 5)) return "attention";
  if ((sv !== null && sv < -0.5) || (lv !== null && lv > 2) || o.hotspots.count > 0) return "watch";
  return "ok";
}

function verdict(o, scopeName) {
  const t = o.selected;
  if (!t || t.actual_sales === null || t.actual_sales === undefined) return "No results on file for this selection.";
  const plain = (n) => fmtPct(Math.abs(n)).replace("+", "");
  const against = t.sales_variance_pct !== null && t.sales_variance_pct !== undefined ? (Math.abs(t.sales_variance_pct) < 0.1 ? "on forecast" : `${t.sales_variance_pct >= 0 ? "ahead of" : "behind"} forecast by ${plain(t.sales_variance_pct)}`)
    : t.prior_year_variance_pct !== null && t.prior_year_variance_pct !== undefined ? `${t.prior_year_variance_pct >= 0 ? "up" : "down"} ${plain(t.prior_year_variance_pct)} on last year` : "on file";
  const hs = o.hotspots.count ? `${o.hotspots.count} restaurant${o.hotspots.count === 1 ? "" : "s"} need attention${o.hotspots.critical ? `, ${o.hotspots.critical} critical` : ""}.` : "No restaurants flagged.";
  return `${scopeName} is ${against}. ${hs}`;
}

function WeatherSummary({ w }) {
  const line = (label, s) => (
    <div className="wx-summary-line">
      <strong>{label}</strong>
      <span>{s.restaurants ? `${fmtNum(s.rain)} of ${fmtNum(s.restaurants)} restaurants had rain${s.thunderstorms ? `, ${fmtNum(s.thunderstorms)} with thunderstorms` : ""} · average high ${fmtTemp(s.avg_high)}` : "No weather on file"}</span>
    </div>
  );
  const wetAreas = (w.current.byArea || []).filter((a) => a.rain > 0);
  return (
    <div className="card">
      <h3>Weather across markets</h3>
      {line(prettyDay(w.current.date), w.current)}
      {line(`${prettyDay(w.lastYear.date, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}, last year`, w.lastYear)}
      <p className="muted" style={{ marginTop: 10 }}>
        {wetAreas.length ? `Rain in ${wetAreas.map((a) => a.area_name).join(", ")}.` : "No markets reported rain."} Shown as context, not an explanation.
      </p>
    </div>
  );
}

export default function Overview() {
  const { user, range } = useApp();
  const navigate = useNavigate();
  const { data: o, error, loading } = useData(getOverview, {});
  if (!o) return <><RangeBar /><Loading error={error} /></>;
  const single = range.from === range.to;
  const childPath = (r) => (o.breakdownLevel === "region" ? `/regions/${r.id}` : o.breakdownLevel === "area" ? `/areas/${r.id}` : `/stores/${r.id}`);
  const childLabel = o.breakdownLevel === "region" ? "Region" : "Area";
  const t = o.selected || {};
  const live = single && range.to === o.today?.date;
  const scope = user.role === "executive" ? "The company" : user.scope_name;

  return (
    <div style={{ opacity: loading ? 0.6 : 1 }}>
      <RangeBar />

      <div className="brief-card">
        <div className="brief-head">
          <StatusPill tone={overallTone(o)} />
          <p className="verdict">{verdict(o, scope)}</p>
        </div>
        <div className="scorecard">
          <SalesTile t={t} live={live} to="/regions" />
          {!live && (
            <ScoreTile to="/regions" label="vs. last year" value={<Delta value={t.prior_year_variance_pct} />}
              sub={t.prior_year_sales ? `Last year ${fmt$(t.prior_year_sales)}` : "No prior year on file"} />
          )}
          <ScoreTile to="/regions" label="Labor vs. allowable" value={fmtHours(t.actual_labor_hours)}
            delta={t.labor_variance_pct} deltaKind="labor" deltaLabel={t.labor_variance_pct > 0 ? "over" : "under"}
            sub={`Allowable ${fmtHours(t.allowable_labor_hours)}${t.labor_cost_pct ? ` · ${t.labor_cost_pct}% of sales` : ""}`} />
          <ScoreTile to="/hotspots" label="Guest rating" value={fmtRating(t.average_rating)} sub={`${fmtNum(t.survey_count)} surveys`} />
          <ScoreTile accent to="/hotspots" label="Need attention" value={o.hotspots.count}
            sub={o.hotspots.critical ? `${o.hotspots.critical} critical · of ${o.hotspots.restaurants}` : `of ${o.hotspots.restaurants} restaurants`} />
        </div>
        <CoverageNote cov={o.forecastCoverage} />
      </div>

      <div className="grid three">
        <Snapshot to="/summary" title="Today" caption={o.today ? `${prettyDay(o.today.date)} · so far` : ""} t={o.today} live />
        <Snapshot to="/summary" title="Yesterday" caption={prettyDay(o.yesterday.date)} t={o.yesterday} />
        <Snapshot to="/summary" title={`Period ${o.periodToDate.number} to date`} caption={`${prettyDay(o.periodToDate.from)} – ${prettyDay(o.periodToDate.through)}`} t={o.periodToDate} />
      </div>

      {o.hotspots.count > 0 && (
        <div className="card">
          <div className="card-header">
            <h3>Where to look first</h3>
            <Link className="btn secondary small" to="/hotspots">All {o.hotspots.count} hotspots</Link>
          </div>
          <div className="hotspot-list compact">
            {o.hotspots.top.map((s) => <HotspotCard key={s.id} s={s} single={single} compact />)}
          </div>
          {o.hotspots.positives.length > 0 && (
            <p className="positives-line"><strong>Outperforming:</strong> {o.hotspots.positives.map((s, i) => (
              <span key={s.id}>{i > 0 && ", "}<Link to={`/stores/${s.id}`}>{s.name.replace(/^IHOP /, "")}</Link> <span className="positive">{fmtPct(s.sales_variance_pct)}</span></span>
            ))} vs. forecast.</p>
          )}
        </div>
      )}

      <div className="card">
        <h3>Sales trend</h3>
        <SalesTrend data={o.trend} />
      </div>

      <div className="card">
        <div className="card-header">
          <h3>{childLabel}s ranked</h3>
          {o.breakdownLevel !== "store" && <Link className="btn secondary small" to="/regions">Full breakdown</Link>}
        </div>
        <p className="muted card-sub">Sales vs. forecast. Select a bar or name to drill in.</p>
        <VarianceBars data={o.breakdown} dataKey="sales_variance_pct" onSelect={(d) => navigate(childPath(d))} />
        <details className="more-table">
          <summary>Show the numbers for every {childLabel.toLowerCase()}</summary>
          <PerfTable rows={o.breakdown} linkFor={childPath} nameLabel={childLabel}
            subtitleFor={o.breakdownLevel === "area" ? (r) => r.area_manager : null} />
          <CoverageNote cov={o.forecastCoverage} />
        </details>
      </div>

      <div className="grid">
        <div className="card">
          <h3>Dayparts</h3>
          <table className="ledger small">
            <thead><tr><th>Daypart</th><th className="num">Sales</th><th className="num">vs. forecast</th><th className="num">vs. last year</th></tr></thead>
            <tbody>
              {o.dayparts.map((d) => (
                <tr key={d.daypart} className={d.daypart === "breakfast" ? "emphasis-row" : ""}>
                  <td>{d.label}</td><td className="num money">{fmt$(d.actual_sales)}</td>
                  <td className="num"><Delta value={d.sales_variance_pct} /></td><td className="num"><Delta value={d.prior_year_variance_pct} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <DaypartNote cov={o.daypartCoverage} />
        </div>
        <WeatherSummary w={o.weather} />
      </div>
    </div>
  );
}
