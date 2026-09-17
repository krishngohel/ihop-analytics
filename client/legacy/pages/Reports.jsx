import { useState, useEffect } from "react";
import { useViewMode } from "../viewMode.jsx";
import { getStores, getReport } from "../api.js";
import { fmt$, fmtNum } from "../format.js";
import { rankByPerformance } from "../rank.js";
import StoreBarChart from "../components/StoreBarChart.jsx";
import { storeStatus } from "../components/statusRules.js";

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
  return <span className={up ? "positive" : "negative"}>{up ? "+" : ""}{v}%</span>;
};

const DollarDelta = ({ v }) => {
  if (v === null || v === undefined) return <span className="muted">-</span>;
  return <span className={v >= 0 ? "positive" : "negative"}>{fmt$(v)}</span>;
};

export default function Reports() {
  const { isDetail } = useViewMode();
  const [scope, setScope] = useState("region");
  const [stores, setStores] = useState([]);
  const [storeId, setStoreId] = useState("");
  const [preset, setPreset] = useState("lastWeek");
  const [custom, setCustom] = useState({ from: "", to: "" });
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => { getStores().then((s) => { setStores(s); if (s[0]) setStoreId(String(s[0].id)); }).catch(() => {}); }, []);

  async function generate() {
    let from, to;
    if (preset === "custom") {
      if (!custom.from || !custom.to) { setErr("Pick both dates for a custom range."); return; }
      from = custom.from; to = custom.to;
    } else {
      [from, to] = presetRange(preset);
    }
    if (scope === "store" && !storeId) { setErr("Pick a store first."); return; }
    setBusy(true); setErr(null);
    try {
      setReport(await getReport({ scope, storeId: scope === "store" ? storeId : undefined, from, to }));
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
        <div className="scope-toggle">
          <button type="button" className={scope === "region" ? "active" : ""} onClick={() => { setScope("region"); setReport(null); }}>Leadership (region)</button>
          <button type="button" className={scope === "store" ? "active" : ""} onClick={() => { setScope("store"); setReport(null); }}>Store ops</button>
        </div>
        {scope === "store" && (
          <select value={storeId} onChange={(e) => setStoreId(e.target.value)}>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
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
        <button className="btn" onClick={generate} disabled={busy}>{busy ? "Generating..." : "Generate report"}</button>
        {report && <button className="btn secondary" onClick={() => window.print()}>Print / Save PDF</button>}
      </div>
      {err && <div className="alert err no-print">{err}</div>}

      {report && scope === "region" && <LeadershipReport report={report} />}
      {report && scope === "store" && <StoreReport report={report} k={k} />}
      {!report && !err && <p className="muted">Pick a period and click Generate report.</p>}
    </>
  );
}

function LeadershipReport({ report }) {
  const rk = report.kpis || {};
  const storeTable = report.storeTable || [];
  const rankedStores = rankByPerformance(storeTable);
  const findings = report.topOpportunities || [];
  return (
    <div className="report leadership card">
      <h2 style={{ marginTop: 0 }}>Region Performance Report</h2>
      <p className="muted">
        Covers {report.period?.from} to {report.period?.to} ({report.period?.days} days){report.prior && <> against {report.prior.from} to {report.prior.to} before it</>}. Generated {report.generatedAt?.slice(0, 10)}.
      </p>

      {report.highlights?.length > 0 && (
        <>
          <h3>Highlights</h3>
          <ul>{report.highlights.map((h, i) => <li key={i}>{h}</li>)}</ul>
        </>
      )}

      <h3>Region numbers</h3>
      <table className="entries">
        <thead><tr><th>Metric</th><th>Value</th><th>vs prior</th></tr></thead>
        <tbody>
          <tr><td>Net revenue</td><td>{fmt$(rk.revenue?.value)}</td><td><Delta v={rk.revenue?.change} /></td></tr>
          <tr><td>Gross revenue</td><td>{fmt$(rk.gross?.value)}</td><td>—</td></tr>
          <tr><td>Comps / voids / discounts</td><td>{fmt$(rk.leakage?.value)}</td><td>—</td></tr>
          <tr><td>Orders</td><td>{fmtNum(rk.orders?.value)}</td><td><Delta v={rk.orders?.change} /></td></tr>
          <tr><td>Avg ticket</td><td>{fmt$(rk.avgTicket?.value)}</td><td>—</td></tr>
          {report.targetForPeriod ? (
            <tr><td>Vs sum of store targets ({fmt$(report.targetForPeriod)})</td><td colSpan={2}><DollarDelta v={report.vsTarget} /></td></tr>
          ) : null}
        </tbody>
      </table>

      <h3>Revenue by store</h3>
      <p className="muted">Ranked by performance against each store's own target, not raw revenue size.</p>
      <StoreBarChart data={rankedStores} />
      <table className="entries">
        <thead><tr><th>Rank</th><th>Store</th><th>Revenue</th><th>Vs own prior</th><th>Vs target</th><th>Status</th></tr></thead>
        <tbody>
          {rankedStores.map((s) => (
            <tr key={s.storeId ?? s.name}>
              <td>{s.rank}</td>
              <td>{s.name}</td>
              <td>{fmt$(s.revenue)}</td>
              <td><Delta v={s.vsOwnPrior} /></td>
              <td><DollarDelta v={s.vsTarget} /></td>
              <td>{storeStatus(s).label}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {findings.length > 0 && (
        <>
          <h3>Top dollar findings</h3>
          <ul>{findings.slice(0, 5).map((f, i) => <li key={i}>{fmt$(f.monthlyDollars)}/mo: {f.sentence}</li>)}</ul>
        </>
      )}

      {(report.bestStore || report.worstStore) && (
        <>
          <h3>Best / worst performing stores</h3>
          <ul>
            {report.bestStore && <li>Best: {report.bestStore.name} (<Delta v={report.bestStore.vsOwnPrior} /> same-store growth)</li>}
            {report.worstStore && <li>Needs attention: {report.worstStore.name} (<Delta v={report.worstStore.vsOwnPrior} /> same-store growth)</li>}
          </ul>
        </>
      )}

      {(report.bestDay || report.worstDay) && (
        <div className="detail-only">
          <h3>Manager on duty, best/worst days</h3>
          <ul>
            {report.bestDay && <li>Best day {report.bestDay.day} ({fmt$(report.bestDay.revenue)}): {(report.bestDay.duty || []).map((d) => `${d.storeName}: ${d.managerName}`).join(", ") || "—"}</li>}
            {report.worstDay && <li>Worst day {report.worstDay.day} ({fmt$(report.worstDay.revenue)}): {(report.worstDay.duty || []).map((d) => `${d.storeName}: ${d.managerName}`).join(", ") || "—"}</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

function StoreReport({ report, k }) {
  return (
    <div className="report card">
      <h2 style={{ marginTop: 0 }}>{report.storeName ? `${report.storeName} Store Report` : "Store Report"}</h2>
      <p className="muted">
        Covers {report.period.from} to {report.period.to} ({report.period.days} days) against {report.prior.from} to {report.prior.to} before it. Generated {report.generatedAt.slice(0, 10)}.
      </p>

      <h3>Highlights</h3>
      <ul>{report.highlights.map((h, i) => <li key={i}>{h}</li>)}</ul>

      <h3>Key numbers</h3>
      <table className="entries">
        <thead><tr><th>Metric</th><th>This period</th><th>Prior period</th><th>Change</th></tr></thead>
        <tbody>
          <tr><td>Revenue</td><td>{fmt$(k.revenue.value)}</td><td>{fmt$(k.revenue.prior)}</td><td><Delta v={k.revenue.change} /></td></tr>
          <tr><td>Orders</td><td>{fmtNum(k.orders.value)}</td><td>{fmtNum(k.orders.prior)}</td><td><Delta v={k.orders.change} /></td></tr>
          <tr><td>Avg ticket</td><td>{fmt$(k.avgTicket.value)}</td><td>{fmt$(k.avgTicket.prior)}</td><td><Delta v={k.avgTicket.change} /></td></tr>
          <tr><td>Items sold</td><td>{fmtNum(k.units.value)}</td><td>{fmtNum(k.units.prior)}</td><td><Delta v={k.units.change} /></td></tr>
          {k.leakage && <tr><td>Comps / voids</td><td>{fmt$(k.leakage.value)}</td><td>—</td><td>—</td></tr>}
          {report.vsRegionAvg != null && <tr><td>Vs region average</td><td colSpan={2}>&nbsp;</td><td><DollarDelta v={report.vsRegionAvg} /></td></tr>}
          {report.vsTarget != null && <tr><td>Vs target</td><td colSpan={2}>&nbsp;</td><td><DollarDelta v={report.vsTarget} /></td></tr>}
        </tbody>
      </table>

      <h3>Top 10 items</h3>
      <table className="entries">
        <thead><tr><th>Item</th><th>Revenue</th><th>Qty</th><th>vs prior</th></tr></thead>
        <tbody>{report.topItems.map((i) => <tr key={i.key}><td>{i.key}</td><td>{fmt$(i.revenue)}</td><td>{i.quantity}</td><td><Delta v={i.change} /></td></tr>)}</tbody>
      </table>

      {report.decliners.length > 0 && (
        <>
          <h3>Needs attention (down &gt;15%)</h3>
          <table className="entries">
            <thead><tr><th>Item</th><th>Revenue</th><th>vs prior</th></tr></thead>
            <tbody>{report.decliners.map((i) => <tr key={i.key}><td>{i.key}</td><td>{fmt$(i.revenue)}</td><td><Delta v={i.change} /></td></tr>)}</tbody>
          </table>
        </>
      )}

      <h3>Categories</h3>
      <table className="entries">
        <thead><tr><th>Category</th><th>Revenue</th><th>Qty</th><th>vs prior</th></tr></thead>
        <tbody>{report.categories.map((c) => <tr key={c.key}><td>{c.key}</td><td>{fmt$(c.revenue)}</td><td>{c.quantity}</td><td><Delta v={c.change} /></td></tr>)}</tbody>
      </table>

      <h3>Dayparts</h3>
      <table className="entries">
        <thead><tr><th>Daypart</th><th>Revenue</th><th>Qty</th><th>vs prior</th></tr></thead>
        <tbody>{report.dayparts.map((d) => <tr key={d.key}><td>{d.key}</td><td>{fmt$(d.revenue)}</td><td>{d.quantity}</td><td><Delta v={d.change} /></td></tr>)}</tbody>
      </table>

      {(report.bestDay || report.worstDay) && (
        <>
          <h3>Manager on duty, best/worst days</h3>
          <ul>
            {report.bestDay && <li>Best day {report.bestDay.day} ({fmt$(report.bestDay.revenue)}){report.bestDay.manager ? `: ${report.bestDay.manager}` : ""}</li>}
            {report.worstDay && <li>Worst day {report.worstDay.day} ({fmt$(report.worstDay.revenue)}){report.worstDay.manager ? `: ${report.worstDay.manager}` : ""}</li>}
          </ul>
        </>
      )}

      {report.entries.length > 0 && (
        <>
          <h3>Staff observations this period</h3>
          <table className="entries">
            <thead><tr><th>Date</th><th>Type</th><th>Note</th><th>$</th></tr></thead>
            <tbody>{report.entries.map((e, i) => <tr key={i}><td>{e.entry_date}</td><td><span className="tag">{e.type}</span></td><td>{e.text}</td><td>{e.amount ? fmt$(e.amount) : ""}</td></tr>)}</tbody>
          </table>
        </>
      )}
    </div>
  );
}
