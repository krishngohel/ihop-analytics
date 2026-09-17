import { Routes, Route, NavLink, Navigate, useNavigate } from "react-router-dom";
import { useApp } from "./appContext.jsx";
import { signOut } from "./api.js";
import { prettyTime } from "./format.js";
import Login from "./pages/Login.jsx";
import Overview from "./pages/Overview.jsx";
import Hotspots from "./pages/Hotspots.jsx";
import Regions from "./pages/Regions.jsx";
import RegionView from "./pages/RegionView.jsx";
import AreaView from "./pages/AreaView.jsx";
import StoreView from "./pages/StoreView.jsx";
import DailySummary from "./pages/DailySummary.jsx";
import ForecastForm from "./pages/ForecastForm.jsx";
import DataRefresh from "./pages/DataRefresh.jsx";

const ROLE_LABEL = { executive: "Company-wide access", region: "Region access", area: "Area access", store: "Store access" };

function homePath(user) {
  if (user.role === "area") return `/areas/${user.scope_id}`;
  if (user.role === "store") return `/stores/${user.scope_id}`;
  return "/";
}

export default function App() {
  const { user, setUser, meta, refresh, refreshing, refreshNow } = useApp();
  const navigate = useNavigate();

  if (user === undefined) return <div className="boot">Loading…</div>;
  if (!user) return <Login />;
  if (!meta) return <div className="boot">Loading…</div>;

  const wide = user.role === "executive" || user.role === "region";
  const links = [
    ...(wide ? [{ to: "/", label: "Overview", end: true }] : []),
    { to: "/hotspots", label: "Hotspots" },
    ...(wide ? [{ to: "/regions", label: "Regions and areas" }] : []),
    ...(user.role === "area" ? [{ to: `/areas/${user.scope_id}`, label: "My area" }] : []),
    ...(user.role === "store" ? [{ to: `/stores/${user.scope_id}`, label: "My restaurant" }] : []),
    { to: "/summary", label: "Daily summary" },
    { to: "/forecast", label: "Weekly forecast form" },
    { to: "/data", label: "Data and refresh" },
  ];

  return (
    <>
      <header className="topbar no-print">
        <h1>IHOP <span>Operations</span></h1>
        <div className="topbar-right">
          <div className="refresh-status">
            <span className="refresh-label">Data refreshed</span>
            <span>{prettyTime(refresh?.last?.finished_at)}</span>
          </div>
          <button type="button" className="btn gold small" onClick={refreshNow} disabled={refreshing}>{refreshing ? "Refreshing…" : "Refresh now"}</button>
          <div className="user-chip">
            <strong>{user.display_name}</strong>
            <span>{ROLE_LABEL[user.role]}: {user.scope_name}</span>
          </div>
          <button type="button" className="link-button" onClick={() => signOut().finally(() => { sessionStorage.clear(); navigate("/"); setUser(null); })}>Sign out</button>
        </div>
      </header>
      {meta.data_source === "demo" && (
        <div className="demo-banner no-print">
          Demonstration data. Restaurants, sales, labor and guest figures are generated; weather is real. Connect Rosnet and Merchant Centric STARS under Data and refresh.
        </div>
      )}
      {meta.freshness?.stale && (
        <div className="stale-banner no-print">{meta.freshness.message} You are looking at older results. <NavLink to="/data">See data inputs</NavLink></div>
      )}
      <div className="shell">
        <nav className="left-rail no-print">
          <div className="rail-section">
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => "rail-link" + (isActive ? " active" : "")}>{l.label}</NavLink>
            ))}
          </div>
        </nav>
        <main className="page">
          {!meta.bounds.first_day && (
            <div className="brief-card" style={{ paddingBottom: 18 }}>
              <p className="verdict">Welcome. There are no results on file yet.</p>
              <p className="muted" style={{ margin: "8px 0 0" }}>
                Go to <NavLink to="/data">Data and refresh</NavLink>, import one copy of each Rosnet report and your Merchant Centric STARS export, and save their layouts. After that, reports that arrive by folder, email or push load on their own.
              </p>
            </div>
          )}
          <Routes>
            <Route path="/" element={wide ? <Overview /> : <Navigate to={homePath(user)} replace />} />
            <Route path="/hotspots" element={<Hotspots />} />
            <Route path="/regions" element={<Regions />} />
            <Route path="/regions/:id" element={<RegionView />} />
            <Route path="/areas/:id" element={<AreaView />} />
            <Route path="/stores/:id" element={<StoreView />} />
            <Route path="/summary" element={<DailySummary />} />
            <Route path="/forecast" element={<ForecastForm />} />
            <Route path="/data" element={<DataRefresh />} />
            <Route path="*" element={<Navigate to={homePath(user)} replace />} />
          </Routes>
        </main>
      </div>
    </>
  );
}
