// Turns long-format rows like { storeId, storeName, daypart, revenue } into a
// stores-as-rows / distinct-column-value-as-columns matrix for display tables.
export function pivotMatrix(rows, { rowKey, rowLabelKey, colKey, valueKey }) {
  const cols = [...new Set((rows || []).map((r) => r[colKey]))];
  const byRow = new Map();
  for (const r of rows || []) {
    const id = r[rowKey];
    if (!byRow.has(id)) byRow.set(id, { id, label: r[rowLabelKey] ?? id, values: {} });
    byRow.get(id).values[r[colKey]] = r[valueKey];
  }
  return { cols, rows: [...byRow.values()] };
}
