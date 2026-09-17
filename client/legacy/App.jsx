import { Routes, Route } from "react-router-dom";
import { useEffect, useState } from "react";
import { ViewModeProvider } from "./viewMode.jsx";
import ScanDetailToggle from "./components/ScanDetailToggle.jsx";
import LeftRail from "./components/LeftRail.jsx";
import RegionBrief from "./pages/RegionBrief.jsx";
import StoreZoom from "./pages/StoreZoom.jsx";
import Opportunities from "./pages/Opportunities.jsx";
import Reports from "./pages/Reports.jsx";
import Upload from "./pages/Upload.jsx";
import Notes from "./pages/Notes.jsx";
import { getStores } from "./api.js";

export default function App() {
  const [stores, setStores] = useState([]);

  useEffect(() => {
    getStores().then(setStores).catch(() => {});
  }, []);

  return (
    <ViewModeProvider>
      <header className="topbar">
        <h1>IHOP <span>Regional</span></h1>
        <ScanDetailToggle />
      </header>
      <div className="shell">
        <LeftRail stores={stores} />
        <main className="page">
          <Routes>
            <Route path="/" element={<RegionBrief />} />
            <Route path="/stores/:id" element={<StoreZoom />} />
            <Route path="/opportunities" element={<Opportunities />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/upload" element={<Upload />} />
            <Route path="/notes" element={<Notes />} />
          </Routes>
        </main>
      </div>
    </ViewModeProvider>
  );
}
