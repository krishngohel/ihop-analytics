// Report engine: period vs prior-period analytics + rule-based written highlights.
import { Router } from "express";
import db from "./db.js";

const router = Router();

const fmt$ = (n) => "$" + Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
const pct = (cur, prev) => (prev > 0 ? +(((cur - prev) / prev) * 100).toFixed(1) : null);

function summary(from, to) {
  return db.prepare(`
    SELECT COALESCE(SUM(total),0) revenue,
           COUNT(DISTINCT sold_at || payment_method) orders,
           COALESCE(SUM(quantity),0) units
    FROM sales WHERE sold_at BETWEEN ? AND ?`).get(from, to);
}

function grouped(col, from, to) {
  return db.prepare(`
    SELECT ${col} key, ROUND(SUM(total),2) revenue, SUM(quantity) quantity
    FROM sales WHERE sold_at BETWEEN ? AND ?
    GROUP BY key ORDER BY revenue DESC`).all(from, to);
}

const DAYPART = `CASE
  WHEN CAST(substr(sold_at,12,2) AS INT) BETWEEN 5 AND 10 THEN 'Breakfast (5-11)'
  WHEN CAST(substr(sold_at,12,2) AS INT) BETWEEN 11 AND 14 THEN 'Lunch (11-15)'
  WHEN CAST(substr(sold_at,12,2) AS INT) BETWEEN 15 AND 17 THEN 'Afternoon (15-18)'
  WHEN CAST(substr(sold_at,12,2) AS INT) BETWEEN 18 AND 21 THEN 'Dinner (18-22)'
  ELSE 'Late Night (22-5)' END`;

function withChange(current, prior) {
  const prevMap = Object.fromEntries(prior.map((r) => [r.key, r.revenue]));
  return current.map((r) => ({ ...r, change: pct(r.revenue, prevMap[r.key] ?? 0) }));
}

router.get("/api/report", (req, res) => {
  const toDay = req.query.to || new Date().toISOString().slice(0, 10);
  const fromDay = req.query.from || new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10);
  const from = `${fromDay}T00:00:00`, to = `${toDay}T23:59:59`;

  const days = Math.max(1, Math.round((Date.parse(toDay) - Date.parse(fromDay)) / 864e5) + 1);
  const prevToDay = new Date(Date.parse(fromDay) - 864e5).toISOString().slice(0, 10);
  const prevFromDay = new Date(Date.parse(fromDay) - days * 864e5).toISOString().slice(0, 10);
  const pFrom = `${prevFromDay}T00:00:00`, pTo = `${prevToDay}T23:59:59`;

  const cur = summary(from, to);
  const prev = summary(pFrom, pTo);
  const avgTicket = cur.orders ? cur.revenue / cur.orders : 0;
  const prevAvgTicket = prev.orders ? prev.revenue / prev.orders : 0;

  const items = withChange(grouped("item", from, to), grouped("item", pFrom, pTo));
  const categories = withChange(grouped("category", from, to), grouped("category", pFrom, pTo));
  const dayparts = withChange(grouped(DAYPART, from, to), grouped(DAYPART, pFrom, pTo));

  const daily = db.prepare(`
    SELECT substr(sold_at,1,10) day, ROUND(SUM(total),2) revenue
    FROM sales WHERE sold_at BETWEEN ? AND ? GROUP BY day ORDER BY revenue DESC`).all(from, to);
  const bestDay = daily[0] || null;
  const worstDay = daily.length > 1 ? daily[daily.length - 1] : null;

  const wkend = db.prepare(`
    SELECT CAST(strftime('%w', substr(sold_at,1,10)) AS INT) IN (0,6) weekend,
           ROUND(SUM(total) * 1.0 / COUNT(DISTINCT substr(sold_at,1,10)), 2) avgDaily
    FROM sales WHERE sold_at BETWEEN ? AND ? GROUP BY weekend`).all(from, to);
  const weekendAvg = wkend.find((r) => r.weekend === 1)?.avgDaily ?? null;
  const weekdayAvg = wkend.find((r) => r.weekend === 0)?.avgDaily ?? null;

  const entries = db.prepare(
    "SELECT entry_date, type, text, amount FROM entries WHERE entry_date BETWEEN ? AND ? ORDER BY entry_date"
  ).all(fromDay, toDay);

  const decliners = items.filter((i) => i.change !== null && i.change <= -15)
    .sort((a, b) => a.change - b.change).slice(0, 5);

  // ---- written highlights (rule-based) ----
  const h = [];
  const revChange = pct(cur.revenue, prev.revenue);
  if (revChange !== null) {
    h.push(`Revenue was ${fmt$(cur.revenue)}, ${revChange >= 0 ? "up" : "down"} ${Math.abs(revChange)}% vs the prior ${days} days (${fmt$(prev.revenue)}).`);
  } else {
    h.push(`Revenue was ${fmt$(cur.revenue)} across ${cur.orders.toLocaleString()} orders. No prior-period data to compare.`);
  }
  const tkChange = pct(avgTicket, prevAvgTicket);
  if (tkChange !== null && Math.abs(tkChange) >= 3) {
    h.push(`Average ticket ${tkChange >= 0 ? "rose" : "fell"} ${Math.abs(tkChange)}% to $${avgTicket.toFixed(2)}.`);
  }
  const movers = items.filter((i) => i.change !== null && i.revenue >= cur.revenue * 0.01);
  if (movers.length) {
    const up = [...movers].sort((a, b) => b.change - a.change)[0];
    if (up.change > 0) h.push(`Fastest grower: ${up.key} (+${up.change}%, ${fmt$(up.revenue)}).`);
    const down = [...movers].sort((a, b) => a.change - b.change)[0];
    if (down.change < 0) h.push(`Biggest decliner: ${down.key} (${down.change}%, ${fmt$(down.revenue)}).`);
  }
  if (items[0]) {
    h.push(`Top seller: ${items[0].key} at ${fmt$(items[0].revenue)} (${((items[0].revenue / (cur.revenue || 1)) * 100).toFixed(1)}% of revenue).`);
  }
  if (dayparts[0]) {
    h.push(`${dayparts[0].key.replace(/ \(.*\)/, "")} drove ${((dayparts[0].revenue / (cur.revenue || 1)) * 100).toFixed(0)}% of revenue.`);
  }
  if (bestDay && worstDay) {
    h.push(`Best day: ${bestDay.day} (${fmt$(bestDay.revenue)}); slowest: ${worstDay.day} (${fmt$(worstDay.revenue)}).`);
  }
  if (weekendAvg && weekdayAvg) {
    h.push(`Weekend days averaged ${fmt$(weekendAvg)} vs ${fmt$(weekdayAvg)} on weekdays.`);
  }
  if (decliners.length) {
    h.push(`${decliners.length} item${decliners.length > 1 ? "s" : ""} declined more than 15% - see "Needs attention".`);
  }

  res.json({
    period: { from: fromDay, to: toDay, days },
    prior: { from: prevFromDay, to: prevToDay },
    generatedAt: new Date().toISOString(),
    kpis: {
      revenue: { value: +cur.revenue.toFixed(2), prior: +prev.revenue.toFixed(2), change: revChange },
      orders: { value: cur.orders, prior: prev.orders, change: pct(cur.orders, prev.orders) },
      avgTicket: { value: +avgTicket.toFixed(2), prior: +prevAvgTicket.toFixed(2), change: tkChange },
      units: { value: cur.units, prior: prev.units, change: pct(cur.units, prev.units) }
    },
    highlights: h,
    topItems: items.slice(0, 10),
    decliners,
    categories,
    dayparts,
    bestDay, worstDay, weekendAvg, weekdayAvg,
    entries
  });
});

export default router;
