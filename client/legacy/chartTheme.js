// Categorical order is fixed and validated (dataviz skill validator, light mode,
// surface #ffffff): worst adjacent CVD ΔE 8.2, worst normal-vision ΔE 17.9 — never
// reorder or cycle past 7 without re-running scripts/validate_palette.js.
// Slot 4 (pancake-gold) ties the chart palette back to the brand accent.
export const CATEGORY_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#d99a2b", "#e87ba4", "#008300", "#4a3aa7"];

// Mirrors StatusBadge's tone colors exactly (App.css .status-badge.tone-*) so a red
// bar and a "Missing target" badge always mean the same thing across the app.
export const STATUS_COLORS = { ok: "#1e6b3c", watch: "#8a5a00", attention: "#b3261e" };

// Fixed name->color assignment (not array position) so a category/daypart keeps its
// color even if a filtered query returns fewer keys or in a different order —
// "color follows the entity, never its rank."
export const CATEGORY_ORDER = ["Pancakes", "Combos", "Omelettes", "Burgers & Sandwiches", "Beverages", "Sides", "Kids"];
export const DAYPART_ORDER = ["Breakfast (5-11)", "Lunch (11-15)", "Afternoon (15-18)", "Dinner (18-22)", "Late Night (22-5)"];

function colorForKey(key, orderList) {
  const idx = orderList.indexOf(key);
  return CATEGORY_COLORS[idx >= 0 ? idx : orderList.length % CATEGORY_COLORS.length];
}

export const categoryColorFor = (name) => colorForKey(name, CATEGORY_ORDER);
export const daypartColorFor = (name) => colorForKey(name, DAYPART_ORDER);

export const KIND_ORDER = ["item_underindex", "local_winner", "daypart_gap", "category_gap"];
export const kindColorFor = (kind) => colorForKey(kind, KIND_ORDER);

export function statusColor(status) {
  return STATUS_COLORS[status?.tone] || STATUS_COLORS.ok;
}
