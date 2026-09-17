import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ResponsiveContainer } from "recharts";
import { fmt$ } from "../format.js";

export default function StackedMatrixChart({ matrix, colorFor, height }) {
  if (!matrix?.rows?.length) return <p className="muted">No data yet.</p>;
  const chartData = matrix.rows.map((r) => ({ label: r.label, ...r.values }));
  return (
    <ResponsiveContainer width="100%" height={height ?? 44 * matrix.rows.length + 60}>
      <BarChart data={chartData} layout="vertical" margin={{ left: 4, right: 16, top: 4, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
        <XAxis type="number" tickFormatter={fmt$} tick={{ fontSize: 11, fill: "var(--ink-soft)" }} axisLine={{ stroke: "var(--border)" }} tickLine={false} />
        <YAxis type="category" dataKey="label" width={90} tick={{ fontSize: 12, fill: "var(--ink)" }} axisLine={{ stroke: "var(--border)" }} tickLine={false} />
        <Tooltip formatter={(v) => fmt$(v)} contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid var(--border)" }} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {matrix.cols.map((col, i) => (
          <Bar
            key={col}
            dataKey={col}
            stackId="mix"
            fill={colorFor(col)}
            stroke="#fff"
            strokeWidth={1}
            radius={i === matrix.cols.length - 1 ? [0, 4, 4, 0] : i === 0 ? [4, 0, 0, 4] : undefined}
            maxBarSize={22}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
