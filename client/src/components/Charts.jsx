import { ResponsiveContainer, LineChart, Line, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, LabelList } from "recharts";
import { fmt$, fmtPct, fmtNum, prettyDay } from "../format.js";

// Categorical slots validated with the dataviz palette validator (light surface): fixed
// order, never cycled. Color follows the series, so "Actual" is always blue.
export const SERIES = { actual: "#2a78d6", forecast: "#eb6834", lastYear: "#1baf7a" };
// Status colors mirror the badges (App.css .status-badge.tone-*), so red means the same thing everywhere.
export const STATUS = { good: "#1e6b3c", bad: "#b3261e" };

const AXIS = { fontSize: 11, fill: "#4a5c70" };
const shortDay = (d) => prettyDay(d, { month: "short", day: "numeric" });

function Legend({ items }) {
  return <div className="chart-legend">{items.map((i) => <span key={i.label}><i style={{ background: i.color, ...(i.dashed ? { backgroundImage: "repeating-linear-gradient(90deg,#fff 0 3px,transparent 3px 6px)" } : {}) }} />{i.label}</span>)}</div>;
}

/** Daily sales: actual against forecast and last year. One axis, dollars. */
export function SalesTrend({ data, height = 260 }) {
  if (!data?.length) return null;
  return (
    <>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="#e7e0d2" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="date" tick={AXIS} tickFormatter={shortDay} minTickGap={32} tickLine={false} axisLine={{ stroke: "#e7e0d2" }} />
          <YAxis tick={AXIS} tickFormatter={(v) => (v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : `$${Math.round(v / 1000)}k`)} width={58} tickLine={false} axisLine={false} domain={["auto", "auto"]} />
          <Tooltip formatter={(v, name) => [fmt$(v), name]} labelFormatter={(d) => prettyDay(d, { weekday: "long", month: "long", day: "numeric" })} />
          <Line name="Last year" type="monotone" dataKey="prior_year_sales" stroke={SERIES.lastYear} strokeWidth={2} dot={false} isAnimationActive={false} />
          <Line name="Forecast" type="monotone" dataKey="forecast_sales" stroke={SERIES.forecast} strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
          <Line name="Actual" type="monotone" dataKey="actual_sales" stroke={SERIES.actual} strokeWidth={2.5} dot={data.length <= 31 ? { r: 3 } : false} activeDot={{ r: 5 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
      <Legend items={[{ label: "Actual", color: SERIES.actual }, { label: "Forecast", color: SERIES.forecast, dashed: true }, { label: "Last year", color: SERIES.lastYear }]} />
    </>
  );
}

/** Labor hours against allowable, its own chart so hours never share an axis with dollars. */
export function LaborTrend({ data, height = 220 }) {
  if (!data?.length) return null;
  return (
    <>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="#e7e0d2" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="date" tick={AXIS} tickFormatter={shortDay} minTickGap={32} tickLine={false} axisLine={{ stroke: "#e7e0d2" }} />
          <YAxis tick={AXIS} tickFormatter={(v) => fmtNum(v)} width={58} tickLine={false} axisLine={false} domain={["auto", "auto"]} />
          <Tooltip formatter={(v, name) => [`${fmtNum(v)} hrs`, name]} labelFormatter={(d) => prettyDay(d, { weekday: "long", month: "long", day: "numeric" })} />
          <Line name="Allowable hours" type="monotone" dataKey="allowable_labor_hours" stroke={SERIES.forecast} strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
          <Line name="Actual hours" type="monotone" dataKey="actual_labor_hours" stroke={SERIES.actual} strokeWidth={2.5} dot={data.length <= 31 ? { r: 3 } : false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
      <Legend items={[{ label: "Actual hours", color: SERIES.actual }, { label: "Allowable hours", color: SERIES.forecast, dashed: true }]} />
    </>
  );
}

// Value label just past the end of the bar: right of positive bars, left of negative ones.
function EndLabel({ x, y, width, height, value }) {
  if (value === null || value === undefined) return null;
  const negative = value < 0;
  const end = negative ? Math.min(x, x + width) - 5 : Math.max(x, x + width) + 5;
  return <text x={end} y={y + height / 2} dy={4} textAnchor={negative ? "end" : "start"} fontSize={11} fill="#14304d">{fmtPct(value)}</text>;
}

// Leave room past the longest bar on each side for its label.
const padDomain = [(min) => Math.min(0, Math.floor(min * 1.35 - 0.5)), (max) => Math.max(0, Math.ceil(max * 1.35 + 0.5))];

/**
 * Variance bars around a zero line. `goodWhenPositive` is true for sales and false for
 * labor, where running above allowable is the miss. Every bar carries its value.
 */
export function VarianceBars({ data, dataKey, goodWhenPositive = true, onSelect, height }) {
  if (!data?.length) return null;
  // Restaurant names all start "IHOP "; drop it on the axis so the label fits one line.
  const rows = data.filter((d) => d[dataKey] !== null && d[dataKey] !== undefined).map((d) => ({ ...d, label: String(d.name).replace(/^IHOP /, "") }));
  const h =height || Math.max(140, rows.length * 34 + 30);
  const color = (v) => ((v >= 0) === goodWhenPositive ? STATUS.good : STATUS.bad);
  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 56, bottom: 0, left: 8 }} barCategoryGap={6}>
        <CartesianGrid stroke="#e7e0d2" strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" domain={padDomain} tick={AXIS} tickFormatter={(v) => `${v}%`} tickLine={false} axisLine={false} />
        <YAxis type="category" dataKey="label" tick={AXIS} width={128} tickLine={false} axisLine={false} interval={0} />
        <Tooltip cursor={{ fill: "rgba(20,48,77,.05)" }} formatter={(v) => [fmtPct(v), goodWhenPositive ? "Sales vs. forecast" : "Labor vs. allowable"]} />
        <ReferenceLine x={0} stroke="#4a5c70" />
        <Bar dataKey={dataKey} radius={4} isAnimationActive={false} onClick={(d) => onSelect && onSelect(d)} cursor={onSelect ? "pointer" : "default"}>
          {rows.map((r) => <Cell key={r.id ?? r.name} fill={color(r[dataKey])} />)}
          <LabelList dataKey={dataKey} content={<EndLabel />} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
