// Generates ~90 days of realistic mock POS data across 6 demo stores, each with a
// deliberately different profile so every opportunity-engine finding type fires on
// first load. Store names are placeholders, not a real region.
import db from "./db.js";
import { MENU } from "./menu.js";
import { ingest } from "./ingest.js";
import { toLocalIso } from "./period.js";

const DAYS = 90;
const PAYMENTS = ["card", "card", "card", "cash", "mobile"];

const alreadySeeded = db.prepare("SELECT COUNT(*) c FROM ingest_batches WHERE source='seed'").get().c > 0;
if (alreadySeeded) {
  console.log("Seed data already present. Delete server/ihop.db (and -wal/-shm) to reseed from scratch.");
  process.exit(0);
}

function hourWeight(hour, dow, { breakfastMult = 1, lunchMult = 1, dinnerMult = 1 } = {}) {
  const weekend = dow === 0 || dow === 6;
  if (hour >= 7 && hour <= 10) return (weekend ? 14 : 10) * breakfastMult;
  if (hour >= 11 && hour <= 14) return (weekend ? 10 : 7) * lunchMult;
  if (hour >= 15 && hour <= 17) return 3;
  if (hour >= 18 && hour <= 21) return 5 * dinnerMult;
  if (hour >= 22 || hour <= 1) return weekend ? 4 : 1.5;
  return 0.5;
}

function buildPool(popOverrides = {}) {
  const pool = [];
  MENU.forEach((m, i) => {
    const pop = popOverrides[m.item] ?? m.popularity;
    for (let k = 0; k < Math.max(0, Math.round(pop)); k++) pool.push(i);
  });
  return pool;
}

const STORES = [
  {
    name: "Westfield", gmName: "Dana Whitfield", target: 135000,
    orderMult: 1.15, trend: (d) => 1 + (DAYS - d) * 0.0012,
    hourOpts: { breakfastMult: 1.3 }, popOverrides: {}, compRate: 0.015,
    roster: ["Alex Rivera", "Sam Okafor"], offRotation: "Priya Desai",
    anomaly: { daysAgo: 23, kind: "dip", note: "Kitchen printer down most of the morning" }
  },
  {
    name: "Riverside", gmName: "Marcus Feld", target: 128000,
    orderMult: 1.0, trend: (d) => 1 - (DAYS - d) * 0.0013,
    hourOpts: {}, popOverrides: {}, compRate: 0.02,
    roster: ["Jordan Lee", "Casey Nguyen"], offRotation: "Taylor Brooks",
    anomaly: { daysAgo: 9, kind: "dip", note: "Short-staffed - two call-outs" }
  },
  {
    name: "Oakton", gmName: "Renee Castillo", target: 96000,
    orderMult: 0.78, trend: (d) => 1 + (DAYS - d) * 0.0005,
    hourOpts: { lunchMult: 0.15 }, popOverrides: {}, compRate: 0.09,
    roster: ["Devon Hale", "Lena Ortiz"], offRotation: "Renee Castillo",
    anomaly: { daysAgo: 40, kind: "dip", note: "Regional health inspection" }
  },
  {
    name: "Brookside", gmName: "Ibrahim Salah", target: 116000,
    orderMult: 0.98, trend: (d) => 1 + (DAYS - d) * 0.001,
    hourOpts: {}, popOverrides: { "Breakfast Sampler": 1 }, compRate: 0.02,
    roster: ["Nina Park", "Wes Coburn"], offRotation: "Ibrahim Salah",
    anomaly: { daysAgo: 15, kind: "spike", note: "Local Little League fundraiser night" }
  },
  {
    name: "Fairview", gmName: "Grace Okonkwo", target: 105000,
    orderMult: 0.9, trend: (d) => 1 + (DAYS - d) * 0.0008,
    hourOpts: {}, popOverrides: { "Cinn-A-Stack Pancakes": 32 }, compRate: 0.025,
    roster: ["Miguel Santana", "Faith Underwood"], offRotation: "Grace Okonkwo",
    anomaly: { daysAgo: 5, kind: "spike", note: "Featured Cinn-A-Stack promo on local radio" }
  },
  {
    name: "Lakewood", gmName: "Owen Bradshaw", target: 110000,
    orderMult: 0.95, trend: (d) => 1 + (DAYS - d) * 0.0007,
    hourOpts: { dinnerMult: 0.12 }, popOverrides: {}, compRate: 0.03,
    roster: ["Harper Quinn", "Diego Marsh"], offRotation: "Owen Bradshaw",
    anomaly: { daysAgo: 60, kind: "dip", note: "Road construction blocked the main entrance" }
  }
];

const insertStore = db.prepare(
  "INSERT INTO stores (name, monthly_revenue_target, gm_name, is_demo) VALUES (?, ?, ?, 1)"
);
const insertEntry = db.prepare(
  "INSERT INTO entries (store_id, entry_date, type, text, is_demo) VALUES (?, ?, 'note', ?, 1)"
);

const now = new Date();
const sales = [];
const duty = [];
let totalRows = 0;

for (const store of STORES) {
  const storeId = Number(insertStore.run(store.name, store.target, store.gmName).lastInsertRowid);
  const pool = buildPool(store.popOverrides);
  const anomalyNoted = { done: false };

  for (let d = DAYS; d >= 1; d--) {
    const day = new Date(now);
    day.setDate(now.getDate() - d);
    const dow = day.getDay();
    const weekend = dow === 0 || dow === 6;
    const dateStr = toLocalIso(day).slice(0, 10);

    const isAnomaly = store.anomaly.daysAgo === d;
    const anomalyMult = isAnomaly ? (store.anomaly.kind === "dip" ? 0.55 : 1.7) : 1;

    const base = weekend ? 210 : 140;
    const noise = 0.85 + Math.random() * 0.3;
    const orders = Math.round(base * store.orderMult * store.trend(d) * noise * anomalyMult);

    const manager = isAnomaly ? store.offRotation : store.roster[d % store.roster.length];
    duty.push({ storeId, dutyDate: dateStr, managerName: manager });

    if (isAnomaly && !anomalyNoted.done) {
      insertEntry.run(storeId, dateStr, store.anomaly.note);
      anomalyNoted.done = true;
    }

    for (let o = 0; o < orders; o++) {
      let hour, tries = 0;
      do {
        hour = Math.floor(Math.random() * 24);
        tries++;
      } while (Math.random() * 18 > hourWeight(hour, dow, store.hourOpts) && tries < 50);
      const minute = Math.floor(Math.random() * 60);
      const soldAt = new Date(day);
      soldAt.setHours(hour, minute, 0, 0);
      const pay = PAYMENTS[Math.floor(Math.random() * PAYMENTS.length)];

      const lines = 1 + Math.floor(Math.random() * 4);
      const orderItems = [];
      for (let l = 0; l < lines; l++) {
        const m = MENU[pool[Math.floor(Math.random() * pool.length)]];
        const qty = Math.random() < 0.12 ? 2 : 1;
        const total = +(qty * m.price).toFixed(2);
        sales.push({
          storeId, soldAt: toLocalIso(soldAt), item: m.item, category: m.category,
          quantity: qty, unitPrice: m.price, total, paymentMethod: pay, lineType: "sale"
        });
        orderItems.push(m);
        totalRows++;
      }

      if (Math.random() < store.compRate) {
        const m = orderItems[Math.floor(Math.random() * orderItems.length)];
        sales.push({
          storeId, soldAt: toLocalIso(soldAt), item: m.item, category: m.category,
          quantity: 1, unitPrice: m.price, total: m.price, paymentMethod: pay,
          lineType: Math.random() < 0.5 ? "comp" : "void"
        });
        totalRows++;
      }
    }
  }
}

const result = ingest({ sales, duty, source: "seed" });
console.log(`Seeded ${STORES.length} stores, ${result.imported} sale/comp/void line items across ${DAYS} days.`);
