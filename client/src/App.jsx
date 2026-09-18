import { useEffect, useState } from "react";
import { Routes, Route, NavLink, Navigate, useNavigate, useLocation } from "react-router-dom";
import { useApp } from "./appContext.jsx";
import { signOut } from "./api.js";
import { prettyTime } from "./format.js";
import { useTheme } from "./theme.js";
import { Brand, OverviewIcon, HotspotIcon, RegionsIcon, StoreIcon, SummaryIcon, ForecastIcon, DataIcon, RefreshIcon, SunIcon, MoonIcon, SignOutIcon, MenuIcon, InfoIcon, AlertIcon } from "./components/Icons.jsx";
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

const initials = (name) => String(name || "?").split(/\s+/).filter((w) => /^[\p{L}\d]/u.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join("");

// The top bar names the section you are in; drill-down pages sit under "Regions and areas".
function sectionTitle(pathname, links) {
  if (/^\/(regions|areas|stores)\//.test(pathname)) return links.find((l) => l.to === pathname)?.label || "Regions and areas";
  return links.find((l) => (l.end ? pathname === l.to : pathname.startsWith(l.to)))?.label || "Overview";
}

export default function App() {
  const { user, setUser, meta, refresh, refreshing, refreshNow } = useApp();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { theme, toggle } = useTheme();
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => { setNavOpen(false); }, [pathname]);
  // A brand new install has nothing to show yet: take the administrator straight to setup.
  const empty = Boolean(meta && !meta.bounds.first_day);
  useEffect(() => { if (empty && user?.role === "executive" && pathname === "/") navigate("/data", { replace: true }); }, [empty, user, pathname, navigate]);

  if (user === undefined) return <div className="boot">Loading…</div>;
  if (!user) return <Login />;
  if (!meta) return <div className="boot">Loading…</div>;

  const wide = user.role === "executive" || user.role === "region";
  const links = [
    ...(wide ? [{ to: "/", label: "Overview", end: true, icon: OverviewIcon }] : []),
    { to: "/hotspots", label: "Hotspots", icon: HotspotIcon },
    ...(wide ? [{ to: "/regions", label: "Regions and areas", icon: RegionsIcon }] : []),
    ...(user.role === "area" ? [{ to: `/areas/${user.scope_id}`, label: "My area", icon: RegionsIcon }] : []),
    ...(user.role === "store" ? [{ to: `/stores/${user.scope_id}`, label: "My restaurant", icon: StoreIcon }] : []),
    { to: "/summary", label: "Daily summary", icon: SummaryIcon },
    { to: "/forecast", label: "Weekly forecast form", icon: ForecastIcon },
    { to: "/data", label: "Data and refresh", icon: DataIcon, group: "Setup" },
  ];
  const stale = Boolean(meta.freshness?.stale);

  return (
    <div className={`app${navOpen ? " nav-open" : ""}`}>
      <aside className="sidebar no-print">
        <Brand />
        <nav className="nav" aria-label="Main">
          {links.map((l) => (
            <span key={l.to} style={{ display: "contents" }}>
              {l.group && <div className="nav-heading">{l.group}</div>}
              <NavLink to={l.to} end={l.end} className={({ isActive }) => "nav-link" + (isActive || (l.to === "/regions" && /^\/(areas|stores)\//.test(pathname) && wide) ? " active" : "")}>
                <l.icon />{l.label}
              </NavLink>
            </span>
          ))}
        </nav>
        <div className="side-foot">
          <div className="user-chip">
            <span className="avatar">{initials(user.display_name)}</span>
            <span className="user-meta">
              <strong>{user.display_name}</strong>
              <span title={`${ROLE_LABEL[user.role]}: ${user.scope_name}`}>{ROLE_LABEL[user.role]}: {user.scope_name}</span>
            </span>
          </div>
          <div className="side-actions">
            <button type="button" className="side-btn" onClick={toggle} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}>
              {theme === "dark" ? <SunIcon size={15} /> : <MoonIcon size={15} />}{theme === "dark" ? "Light" : "Dark"}
            </button>
            <button type="button" className="side-btn" onClick={() => signOut().finally(() => { sessionStorage.clear(); navigate("/"); setUser(null); })}>
              <SignOutIcon size={15} />Sign out
            </button>
          </div>
        </div>
      </aside>
      <button type="button" className="scrim" aria-label="Close menu" onClick={() => setNavOpen(false)} />

      <div className="main">
        <header className="topbar no-print">
          <div className="topbar-left">
            <button type="button" className="menu-btn" aria-label="Open menu" onClick={() => setNavOpen(true)}><MenuIcon /></button>
            <h1>{sectionTitle(pathname, links)}</h1>
          </div>
          <div className="topbar-right">
            <div className="refresh-status">
              <i className={`live-dot${stale ? " stale" : ""}`} aria-hidden="true" />
              <span><span className="refresh-label">Data refreshed </span><strong>{prettyTime(refresh?.last?.finished_at)}</strong></span>
            </div>
            <button type="button" className="btn secondary small" onClick={refreshNow} disabled={refreshing}>
              <RefreshIcon size={14} className={refreshing ? "spin" : ""} />{refreshing ? "Refreshing…" : "Refresh now"}
            </button>
          </div>
        </header>
        {meta.data_source === "demo" && (
          <div className="demo-banner no-print">
            <InfoIcon size={15} />
            <span>Demonstration data. Restaurants, sales, labor and guest figures are generated; weather is real. Connect Rosnet and Merchant Centric STARS under Data and refresh.</span>
          </div>
        )}
        {stale && (
          <div className="stale-banner no-print"><AlertIcon size={15} /><span>{meta.freshness.message} You are looking at older results. <NavLink to="/data">See data inputs</NavLink></span></div>
        )}
        <main className="page">
          {!meta.bounds.first_day && pathname !== "/data" && (
            <div className="brief-card">
              <p className="verdict">Welcome. There are no results on file yet.</p>
              <p className="muted" style={{ margin: "8px 0 14px" }}>
                {user.role === "executive" ? "Connect Rosnet and load your restaurants. It takes a few minutes, all from this screen." : "An administrator is still connecting Rosnet. Results will appear here once they arrive."}
              </p>
              {user.role === "executive" && <NavLink className="btn" to="/data">Start setup</NavLink>}
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
    </div>
  );
}
