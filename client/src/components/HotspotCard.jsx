import { Link } from "react-router-dom";
import { SeverityBadge, Delta, WeatherLine } from "./Bits.jsx";
import { fmt$, fmt$signed, fmtHours, fmtHoursSigned, fmtNum, fmtRating, salesTone, laborTone } from "../format.js";

function Row({ label, children }) {
  return <div className="hs-row"><span>{label}</span><span className="money">{children}</span></div>;
}

// Everything leadership needs for one restaurant on one card: the flags first, then the
// numbers behind them, then weather as context. Flags state what happened, not why.
export default function HotspotCard({ s, single = true, compact = false }) {
  return (
    <article className={`hotspot severity-${s.severity || "none"}`}>
      <header>
        <div>
          <h3><Link to={`/stores/${s.id}`}>{s.name}</Link></h3>
          <div className="hs-where">
            <Link to={`/regions/${s.region_id}`}>{s.region_name}</Link> · <Link to={`/areas/${s.area_id}`}>{s.area_name}</Link>
            {s.area_manager ? ` · ${s.area_manager}` : ""}
          </div>
        </div>
        <SeverityBadge severity={s.severity} />
      </header>

      {s.flags?.length > 0 && <ul className="hs-flags">{s.flags.map((f) => <li key={f}>{f}</li>)}</ul>}
      {s.weather_note && <p className="hs-weather-note">{s.weather_note}</p>}

      {!compact && (
        <div className="hs-grid">
          <section>
            <h4>Sales</h4>
            <Row label="Actual">{fmt$(s.actual_sales)}</Row>
            {s.forecast_basis !== null && s.forecast_basis !== undefined && <Row label="Forecast">{fmt$(s.forecast_basis)}</Row>}
            {s.prior_year_sales !== null && s.prior_year_sales !== undefined && <Row label="Last year">{fmt$(s.prior_year_sales)}</Row>}
            {s.sales_variance !== null && s.sales_variance !== undefined && <Row label="vs. forecast"><span className={salesTone(s.sales_variance)}>{fmt$signed(s.sales_variance)}</span> <Delta value={s.sales_variance_pct} /></Row>}
            {s.prior_year_variance !== null && s.prior_year_variance !== undefined && <Row label="vs. last year"><span className={salesTone(s.prior_year_variance)}>{fmt$signed(s.prior_year_variance)}</span> <Delta value={s.prior_year_variance_pct} /></Row>}
          </section>
          <section>
            <h4>Labor</h4>
            <Row label="Actual">{fmtHours(s.actual_labor_hours)}</Row>
            <Row label="Scheduled">{fmtHours(s.scheduled_labor_hours)}</Row>
            <Row label="Allowable (plan)">{fmtHours(s.allowable_labor_hours)}</Row>
            <Row label="Variance"><span className={laborTone(s.labor_variance)}>{fmtHoursSigned(s.labor_variance)}</span> <Delta value={s.labor_variance_pct} kind="labor" /></Row>
          </section>
          {(s.guest?.survey_count > 0 || s.guest?.google_review_count > 0) && (
            <section>
              <h4>Guest (trailing 7 days)</h4>
              <Row label="Survey rating">{fmtRating(s.guest?.average_rating)}</Row>
              <Row label="Survey count">{fmtNum(s.guest?.survey_count)}</Row>
              <Row label="Google rating">{fmtRating(s.guest?.google_rating)}</Row>
              <Row label="Google reviews">{fmtNum(s.guest?.google_review_count)}</Row>
            </section>
          )}
          <section className="hs-weather">
            <h4>Weather</h4>
            <WeatherLine label={single ? "Current" : "This period"} w={s.weather?.current} single={single} />
            <WeatherLine label={single ? "Same day last year" : "Same days last year"} w={s.weather?.lastYear} single={single} />
          </section>
        </div>
      )}
    </article>
  );
}
