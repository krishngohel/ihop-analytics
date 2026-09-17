import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Cell } from "recharts";
import { getOpportunities, getStores } from "../api.js";
import { useViewMode } from "../viewMode.jsx";
import { fmt$, daysAgo } from "../format.js";
import { kindColorFor } from "../chartTheme.js";
import DateRangeControls from "../components/DateRangeControls.jsx";

const KIND_LABEL = {
  item_underindex: "Item under-index",
  local_winner: "Local winner",
  daypart_gap: "Daypart gap",
  category_gap: "Category gap",
};

export default function Opportunities() {
  const { isDetail } = useViewMode();
  const [from, setFrom] = useState(daysAgo(7));
  const [to, setTo] = useState(daysAgo(1));
  const [opportunities, setOpportunities] = useState(null);
  const [stores, setStores] = useState([]);
  const [err, setErr] = useState(null);

  useEffect(() => { getStores().then(setStores).catch(() => {}); }, []);

  useEffect(() => {
    setErr(null);
    getOpportunities({ from, to })
      .then((rows) => setOpportunities([...rows].sort((a, b) => (b.monthlyDollars || 0) - (a.monthlyDollars || 0))))
      .catch((e) => setErr(e.message));
  }, [from, to]);

  const storeName = (storeId) => stores.find((s) => String(s.id) === String(storeId))?.name || storeId;

  if (err) return <div className="alert err">Can't reach the API ({err}).</div>;

  return (
    <>
      <DateRangeControls from={from} to={to} onFrom={setFrom} onTo={setTo} />
      <h2>Opportunities</h2>
      <p className="muted">Ranked by estimated monthly dollar impact. Method: gap vs. peer or prior-period performance. Not a guarantee.</p>

      {!opportunities ? <p className="muted">Loading…</p> : opportunities.length === 0 ? (
        <p className="muted">No standout opportunities in this period.</p>
      ) : (
        <>
        <div className="card">
          <div className="chart-legend" style={{ marginBottom: 4 }}>
            {Object.entries(KIND_LABEL).map(([kind, label]) => (
              <span key={kind}><i style={{ background: kindColorFor(kind) }} />{label}</span>
            ))}
          </div>
          <ResponsiveContainer width="100%" height={Math.min(opportunities.length, 8) * 34 + 20}>
            <BarChart data={opportunities.slice(0, 8)} layout="vertical" margin={{ left: 4, right: 60, top: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
              <XAxis type="number" tickFormatter={fmt$} tick={{ fontSize: 11, fill: "var(--ink-soft)" }} axisLine={{ stroke: "var(--border)" }} tickLine={false} />
              <YAxis type="category" dataKey={(o) => storeName(o.storeId)} width={100} tick={{ fontSize: 12, fill: "var(--ink)" }} axisLine={{ stroke: "var(--border)" }} tickLine={false} />
              <Tooltip content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const o = payload[0].payload;
                return (
                  <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", fontSize: 12, maxWidth: 260 }}>
                    <strong>{fmt$(o.monthlyDollars)}/mo:</strong> {o.sentence}
                  </div>
                );
              }} />
              <Bar dataKey="monthlyDollars" radius={[0, 4, 4, 0]} maxBarSize={20}>
                {opportunities.slice(0, 8).map((o, i) => <Cell key={i} fill={kindColorFor(o.kind)} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <ul className="opp-list detailed">
          {opportunities.map((o, i) => (
            <li key={i} className="card">
              <div className="opp-headline">
                <span className="money opp-dollar">{fmt$(o.monthlyDollars)}/mo</span>
                <span>{o.sentence}</span>
              </div>
              {isDetail && (
                <div className="opp-detail">
                  <span className="tag">{KIND_LABEL[o.kind] || o.kind}</span>
                  {o.periodLabel && <span className="muted"> · {o.periodLabel}</span>}
                  {o.storeId && <Link to={`/stores/${o.storeId}`} className="opp-link">{storeName(o.storeId)}</Link>}
                  {o.detail && <p className="muted opp-math">{o.detail}</p>}
                </div>
              )}
            </li>
          ))}
        </ul>
        </>
      )}
    </>
  );
}
