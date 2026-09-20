import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useApp, useData } from "../appContext.jsx";
import { getTrends, excelExportUrl } from "../api.js";
import RangeBar from "../components/RangeBar.jsx";
import { ScoreTile, Delta, Loading, DaypartNote } from "../components/Bits.jsx";
import { SalesTrend, LaborTrend, WeeklyBars, VarianceTrend, WeekdayBars, DaypartStack, GroupLines, MetricTrend, SERIES } from "../components/Charts.jsx";
import { DownloadIcon, ReportIcon } from "../components/Icons.jsx";
import { fmt$, fmtNum, fmtHours, fmtRating, prettyDay } from "../format.js";

const has = (v) => v !== null && v !== undefined;
const anyValue = (rows, key) => rows.some((r) => has(r[key]));

/** A scope picker for the trends: the whole company, one region, or one area. */
function ScopePicker({ meta, scope, setScope }) {
  return (
    <label>Show{" "}
      <select value={scope} onChange={(e) => setScope(e.target.value)}>
        <option value="">All restaurants</option>
        {meta.hierarchy.map((g) => (
          <optgroup key={g.region_id} label={g.region_name}>
            <option value={`region:${g.region_id}`}>{g.region_name} (whole region)</option>
            {g.areas.map((a) => <option key={a.area_id} value={`area:${a.area_id}`}>{a.area_name}</option>)}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

function scopeParams(scope) {
  const [kind, id] = scope.split(":");
  return kind === "region" ? { regionId: id } : kind === "area" ? { areaId: id } : {};
}

export default function Trends() {
  const { meta, range, query, setPreset } = useApp();
  const navigate = useNavigate();
  const [scope, setScope] = useState("");
  // A single day has no trend in it: arriving here on "Yesterday" or "Today" widens the window.
  useEffect(() => { if (range.from && range.from === range.to) setPreset("last28"); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const params = scopeParams(scope);
  const { data: t, error, loading } = useData(getTrends, params);
  if (!t) return <><RangeBar><ScopePicker meta={meta} scope={scope} setScope={setScope} /></RangeBar><Loading error={error} /></>;
  const tot = t.totals || {};
  const level = t.breakdownLevel;
  const childPath = (id) => (level === "region" ? `/regions/${id}` : level === "area" ? `/areas/${id}` : `/stores/${id}`);
  const levelLabel = level === "region" ? "Regions" : level === "area" ? "Areas" : "Restaurants";
  const weeks = t.weekly.filter((w) => has(w.actual_sales));
  const lastFull = [...weeks].reverse().find((w) => !w.partial);

  return (
    <div style={{ opacity: loading ? 0.6 : 1 }}>
      <RangeBar><ScopePicker meta={meta} scope={scope} setScope={setScope} /></RangeBar>

      <div className="brief-card">
        <div className="card-header">
          <p className="verdict" style={{ margin: 0 }}>How {scope ? "this selection" : "the company"} has been trending</p>
          <div className="export-row">
            <a className="btn secondary small" href={excelExportUrl({ ...query, ...params })} download><DownloadIcon size={14} />Excel workbook with charts</a>
            <Link className="btn secondary small" to="/reports"><ReportIcon size={14} />Weekly PDF report</Link>
          </div>
        </div>
        <div className="scorecard">
          <ScoreTile label="Sales in range" value={fmt$(tot.actual_sales)} delta={tot.sales_variance_pct} deltaLabel="vs. forecast" sub={has(tot.forecast_basis) ? `Forecast ${fmt$(tot.forecast_basis)}` : "No forecast on file"} />
          <ScoreTile label="vs. last year" value={<Delta value={tot.prior_year_variance_pct} />} sub={tot.prior_year_sales ? `Last year ${fmt$(tot.prior_year_sales)}` : "No prior year on file"} />
          <ScoreTile label="Labor vs. allowable" value={fmtHours(tot.actual_labor_hours)} delta={tot.labor_variance_pct} deltaKind="labor" deltaLabel={tot.labor_variance_pct > 0 ? "over" : "under"} sub={has(tot.labor_cost_pct) ? `${tot.labor_cost_pct}% of sales` : "No labor cost on file"} />
          <ScoreTile label="Last full week" value={lastFull ? fmt$(lastFull.actual_sales) : "–"} delta={lastFull?.week_over_week_pct} deltaLabel="week over week" sub={lastFull ? `Week of ${prettyDay(lastFull.week_start)}` : "No full week in range yet"} />
        </div>
      </div>

      <div className="card">
        <h3>Sales by day</h3>
        <SalesTrend data={t.daily} />
      </div>

      <div className="grid">
        <div className="card">
          <h3>Week by week</h3>
          <p className="muted card-sub">Monday-start weeks. A week that isn't over yet is shown as far as it goes.</p>
          {weeks.length ? <WeeklyBars data={weeks} /> : <p className="empty-note">Nothing on file yet.</p>}
          {weeks.length > 0 && (
            <details className="more-table">
              <summary>Show the numbers for every week</summary>
              <table className="ledger small">
                <thead><tr><th>Week of</th><th className="num">Days</th><th className="num">Sales</th><th className="num">vs. forecast</th><th className="num">vs. last year</th><th className="num">Week over week</th><th className="num">Labor vs. allowable</th></tr></thead>
                <tbody>
                  {[...weeks].reverse().map((w) => (
                    <tr key={w.week_start}><td>{prettyDay(w.week_start)}{w.partial ? " (partial)" : ""}</td><td className="num">{w.days}</td><td className="num money">{fmt$(w.actual_sales)}</td>
                      <td className="num"><Delta value={w.sales_variance_pct} /></td><td className="num"><Delta value={w.prior_year_variance_pct} /></td><td className="num"><Delta value={w.week_over_week_pct} /></td><td className="num"><Delta value={w.labor_variance_pct} kind="labor" /></td></tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </div>
        <div className="card">
          <h3>Variance by day</h3>
          <p className="muted card-sub">Above zero is good for sales and bad for labor.</p>
          {anyValue(t.daily, "sales_variance_pct") || anyValue(t.daily, "labor_variance_pct") ? <VarianceTrend data={t.daily} /> : <p className="empty-note">No forecast or allowable hours on file for these days yet.</p>}
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h3>{levelLabel} over time</h3>
          {level !== "store" && <Link className="btn secondary small" to="/regions">Full breakdown</Link>}
        </div>
        <p className="muted card-sub">Sales against forecast, one line per {levelLabel.toLowerCase().replace(/s$/, "")}. Select a name to drill in.</p>
        {t.groups.groups.some((g) => anyValue(t.groups.rows, `variance_${g.id}`))
          ? <GroupLines rows={t.groups.rows} groups={t.groups.groups} onSelect={(g) => navigate(childPath(g.id))} />
          : <p className="empty-note">No forecast on file for these days yet.</p>}
        <details className="more-table">
          <summary>Show the numbers for every {levelLabel.toLowerCase().replace(/s$/, "")}</summary>
          <table className="ledger small">
            <thead><tr><th>{levelLabel.replace(/s$/, "")}</th><th className="num">Sales</th><th className="num">vs. forecast</th><th className="num">vs. last year</th><th className="num">Labor vs. allowable</th><th className="num">Labor cost</th><th className="num">Rating</th></tr></thead>
            <tbody>
              {t.breakdown.map((g) => (
                <tr key={g.id}><td><Link to={childPath(g.id)}>{String(g.name).replace(/^IHOP /, "")}</Link></td><td className="num money">{fmt$(g.actual_sales)}</td>
                  <td className="num"><Delta value={g.sales_variance_pct} /></td><td className="num"><Delta value={g.prior_year_variance_pct} /></td><td className="num"><Delta value={g.labor_variance_pct} kind="labor" /></td>
                  <td className="num">{has(g.labor_cost_pct) ? `${g.labor_cost_pct}%` : "-"}</td><td className="num">{fmtRating(g.average_rating)}</td></tr>
              ))}
            </tbody>
          </table>
        </details>
      </div>

      <div className="grid">
        <div className="card">
          <h3>Labor by day</h3>
          {anyValue(t.daily, "actual_labor_hours") ? <LaborTrend data={t.daily} /> : <p className="empty-note">No labor hours on file for these days yet.</p>}
        </div>
        <div className="card">
          <h3>Labor cost as a share of sales</h3>
          {anyValue(t.daily, "labor_cost_pct")
            ? <MetricTrend data={t.daily} format={(v) => (has(v) ? `${v}%` : "-")} tick={(v) => `${v}%`} series={[{ key: "labor_cost_pct", name: "Labor cost %", color: SERIES.actual, primary: true }]} />
            : <p className="empty-note">No labor cost on file for these days yet.</p>}
        </div>
      </div>

      <div className="grid">
        <div className="card">
          <h3>The average day, by weekday</h3>
          <p className="muted card-sub">Days without sales on file are left out of the average.</p>
          <WeekdayBars data={t.weekday} />
        </div>
        <div className="card">
          <h3>Where each day's sales came from</h3>
          {t.daypartByDay.length ? <DaypartStack data={t.daypartByDay} /> : <p className="empty-note">No daypart sales on file for these days yet.</p>}
          <table className="ledger small" style={{ marginTop: 10 }}>
            <thead><tr><th>Daypart</th><th className="num">Sales</th><th className="num">vs. forecast</th><th className="num">vs. last year</th></tr></thead>
            <tbody>{t.dayparts.map((d) => <tr key={d.daypart}><td>{d.label}</td><td className="num money">{fmt$(d.actual_sales)}</td><td className="num"><Delta value={d.sales_variance_pct} /></td><td className="num"><Delta value={d.prior_year_variance_pct} /></td></tr>)}</tbody>
          </table>
          <DaypartNote cov={t.daypartCoverage} />
        </div>
      </div>

      <div className="card">
        <h3>Guest rating by day</h3>
        {anyValue(t.daily, "average_rating")
          ? <MetricTrend data={t.daily} format={fmtRating} tick={(v) => v} series={[{ key: "average_rating", name: "Average rating", color: SERIES.actual, primary: true }]} />
          : <p className="empty-note">No guest surveys on file for these days. Ratings arrive from Merchant Centric STARS once that connection is set up under Data and refresh.</p>}
        {anyValue(t.daily, "survey_count") && <p className="muted" style={{ marginTop: 8 }}>{fmtNum(tot.survey_count)} surveys in range.</p>}
      </div>
      <p className="muted" style={{ fontSize: 12.5 }}>Range: {prettyDay(range.from)} to {prettyDay(range.to)}. Percentages are re-divided from totals, never averaged, and a comparison only counts days that have both sides on file.</p>
    </div>
  );
}
