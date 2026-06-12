import { useState } from "react";
import Dashboard from "./Dashboard.jsx";
import Upload from "./Upload.jsx";
import Entries from "./Entries.jsx";
import Reports from "./Reports.jsx";

const TABS = ["Dashboard", "Reports", "Upload Data", "Staff Inputs"];

export default function App() {
  const [tab, setTab] = useState("Dashboard");
  return (
    <>
      <header className="topbar">
        <h1>IHOP <span>Sales Analytics</span></h1>
        <nav className="tabs">
          {TABS.map((t) => (
            <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </nav>
      </header>
      <main className="page">
        {tab === "Dashboard" && <Dashboard />}
        {tab === "Reports" && <Reports />}
        {tab === "Upload Data" && <Upload />}
        {tab === "Staff Inputs" && <Entries />}
      </main>
    </>
  );
}
