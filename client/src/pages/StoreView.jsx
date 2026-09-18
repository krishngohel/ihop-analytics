import { useState } from "react";
import { useParams } from "react-router-dom";
import { useApp, useData } from "../appContext.jsx";
import { getStore } from "../api.js";
import RangeBar from "../components/RangeBar.jsx";
import { SalesTrend, LaborTrend } from "../components/Charts.jsx";
import { Snapshot, PerformanceStrip, Crumbs, Loading, Delta, SeverityBadge, WeatherLine } from "../components/Bits.jsx";
import { fmt$, fmtHours, fmtNum, fmtRating, fmtTemp, prettyDay, laborTone, fmtHoursSigned } from "../format.js";

const VIEWS = [{ key: "daily", label: "Daily" }, { key: "weekly", label: "Weekly" }, { key: "periods", label: "By period" }];

function wx(w) {
  if (!w) return "-";
  return `${w.weather_description}, ${fmtTemp(w.temperature_high)}`;
}

export default function StoreView() {
  const { id } = useParams();
  const { range } = useApp();
  const [view, setView] = useState("daily");
  const { data: s, error, loading } = useData((p) => getStore(id, p), { id });
  if (!s) return <><RangeBar /><Loading error={error} /></>;
  const r = s.restaurant;
  const single = range.from === range.to;
  const lastDay = s.daily[s.daily.length - 1];

  return (
    <div style={{ opacity: loading ? 0.6 : 1 }}>
      <RangeBar />
      <Crumbs items={[{ label: "Company", to: "/regions" }, { label: r.region_name, to: `/regions/${r.region_id}` }, { label: `${r.area_name} area`, to: `/areas/${r.area_id}` }, { label: r.restaurant_name }]} />

      <div className="brief-card">
        <div className="page-title-row">
          <h2>{r.restaurant_name}</h2>
          {s.latestStatus?.severity && <SeverityBadge severity={s.latestStatus.severity} />}
        </div>
        <p className="muted" style={{ margin: "2px 0 0" }}>{[r.address, r.city, r.state].filter(Boolean).join(", ")} · {r.region_name} region · {r.area_name} area · Area manager {r.area_manager}</p>
        {s.latestStatus?.flags?.length > 0 && (
          <p className="status-line"><strong>{prettyDay(s.latestStatus.date)}:</strong> {s.latestStatus.flags.join(" · ")}{s.latestStatus.weather_note ? ` ${s.latestStatus.weather_note}` : ""}</p>
        )}
        <PerformanceStrip t={s.selected} live={single && range.to === s.today?.date} />
        {s.areaAverage && <p className="muted" style={{ margin: "12px 0 0" }}>{r.area_name} area for the same dates: sales <Delta value={s.areaAverage.sales_variance_pct} /> vs. forecast, labor <Delta value={s.areaAverage.labor_variance_pct} kind="labor" /> vs. allowable, guest rating {fmtRating(s.areaAverage.average_rating)}.</p>}
      </div>

      <div className="grid three">
        <Snapshot title="Today" caption={s.today ? `${prettyDay(s.today.date)} · sales so far` : ""} t={s.today} live />
        <Snapshot title="Yesterday, final" caption={prettyDay(s.yesterday.date)} t={s.yesterday} />
        <Snapshot title={`Period ${s.periodToDate.number} to date`} caption={`${prettyDay(s.periodToDate.from)} to ${prettyDay(s.periodToDate.through)}`} t={s.periodToDate} />
      </div>

      <div className="card">
        <h3>Recent performance anomalies</h3>
        <p className="muted card-sub">Days in the last 28 that crossed a threshold: sales 10% under forecast, 12% under last year, labor 8% over allowable, a possible opening-time issue, or sales 12% over forecast.</p>
        {s.anomalies.length === 0 ? <p className="muted">No anomalies in the last 28 days.</p> : (
          <ul className="anomaly-list">
            {s.anomalies.map((a) => (
              <li key={a.date} className={a.severe ? "severe" : a.positive ? "good" : ""}>
                <span className="anomaly-date">{a.label}</span>
                <span className="anomaly-body">
                  <span>{a.flags.join(" · ")}</span>
                  {a.weather_note && <span className="hs-weather-note">{a.weather_note}</span>}
                </span>
                <span className="money neutral">{fmt$(a.actual_sales)} vs. {fmt$(a.forecast_sales)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {!single && (
        <div className="grid">
          <div className="card"><h3>Sales: actual, forecast, last year</h3><SalesTrend data={s.daily} height={230} /></div>
          <div className="card"><h3>Labor hours vs. allowable</h3><LaborTrend data={s.daily} height={230} /></div>
        </div>
      )}
      {single && lastDay && (
        <div className="card">
          <h3>Weather context for {prettyDay(lastDay.date)}</h3>
          <WeatherLine label="Current" w={lastDay.weather} />
          <WeatherLine label="Same day last year" w={lastDay.weatherLastYear} />
          {lastDay.weatherContext && <p className="hs-weather-note">{lastDay.weatherContext}</p>}
        </div>
      )}

      <div className="card">
        <div className="card-header">
          <h3>Results</h3>
          <div className="pill-group">{VIEWS.map((v) => <button key={v.key} type="button" className={view === v.key ? "active" : ""} onClick={() => setView(v.key)}>{v.label}</button>)}</div>
        </div>
        <div className="table-scroll">
          {view === "daily" ? (
            <table className="ledger small">
              <thead><tr><th>Day</th><th className="num">Sales</th><th className="num">Forecast</th><th className="num">Last year</th><th className="num">vs. fcst</th><th className="num">vs. LY</th><th className="num">Labor hrs</th><th className="num">Allowable</th><th className="num">Labor var.</th><th className="num">Rating</th><th>Weather</th><th>Same day last year</th></tr></thead>
              <tbody>
                {[...s.daily].reverse().map((d) => (
                  <tr key={d.date}>
                    <td>{prettyDay(d.date)}{["late", "disrupted"].includes(d.opening_time_status) && <span className="tag attention">opening issue</span>}{d.is_final === 0 && <span className="tag">live</span>}</td>
                    <td className="num money">{fmt$(d.actual_sales)}</td><td className="num money">{fmt$(d.forecast_basis)}</td><td className="num money">{fmt$(d.prior_year_sales)}</td>
                    <td className="num"><Delta value={d.sales_variance_pct} /></td><td className="num"><Delta value={d.prior_year_variance_pct} /></td>
                    <td className="num money">{fmtNum(d.actual_labor_hours)}</td><td className="num money">{fmtNum(d.allowable_labor_hours)}</td>
                    <td className="num"><Delta value={d.labor_variance_pct} kind="labor" /></td>
                    <td className="num money">{fmtRating(d.average_rating)}</td>
                    <td className={d.weather?.rain_flag ? "wx-wet" : ""}>{wx(d.weather)}</td><td className={d.weatherLastYear?.rain_flag ? "wx-wet" : ""}>{wx(d.weatherLastYear)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="ledger small">
              <thead><tr><th>{view === "weekly" ? "Week" : "Period"}</th><th className="num">Days</th><th className="num">Sales</th><th className="num">Forecast</th><th className="num">Last year</th><th className="num">vs. fcst</th><th className="num">vs. LY</th><th className="num">Labor hrs</th><th className="num">Labor var.</th><th className="num">Rating</th><th className="num">Surveys</th></tr></thead>
              <tbody>
                {[...(view === "weekly" ? s.weekly : s.periods)].reverse().map((w) => (
                  <tr key={w.label}>
                    <td>{view === "weekly" ? `${prettyDay(w.week_start, { month: "short", day: "numeric" })} to ${prettyDay(w.week_end, { month: "short", day: "numeric" })}` : `${w.label} (${prettyDay(w.from, { month: "short", day: "numeric" })} to ${prettyDay(w.to, { month: "short", day: "numeric" })})`}</td>
                    <td className="num neutral">{w.days}</td>
                    <td className="num money">{fmt$(w.actual_sales)}</td><td className="num money">{fmt$(w.forecast_sales)}</td><td className="num money">{fmt$(w.prior_year_sales)}</td>
                    <td className="num"><Delta value={w.sales_variance_pct} /></td><td className="num"><Delta value={w.prior_year_variance_pct} /></td>
                    <td className="num money">{fmtHours(w.actual_labor_hours)}</td>
                    <td className="num"><span className={`money ${laborTone(w.labor_variance)}`}>{fmtHoursSigned(w.labor_variance)}</span> <Delta value={w.labor_variance_pct} kind="labor" /></td>
                    <td className="num money">{fmtRating(w.average_rating)}</td><td className="num money">{fmtNum(w.survey_count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="card">
        <h3>Dayparts</h3>
        <table className="ledger small">
          <thead><tr><th>Daypart</th><th className="num">Sales</th><th className="num">Forecast</th><th className="num">Last year</th><th className="num">vs. forecast</th><th className="num">vs. last year</th></tr></thead>
          <tbody>
            {s.dayparts.map((d) => (
              <tr key={d.daypart} className={d.daypart === "breakfast" ? "emphasis-row" : ""}>
                <td>{d.label}</td><td className="num money">{fmt$(d.actual_sales)}</td><td className="num money">{fmt$(d.forecast_basis)}</td><td className="num money">{fmt$(d.prior_year_sales)}</td>
                <td className="num"><Delta value={d.sales_variance_pct} /></td><td className="num"><Delta value={d.prior_year_variance_pct} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
