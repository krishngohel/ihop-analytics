import { NavLink } from "react-router-dom";

const LINKS = [
  { to: "/", label: "Region", end: true },
  { to: "/opportunities", label: "Opportunities" },
  { to: "/reports", label: "Reports" },
  { to: "/upload", label: "Upload" },
  { to: "/notes", label: "Notes" },
];

export default function LeftRail({ stores = [] }) {
  return (
    <nav className="left-rail no-print">
      <div className="rail-section">
        {LINKS.map((l) => (
          <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => "rail-link" + (isActive ? " active" : "")}>
            {l.label}
          </NavLink>
        ))}
      </div>
      {stores.length > 0 && (
        <div className="rail-section">
          <div className="rail-heading">Stores</div>
          {stores.map((s) => (
            <NavLink key={s.id} to={`/stores/${s.id}`} className={({ isActive }) => "rail-link store" + (isActive ? " active" : "")}>
              {s.name}
            </NavLink>
          ))}
        </div>
      )}
    </nav>
  );
}
