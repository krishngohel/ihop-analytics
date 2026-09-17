import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { fmt$ } from "../format.js";
import { categoryColorFor } from "../chartTheme.js";

export default function CategoryDonut({ data, nameKey = "category" }) {
  if (!data?.length) return <p className="muted">No data yet.</p>;
  return (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie data={data} dataKey="revenue" nameKey={nameKey} innerRadius={55} outerRadius={95} paddingAngle={2} stroke="#fff" strokeWidth={2}>
          {data.map((d) => (
            <Cell key={d[nameKey]} fill={categoryColorFor(d[nameKey])} />
          ))}
        </Pie>
        <Tooltip formatter={(v) => fmt$(v)} contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid var(--border)" }} />
        <Legend layout="vertical" align="right" verticalAlign="middle" iconType="circle" wrapperStyle={{ fontSize: 12, lineHeight: "20px" }} />
      </PieChart>
    </ResponsiveContainer>
  );
}
