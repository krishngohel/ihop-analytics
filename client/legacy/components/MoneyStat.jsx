import { useViewMode } from "../viewMode.jsx";
import { fmt$, fmtPct, fmtNum, deltaClass } from "../format.js";

// Global display rule: Detail always shows orders/units beside the dollar figure;
// Scan always shows exactly one companion (usually vs-prior or vs-target) — never a bare $.
export default function MoneyStat({ label, value, companionLabel, companionPct, orders, units, size = "md" }) {
  const { isDetail } = useViewMode();
  const hasDetailSub = orders !== undefined || units !== undefined;

  return (
    <div className={`money-stat size-${size}`}>
      {label && <div className="money-stat-label">{label}</div>}
      <div className="money-stat-value money">{fmt$(value)}</div>
      {isDetail && hasDetailSub && (
        <div className="money-stat-sub neutral">
          {orders !== undefined && <span>{fmtNum(orders)} orders</span>}
          {units !== undefined && <span>{fmtNum(units)} units</span>}
        </div>
      )}
      {!isDetail && companionPct !== undefined && (
        <div className={`money-stat-sub ${deltaClass(companionPct)}`}>
          {fmtPct(companionPct)} {companionLabel || ""}
        </div>
      )}
    </div>
  );
}
