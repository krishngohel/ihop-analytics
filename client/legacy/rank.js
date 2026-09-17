// Ranks stores by performance (percent vs their own target), not raw revenue size —
// a small store beating its target should outrank a big store missing its target.
// Stores with no target set sink to the bottom rather than break the sort.
export function rankByPerformance(rows) {
  const withPct = (rows || []).map((r) => ({
    ...r,
    vsTargetPct: r.targetForPeriod ? (r.vsTarget / r.targetForPeriod) * 100 : null,
  }));
  const sorted = [...withPct].sort((a, b) => {
    if (a.vsTargetPct === null && b.vsTargetPct === null) return b.revenue - a.revenue;
    if (a.vsTargetPct === null) return 1;
    if (b.vsTargetPct === null) return -1;
    return b.vsTargetPct - a.vsTargetPct;
  });
  return sorted.map((r, i) => ({ ...r, rank: i + 1, outOf: sorted.length }));
}
