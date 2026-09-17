import { useEffect, useMemo, useState } from "react";
import { useApp } from "../appContext.jsx";
import { getForecastForm, getForecastRollup, saveForecast } from "../api.js";
import { Delta, Loading } from "../components/Bits.jsx";
import { fmt$, fmtNum, fmtPct, prettyDay, prettyTime, addDays, laborTone } from "../format.js";

const STATUS = { submitted: { label: "Submitted", tone: "ok" }, incomplete: { label: "Incomplete", tone: "watch" }, missing: { label: "Not started", tone: "attention" } };
const num = (v) => (v === "" || v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));
const pctOf = (a, b) => (a !== null && b ? Math.round(((a - b) / b) * 1000) / 10 : null);

function StatusBadge({ status }) {
  const s = STATUS[status];
  return <span className={`status-badge tone-${s.tone}`}>{s.label}</span>;
}

// One restaurant's form. Calculated fields update as the manager types; the server
// re-checks everything on save and refuses a submit that doesn't reconcile.
function StoreForm({ row, guide, onSaved }) {
  const [f, setF] = useState({
    manager_forecast: row.manager_forecast ?? "", forecast_adjustment_reason: row.forecast_adjustment_reason || "",
    scheduled_hours: row.scheduled_hours ?? "", manager_hours: row.manager_hours ?? "", notes: row.notes || "",
  });
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState([]);
  const [message, setMessage] = useState(null);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  const mf = num(f.manager_forecast);
  const sched = num(f.scheduled_hours);
  const mgr = num(f.manager_hours);
  const allowable = mf ? 7 * guide.fixed_daily_hours + mf / guide.sales_per_hour + (mgr || 0) : null;
  const totalScheduled = sched !== null ? sched + (mgr || 0) : null;
  const laborVar = allowable !== null && totalScheduled !== null ? totalScheduled - allowable : null;
  const laborPct = totalScheduled !== null && mf ? Math.round(((totalScheduled * row.avg_hourly_rate) / mf) * 1000) / 10 : null;

  const save = async (submit) => {
    setBusy(true); setProblems([]); setMessage(null);
    try {
      const saved = await saveForecast({ week_start: row.week_start, restaurant_id: row.restaurant_id, ...f, submit });
      setMessage(submit ? "Submitted" : "Draft saved");
      onSaved(saved);
    } catch (e) {
      setProblems(e.body?.problems?.length ? e.body.problems : [e.message]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="card forecast-store">
      <header>
        <div>
          <h3>{row.restaurant_name}</h3>
          <div className="muted">{row.region_name} region · {row.area_name} area · week of {prettyDay(row.week_start, { month: "short", day: "numeric", year: "numeric" })}</div>
        </div>
        <StatusBadge status={row.status} />
      </header>

      <div className="fc-context">
        <div><span>Last year sales</span><strong className="money">{fmt$(row.last_year_sales)}</strong></div>
        <div><span>Recent sales trend (4 weeks vs. last year)</span><strong><Delta value={row.recent_trend} /></strong></div>
        <div><span>What the trend implies</span><strong className="money">{fmt$(row.trend_implied_forecast)}</strong></div>
        <div><span>System forecast</span><strong className="money">{fmt$(row.system_forecast)}</strong></div>
        <div><span>Labor plan at system forecast</span><strong className="money">{fmtNum(row.labor_plan)} hrs</strong></div>
      </div>

      {row.adjustment_expected && (
        <div className="alert warn">
          Forecast adjustment expected: the system forecast is {fmtPct(row.system_vs_trend_pct)} against what the recent trend implies. Adjust the projection, or explain why the system number still holds.
        </div>
      )}

      <div className="fc-inputs">
        <label>Manager-adjusted projected sales<input type="number" min="0" step="100" inputMode="decimal" value={f.manager_forecast} onChange={set("manager_forecast")} placeholder={row.system_forecast ?? ""} /></label>
        <label>Actual scheduled labor (crew hours)<input type="number" min="0" step="1" value={f.scheduled_hours} onChange={set("scheduled_hours")} /></label>
        <label>Manager hours<input type="number" min="0" step="1" value={f.manager_hours} onChange={set("manager_hours")} /></label>
        <label className="span-2">Reason for adjustment<textarea rows={2} value={f.forecast_adjustment_reason} onChange={set("forecast_adjustment_reason")} placeholder="What do you know that the system forecast doesn't?" /></label>
        <label>Notes / business context<textarea rows={2} value={f.notes} onChange={set("notes")} placeholder="Local events, staffing, construction, promotions" /></label>
      </div>

      <div className="fc-calcs">
        <div><span>Projected vs. last year</span><strong><Delta value={pctOf(mf, row.last_year_sales)} /></strong></div>
        <div><span>Projected vs. system forecast</span><strong><Delta value={pctOf(mf, row.system_forecast)} /></strong></div>
        <div><span>Total allowable hours</span><strong className="money">{allowable === null ? "-" : `${fmtNum(allowable)} hrs`}</strong></div>
        <div><span>Total scheduled (crew + manager)</span><strong className="money">{totalScheduled === null ? "-" : `${fmtNum(totalScheduled)} hrs`}</strong></div>
        <div><span>Labor variance</span><strong className={`money ${laborTone(laborVar)}`}>{laborVar === null ? "-" : `${laborVar > 0 ? "+" : ""}${fmtNum(laborVar)} hrs (${fmtPct(pctOf(totalScheduled, allowable))})`}</strong></div>
        <div><span>Labor percentage</span><strong className="money">{laborPct === null ? "-" : `${laborPct}%`}</strong></div>
      </div>

      {row.flags.length > 0 && <ul className="hs-flags">{row.flags.map((x) => <li key={x}>{x}</li>)}</ul>}
      {problems.length > 0 && <div className="alert err"><strong>Not ready to submit:</strong><ul>{problems.map((p) => <li key={p}>{p}</li>)}</ul></div>}

      <footer>
        <button type="button" className="btn" disabled={busy} onClick={() => save(true)}>{row.status === "submitted" ? "Resubmit" : "Submit forecast"}</button>
        <button type="button" className="btn secondary" disabled={busy} onClick={() => save(false)}>Save draft</button>
        <span className="muted">{message || (row.submitted_at ? `Submitted ${prettyTime(row.submitted_at)} by ${row.submitted_by}` : "")}</span>
      </footer>
    </article>
  );
}

function RollupTable({ rows, nameLabel, sub }) {
  return (
    <div className="table-scroll">
      <table className="ledger small">
        <thead><tr><th>{nameLabel}</th><th className="num">Submitted</th><th className="num">Incomplete</th><th className="num">Not started</th><th className="num">Last year</th><th className="num">System forecast</th><th className="num">Manager forecast*</th><th className="num">vs. system*</th><th className="num">Scheduled hrs*</th><th className="num">Allowable hrs*</th><th className="num">Labor variance*</th><th className="num">Flagged</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td><strong>{r.name}</strong>{sub && <div className="cell-sub">{sub(r)}</div>}</td>
              <td className="num money">{r.submitted} / {r.restaurants}</td><td className="num money">{r.incomplete}</td><td className={`num money ${r.missing ? "negative" : ""}`}>{r.missing}</td>
              <td className="num money">{fmt$(r.last_year_sales)}</td><td className="num money">{fmt$(r.system_forecast)}</td><td className="num money">{r.submitted ? fmt$(r.manager_forecast) : "-"}</td>
              <td className="num"><Delta value={r.projected_vs_system_pct} /></td>
              <td className="num money">{r.submitted ? fmtNum(r.scheduled_hours) : "-"}</td><td className="num money">{r.submitted ? fmtNum(r.allowable_hours) : "-"}</td>
              <td className="num"><Delta value={r.labor_variance_pct} kind="labor" /></td><td className="num money">{r.flagged}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">* Submitted restaurants only.</p>
    </div>
  );
}

export default function ForecastForm() {
  const { meta, user } = useApp();
  const areas = useMemo(() => meta.hierarchy.flatMap((r) => r.areas.map((a) => ({ ...a, region_name: r.region_name }))), [meta]);
  const [week, setWeek] = useState(meta.next_forecast_week);
  const [areaId, setAreaId] = useState(String(areas[0]?.area_id || ""));
  const [tab, setTab] = useState(user.role === "executive" || user.role === "region" ? "rollup" : "forms");
  const [form, setForm] = useState(null);
  const [rollup, setRollup] = useState(null);
  const [error, setError] = useState(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    if (tab === "forms") { setForm(null); getForecastForm({ weekStart: week, areaId }).then((d) => !cancelled && setForm(d)).catch((e) => !cancelled && setError(e)); }
    else { getForecastRollup({ weekStart: week }).then((d) => !cancelled && setRollup(d)).catch((e) => !cancelled && setError(e)); }
    return () => { cancelled = true; };
  }, [week, areaId, tab, version]);

  const onSaved = (saved) => setForm((f) => ({ ...f, rows: f.rows.map((r) => (r.restaurant_id === saved.restaurant_id ? saved : r)) }));
  const counts = form ? form.rows.reduce((c, r) => ({ ...c, [r.status]: (c[r.status] || 0) + 1 }), {}) : {};

  return (
    <div>
      <div className="rangebar no-print">
        <div className="rangebar-row">
          <button type="button" className="btn secondary small" onClick={() => setWeek(addDays(week, -7))}>Previous week</button>
          <strong>Week of {prettyDay(week, { month: "long", day: "numeric", year: "numeric" })}</strong>
          <button type="button" className="btn secondary small" onClick={() => setWeek(addDays(week, 7))}>Next week</button>
          <div className="pill-group">
            <button type="button" className={tab === "rollup" ? "active" : ""} onClick={() => setTab("rollup")}>Roll-up</button>
            <button type="button" className={tab === "forms" ? "active" : ""} onClick={() => setTab("forms")}>Store forms</button>
          </div>
          {tab === "forms" && areas.length > 1 && (
            <label>Area <select value={areaId} onChange={(e) => setAreaId(e.target.value)}>{areas.map((a) => <option key={a.area_id} value={a.area_id}>{a.region_name}: {a.area_name} ({a.area_manager})</option>)}</select></label>
          )}
        </div>
        <div className="rangebar-caption">Each restaurant reconciles last year, the recent trend and the system forecast into a projected sales number, then shows the labor schedule fits it. Store forms roll up to area and region.</div>
      </div>

      {error && <div className="alert err">{error.message}</div>}

      {tab === "forms" && (!form ? <Loading /> : (
        <>
          <p className="muted">{form.rows.length} restaurants · {counts.submitted || 0} submitted · {counts.incomplete || 0} incomplete · {counts.missing || 0} not started</p>
          {form.rows.map((row) => <StoreForm key={`${row.restaurant_id}-${row.week_start}`} row={row} guide={form.guide} onSaved={onSaved} />)}
        </>
      ))}

      {tab === "rollup" && (!rollup ? <Loading /> : (
        <>
          <div className="card"><h3>By region</h3><RollupTable rows={rollup.regions} nameLabel="Region" /></div>
          <div className="card"><h3>By area</h3><RollupTable rows={rollup.areas} nameLabel="Area" sub={(r) => `${r.region_name} · ${r.area_manager}`} /></div>
          <div className="grid">
            <div className="card">
              <h3>Missing or incomplete submissions ({rollup.missing.length})</h3>
              {rollup.missing.length === 0 ? <p className="muted">Every restaurant has submitted.</p> : (
                <ul className="plain-list">{rollup.missing.map((m) => <li key={m.restaurant_id}><strong>{m.restaurant_name}</strong> <span className="neutral">{m.area_name} · {m.area_manager}</span> <StatusBadge status={m.status} /></li>)}</ul>
              )}
            </div>
            <div className="card">
              <h3>Outlier flags ({rollup.outliers.length})</h3>
              {rollup.outliers.length === 0 ? <p className="muted">No outliers flagged.</p> : (
                <ul className="plain-list">{rollup.outliers.map((o) => <li key={o.restaurant_id}><strong>{o.restaurant_name}</strong> <span className="neutral">{o.area_name}</span><div className="cell-sub">{o.flags.join(" · ")}</div></li>)}</ul>
              )}
            </div>
          </div>
          <button type="button" className="btn secondary small no-print" onClick={() => setVersion((v) => v + 1)}>Reload roll-up</button>
        </>
      ))}
    </div>
  );
}
