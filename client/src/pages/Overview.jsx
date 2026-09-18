import { Link, useNavigate } from "react-router-dom";
import { useApp, useData } from "../appContext.jsx";
import { getOverview } from "../api.js";
import RangeBar from "../components/RangeBar.jsx";
import PerfTable from "../components/PerfTable.jsx";
import HotspotCard from "../components/HotspotCard.jsx";
import { SalesTrend, VarianceBars } from "../components/Charts.jsx";
import { Snapshot, PerformanceStrip, Delta, Loading } from "../components/Bits.jsx";
import { fmt$, fmtPct, fmtNum, fmtRating, fmtHoursSigned, fmtTemp, prettyDay, laborTone } from "../format.js";

function verdict(o, scopeName) {
  const t = o.selected;
  if (!t || t.actual_sales === null || t.actual_sales === undefined) return "No results on file for this selection.";
  const plain = (n) => fmtPct(Math.abs(n)).replace("+", "");
  // Forecast first. Without one on file (the Rosnet API doesn't carry it) fall back to last year.
  const against = t.sales_variance_pct !== null && t.sales_variance_pct !== undefined ? `, ${t.sales_variance_pct >= 0 ? "ahead of" : "behind"} forecast by ${plain(t.sales_variance_pct)}`
    : t.prior_year_variance_pct !== null && t.prior_year_variance_pct !== undefined ? `, ${t.prior_year_variance_pct >= 0 ? "up" : "down"} ${plain(t.prior_year_variance_pct)} on last year` : "";
  const labor = t.labor_variance_pct === null || t.labor_variance_pct === undefined ? "" : ` and labor is ${plain(t.labor_variance_pct)} ${t.labor_variance_pct > 0 ? "over" : "under"} allowable hours`;
  const hs = ` ${o.hotspots.count} of ${o.hotspots.restaurants} restaurants need attention${o.hotspots.critical ? `, ${o.hotspots.critical} of them critical` : ""}.`;
  const missing = t.forecast_sales === null || t.forecast_sales === undefined ? " No forecast is on file for these dates yet." : "";
  return `${scopeName}: sales are ${fmt$(t.actual_sales)}${against}${labor}.${hs}${missing}`;
}

function WeatherSummary({ w }) {
  const line = (label, s) => (
    <div className="wx-summary-line">
      <strong>{label}</strong>
      <span>{s.restaurants ? `${fmtNum(s.rain)} of ${fmtNum(s.restaurants)} restaurants had rain${s.thunderstorms ? `, ${fmtNum(s.thunderstorms)} with thunderstorms` : ""} · average high ${fmtTemp(s.avg_high)}` : "No weather on file"}</span>
    </div>
  );
  const wetAreas = w.current.byArea.filter((a) => a.rain > 0);
  return (
    <div className="card">
      <h3>Weather across restaurant markets</h3>
      {line(prettyDay(w.current.date), w.current)}
      {line(`${prettyDay(w.lastYear.date, { weekday: "short", month: "short", day: "numeric", year: "numeric" })} (comparable day last year)`, w.lastYear)}
      <p className="muted" style={{ marginTop: 10 }}>
        {wetAreas.length ? `Rain in: ${wetAreas.map((a) => `${a.area_name} (${a.rain} of ${a.restaurants})`).join(", ")}.` : "No markets reported rain."} Weather is shown as context for comparing with last year, not as an explanation.
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

  return (
    <div style={{ opacity: loading ? 0.6 : 1 }}>
      <RangeBar />
      <div className="brief-card">
        <p className="verdict">{verdict(o, user.role === "executive" ? "Company" : user.scope_name)}</p>
        <PerformanceStrip t={o.selected} live={single && range.to === o.today?.date} />
      </div>

      <div className="grid three">
        <Snapshot detailed title="Today" caption={o.today ? `${prettyDay(o.today.date)} · sales so far` : ""} t={o.today} live />
        <Snapshot detailed title="Yesterday, final" caption={prettyDay(o.yesterday.date)} t={o.yesterday} />
        <Snapshot detailed title={`Period ${o.periodToDate.number} to date`} caption={`${prettyDay(o.periodToDate.from)} to ${prettyDay(o.periodToDate.through)}`} t={o.periodToDate} />
      </div>

      <div className="card">
        <div className="card-header">
          <h3>Where to look first: {o.hotspots.count} hotspots</h3>
          <Link className="btn secondary small" to="/hotspots">Open all hotspots</Link>
        </div>
        <p className="muted card-sub">The bottom {Math.round(o.hotspots.share * 100)}% of {o.hotspots.restaurants} restaurants on sales and labor exceptions for this selection.</p>
        <div className="hotspot-list compact">
          {o.hotspots.top.map((s) => <HotspotCard key={s.id} s={s} single={single} compact />)}
        </div>
        {o.hotspots.positives.length > 0 && (
          <p className="positives-line"><strong>Outperforming:</strong> {o.hotspots.positives.map((s, i) => (
            <span key={s.id}>{i > 0 && ", "}<Link to={`/stores/${s.id}`}>{s.name}</Link> <span className="positive">{fmtPct(s.sales_variance_pct)}</span></span>
          ))} vs. forecast.</p>
        )}
      </div>

      <div className="card">
        <h3>Sales trend</h3>
        <SalesTrend data={o.trend} />
      </div>

      <div className="card">
        <div className="card-header"><h3>{childLabel}s compared</h3></div>
        <p className="muted card-sub">Sales vs. forecast. Select a bar or a name to drill in.</p>
        <VarianceBars data={o.breakdown} dataKey="sales_variance_pct" onSelect={(d) => navigate(childPath(d))} />
        <PerfTable rows={o.breakdown} linkFor={childPath} nameLabel={childLabel} subtitleFor={o.breakdownLevel === "area" ? (r) => r.area_manager : null} />
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
        </div>
        <WeatherSummary w={o.weather} />
      </div>
    </div>
  );
}
