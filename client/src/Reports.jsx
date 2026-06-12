import { useState } from "react";
import { getJSON } from "./api.js";

const fmt$ = (n) => "$" + Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
const iso = (d) => d.toISOString().slice(0, 10);

function presetRange(preset) {
  const now = new Date();
  const dow = (now.getDay() + 6) % 7; // Monday = 0
  if (preset === "thisWeek") {
    const start = new Date(now); start.setDate(now.getDate() - dow);
    return [iso(start), iso(now)];
  }
  if (preset === "lastWeek") {
    const end = new Date(now); end.setDate(now.getDate() - dow - 1);
    const start = new Date(end); start.setDate(end.getDate() - 6);
    return [iso(start), iso(end)];
  }
  if (preset === "thisMonth") {
    return [iso(new Date(now.getFullYear(), now.getMonth(), 1, 12)), iso(now)];
  }
  if (preset === "lastMonth") {
    return [iso(new Date(now.getFullYear(), now.getMonth() - 1, 1, 12)),
            iso(new Date(now.getFullYear(), now.getMonth(), 0, 12))];
  }
  return null;
}

const Delta = ({ v }) => {
  if (v === null || v === undefined) return <span className="muted">-</span>;
  const up = v >= 0;
  return <span style={{ color: up ? "#1e7c3c" : "#b3261e", fontWeight: 600 }}>{up ? "+" : ""}{v}%</span>;
};

export default function Reports() {
  const [preset, setPreset] = useState("lastWeek");
  const [custom, setCustom] = useState({ from: "", to: "" });
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function generate() {
    let from, to;
    if (preset === "custom") {
      if (!custom.from || !custom.to) { setErr("Pick both dates for a custom range."); return; }
      from = custom.from; to = custom.to;
    } else {
      [from, to] = presetRange(preset);
    }
    setBusy(true); setErr(null);
    try {
      setReport(await getJSON("/api/report", { from, to }));
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  const k = report?.kpis;

  return (
    <>
      <div className="filters no-print">
        <select value={preset} onChange={(e) => setPreset(e.target.value)}>
          <option value="thisWeek">This week</option>
          <option value="lastWeek">Last week</option>
          <option value="thisMonth">This month</option>
          <option value="lastMonth">Last month</option>
          <option value="custom">Custom range</option>
        </select>
        {preset === "custom" && (
          <>
            <input type="date" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
            <input type="date" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
          </>
        )}
        <button className="btn" onClick={generate} disabled={busy}>{busy ? "Generating..." : "Generate Report"}</button>
        {report && <button className="btn secondary" onClick={() => window.print()}>Print / Save PDF</button>}
      </div>
      {err && <div className="alert err no-print">{err}</div>}

      {report && (
        <div className="report card">
          <h2 style={{ marginTop: 0 }}>IHOP Sales Report</h2>
          <p className="muted">
            {report.period.from} to {report.period.to} ({report.period.days} days)
            &middot; compared with {report.prior.from} to {report.prior.to}
            &middot; generated {report.generatedAt.slice(0, 10)}
          </p>

          <h3>Highlights</h3>
          <ul>
            {report.highlights.map((h, i) => <li key={i}>{h}</li>)}
          </ul>

          <h3>Key Numbers</h3>
          <table className="entries">
            <thead><tr><th>Metric</th><th>This period</th><th>Prior period</th><th>Change</th></tr></thead>
            <tbody>
              <tr><td>Revenue</td><td>{fmt$(k.revenue.value)}</td><td>{fmt$(k.revenue.prior)}</td><td><Delta v={k.revenue.change} /></td></tr>
              <tr><td>Orders</td><td>{k.orders.value.toLocaleString()}</td><td>{k.orders.prior.toLocaleString()}</td><td><Delta v={k.orders.change} /></td></tr>
              <tr><td>Avg ticket</td><td>${k.avgTicket.value}</td><td>${k.avgTicket.prior}</td><td><Delta v={k.avgTicket.change} /></td></tr>
              <tr><td>Items sold</td><td>{k.units.value.toLocaleString()}</td><td>{k.units.prior.toLocaleString()}</td><td><Delta v={k.units.change} /></td></tr>
            </tbody>
          </table>

          <h3>Top 10 Items</h3>
          <table className="entries">
            <thead><tr><th>Item</th><th>Revenue</th><th>Qty</th><th>vs prior</th></tr></thead>
            <tbody>
              {report.topItems.map((i) => (
                <tr key={i.key}><td>{i.key}</td><td>{fmt$(i.revenue)}</td><td>{i.quantity}</td><td><Delta v={i.change} /></td></tr>
              ))}
            </tbody>
          </table>

          {report.decliners.length > 0 && (
            <>
              <h3>Needs Attention (down &gt;15%)</h3>
              <table className="entries">
                <thead><tr><th>Item</th><th>Revenue</th><th>vs prior</th></tr></thead>
                <tbody>
                  {report.decliners.map((i) => (
                    <tr key={i.key}><td>{i.key}</td><td>{fmt$(i.revenue)}</td><td><Delta v={i.change} /></td></tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <h3>Categories</h3>
          <table className="entries">
            <thead><tr><th>Category</th><th>Revenue</th><th>Qty</th><th>vs prior</th></tr></thead>
            <tbody>
              {report.categories.map((c) => (
                <tr key={c.key}><td>{c.key}</td><td>{fmt$(c.revenue)}</td><td>{c.quantity}</td><td><Delta v={c.change} /></td></tr>
              ))}
            </tbody>
          </table>

          <h3>Dayparts</h3>
          <table className="entries">
            <thead><tr><th>Daypart</th><th>Revenue</th><th>Qty</th><th>vs prior</th></tr></thead>
            <tbody>
              {report.dayparts.map((d) => (
                <tr key={d.key}><td>{d.key}</td><td>{fmt$(d.revenue)}</td><td>{d.quantity}</td><td><Delta v={d.change} /></td></tr>
              ))}
            </tbody>
          </table>

          {report.entries.length > 0 && (
            <>
              <h3>Staff Observations This Period</h3>
              <table className="entries">
                <thead><tr><th>Date</th><th>Type</th><th>Note</th><th>$</th></tr></thead>
                <tbody>
                  {report.entries.map((e, i) => (
                    <tr key={i}><td>{e.entry_date}</td><td><span className="tag">{e.type}</span></td><td>{e.text}</td><td>{e.amount ? `$${e.amount}` : ""}</td></tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
      {!report && !err && <p className="muted">Pick a period and click Generate Report.</p>}
    </>
  );
}
