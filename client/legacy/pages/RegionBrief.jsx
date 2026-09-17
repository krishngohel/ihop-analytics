import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import {
  getRegionSummary, getStoreRanking, getOpportunities, getRevenue,
  getStoreDayparts, getStoreCategories, getCategories, getRevenueTrend, getDuty,
} from "../api.js";
import { useViewMode } from "../viewMode.jsx";
import { fmt$, fmtPct, fmtNum, deltaClass, daysAgo } from "../format.js";
import { pivotMatrix } from "../pivot.js";
import { rankByPerformance } from "../rank.js";
import { categoryColorFor, daypartColorFor } from "../chartTheme.js";
import { storeStatus } from "../components/statusRules.js";
import StatusBadge from "../components/StatusBadge.jsx";
import MoneyStat from "../components/MoneyStat.jsx";
import Sparkline from "../components/Sparkline.jsx";
import DateRangeControls from "../components/DateRangeControls.jsx";
import StoreBarChart from "../components/StoreBarChart.jsx";
import CategoryDonut from "../components/CategoryDonut.jsx";
import StackedMatrixChart from "../components/StackedMatrixChart.jsx";

function buildVerdict(summary, rankedStores, topOpp) {
  if (!summary) return "Loading region numbers…";
  const bits = [`Region revenue is ${fmt$(summary.revenue)}`];
  if (typeof summary.vsPrior === "number") {
    bits.push(`${summary.vsPrior >= 0 ? "up" : "down"} ${Math.abs(summary.vsPrior).toFixed(1)}% vs the prior period`);
  }
  if (typeof summary.vsTarget === "number" && summary.targetForPeriod) {
    bits.push(`${fmt$(Math.abs(summary.vsTarget))} ${summary.vsTarget >= 0 ? "ahead of" : "behind"} target`);
  }
  let sentence = bits.join(", ") + ".";
  const worst = (rankedStores || [])[rankedStores?.length - 1];
  if (worst && (worst.belowAverage || (worst.vsTarget ?? 0) < 0)) {
    sentence += ` ${worst.name} needs the most attention.`;
  }
  if (topOpp) sentence += ` Biggest opportunity: ${topOpp.sentence}`;
  return sentence;
}

export default function RegionBrief() {
  const { isDetail } = useViewMode();
  const [from, setFrom] = useState(daysAgo(7));
  const [to, setTo] = useState(daysAgo(1));
  const [grain, setGrain] = useState("day");
  const [selectedDay, setSelectedDay] = useState(null);

  const [summary, setSummary] = useState(null);
  const [ranking, setRanking] = useState(null);
  const [opportunities, setOpportunities] = useState(null);
  const [trend, setTrend] = useState(null);
  const [err, setErr] = useState(null);

  const [revenueTable, setRevenueTable] = useState(null);
  const [dayparts, setDayparts] = useState(null);
  const [categories, setCategories] = useState(null);
  const [categoryMix, setCategoryMix] = useState(null);
  const [duty, setDuty] = useState(null);

  const params = { from, to };

  useEffect(() => {
    setErr(null);
    Promise.all([getRegionSummary(params), getStoreRanking(params), getOpportunities(params), getRevenueTrend(params)])
      .then(([s, r, o, t]) => { setSummary(s); setRanking(r); setOpportunities(o); setTrend(t); })
      .catch((e) => setErr(e.message));
    setSelectedDay(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  useEffect(() => {
    if (!isDetail) return;
    Promise.all([
      getRevenue({ ...params, grain }),
      getStoreDayparts(params),
      getStoreCategories(params),
      getCategories(params),
      getDuty(params),
    ])
      .then(([rev, dp, cat, mix, d]) => { setRevenueTable(rev); setDayparts(dp); setCategories(cat); setCategoryMix(mix); setDuty(d); })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDetail, from, to, grain]);

  const topOpportunities = useMemo(() => (opportunities || []).slice(0, isDetail ? 5 : 3), [opportunities, isDetail]);

  const rankedStores = useMemo(() => rankByPerformance(ranking), [ranking]);

  const storeNameById = useMemo(() => {
    const m = new Map();
    for (const r of ranking || []) m.set(r.storeId, r.name);
    return m;
  }, [ranking]);

  const dutyByDay = useMemo(() => {
    const map = new Map();
    for (const row of duty || []) {
      const day = row.duty_date;
      if (!map.has(day)) map.set(day, []);
      map.get(day).push(row);
    }
    return map;
  }, [duty]);

  const withStoreName = (rows) => (rows || []).map((r) => ({ ...r, storeName: storeNameById.get(r.store_id) ?? `Store ${r.store_id}` }));
  const daypartMatrix = useMemo(
    () => pivotMatrix(withStoreName(dayparts), { rowKey: "store_id", rowLabelKey: "storeName", colKey: "daypart", valueKey: "revenue" }),
    [dayparts, storeNameById]
  );
  const categoryMatrix = useMemo(
    () => pivotMatrix(withStoreName(categories), { rowKey: "store_id", rowLabelKey: "storeName", colKey: "category", valueKey: "revenue" }),
    [categories, storeNameById]
  );

  if (err) return <div className="alert err">Can't reach the API ({err}). Is the server running on port 4000?</div>;

  return (
    <>
      <DateRangeControls from={from} to={to} onFrom={setFrom} onTo={setTo} />

      <div className="brief-card">
        <p className="verdict">{buildVerdict(summary, rankedStores, opportunities?.[0])}</p>
        <div className="kpis">
          <MoneyStat label="Net revenue" value={summary?.revenue} companionPct={summary?.vsPrior} companionLabel="vs prior" orders={summary?.orders} units={summary?.units} />
          <MoneyStat label="Vs target" value={summary?.vsTarget} />
          <MoneyStat label="Top opportunity" value={opportunities?.[0]?.monthlyDollars} companionLabel="est. monthly" />
          {isDetail && <MoneyStat label="Comps / voids" value={summary?.leakage} companionLabel="leakage" />}
          {isDetail && <MoneyStat label="Avg ticket" value={summary?.avgTicket} />}
        </div>
      </div>

      {!isDetail && trend && (
        <div className="card">
          <h3>Revenue trend</h3>
          <Sparkline data={trend} />
        </div>
      )}

      <div className="card">
        <div className="card-header">
          <h3>Store ledger</h3>
        </div>
        <p className="muted" style={{ marginTop: -6, marginBottom: 12 }}>Ranked by performance against each store's own target, not raw revenue size.</p>
        {!ranking ? <p className="muted">Loading…</p> : <StoreBarChart data={rankedStores} compact={!isDetail} />}
        {!ranking ? null : (
          <table className="ledger">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Store</th>
                <th>Revenue</th>
                {isDetail && <>
                  <th>Gross</th>
                  <th>Comps</th>
                  <th>Orders</th>
                  <th>Units</th>
                  <th>Ticket</th>
                  <th>Vs region avg</th>
                </>}
                <th>Vs own</th>
                <th>Vs target</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rankedStores.map((row) => {
                const status = storeStatus(row);
                return (
                  <tr key={row.storeId}>
                    <td className="money">{row.rank}</td>
                    <td><Link to={`/stores/${row.storeId}`}>{row.name}</Link></td>
                    <td className="money">{fmt$(row.revenue)}</td>
                    {isDetail && <>
                      <td className="money">{fmt$(row.gross)}</td>
                      <td className="money">{fmt$(row.comps)}</td>
                      <td>{fmtNum(row.orders)}</td>
                      <td>{fmtNum(row.units)}</td>
                      <td className="money">{fmt$(row.avgTicket)}</td>
                      <td className={deltaClass(row.vsRegionAvg)}>{fmt$(row.vsRegionAvg)}</td>
                    </>}
                    <td className={deltaClass(row.vsOwnPrior)}>{fmtPct(row.vsOwnPrior)}</td>
                    <td className={deltaClass(row.vsTarget)}>{fmt$(row.vsTarget)}</td>
                    <td><StatusBadge tone={status.tone}>{status.label}</StatusBadge></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3>Top opportunities</h3>
        {!topOpportunities?.length ? <p className="muted">No standout opportunities in this period.</p> : (
          <ul className="opp-list">
            {topOpportunities.map((o, i) => (
              <li key={i}>
                <span className="money opp-dollar">{fmt$(o.monthlyDollars)}/mo</span>
                <span>{o.sentence}</span>
                {o.storeId && <Link to={`/stores/${o.storeId}`} className="opp-link">View store</Link>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {isDetail && (
        <>
          <div className="card">
            <div className="card-header">
              <h3>Revenue by {grain}</h3>
              <div className="grain-toggle no-print">
                {["day", "week", "month"].map((g) => (
                  <button key={g} type="button" className={grain === g ? "active" : ""} onClick={() => setGrain(g)}>{g}</button>
                ))}
              </div>
            </div>
            {!revenueTable ? <p className="muted">Loading…</p> : (
              <table className="ledger">
                <thead><tr><th>{grain}</th><th>Revenue</th><th>Orders</th><th>Units</th></tr></thead>
                <tbody>
                  {revenueTable.map((r, i) => (
                    <tr key={i}><td>{r.period ?? r.day ?? r.week ?? r.month}</td><td className="money">{fmt$(r.revenue)}</td><td>{fmtNum(r.orders)}</td><td>{fmtNum(r.units)}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="card">
            <h3>Revenue trend</h3>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={trend} onClick={(e) => e?.activeLabel && setSelectedDay(e.activeLabel)}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} minTickGap={28} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={fmt$} width={70} />
                <Tooltip formatter={(v, name) => (name === "revenue" ? fmt$(v) : v)} />
                <Line type="monotone" dataKey="revenue" stroke="#14304d" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
            {selectedDay && (
              <div className="duty-popover">
                <strong>Managers on duty for {selectedDay}:</strong>{" "}
                {(dutyByDay.get(selectedDay) || []).map((d) => `${storeNameById.get(d.store_id) ?? `Store ${d.store_id}`}: ${d.manager_name}`).join(" · ") || "no data logged"}
              </div>
            )}
          </div>

          <div className="grid">
            <div className="card">
              <h3>Region category mix</h3>
              <CategoryDonut data={categoryMix} />
            </div>
            <div className="card">
              <h3>Store × Daypart</h3>
              <StackedMatrixChart matrix={daypartMatrix} colorFor={daypartColorFor} />
              <MatrixTable matrix={daypartMatrix} />
            </div>
          </div>
          <div className="card">
            <h3>Store × Category</h3>
            <StackedMatrixChart matrix={categoryMatrix} colorFor={categoryColorFor} />
            <MatrixTable matrix={categoryMatrix} />
          </div>
        </>
      )}
    </>
  );
}

function MatrixTable({ matrix }) {
  if (!matrix?.rows?.length) return <p className="muted">No data yet.</p>;
  return (
    <table className="ledger small">
      <thead><tr><th>Store</th>{matrix.cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
      <tbody>
        {matrix.rows.map((r) => (
          <tr key={r.id}>
            <td>{r.label}</td>
            {matrix.cols.map((c) => <td key={c} className="money">{fmt$(r.values[c] || 0)}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
