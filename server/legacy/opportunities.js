// Rule-based, dollar-valued findings (no AI/model dependency) — every number here is
// a difference from an actual peer-store or prior-period figure, never a projection.
import db from "./db.js";
import { GROSS_SQL, ORDER_COUNT_SQL, DAYPART_SQL } from "./db.js";
import { periodDays, round2 } from "./period.js";

const MONTH_BASIS_DAYS = 30;
const MIN_REGION_ITEM_ORDERS = 30;
const MIN_STORE_ITEM_ORDERS = 15;
const MIN_STORE_REVENUE_FOR_MIX = 300;
const UNDER_INDEX_THRESHOLD = 0.8;
const LOCAL_WINNER_THRESHOLD = 1.5;
const MIX_SHARE_GAP = 0.05;
const MIN_FINDING_DOLLARS = 50;

function roundDollars(n) {
  return Math.round(n / 10) * 10;
}

export function computeOpportunities({ from, to }) {
  const monthFactor = MONTH_BASIS_DAYS / periodDays(from.slice(0, 10), to.slice(0, 10));
  const findings = [];

  const stores = db.prepare("SELECT id, name FROM stores").all();
  if (stores.length < 2) return findings;
  const storeName = Object.fromEntries(stores.map((s) => [s.id, s.name]));

  const storeTotalsRows = db.prepare(`
    SELECT store_id, ${ORDER_COUNT_SQL} orders, ${GROSS_SQL} revenue
    FROM sales WHERE sold_at BETWEEN ? AND ? GROUP BY store_id
  `).all(from, to);
  const storeOrders = Object.fromEntries(storeTotalsRows.map((r) => [r.store_id, r.orders]));
  const storeRevenue = Object.fromEntries(storeTotalsRows.map((r) => [r.store_id, r.revenue]));
  const regionTotalOrders = storeTotalsRows.reduce((s, r) => s + r.orders, 0);

  // ---- Item under-index + Local winner ----
  if (regionTotalOrders >= MIN_REGION_ITEM_ORDERS) {
    const topItems = db.prepare(`
      SELECT item, AVG(unit_price) price, SUM(quantity) qty
      FROM sales WHERE line_type='sale' AND sold_at BETWEEN ? AND ?
      GROUP BY item ORDER BY SUM(total) DESC LIMIT 15
    `).all(from, to);

    // One query for every top item's per-store split, instead of one query per item
    // (was 15 round-trips; this is 1, and the DB does the grouping either way).
    const qtyByItemStore = new Map();
    if (topItems.length) {
      const placeholders = topItems.map(() => "?").join(",");
      const rows = db.prepare(`
        SELECT item, store_id, SUM(quantity) qty
        FROM sales WHERE line_type='sale' AND item IN (${placeholders}) AND sold_at BETWEEN ? AND ?
        GROUP BY item, store_id
      `).all(...topItems.map((t) => t.item), from, to);
      for (const r of rows) {
        if (!qtyByItemStore.has(r.item)) qtyByItemStore.set(r.item, new Map());
        qtyByItemStore.get(r.item).set(r.store_id, r.qty);
      }
    }

    for (const ti of topItems) {
      const regionRate = ti.qty / regionTotalOrders;
      if (regionRate <= 0) continue;

      const qtyByStore = qtyByItemStore.get(ti.item) || new Map();

      const rateByStore = {};
      for (const s of stores) {
        const orders = storeOrders[s.id] || 0;
        if (orders < MIN_STORE_ITEM_ORDERS) continue;
        rateByStore[s.id] = (qtyByStore.get(s.id) || 0) / orders;
      }

      let winnerId = null, winnerRate = 0;
      for (const [id, rate] of Object.entries(rateByStore)) {
        if (rate >= regionRate * LOCAL_WINNER_THRESHOLD && rate > winnerRate) {
          winnerId = Number(id);
          winnerRate = rate;
        }
      }

      for (const [idStr, rate] of Object.entries(rateByStore)) {
        const storeId = Number(idStr);
        if (rate <= regionRate * UNDER_INDEX_THRESHOLD) {
          const gapPerOrder = regionRate - rate;
          const dollars = roundDollars(gapPerOrder * storeOrders[storeId] * ti.price * monthFactor);
          const pctBelow = Math.round((1 - rate / regionRate) * 100);
          if (dollars >= MIN_FINDING_DOLLARS && pctBelow > 0) {
            findings.push({
              kind: "item_underindex",
              storeId,
              monthlyDollars: dollars,
              sentence: `${storeName[storeId]} sells ${pctBelow}% fewer ${ti.item} than the region average. Closing that gap is worth about $${dollars.toLocaleString()} a month.`
            });
          }
        }
        if (winnerId != null && storeId !== winnerId && rate < regionRate) {
          const halfGap = (winnerRate - rate) / 2;
          const dollars = roundDollars(halfGap * storeOrders[storeId] * ti.price * monthFactor);
          if (halfGap > 0 && dollars >= MIN_FINDING_DOLLARS) {
            findings.push({
              kind: "local_winner",
              storeId,
              monthlyDollars: dollars,
              sentence: `${storeName[winnerId]}'s ${ti.item} rate is well above the region. ${storeName[storeId]} closing half that gap is worth about $${dollars.toLocaleString()} a month.`
            });
          }
        }
      }
    }
  }

  // ---- Daypart / category mix gaps ----
  for (const [dim, expr, label] of [["daypart", DAYPART_SQL, "daypart"], ["category", "category", "category"]]) {
    const regionRows = db.prepare(`
      SELECT ${expr} key, ${GROSS_SQL} revenue
      FROM sales WHERE sold_at BETWEEN ? AND ? GROUP BY key
    `).all(from, to);
    const regionTotal = regionRows.reduce((s, r) => s + r.revenue, 0);
    if (regionTotal <= 0) continue;
    const regionShare = Object.fromEntries(regionRows.map((r) => [r.key, r.revenue / regionTotal]));

    // One query for every store's mix, instead of one query per store (was N
    // round-trips for N stores; this is 1, grouped by store_id + key together).
    const storeRowsByStore = new Map();
    for (const r of db.prepare(`
      SELECT store_id, ${expr} key, ${GROSS_SQL} revenue
      FROM sales WHERE sold_at BETWEEN ? AND ? GROUP BY store_id, key
    `).all(from, to)) {
      if (!storeRowsByStore.has(r.store_id)) storeRowsByStore.set(r.store_id, []);
      storeRowsByStore.get(r.store_id).push(r);
    }

    for (const s of stores) {
      const rev = storeRevenue[s.id] || 0;
      if (rev < MIN_STORE_REVENUE_FOR_MIX) continue;
      const storeRows = storeRowsByStore.get(s.id) || [];
      const storeShareByKey = Object.fromEntries(storeRows.map((r) => [r.key, r.revenue / rev]));

      for (const [key, share] of Object.entries(regionShare)) {
        const storeShare = storeShareByKey[key] || 0;
        const gap = share - storeShare;
        if (gap >= MIX_SHARE_GAP) {
          const dollars = roundDollars(gap * rev * monthFactor);
          if (dollars >= MIN_FINDING_DOLLARS) {
            const gapPts = Math.round(gap * 100);
            const cleanKey = key.replace(/ \(.*\)/, "");
            findings.push({
              kind: `${dim}_gap`,
              storeId: s.id,
              monthlyDollars: dollars,
              sentence: `${storeName[s.id]} under-indexes on ${cleanKey} (${gapPts}pts below the region mix by ${label}). Matching the region is worth about $${dollars.toLocaleString()} a month.`
            });
          }
        }
      }
    }
  }

  return findings.sort((a, b) => b.monthlyDollars - a.monthlyDollars);
}
