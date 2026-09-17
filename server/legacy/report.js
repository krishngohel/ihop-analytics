// Report engine: period vs prior-period analytics + rule-based written highlights.
// scope=store -> single-location ops report. scope=region -> leadership/boss packet.
import { Router } from "express";
import db, { NET_SQL, GROSS_SQL, LEAKAGE_SQL, ORDER_COUNT_SQL, UNITS_SQL, DAYPART_SQL } from "./db.js";
import { periodDays, priorPeriod, pctChange, toRange, round2 } from "./period.js";
import { computeOpportunities } from "./opportunities.js";

const router = Router();

const fmt$ = (n) => "$" + Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 });

function periodSummary(from, to, storeId) {
  const clause = storeId ? " AND store_id = ?" : "";
  const params = storeId ? [from, to, storeId] : [from, to];
  return db.prepare(`SELECT ${NET_SQL} revenue, ${GROSS_SQL} gross, ${LEAKAGE_SQL} leakage, ${ORDER_COUNT_SQL} orders, ${UNITS_SQL} units FROM sales WHERE sold_at BETWEEN ? AND ?${clause}`).get(...params);
}

function grouped(col, from, to, storeId) {
  const clause = storeId ? " AND store_id = ?" : "";
  const params = storeId ? [from, to, storeId] : [from, to];
  return db.prepare(`SELECT ${col} key, ${GROSS_SQL} revenue, ${UNITS_SQL} quantity FROM sales WHERE line_type='sale' AND sold_at BETWEEN ? AND ?${clause} GROUP BY key ORDER BY revenue DESC`).all(...params);
}

function withChange(current, prior) {
  const prevMap = Object.fromEntries(prior.map((r) => [r.key, r.revenue]));
  return current.map((r) => ({ ...r, change: pctChange(r.revenue, prevMap[r.key] ?? 0) }));
}

function dailyRevenue(from, to, storeId) {
  const clause = storeId ? " AND store_id = ?" : "";
  const params = storeId ? [from, to, storeId] : [from, to];
  return db.prepare(`SELECT substr(sold_at,1,10) day, ${NET_SQL} revenue FROM sales WHERE sold_at BETWEEN ? AND ?${clause} GROUP BY day ORDER BY revenue DESC`).all(...params)
    .map((r) => ({ day: r.day, revenue: round2(r.revenue) }));
}

function dutyOnDate(storeId, date) {
  return db.prepare("SELECT manager_name FROM duty_logs WHERE store_id=? AND duty_date=?").get(storeId, date)?.manager_name || null;
}

function dutyAllStoresOnDate(date) {
  return db.prepare(`
    SELECT d.store_id storeId, s.name storeName, d.manager_name managerName
    FROM duty_logs d JOIN stores s ON s.id = d.store_id WHERE d.duty_date = ?
  `).all(date);
}

router.get("/api/report", (req, res) => {
  const toDay = req.query.to || new Date().toISOString().slice(0, 10);
  const fromDay = req.query.from || new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10);
  const storeId = req.query.storeId ? Number(req.query.storeId) : null;
  const scope = req.query.scope === "store" || (req.query.scope !== "region" && storeId) ? "store" : "region";

  if (scope === "store" && !storeId) {
    return res.status(400).json({ error: "storeId is required when scope=store" });
  }

  const { from, to } = toRange(fromDay, toDay);
  const days = periodDays(fromDay, toDay);
  const prior = priorPeriod(fromDay, toDay);
  const { from: pFrom, to: pTo } = toRange(prior.fromDay, prior.toDay);

  if (scope === "store") return res.json(buildStoreReport({ storeId, fromDay, toDay, from, to, days, prior, pFrom, pTo }));
  return res.json(buildRegionReport({ fromDay, toDay, from, to, days, prior, pFrom, pTo }));
});

function buildStoreReport({ storeId, fromDay, toDay, from, to, days, prior, pFrom, pTo }) {
  const store = db.prepare("SELECT id, name, gm_name, monthly_revenue_target FROM stores WHERE id=?").get(storeId);
  const cur = periodSummary(from, to, storeId);
  const prev = periodSummary(pFrom, pTo, storeId);
  const avgTicket = cur.orders ? cur.revenue / cur.orders : 0;
  const prevAvgTicket = prev.orders ? prev.revenue / prev.orders : 0;

  const items = withChange(grouped("item", from, to, storeId), grouped("item", pFrom, pTo, storeId));
  const categories = withChange(grouped("category", from, to, storeId), grouped("category", pFrom, pTo, storeId));
  const dayparts = withChange(grouped(DAYPART_SQL, from, to, storeId), grouped(DAYPART_SQL, pFrom, pTo, storeId));
  const decliners = items.filter((i) => i.change !== null && i.change <= -15).sort((a, b) => a.change - b.change).slice(0, 5);

  const daily = dailyRevenue(from, to, storeId);
  const bestDay = daily[0] || null;
  const worstDay = daily.length > 1 ? daily[daily.length - 1] : null;

  const regionRow = db.prepare(`SELECT ${NET_SQL} revenue, ${ORDER_COUNT_SQL} orders FROM sales WHERE sold_at BETWEEN ? AND ?`).get(from, to);
  const storeCount = db.prepare("SELECT COUNT(*) c FROM stores").get().c;
  const regionAvg = storeCount ? regionRow.revenue / storeCount : 0;

  const targetForPeriod = store.monthly_revenue_target ? store.monthly_revenue_target * (days / 30) : null;
  const opportunities = computeOpportunities({ from, to }).filter((f) => f.storeId === storeId).slice(0, 10);
  const entries = db.prepare("SELECT entry_date, type, text, amount FROM entries WHERE store_id=? AND entry_date BETWEEN ? AND ? ORDER BY entry_date").all(storeId, fromDay, toDay);

  const h = [];
  const revChange = pctChange(cur.revenue, prev.revenue);
  h.push(revChange !== null
    ? `Revenue was ${fmt$(cur.revenue)}, ${revChange >= 0 ? "up" : "down"} ${Math.abs(revChange)}% vs the prior ${days} days (${fmt$(prev.revenue)}).`
    : `Revenue was ${fmt$(cur.revenue)} across ${cur.orders.toLocaleString()} orders. No prior-period data to compare.`);
  if (targetForPeriod) {
    const diff = cur.revenue - targetForPeriod;
    h.push(`${diff >= 0 ? "Beat" : "Missed"} its target by ${fmt$(Math.abs(diff))} (target ${fmt$(targetForPeriod)}).`);
  }
  if (regionAvg) h.push(`${cur.revenue >= regionAvg ? "Above" : "Below"} the regional average store (${fmt$(regionAvg)}) by ${fmt$(Math.abs(cur.revenue - regionAvg))}.`);
  if (cur.leakage > 0) h.push(`Comps/voids/discounts totaled ${fmt$(cur.leakage)} (${((cur.leakage / (cur.gross || 1)) * 100).toFixed(1)}% of gross sales).`);
  const movers = items.filter((i) => i.change !== null && i.revenue >= cur.revenue * 0.01);
  if (movers.length) {
    const up = [...movers].sort((a, b) => b.change - a.change)[0];
    if (up.change > 0) h.push(`Fastest grower: ${up.key} (+${up.change}%, ${fmt$(up.revenue)}).`);
    const down = [...movers].sort((a, b) => a.change - b.change)[0];
    if (down.change < 0) h.push(`Biggest decliner: ${down.key} (${down.change}%, ${fmt$(down.revenue)}).`);
  }
  if (bestDay && worstDay) {
    h.push(`Best day: ${bestDay.day} (${fmt$(bestDay.revenue)}${dutyOnDate(storeId, bestDay.day) ? `, ${dutyOnDate(storeId, bestDay.day)} on duty` : ""}); slowest: ${worstDay.day} (${fmt$(worstDay.revenue)}${dutyOnDate(storeId, worstDay.day) ? `, ${dutyOnDate(storeId, worstDay.day)} on duty` : ""}).`);
  }
  if (opportunities.length) h.push(`Top opportunity: ${opportunities[0].sentence}`);

  return {
    scope: "store",
    storeId, storeName: store.name, gmName: store.gm_name,
    period: { from: fromDay, to: toDay, days }, prior: { from: prior.fromDay, to: prior.toDay }, generatedAt: new Date().toISOString(),
    kpis: {
      revenue: { value: round2(cur.revenue), prior: round2(prev.revenue), change: revChange },
      gross: { value: round2(cur.gross) },
      leakage: { value: round2(cur.leakage) },
      orders: { value: cur.orders, prior: prev.orders, change: pctChange(cur.orders, prev.orders) },
      avgTicket: { value: round2(avgTicket), prior: round2(prevAvgTicket), change: pctChange(avgTicket, prevAvgTicket) },
      units: { value: cur.units, prior: prev.units, change: pctChange(cur.units, prev.units) }
    },
    vsRegionAvg: regionAvg ? round2(cur.revenue - regionAvg) : null,
    vsTarget: targetForPeriod != null ? round2(cur.revenue - targetForPeriod) : null,
    targetForPeriod: targetForPeriod != null ? round2(targetForPeriod) : null,
    highlights: h,
    topItems: items.slice(0, 10),
    decliners, categories, dayparts,
    bestDay: bestDay ? { ...bestDay, manager: dutyOnDate(storeId, bestDay.day) } : null,
    worstDay: worstDay ? { ...worstDay, manager: dutyOnDate(storeId, worstDay.day) } : null,
    opportunities,
    entries
  };
}

function buildRegionReport({ fromDay, toDay, from, to, days, prior, pFrom, pTo }) {
  const stores = db.prepare("SELECT id, name, monthly_revenue_target, gm_name FROM stores ORDER BY name").all();
  const cur = periodSummary(from, to, null);
  const prev = periodSummary(pFrom, pTo, null);
  const avgTicket = cur.orders ? cur.revenue / cur.orders : 0;
  const targetSum = stores.reduce((s, st) => s + (st.monthly_revenue_target || 0), 0);
  const targetForPeriod = targetSum * (days / 30);

  const curByStoreRows = db.prepare(`SELECT store_id, ${NET_SQL} net, ${GROSS_SQL} gross, ${LEAKAGE_SQL} leakage, ${ORDER_COUNT_SQL} orders, ${UNITS_SQL} units FROM sales WHERE sold_at BETWEEN ? AND ? GROUP BY store_id`).all(from, to);
  const prevByStoreRows = db.prepare(`SELECT store_id, ${NET_SQL} net FROM sales WHERE sold_at BETWEEN ? AND ? GROUP BY store_id`).all(pFrom, pTo);
  const curByStore = Object.fromEntries(curByStoreRows.map((r) => [r.store_id, r]));
  const prevByStore = Object.fromEntries(prevByStoreRows.map((r) => [r.store_id, r.net]));
  const activeCount = curByStoreRows.length;
  const regionAvg = activeCount ? curByStoreRows.reduce((s, r) => s + r.net, 0) / activeCount : 0;

  const storeTable = stores.map((s) => {
    const c = curByStore[s.id] || { net: 0, gross: 0, leakage: 0, orders: 0, units: 0 };
    const priorNet = prevByStore[s.id] || 0;
    const storeTargetForPeriod = s.monthly_revenue_target ? s.monthly_revenue_target * (days / 30) : null;
    return {
      storeId: s.id, name: s.name, gmName: s.gm_name,
      revenue: round2(c.net), comps: round2(c.leakage), orders: c.orders, units: c.units,
      avgTicket: c.orders ? round2(c.net / c.orders) : 0,
      vsOwnPrior: pctChange(c.net, priorNet),
      vsRegionAvg: regionAvg ? round2(c.net - regionAvg) : null,
      vsTarget: storeTargetForPeriod != null ? round2(c.net - storeTargetForPeriod) : null,
      targetForPeriod: storeTargetForPeriod != null ? round2(storeTargetForPeriod) : null,
      belowAverage: regionAvg > 0 && c.net < regionAvg
    };
  }).sort((a, b) => b.revenue - a.revenue);

  const bestStore = storeTable[0] || null;
  const worstStore = storeTable[storeTable.length - 1] || null;
  const belowAverageStores = storeTable.filter((s) => s.belowAverage).map((s) => s.name);

  const daily = dailyRevenue(from, to, null);
  const bestDay = daily[0] || null;
  const worstDay = daily.length > 1 ? daily[daily.length - 1] : null;

  const opportunities = computeOpportunities({ from, to }).slice(0, 10);
  const storeName = Object.fromEntries(stores.map((s) => [s.id, s.name]));

  const h = [];
  const revChange = pctChange(cur.revenue, prev.revenue);
  h.push(revChange !== null
    ? `Region revenue was ${fmt$(cur.revenue)} across ${stores.length} stores, ${revChange >= 0 ? "up" : "down"} ${Math.abs(revChange)}% vs the prior ${days} days (${fmt$(prev.revenue)}).`
    : `Region revenue was ${fmt$(cur.revenue)} across ${stores.length} stores. No prior-period data to compare.`);
  if (targetForPeriod) {
    const diff = cur.revenue - targetForPeriod;
    h.push(`${diff >= 0 ? "Beat" : "Missed"} the combined store target by ${fmt$(Math.abs(diff))} (target ${fmt$(targetForPeriod)}).`);
  }
  if (cur.leakage > 0) h.push(`Comps/voids/discounts cost the region ${fmt$(cur.leakage)} this period.`);
  if (bestStore) h.push(`Top store: ${bestStore.name} at ${fmt$(bestStore.revenue)}${bestStore.vsOwnPrior != null ? ` (${bestStore.vsOwnPrior >= 0 ? "+" : ""}${bestStore.vsOwnPrior}% vs its own prior period)` : ""}.`);
  if (worstStore) h.push(`Needs attention: ${worstStore.name} at ${fmt$(worstStore.revenue)}${worstStore.vsOwnPrior != null ? ` (${worstStore.vsOwnPrior >= 0 ? "+" : ""}${worstStore.vsOwnPrior}% vs its own prior period)` : ""}.`);
  if (belowAverageStores.length) h.push(`${belowAverageStores.length} of ${stores.length} stores are below the regional average: ${belowAverageStores.join(", ")}.`);
  if (opportunities.length) h.push(`Biggest opportunity: ${opportunities[0].sentence}`);
  if (bestDay && worstDay) {
    const bestDuty = dutyAllStoresOnDate(bestDay.day).map((d) => `${d.storeName} (${d.managerName})`).join(", ");
    const worstDuty = dutyAllStoresOnDate(worstDay.day).map((d) => `${d.storeName} (${d.managerName})`).join(", ");
    h.push(`Best day region-wide: ${bestDay.day} (${fmt$(bestDay.revenue)})${bestDuty ? ` - on duty: ${bestDuty}` : ""}. Slowest: ${worstDay.day} (${fmt$(worstDay.revenue)})${worstDuty ? ` - on duty: ${worstDuty}` : ""}.`);
  }

  return {
    scope: "region",
    period: { from: fromDay, to: toDay, days }, prior: { from: prior.fromDay, to: prior.toDay }, generatedAt: new Date().toISOString(),
    kpis: {
      revenue: { value: round2(cur.revenue), prior: round2(prev.revenue), change: revChange },
      gross: { value: round2(cur.gross) },
      leakage: { value: round2(cur.leakage) },
      orders: { value: cur.orders, prior: prev.orders, change: pctChange(cur.orders, prev.orders) },
      avgTicket: { value: round2(avgTicket) },
      units: { value: cur.units }
    },
    targetForPeriod: round2(targetForPeriod),
    vsTarget: targetForPeriod ? round2(cur.revenue - targetForPeriod) : null,
    storeTable,
    bestStore, worstStore, belowAverageStores,
    topOpportunities: opportunities,
    bestDay: bestDay ? { ...bestDay, duty: dutyAllStoresOnDate(bestDay.day) } : null,
    worstDay: worstDay ? { ...worstDay, duty: dutyAllStoresOnDate(worstDay.day) } : null,
    highlights: h
  };
}

export default router;
