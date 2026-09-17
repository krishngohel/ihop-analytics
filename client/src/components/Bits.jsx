import { Link } from "react-router-dom";
import { fmt$, fmt$signed, fmtPct, fmtHours, fmtHoursSigned, fmtNum, fmtRating, fmtTemp, salesTone, laborTone } from "../format.js";

export const SEVERITY = {
  critical: { label: "Critical", tone: "attention" },
  needs_review: { label: "Needs review", tone: "watch" },
  watch: { label: "Watch", tone: "neutral" },
  positive_outlier: { label: "Positive outlier", tone: "ok" },
};

export function SeverityBadge({ severity }) {
  const s = SEVERITY[severity];
  if (!s) return null;
  return <span className={`status-badge tone-${s.tone}`}>{s.label}</span>;
}

export function Delta({ value, kind = "sales", suffix = "" }) {
  const tone = kind === "labor" ? laborTone(value) : salesTone(value);
  return <span className={`money ${tone}`}>{fmtPct(value)}{suffix}</span>;
}

export function Crumbs({ items }) {
  return (
    <nav className="crumbs no-print" aria-label="Breadcrumb">
      {items.map((it, i) => (
        <span key={i}>
          {it.to ? <Link to={it.to}>{it.label}</Link> : <strong>{it.label}</strong>}
          {i < items.length - 1 && <i aria-hidden="true">/</i>}
        </span>
      ))}
    </nav>
  );
}

export function Loading({ error }) {
  if (error) return <div className="alert err">{error.message}</div>;
  return <p className="muted">Loading…</p>;
}

function Stat({ label, value, lines = [] }) {
  return (
    <div className="money-stat">
      <div className="money-stat-label">{label}</div>
      <div className="money-stat-value money">{value}</div>
      {lines.filter(Boolean).map((l, i) => <div key={i} className="money-stat-sub">{l}</div>)}
    </div>
  );
}

/** The standard company / region / area / store KPI strip: sales, labor, guest. */
export function PerformanceStrip({ t, live = false, extra = null }) {
  if (!t || t.actual_sales === undefined || t.actual_sales === null) return <p className="muted">No results on file for this selection.</p>;
  return (
    <div className="kpis">
      <Stat label={live ? "Sales so far" : "Actual sales"} value={fmt$(t.actual_sales)} lines={[
        <span key="f" className="neutral">{live ? "Forecast to this point" : "Forecast"} {fmt$(t.forecast_basis)}</span>,
        live && <span key="d" className="neutral">Full-day forecast {fmt$(t.forecast_sales)}</span>,
      ]} />
      <Stat label="Sales variance" value={<span className={salesTone(t.sales_variance)}>{fmt$signed(t.sales_variance)}</span>} lines={[
        <span key="p"><Delta value={t.sales_variance_pct} /> <span className="neutral">vs. forecast</span></span>,
        !live && <span key="ly"><Delta value={t.prior_year_variance_pct} /> <span className="neutral">vs. last year ({fmt$(t.prior_year_sales)})</span></span>,
      ]} />
      <Stat label="Actual labor" value={fmtHours(t.actual_labor_hours)} lines={[
        <span key="a" className="neutral">Allowable {fmtHours(t.allowable_labor_hours)} · scheduled {fmtHours(t.scheduled_labor_hours)}</span>,
        <span key="c" className="neutral">Labor cost {fmt$(t.actual_labor_cost)}{t.labor_cost_pct !== null && t.labor_cost_pct !== undefined ? ` (${t.labor_cost_pct}% of sales)` : ""}</span>,
      ]} />
      <Stat label="Labor variance" value={<span className={laborTone(t.labor_variance)}>{fmtHoursSigned(t.labor_variance)}</span>} lines={[
        <span key="p"><Delta value={t.labor_variance_pct} kind="labor" /> <span className="neutral">vs. allowable</span></span>,
      ]} />
      {!live && (
        <Stat label="Guest rating" value={fmtRating(t.average_rating)} lines={[
          <span key="s" className="neutral">{fmtNum(t.survey_count)} surveys</span>,
          <span key="g" className="neutral">Google {fmtRating(t.google_rating)} · {fmtNum(t.google_review_count)} reviews</span>,
        ]} />
      )}
      {extra}
    </div>
  );
}

export { Stat };

export function WeatherLine({ label, w, single = true }) {
  if (!w) return <div className="wx-line"><span className="wx-label">{label}</span><span className="neutral">No weather on file</span></div>;
  return (
    <div className="wx-line">
      <span className="wx-label">{label}</span>
      <span className={w.thunderstorm_flag || w.rain_flag ? "wx-wet" : ""}>{w.weather_description || "n/a"}</span>
      <span className="neutral">
        {single ? `${fmtTemp(w.temperature_high)} / ${fmtTemp(w.temperature_low)}` : `avg high ${fmtTemp(w.temperature_high)}`}
        {w.precipitation_amount > 0 ? ` · ${Number(w.precipitation_amount).toFixed(2)} in` : ""}
        {single && w.morning_precipitation > 0 ? ` (${Number(w.morning_precipitation).toFixed(2)} in before 11am)` : ""}
      </span>
    </div>
  );
}
