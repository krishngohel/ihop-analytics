// Generates ~90 days of realistic mock POS data.
import db from "./db.js";
import { MENU } from "./menu.js";

const DAYS = 90;
const PAYMENTS = ["card", "card", "card", "cash", "mobile"];

// Weighted item picker
const pool = [];
MENU.forEach((m, i) => { for (let k = 0; k < m.popularity; k++) pool.push(i); });
const pickItem = () => MENU[pool[Math.floor(Math.random() * pool.length)]];

// Hour weights: IHOP peaks at breakfast/brunch, bump late night on weekends
function hourWeight(hour, dow) {
  const weekend = dow === 0 || dow === 6;
  if (hour >= 7 && hour <= 10) return weekend ? 14 : 10;
  if (hour >= 11 && hour <= 14) return weekend ? 10 : 7;
  if (hour >= 15 && hour <= 17) return 3;
  if (hour >= 18 && hour <= 21) return 5;
  if (hour >= 22 || hour <= 1) return weekend ? 4 : 1.5;
  return 0.5;
}

const insert = db.prepare(`
  INSERT INTO sales (sold_at, item, category, quantity, unit_price, total, payment_method, source)
  VALUES (?, ?, ?, ?, ?, ?, ?, 'seed')
`);

const existing = db.prepare("SELECT COUNT(*) c FROM sales WHERE source='seed'").get().c;
if (existing > 0) {
  console.log(`Seed data already present (${existing} rows). Run 'DELETE FROM sales WHERE source=''seed''' to reseed.`);
  process.exit(0);
}

db.exec("BEGIN");
try {
  const now = new Date();
  let rows = 0;
  for (let d = DAYS; d >= 1; d--) {
    const day = new Date(now);
    day.setDate(now.getDate() - d);
    const dow = day.getDay();
    const weekend = dow === 0 || dow === 6;
    // Orders per day: weekday ~140, weekend ~210, with noise + slight upward trend
    const base = weekend ? 210 : 140;
    const trend = 1 + (DAYS - d) * 0.0015;
    const orders = Math.round(base * trend * (0.85 + Math.random() * 0.3));

    for (let o = 0; o < orders; o++) {
      // pick an hour weighted by daypart
      let hour, tries = 0;
      do {
        hour = Math.floor(Math.random() * 24);
        tries++;
      } while (Math.random() * 14 > hourWeight(hour, dow) && tries < 50);
      const minute = Math.floor(Math.random() * 60);
      const soldAt = new Date(day);
      soldAt.setHours(hour, minute, 0, 0);
      const pay = PAYMENTS[Math.floor(Math.random() * PAYMENTS.length)];

      // each order = 1-4 line items
      const lines = 1 + Math.floor(Math.random() * 4);
      for (let l = 0; l < lines; l++) {
        const m = pickItem();
        const qty = Math.random() < 0.12 ? 2 : 1;
        insert.run(
          soldAt.toISOString(),
          m.item, m.category, qty, m.price,
          +(qty * m.price).toFixed(2), pay
        );
        rows++;
      }
    }
  }
  db.exec("COMMIT");
  console.log(`Seeded ${rows} sale line items across ${DAYS} days.`);
} catch (e) {
  db.exec("ROLLBACK");
  throw e;
}
