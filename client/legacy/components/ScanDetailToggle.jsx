import { useViewMode } from "../viewMode.jsx";

export default function ScanDetailToggle() {
  const { mode, toggle } = useViewMode();
  return (
    <button type="button" className="scan-detail-toggle no-print" onClick={toggle} aria-label="Toggle Scan / Detail view">
      <span className={mode === "scan" ? "active" : ""}>Scan</span>
      <span className={mode === "detail" ? "active" : ""}>Detail</span>
    </button>
  );
}
