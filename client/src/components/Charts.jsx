import { useState } from "react";
import { ResponsiveContainer, ComposedChart, Area, Line, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, LabelList } from "recharts";
import { fmt$, fmtPct, fmtNum, prettyDay } from "../format.js";

// Colors come from CSS custom properties (App.css) so every chart follows the light or dark
// theme. The categorical slots were validated with the dataviz palette validator on both
// surfaces: fixed order, never cycled. Color follows the series, so "Actual" is always blue.
export const SERIES = { actual: "var(--series-1)", forecast: "var(--series-2)", lastYear: "var(--series-3)" };
// Status colors mirror the badges, so red means the same thing everywhere.
export const STATUS = { good: "var(--good-mark)", bad: "var(--bad-mark)" };

const AXIS = { fontSize: 11, fill: "var(--text-3)" };
const shortDay = (d) => prettyDay(d, { month: "short", day: "numeric" });
const longDay = (d) => prettyDay(d, { weekday: "long", month: "long", day: "numeric" });
const dollarsTick = (v) => (Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : `$${Math.round(v / 1000)}k`);

function Legend({ items }) {
  return <div className="chart-legend">{items.map((i) => <span key={i.label}><i className={i.dashed ? "dashed" : ""} style={{ borderTopColor: i.color }} />{i.label}</span>)}</div>;
}

function Tip({ active, payload, label, title, format }) {
  if (!active || !payload?.length) return null;
  // The area and the line for "Actual" share a data key; show it once.
  const seen = new Set();
  const rows = payload.filter((p) => p.value !== null && p.value !== undefined && !seen.has(p.dataKey) && seen.add(p.dataKey));
  return (
    <div className="chart-tip">
      <div className="chart-tip-title">{title ? title(label, payload) : label}</div>
      {rows.map((p) => <div key={p.dataKey} className="chart-tip-row"><i style={{ background: p.payload?.__color || p.color || p.stroke }} />{p.name}<b>{format(p.value)}</b></div>)}
    </div>
  );
}

/**
 * A time-series card body: legend and a chart / table switch above the plot. The table is
 * the same data as text, for anyone who would rather read the numbers than hover for them.
 */
function Trend({ data, series, format, tick, height }) {
  const [asTable, setAsTable] = useState(false);
  if (!data?.length) return null;
  return (
    <>
      <div className="card-header">
        <Legend items={series.map((s) => ({ label: s.name, color: s.color, dashed: s.dashed }))} />
        <div className="pill-group" role="group" aria-label="View">
          <button type="button" className={asTable ? "" : "active"} onClick={() => setAsTable(false)}>Chart</button>
          <button type="button" className={asTable ? "active" : ""} onClick={() => setAsTable(true)}>Table</button>
        </div>
      </div>
      {asTable ? (
        <div className="table-scroll tall" style={{ maxHeight: height }}>
          <table className="ledger small">
            <thead><tr><th>Day</th>{series.map((s) => <th key={s.key} className="num">{s.name}</th>)}</tr></thead>
            <tbody>{[...data].reverse().map((d) => <tr key={d.date}><td>{prettyDay(d.date)}</td>{series.map((s) => <td key={s.key} className="num money">{format(d[s.key])}</td>)}</tr>)}</tbody>
          </table>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="actualWash" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--series-1)" stopOpacity={0.16} />
                <stop offset="100%" stopColor="var(--series-1)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--grid)" vertical={false} />
            <XAxis dataKey="date" tick={AXIS} tickFormatter={shortDay} minTickGap={36} tickLine={false} axisLine={{ stroke: "var(--axis)" }} tickMargin={6} />
            <YAxis tick={AXIS} tickFormatter={tick} width={58} tickLine={false} axisLine={false} domain={["auto", "auto"]} />
            <Tooltip cursor={{ stroke: "var(--axis)", strokeWidth: 1 }} content={<Tip title={longDay} format={format} />} />
            {[...series].reverse().map((s) => (s.primary
              ? [
                <Area key={`${s.key}-wash`} name={s.name} type="monotone" dataKey={s.key} stroke="none" fill="url(#actualWash)" isAnimationActive={false} activeDot={false} legendType="none" />,
                <Line key={s.key} name={s.name} type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={2.25} strokeLinecap="round" dot={false} activeDot={{ r: 5, stroke: "var(--surface)", strokeWidth: 2 }} isAnimationActive={false} />,
              ]
              : <Line key={s.key} name={s.name} type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={1.75} strokeDasharray={s.dashed ? "5 4" : undefined} dot={false} activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2 }} isAnimationActive={false} />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </>
  );
}

/** Daily sales: actual against forecast and last year. One axis, dollars. */
export function SalesTrend({ data, height = 280 }) {
  return (
    <Trend data={data} height={height} format={fmt$} tick={dollarsTick} series={[
      { key: "actual_sales", name: "Actual", color: SERIES.actual, primary: true },
      { key: "forecast_sales", name: "Forecast", color: SERIES.forecast, dashed: true },
      { key: "prior_year_sales", name: "Last year", color: SERIES.lastYear },
    ]} />
  );
}

/** Labor hours against allowable, its own chart so hours never share an axis with dollars. */
export function LaborTrend({ data, height = 240 }) {
  return (
    <Trend data={data} height={height} format={(v) => (v === null || v === undefined ? "-" : `${fmtNum(v)} hrs`)} tick={(v) => fmtNum(v)} series={[
      { key: "actual_labor_hours", name: "Actual hours", color: SERIES.actual, primary: true },
      { key: "allowable_labor_hours", name: "Allowable hours", color: SERIES.forecast, dashed: true },
    ]} />
  );
}

// Value label just past the end of the bar: right of positive bars, left of negative ones.
function EndLabel({ x, y, width, height, value }) {
  if (value === null || value === undefined) return null;
  const negative = value < 0;
  const end = negative ? Math.min(x, x + width) - 6 : Math.max(x, x + width) + 6;
  return <text x={end} y={y + height / 2} dy={4} textAnchor={negative ? "end" : "start"} fontSize={11.5} fontWeight={600} fill="var(--text)">{fmtPct(value)}</text>;
}

// Variance scale. Positive labels sit in the right margin; negative labels need room inside
// the plot, and being a fixed pixel width they take a bigger share of a narrow chart. So the
// negative end of the domain is padded by however many percent LABEL_PX works out to.
const NAME_W = 132;
const MARGIN = { top: 4, right: 56, bottom: 0, left: 8 };
const LABEL_PX = 50;
function varianceScale(values, chartWidth) {
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values, min === 0 ? 1 : 0);
  const plot = Math.max(120, chartWidth - NAME_W - MARGIN.left - MARGIN.right);
  const padNeg = min < 0 ? (LABEL_PX * (max - min)) / (plot - LABEL_PX) : 0;
  const rough = (max - min) / 4;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= rough);
  const ticks = [];
  for (let t = Math.ceil(min / step) * step; t <= max + 1e-9; t += step) ticks.push(Math.round(t * 1000) / 1000);
  return { domain: [min - padNeg, max], ticks };
}

/**
 * Variance bars around a zero line. `goodWhenPositive` is true for sales and false for
 * labor, where running above allowable is the miss. Every bar carries its signed value,
 * so good and bad never rest on color alone.
 */
export function VarianceBars({ data, dataKey, goodWhenPositive = true, onSelect, height }) {
  const [width, setWidth] = useState(640);
  if (!data?.length) return null;
  const color = (v) => ((v >= 0) === goodWhenPositive ? STATUS.good : STATUS.bad);
  // Restaurant names all start "IHOP "; drop it on the axis so the label fits one line.
  const rows = data.filter((d) => d[dataKey] !== null && d[dataKey] !== undefined).map((d) => ({ ...d, label: String(d.name).replace(/^IHOP /, ""), __color: color(d[dataKey]) }));
  const h = height || Math.max(140, rows.length * 32 + 34);
  const scale = varianceScale(rows.map((r) => r[dataKey]), width);
  const measure = goodWhenPositive ? "Sales vs. forecast" : "Labor vs. allowable";
  return (
    <>
      <ResponsiveContainer width="100%" height={h} onResize={(w) => w && setWidth(w)}>
        <BarChart data={rows} layout="vertical" margin={MARGIN} barCategoryGap={8}>
          <CartesianGrid stroke="var(--grid)" horizontal={false} />
          <XAxis type="number" domain={scale.domain} ticks={scale.ticks} tick={AXIS} tickFormatter={(v) => `${v}%`} tickLine={false} axisLine={false} />
          <YAxis type="category" dataKey="label" tick={{ ...AXIS, fontSize: 12, fill: "var(--text-2)" }} width={NAME_W} tickLine={false} axisLine={false} interval={0} />
          <Tooltip cursor={{ fill: "var(--surface-2)" }} content={<Tip title={(_, p) => p[0]?.payload?.name} format={fmtPct} />} />
          <ReferenceLine x={0} stroke="var(--axis)" />
          <Bar name={measure} dataKey={dataKey} maxBarSize={18} radius={[0, 4, 4, 0]} isAnimationActive={false} onClick={(d) => onSelect && onSelect(d)} cursor={onSelect ? "pointer" : "default"}>
            {rows.map((r) => <Cell key={r.id ?? r.name} fill={r.__color} />)}
            <LabelList dataKey={dataKey} content={<EndLabel />} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="chart-legend" style={{ marginTop: 6 }}>
        <span><i className="block" style={{ background: STATUS.good }} />{goodWhenPositive ? "At or above forecast" : "At or under allowable"}</span>
        <span><i className="block" style={{ background: STATUS.bad }} />{goodWhenPositive ? "Below forecast" : "Over allowable"}</span>
      </div>
    </>
  );
}

// ---- Trends page charts -------------------------------------------------------------------

/** Any daily series with its own formatter: guest rating, labor cost share, and so on. */
export function MetricTrend({ data, series, format, tick, height = 220 }) {
  return <Trend data={data} height={height} format={format} tick={tick || format} series={series} />;
}

const pctTick = (v) => `${v}%`;
const weekLabel = (w) => prettyDay(w, { month: "short", day: "numeric" });

/** Weekly totals as grouped columns: actual, forecast and last year side by side. */
export function WeeklyBars({ data, height = 260 }) {
  if (!data?.length) return null;
  const series = [
    { key: "actual_sales", name: "Actual", color: SERIES.actual },
    { key: "forecast_basis", name: "Forecast", color: SERIES.forecast },
    { key: "prior_year_sales", name: "Last year", color: SERIES.lastYear },
  ];
  return (
    <>
      <Legend items={series.map((s) => ({ label: s.name, color: s.color }))} />
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }} barCategoryGap={18} barGap={2}>
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis dataKey="week_start" tick={AXIS} tickFormatter={(w) => `Wk of ${weekLabel(w)}`} tickLine={false} axisLine={{ stroke: "var(--axis)" }} tickMargin={6} />
          <YAxis tick={AXIS} tickFormatter={dollarsTick} width={58} tickLine={false} axisLine={false} />
          <Tooltip cursor={{ fill: "var(--surface-2)" }} content={<Tip title={(w, p) => `Week of ${weekLabel(w)}${p[0]?.payload?.partial ? ` (${p[0].payload.days} days)` : ""}`} format={fmt$} />} />
          {series.map((s) => <Bar key={s.key} name={s.name} dataKey={s.key} fill={s.color} maxBarSize={34} radius={[3, 3, 0, 0]} isAnimationActive={false} />)}
        </BarChart>
      </ResponsiveContainer>
    </>
  );
}

/** Sales vs. forecast and labor vs. allowable, day by day, around a zero line. */
export function VarianceTrend({ data, height = 220 }) {
  if (!data?.length) return null;
  const series = [
    { key: "sales_variance_pct", name: "Sales vs. forecast", color: SERIES.actual },
    { key: "labor_variance_pct", name: "Labor vs. allowable", color: SERIES.forecast },
  ];
  return (
    <>
      <Legend items={series.map((s) => ({ label: s.name, color: s.color }))} />
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis dataKey="date" tick={AXIS} tickFormatter={shortDay} minTickGap={36} tickLine={false} axisLine={{ stroke: "var(--axis)" }} tickMargin={6} />
          <YAxis tick={AXIS} tickFormatter={pctTick} width={48} tickLine={false} axisLine={false} domain={["auto", "auto"]} />
          <ReferenceLine y={0} stroke="var(--axis)" />
          <Tooltip cursor={{ stroke: "var(--axis)", strokeWidth: 1 }} content={<Tip title={longDay} format={fmtPct} />} />
          {series.map((s) => <Line key={s.key} name={s.name} type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={2} dot={{ r: 2.5, strokeWidth: 0, fill: s.color }} activeDot={{ r: 5, stroke: "var(--surface)", strokeWidth: 2 }} connectNulls={false} isAnimationActive={false} />)}
        </ComposedChart>
      </ResponsiveContainer>
    </>
  );
}

/** The average day for each weekday. */
export function WeekdayBars({ data, height = 240 }) {
  if (!data?.length) return null;
  const series = [
    { key: "avg_actual_sales", name: "Average sales", color: SERIES.actual },
    { key: "avg_forecast_sales", name: "Average forecast", color: SERIES.forecast },
    { key: "avg_prior_year_sales", name: "Average last year", color: SERIES.lastYear },
  ];
  return (
    <>
      <Legend items={series.map((s) => ({ label: s.name, color: s.color }))} />
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }} barCategoryGap={18} barGap={2}>
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis dataKey="short" tick={AXIS} tickLine={false} axisLine={{ stroke: "var(--axis)" }} tickMargin={6} />
          <YAxis tick={AXIS} tickFormatter={dollarsTick} width={58} tickLine={false} axisLine={false} />
          <Tooltip cursor={{ fill: "var(--surface-2)" }} content={<Tip title={(_, p) => `${p[0]?.payload?.weekday} · ${p[0]?.payload?.days} day${p[0]?.payload?.days === 1 ? "" : "s"} on file`} format={fmt$} />} />
          {series.map((s) => <Bar key={s.key} name={s.name} dataKey={s.key} fill={s.color} maxBarSize={30} radius={[3, 3, 0, 0]} isAnimationActive={false} />)}
        </BarChart>
      </ResponsiveContainer>
    </>
  );
}

const DAYPART_SERIES = [
  { key: "breakfast", name: "Breakfast", color: "var(--series-5)" },
  { key: "lunch", name: "Lunch", color: "var(--series-1)" },
  { key: "dinner", name: "Dinner", color: "var(--series-4)" },
  { key: "late_night", name: "Late night", color: "var(--series-3)" },
];

/** Each day's sales stacked by daypart. */
export function DaypartStack({ data, height = 240 }) {
  if (!data?.length) return null;
  return (
    <>
      <Legend items={DAYPART_SERIES.map((s) => ({ label: s.name, color: s.color }))} />
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }} barCategoryGap={4}>
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis dataKey="date" tick={AXIS} tickFormatter={shortDay} minTickGap={36} tickLine={false} axisLine={{ stroke: "var(--axis)" }} tickMargin={6} />
          <YAxis tick={AXIS} tickFormatter={dollarsTick} width={58} tickLine={false} axisLine={false} />
          <Tooltip cursor={{ fill: "var(--surface-2)" }} content={<Tip title={longDay} format={fmt$} />} />
          {DAYPART_SERIES.map((s) => <Bar key={s.key} name={s.name} dataKey={s.key} stackId="day" fill={s.color} maxBarSize={40} isAnimationActive={false} />)}
        </BarChart>
      </ResponsiveContainer>
    </>
  );
}

const GROUP_COLORS = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)", "var(--series-5)", "var(--series-6)"];

/** One line per region / area / restaurant: sales against forecast over time. */
export function GroupLines({ rows, groups, metric = "variance", height = 260, onSelect }) {
  if (!rows?.length || !groups?.length) return null;
  const shown = groups.slice(0, 6);
  const items = shown.map((g, i) => ({ ...g, color: GROUP_COLORS[i % GROUP_COLORS.length], key: `${metric}_${g.id}` }));
  return (
    <>
      <div className="chart-legend">
        {items.map((g) => (
          <span key={g.id} style={{ cursor: onSelect ? "pointer" : "default" }} onClick={() => onSelect && onSelect(g)}>
            <i style={{ borderTopColor: g.color }} />{String(g.name).replace(/^IHOP /, "")}
          </span>
        ))}
        {groups.length > shown.length && <span className="muted">and {groups.length - shown.length} more in the table</span>}
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis dataKey="date" tick={AXIS} tickFormatter={shortDay} minTickGap={36} tickLine={false} axisLine={{ stroke: "var(--axis)" }} tickMargin={6} />
          <YAxis tick={AXIS} tickFormatter={pctTick} width={48} tickLine={false} axisLine={false} domain={["auto", "auto"]} />
          <ReferenceLine y={0} stroke="var(--axis)" />
          <Tooltip cursor={{ stroke: "var(--axis)", strokeWidth: 1 }} content={<Tip title={longDay} format={fmtPct} />} />
          {items.map((g) => <Line key={g.id} name={String(g.name).replace(/^IHOP /, "")} type="monotone" dataKey={g.key} stroke={g.color} strokeWidth={1.75} dot={false} activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2 }} connectNulls={false} isAnimationActive={false} />)}
        </ComposedChart>
      </ResponsiveContainer>
    </>
  );
}
