import { Link } from "react-router-dom";
import { AlertIcon, EyeIcon, CheckIcon, StarIcon } from "./Icons.jsx";
import { fmt$, fmt$signed, fmtPct, fmtHours, fmtHoursSigned, fmtNum, fmtRating, fmtTemp, salesTone, laborTone } from "../format.js";

export const SEVERITY = {
  critical: { label: "Critical", tone: "attention", icon: AlertIcon },
  needs_review: { label: "Needs review", tone: "watch", icon: EyeIcon },
  watch: { label: "Watch", tone: "neutral", icon: EyeIcon },
  positive_outlier: { label: "Positive outlier", tone: "ok", icon: StarIcon },
};

export function SeverityBadge({ severity }) {
  const s = SEVERITY[severity];
  if (!s) return null;
  return <span className={`status-badge tone-${s.tone}`}><s.icon size={12} />{s.label}</span>;
}

/** A status pill with the icon that matches its tone, so the state never rides on color alone. */
const TONE_ICON = { ok: CheckIcon, watch: EyeIcon, attention: AlertIcon };
export function ToneBadge({ tone, children }) {
  const I = TONE_ICON[tone];
  return <span className={`status-badge tone-${tone}`}>{I && <I size={12} />}{children}</span>;
}

export function Delta({ value, kind = "sales", suffix = "" }) {
  const tone = kind === "labor" ? laborTone(value) : salesTone(value);
  return <span className={`money ${tone}`}>{fmtPct(value)}{suffix}</span>;
}

/**
 * A variance percentage with a small bar either side of a zero line, scaled to `max`
 * (the largest variance in the table) so rows can be compared at a glance.
 */
export function VarCell({ value, max, kind = "sales" }) {
  if (value === null || value === undefined) return <span className="neutral">-</span>;
  const good = kind === "labor" ? value <= 0 : value >= 0;
  const share = max ? Math.min(1, Math.abs(value) / max) * 50 : 0;
  return (
    <span className="varcell">
      <span className="varbar" aria-hidden="true"><i className={good ? "good" : "bad"} style={value >= 0 ? { left: "50%", width: `${share}%` } : { right: "50%", width: `${share}%` }} /></span>
      <Delta value={value} kind={kind} />
    </span>
  );
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

/**
 * Today / yesterday / period card. The live card adds a meter of sales so far against the
 * full-day forecast. `detailed` adds the dollar and hour figures behind each percentage.
 */
export function Snapshot({ title, caption, t, live = false, detailed = false }) {
  const heading = <h3>{title}{live && <span className="live-pill"><i />Live</span>}</h3>;
  if (!t || t.actual_sales === undefined || t.actual_sales === null) return <div className="card snapshot">{heading}<p className="muted">Nothing on file yet.</p></div>;
  const progress = live && t.forecast_sales ? Math.min(100, Math.round((t.actual_sales / t.forecast_sales) * 100)) : null;
  return (
    <div className="card snapshot">
      {heading}
      <div className="muted">{caption}</div>
      <div className="snapshot-value">{fmt$(t.actual_sales)}</div>
      {progress !== null && (
        <div className="meter">
          <div className="meter-track" role="img" aria-label={`${progress}% of the full-day forecast`}><div className="meter-fill" style={{ width: `${progress}%` }} /></div>
          <div className="meter-caption"><span>{progress}% of full-day forecast</span><span className="money">{fmt$(t.forecast_sales)}</span></div>
        </div>
      )}
      <dl>
        <div><dt>{live ? "vs. forecast so far" : "vs. forecast"}</dt><dd><Delta value={t.sales_variance_pct} />{detailed && t.forecast_basis !== null && t.forecast_basis !== undefined && <> <span className="neutral money">({fmt$(t.forecast_basis)})</span></>}</dd></div>
        {!live && <div><dt>vs. last year</dt><dd><Delta value={t.prior_year_variance_pct} /></dd></div>}
        <div><dt>Labor vs. allowable</dt><dd><Delta value={t.labor_variance_pct} kind="labor" />{detailed && t.labor_variance !== null && t.labor_variance !== undefined && <> <span className={`money ${laborTone(t.labor_variance)}`}>({fmtHoursSigned(t.labor_variance)})</span></>}</dd></div>
        {detailed && !live && <div><dt>Guest rating</dt><dd className="money">{fmtRating(t.average_rating)} <span className="neutral">({fmtNum(t.survey_count)} surveys)</span></dd></div>}
      </dl>
    </div>
  );
}

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
