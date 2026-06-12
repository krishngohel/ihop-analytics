import { useEffect, useState } from "react";
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, CartesianGrid, Legend
} from "recharts";
import { getJSON } from "./api.js";

const COLORS = ["#1450a3", "#e23744", "#f5a623", "#2e9e5b", "#7b61c4", "#17a2b8", "#8a6d3b"];
const fmt$ = (n) => "$" + Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 });

const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

export default function Dashboard() {
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(daysAgo(0));
  const [topBy, setTopBy] = useState("revenue");
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    const params = { from, to };
    Promise.all([
      getJSON("/api/summary", params),
      getJSON("/api/revenue-trend", params),
      getJSON("/api/top-items", { ...params, by: topBy, limit: 10 }),
      getJSON("/api/categories", params),
      getJSON("/api/dayparts", params)
    ])
      .then(([summary, trend, top, categories, dayparts]) =>
        setData({ summary, trend, top, categories, dayparts }))
      .catch((e) => setErr(e.message));
  }, [from, to, topBy]);

  if (err) return <div className="alert err">Can't reach the API ({err}). Is the server running on port 4000?</div>;
  if (!data) return <p className="muted">Loading…</p>;

  const { summary, trend, top, categories, dayparts } = data;

  return (
    <>
      <div className="filters">
        <label>From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <button className="btn secondary" onClick={() => { setFrom(daysAgo(6)); setTo(daysAgo(0)); }}>7d</button>
        <button className="btn secondary" onClick={() => { setFrom(daysAgo(29)); setTo(daysAgo(0)); }}>30d</button>
        <button className="btn secondary" onClick={() => { setFrom(daysAgo(89)); setTo(daysAgo(0)); }}>90d</button>
      </div>

      <div className="kpis">
        <div className="kpi"><div className="label">Revenue</div><div className="value">{fmt$(summary.revenue)}</div></div>
        <div className="kpi"><div className="label">Orders</div><div className="value">{summary.orders.toLocaleString()}</div></div>
        <div className="kpi"><div className="label">Avg Ticket</div><div className="value">${summary.avgTicket}</div></div>
        <div className="kpi"><div className="label">Top Seller</div><div className="value small">{summary.topItem || "—"}</div></div>
      </div>

      <div className="grid">
        <div className="card wide">
          <h3>Daily Revenue</h3>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={trend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef1f7" />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} minTickGap={28} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={fmt$} width={70} />
              <Tooltip formatter={(v, name) => name === "revenue" ? fmt$(v) : v} />
              <Line type="monotone" dataKey="revenue" stroke="#1450a3" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <h3>
            Top 10 Items{" "}
            <select value={topBy} onChange={(e) => setTopBy(e.target.value)} style={{ float: "right", fontSize: 12 }}>
              <option value="revenue">by revenue</option>
              <option value="quantity">by quantity</option>
            </select>
          </h3>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={top} layout="vertical" margin={{ left: 10 }}>
              <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={topBy === "revenue" ? fmt$ : undefined} />
              <YAxis type="category" dataKey="item" width={170} tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v, name) => name === "revenue" ? fmt$(v) : v} />
              <Bar dataKey={topBy} fill="#e23744" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <h3>Revenue by Category</h3>
          <ResponsiveContainer width="100%" height={320}>
            <PieChart>
              <Pie data={categories} dataKey="revenue" nameKey="category" innerRadius={55} outerRadius={95} paddingAngle={2}>
                {categories.map((c, i) => <Cell key={c.category} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={fmt$} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="card wide">
          <h3>Revenue by Daypart</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={dayparts}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef1f7" />
              <XAxis dataKey="daypart" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={fmt$} width={70} />
              <Tooltip formatter={fmt$} />
              <Bar dataKey="revenue" fill="#1450a3" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </>
  );
}
