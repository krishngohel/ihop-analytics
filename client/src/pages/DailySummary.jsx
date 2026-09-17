import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useApp } from "../appContext.jsx";
import { getDailySummary } from "../api.js";
import { SeverityBadge, Loading } from "../components/Bits.jsx";
import { fmt$, fmtPct, fmtHours, fmtNum, fmtRating, prettyDay, prettyTime, addDays } from "../format.js";

export default function DailySummary() {
  const { meta, dataVersion } = useApp();
  const [date, setDate] = useState(meta.last_final_day);
  const [state, setState] = useState({ data: null, error: null });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setState({ data: null, error: null });
    getDailySummary({ date }).then((data) => !cancelled && setState({ data, error: null })).catch((error) => !cancelled && setState({ data: null, error }));
    return () => { cancelled = true; };
  }, [date, dataVersion]);

  const s = state.data;
  const copy = async () => {
    await navigator.clipboard.writeText(s.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div>
      <div className="rangebar no-print">
        <div className="rangebar-row">
          <button type="button" className="btn secondary small" onClick={() => setDate(addDays(date, -1))} disabled={date <= meta.bounds.first_day}>Previous day</button>
          <label>Business day <input type="date" value={date} min={meta.bounds.first_day} max={meta.last_final_day} onChange={(e) => e.target.value && setDate(e.target.value)} /></label>
          <button type="button" className="btn secondary small" onClick={() => setDate(addDays(date, 1))} disabled={date >= meta.last_final_day}>Next day</button>
          {s && <button type="button" className="btn small" onClick={copy}>{copied ? "Copied" : "Copy as text"}</button>}
          {s && <button type="button" className="btn secondary small" onClick={() => window.print()}>Print</button>}
        </div>
      </div>

      {!s ? <Loading error={state.error} /> : (
        <article className="card summary">
          <header>
            <h2>{date === meta.last_final_day ? "Yesterday's Business Summary" : "Business Summary"}</h2>
            <p className="muted">{prettyDay(s.date, { weekday: "long", month: "long", day: "numeric", year: "numeric" })} · {s.scope} · {s.restaurants} restaurants · generated {prettyTime(s.generated_at)}</p>
          </header>

          <h3>Company performance</h3>
          <ul>
            <li><strong>Sales:</strong> {fmt$(s.company.sales.actual)} actual vs. {fmt$(s.company.sales.forecast)} forecast, variance: <span className={s.company.sales.variance_pct >= 0 ? "positive" : "negative"}>{fmtPct(s.company.sales.variance_pct)}</span> <span className="neutral">({fmtPct(s.company.sales.prior_year_variance_pct)} vs. last year)</span></li>
            <li><strong>Labor:</strong> {fmtHours(s.company.labor.actual_hours)} actual vs. {fmtHours(s.company.labor.allowable_hours)} allowable, variance: <span className={s.company.labor.variance_pct <= 0 ? "positive" : "negative"}>{fmtPct(s.company.labor.variance_pct)}</span></li>
            <li><strong>Guest experience:</strong> {fmtNum(s.company.guest.survey_count)} surveys, {fmtRating(s.company.guest.average_rating)} average rating <span className="neutral">(Google {fmtRating(s.company.guest.google_rating)} across {fmtNum(s.company.guest.google_review_count)} reviews)</span></li>
          </ul>

          <h3>Top performers</h3>
          <ul>{s.topPerformers.length ? s.topPerformers.map((t) => <li key={t.restaurant_id + t.text}><Link to={`/stores/${t.restaurant_id}`}>{t.name}</Link>: {t.text}</li>) : <li>None beat forecast</li>}</ul>

          <h3>Priority hotspots <span className="muted">({s.hotspot_count} in total, <Link to="/hotspots">see all</Link>)</span></h3>
          <ul>{s.hotspots.length ? s.hotspots.map((h) => (
            <li key={h.restaurant_id}><Link to={`/stores/${h.restaurant_id}`}>{h.name}</Link> <SeverityBadge severity={h.severity} /> <span className="neutral">{h.region} · {h.area}</span><br />{h.text}</li>
          )) : <li>None</li>}</ul>

          <h3>Regional notes</h3>
          <ul>{s.regionalNotes.length ? s.regionalNotes.map((n) => <li key={n}>{n}</li>) : <li>No regional misses</li>}</ul>
        </article>
      )}
    </div>
  );
}
