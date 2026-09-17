// Pure parsing: turns an uploaded workbook into normalized rows. Knows nothing about
// the database — store-name resolution and demo-wipe happen in the upload route, so
// this file stays independently readable/testable.
import XLSX from "xlsx";
import { toLocalIso } from "./period.js";

const LINE_TYPES = new Set(["sale", "discount", "comp", "void"]);

function normalizeKey(k) {
  return k.toLowerCase().trim().replace(/\s+/g, "_");
}

function pick(norm, keys) {
  for (const k of keys) {
    if (norm[k] != null && norm[k] !== "") return norm[k];
  }
  return null;
}

export function parseSpreadsheet(buffer) {
  let wb;
  try {
    wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  } catch {
    return { error: "Could not read file - is it a valid .xlsx?" };
  }
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: null });

  const sales = [];
  const dutyByKey = new Map();
  const errors = [];
  let hasStoreColumn = false;

  rawRows.forEach((r, i) => {
    const norm = {};
    for (const k of Object.keys(r)) norm[normalizeKey(k)] = r[k];

    const storeNameRaw = pick(norm, ["store", "location", "store_#", "store_no", "store_number"]);
    const storeName = storeNameRaw ? String(storeNameRaw).trim() : null;
    if (storeName) hasStoreColumn = true;

    const item = pick(norm, ["item", "menu_item"]);
    if (!item) {
      if (Object.values(r).some((v) => v != null)) errors.push(`Row ${i + 2}: missing Item`);
      return;
    }
    const qty = Number(pick(norm, ["quantity", "qty"])) || 1;
    const price = Number(pick(norm, ["unit_price", "price"])) || 0;
    const total = Number(pick(norm, ["total", "amount", "sales"])) || +(qty * price).toFixed(2);
    if (!total) { errors.push(`Row ${i + 2}: no price/total`); return; }

    let soldAt;
    const d = pick(norm, ["date", "business_date"]);
    const t = pick(norm, ["time"]);
    if (d instanceof Date) {
      soldAt = new Date(d);
      if (typeof t === "string" && /^\d{1,2}:\d{2}/.test(t)) {
        const [h, m] = t.split(":").map(Number);
        soldAt.setHours(h, m, 0, 0);
      } else if (t instanceof Date) {
        soldAt.setHours(t.getHours(), t.getMinutes(), 0, 0);
      }
    } else if (typeof d === "string" && !isNaN(Date.parse(d))) {
      soldAt = new Date(`${d} ${t || "12:00"}`);
      if (isNaN(soldAt)) soldAt = new Date(d);
    } else {
      errors.push(`Row ${i + 2}: bad Date`);
      return;
    }

    const lineTypeRaw = String(pick(norm, ["type", "line_type"]) || "sale").toLowerCase().trim();
    const lineType = LINE_TYPES.has(lineTypeRaw) ? lineTypeRaw : "sale";

    sales.push({
      storeName,
      soldAt: toLocalIso(soldAt),
      item: String(item),
      category: String(norm.category || "Uncategorized"),
      quantity: qty,
      unitPrice: price || +(total / qty).toFixed(2),
      total,
      paymentMethod: String(pick(norm, ["payment_method", "payment"]) || "card"),
      lineType
    });

    const managerNameRaw = pick(norm, ["manager", "mod", "manager_on_duty"]);
    if (managerNameRaw) {
      const dutyDate = toLocalIso(soldAt).slice(0, 10);
      const key = `${storeName || ""}__${dutyDate}`;
      dutyByKey.set(key, { storeName, dutyDate, managerName: String(managerNameRaw).trim() });
    }
  });

  return { sales, duty: [...dutyByKey.values()], errors, hasStoreColumn };
}
