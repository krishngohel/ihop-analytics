import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import {
  getStores, getSummary, getTopItems, getCategories, getDayparts,
  getStoreRanking, getOpportunities, getDuty, getRevenue, getEntries,
} from "../api.js";
import { useViewMode } from "../viewMode.jsx";
import { fmt$, fmtPct, fmtNum, deltaClass, daysAgo } from "../format.js";
import { rankByPerformance } from "../rank.js";
import { storeStatus } from "../components/statusRules.js";
import StatusBadge from "../components/StatusBadge.jsx";
import MoneyStat from "../components/MoneyStat.jsx";
import DateRangeControls from "../components/DateRangeControls.jsx";

const SLICE_COLORS = ["#14304d", "#d99a2b", "#4a5c70", "#8a6d3b", "#b3261e"];

export default function StoreZoom() {
  const { id } = useParams();
  const storeId = id;
  const { isDetail } = useViewMode();
  const [from, setFrom] = useState(daysAgo(7));
  const [to, setTo] = useState(daysAgo(1));

  const [stores, setStores] = useState([]);
  const [summary, setSummary] = useState(null);
  const [rankingRow, setRankingRow] = useState(null);
  const [topItems, setTopItems] = useState(null);
  const [categories, setCategories] = useState(null);
  const [dayparts, setDayparts] = useState(null);
  const [opportunities, setOpportunities] = useState(null);
  const [entries, setEntries] = useState(null);
  const [duty, setDuty] = useState(null);
  const [revenueTable, setRevenueTable] = useState(null);
  const [err, setErr] = useState(null);

  const params = { storeId, from, to };

  useEffect(() => { getStores().then(setStores).catch(() => {}); }, []);

  useEffect(() => {
    setErr(null);
    Promise.all([
      getSummary(params),
      getStoreRanking({ from, to }),
      getTopItems({ ...params, by: "revenue", limit: isDetail ? 50 : 5 }),
      getCategories(params),
      getDayparts(params),
      getOpportunities(params),
    ])
      .then(([s, ranking, items, cats, dp, opps]) => {
        setSummary(s);
        const ranked = rankByPerformance(ranking);
        setRankingRow(ranked.find((r) => String(r.storeId) === String(storeId)) || null);
        setTopItems(items);
        setCategories(cats);
        setDayparts(dp);
        setOpportunities(opps);
      })
      .catch((e) => setErr(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId, from, to]);

  useEffect(() => {
    if (!isDetail) return;
    Promise.all([getDuty(params), getRevenue({ ...params, grain: "day" }), getEntries({ storeId })])
      .then(([d, rev, ent]) => { setDuty(d); setRevenueTable(rev); setEntries(ent); })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDetail, storeId, from, to]);

  const store = stores.find((s) => String(s.id) === String(storeId));

  const spikeDays = useMemo(() => {
    if (!revenueTable?.length) return new Map();
    const avg = revenueTable.reduce((a, r) => a + (r.revenue || 0), 0) / revenueTable.length;
    const flagged = new Map();
    for (const r of revenueTable) {
      const day = r.period ?? r.day;
      if (!avg) continue;
      const changeVsAvg = ((r.revenue - avg) / avg) * 100;
      if (Math.abs(changeVsAvg) >= 15) flagged.set(day, changeVsAvg);
    }
    return flagged;
  }, [revenueTable]);

  const dutyByDay = useMemo(() => {
    const map = new Map();
    for (const row of duty || []) map.set(row.duty_date, row.manager_name);
    return map;
  }, [duty]);

  if (err) return <div className="alert err">Can't reach the API ({err}).</div>;

  const status = rankingRow ? storeStatus(rankingRow) : null;

  return (
    <>
      <DateRangeControls from={from} to={to} onFrom={setFrom} onTo={setTo} />

      <div className="page-title-row">
        <h2>{store?.name || `Store ${storeId}`}</h2>
        {status && <StatusBadge tone={status.tone}>{status.label}</StatusBadge>}
      </div>
      {store?.gm_name && <p className="muted">GM: {store.gm_name}{store.monthly_revenue_target ? `, target ${fmt$(store.monthly_revenue_target)}/mo` : ""}</p>}

      <div className="brief-card">
        <p className="verdict">
          {summary && `${store?.name || "This store"}'s revenue is ${fmt$(summary.revenue)}`}
          {rankingRow && typeof rankingRow.vsOwnPrior === "number" && `, ${rankingRow.vsOwnPrior >= 0 ? "up" : "down"} ${Math.abs(rankingRow.vsOwnPrior).toFixed(1)}% vs its own prior period`}
          {rankingRow && typeof rankingRow.vsRegionAvg === "number" && `, ${fmt$(Math.abs(rankingRow.vsRegionAvg))} ${rankingRow.vsRegionAvg >= 0 ? "ahead of" : "behind"} the region average`}
          {rankingRow && typeof rankingRow.vsTarget === "number" && `, ${fmt$(Math.abs(rankingRow.vsTarget))} ${rankingRow.vsTarget >= 0 ? "ahead of" : "behind"} target`}
          {(summary || rankingRow) && "."}
          {rankingRow?.rank && ` Ranked #${rankingRow.rank} of ${rankingRow.outOf} stores by performance.`}
        </p>

        <div className="kpis">
          <MoneyStat label="Revenue" value={summary?.revenue} orders={summary?.orders} units={summary?.units} companionPct={rankingRow?.vsOwnPrior} companionLabel="vs own" />
          <MoneyStat label="Vs region avg" value={rankingRow?.vsRegionAvg} />
          <MoneyStat label="Avg ticket" value={summary?.avgTicket} />
          {isDetail && <MoneyStat label="Comps / voids" value={rankingRow?.comps} companionLabel="leakage" />}
        </div>
      </div>

      <div className="grid">
        <div className="card">
          <h3>Top items</h3>
          {!topItems?.length ? <p className="muted">No sales in this period.</p> : (
            <table className="ledger small">
              <thead><tr><th>Item</th><th>Revenue</th>{isDetail && <th>Qty</th>}</tr></thead>
              <tbody>
                {topItems.map((it) => (
                  <tr key={it.item}><td>{it.item}</td><td className="money">{fmt$(it.revenue)}</td>{isDetail && <td>{fmtNum(it.quantity)}</td>}</tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {isDetail && categories?.length > 0 && categories.length <= 5 && (
          <div className="card">
            <h3>Category mix</h3>
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={categories} dataKey="revenue" nameKey="category" innerRadius={45} outerRadius={85}>
                  {categories.map((c, i) => <Cell key={c.category} fill={SLICE_COLORS[i % SLICE_COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={fmt$} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
        {isDetail && categories?.length > 5 && (
          <div className="card">
            <h3>Category mix</h3>
            <table className="ledger small">
              <thead><tr><th>Category</th><th>Revenue</th></tr></thead>
              <tbody>{categories.map((c) => <tr key={c.category}><td>{c.category}</td><td className="money">{fmt$(c.revenue)}</td></tr>)}</tbody>
            </table>
          </div>
        )}

        {isDetail && (
          <div className="card">
            <h3>Dayparts</h3>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={dayparts}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="daypart" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={fmt$} width={70} />
                <Tooltip formatter={fmt$} />
                <Bar dataKey="revenue" fill="#d99a2b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="card">
        <h3>Opportunities at this store</h3>
        {!opportunities?.length ? <p className="muted">No standout opportunities in this period.</p> : (
          <ul className="opp-list">
            {opportunities.map((o, i) => (
              <li key={i}><span className="money opp-dollar">{fmt$(o.monthlyDollars)}/mo</span><span>{o.sentence}</span></li>
            ))}
          </ul>
        )}
      </div>

      {isDetail && (
        <div className="card">
          <h3>Manager on duty</h3>
          {!revenueTable?.length ? <p className="muted">No daily data yet.</p> : (
            <table className="ledger small">
              <thead><tr><th>Day</th><th>Revenue</th><th>Manager on duty</th></tr></thead>
              <tbody>
                {revenueTable.map((r) => {
                  const day = r.period ?? r.day;
                  const flagged = spikeDays.has(day);
                  return (
                    <tr key={day} className={flagged ? "flagged-row" : ""}>
                      <td>{day}{flagged && <span className="tag attention"> {spikeDays.get(day) >= 0 ? "spike" : "dip"}</span>}</td>
                      <td className="money">{fmt$(r.revenue)}</td>
                      <td>{dutyByDay.get(day) || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {isDetail && (
        <div className="card">
          <div className="card-header">
            <h3>Notes</h3>
            <Link to={`/notes?store=${storeId}`} className="btn secondary small">+ Add note for this store</Link>
          </div>
          {!entries?.length ? <p className="muted">Nothing logged yet.</p> : (
            <table className="ledger small">
              <thead><tr><th>Date</th><th>Type</th><th>Note</th><th>$</th></tr></thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id}><td>{e.entry_date}</td><td><span className="tag">{e.type}</span></td><td>{e.text}</td><td>{e.amount ? fmt$(e.amount) : ""}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </>
  );
}
