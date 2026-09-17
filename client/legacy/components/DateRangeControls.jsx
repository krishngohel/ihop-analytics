import { daysAgo } from "../format.js";

export default function DateRangeControls({ from, to, onFrom, onTo }) {
  // Ranges end yesterday: today's sales aren't in yet, and a partial day skews vs-prior.
  const setRange = (n) => {
    onFrom(daysAgo(n + 1));
    onTo(daysAgo(1));
  };
  return (
    <div className="filters no-print">
      <label>From <input type="date" value={from} onChange={(e) => onFrom(e.target.value)} /></label>
      <label>To <input type="date" value={to} onChange={(e) => onTo(e.target.value)} /></label>
      <button type="button" className="btn secondary" onClick={() => setRange(6)}>7d</button>
      <button type="button" className="btn secondary" onClick={() => setRange(29)}>30d</button>
      <button type="button" className="btn secondary" onClick={() => setRange(89)}>90d</button>
    </div>
  );
}
