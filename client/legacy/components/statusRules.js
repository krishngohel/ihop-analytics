// Backend ranking/report rows carry `belowAverage` (bool), `vsTarget` (dollar diff from
// target, or null with no target set) and `targetForPeriod` (dollar target for the same
// range). Missing fields read as neutral "On track" rather than crashing.
export function storeStatus({ belowAverage, vsTarget, targetForPeriod } = {}) {
  if (typeof vsTarget === "number" && targetForPeriod > 0 && vsTarget < -0.05 * targetForPeriod) {
    return { tone: "attention", label: "Missing target" };
  }
  if (belowAverage) {
    return { tone: "watch", label: "Below avg" };
  }
  return { tone: "ok", label: "On track" };
}
