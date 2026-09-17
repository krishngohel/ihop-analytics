import { LineChart, Line, ResponsiveContainer } from "recharts";

export default function Sparkline({ data, dataKey = "revenue", height = 44 }) {
  if (!data?.length) return null;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data}>
        <Line type="monotone" dataKey={dataKey} stroke="#14304d" strokeWidth={2} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
