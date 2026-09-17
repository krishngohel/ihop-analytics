import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Cell } from "recharts";
import { fmt$ } from "../format.js";
import { storeStatus } from "./statusRules.js";
import { statusColor, STATUS_COLORS } from "../chartTheme.js";

const LEGEND = [
  { tone: "ok", label: "On track" },
  { tone: "watch", label: "Below avg" },
  { tone: "attention", label: "Missing target" },
];

// Renders rows in whatever order the caller passes them — it does not re-sort by
// revenue, so a chart placed above a performance-ranked table stays consistent
// with it rather than silently telling a different story.
export default function StoreBarChart({ data, compact = false }) {
  if (!data?.length) return null;
  return (
    <div>
      <ResponsiveContainer width="100%" height={compact ? 34 * data.length + 20 : 40 * data.length + 24}>
        <BarChart data={data} layout="vertical" margin={{ left: 4, right: 28, top: 4, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
          <XAxis type="number" tickFormatter={fmt$} tick={{ fontSize: 11, fill: "var(--ink-soft)" }} axisLine={{ stroke: "var(--border)" }} tickLine={false} />
          <YAxis type="category" dataKey="name" width={compact ? 78 : 104} tick={{ fontSize: 12, fill: "var(--ink)" }} axisLine={{ stroke: "var(--border)" }} tickLine={false} />
          <Tooltip formatter={(v) => fmt$(v)} contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid var(--border)" }} />
          <Bar dataKey="revenue" radius={[0, 4, 4, 0]} maxBarSize={compact ? 16 : 20}>
            {data.map((row) => (
              <Cell key={row.storeId ?? row.name} fill={statusColor(storeStatus(row))} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="chart-legend">
        {LEGEND.map((l) => (
          <span key={l.tone}><i style={{ background: STATUS_COLORS[l.tone] }} />{l.label}</span>
        ))}
      </div>
    </div>
  );
}
