import { useState } from "react";
import { useApp, useData } from "../appContext.jsx";
import { getHotspots } from "../api.js";
import RangeBar from "../components/RangeBar.jsx";
import HotspotCard from "../components/HotspotCard.jsx";
import { Loading } from "../components/Bits.jsx";
import { prettyDay } from "../format.js";

export default function Hotspots() {
  const { meta, range } = useApp();
  const [regionId, setRegionId] = useState("");
  const [areaId, setAreaId] = useState("");
  const [category, setCategory] = useState("overall");
  const [tab, setTab] = useState("hotspots");
  const { data: h, error, loading } = useData(getHotspots, { regionId, areaId, category });

  const regions = meta.hierarchy;
  const areas = regions.filter((r) => !regionId || String(r.region_id) === String(regionId)).flatMap((r) => r.areas);
  const single = range.from === range.to;

  const filters = (
    <>
      {regions.length > 1 && (
        <label>Region{" "}
          <select value={regionId} onChange={(e) => { setRegionId(e.target.value); setAreaId(""); }}>
            <option value="">All regions</option>
            {regions.map((r) => <option key={r.region_id} value={r.region_id}>{r.region_name}</option>)}
          </select>
        </label>
      )}
      {areas.length > 1 && (
        <label>Area{" "}
          <select value={areaId} onChange={(e) => setAreaId(e.target.value)}>
            <option value="">All areas</option>
            {areas.map((a) => <option key={a.area_id} value={a.area_id}>{a.area_name}</option>)}
          </select>
        </label>
      )}
    </>
  );

  if (!h) return <><RangeBar>{filters}</RangeBar><Loading error={error} /></>;
  const list = tab === "hotspots" ? h.hotspots : tab === "watch" ? h.watch : h.positives;

  return (
    <div style={{ opacity: loading ? 0.6 : 1 }}>
      <RangeBar>{filters}</RangeBar>
      <div className="page-title-row">
        <h2>Hotspots</h2>
        <span className="muted">{h.hotspots.length} of {h.restaurants} restaurants · last-year comparison uses {prettyDay(h.lastYearFrom, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}{single ? "" : ` to ${prettyDay(h.lastYearTo)}`}</span>
      </div>

      <div className="pill-group wrap" role="group" aria-label="Hotspot category">
        {Object.entries(meta.hotspot_categories).map(([key, label]) => (
          <button key={key} type="button" className={category === key && tab === "hotspots" ? "active" : ""} onClick={() => { setCategory(key); setTab("hotspots"); }}>
            {label} <span className="count">{h.counts[key]}</span>
          </button>
        ))}
      </div>
      <div className="pill-group wrap secondary" role="group" aria-label="Other lists">
        <button type="button" className={tab === "watch" ? "active" : ""} onClick={() => { setCategory("overall"); setTab("watch"); }}>Watch list <span className="count">{category === "overall" ? h.watch.length : "…"}</span></button>
        <button type="button" className={tab === "positives" ? "active" : ""} onClick={() => setTab("positives")}>Positive outliers <span className="count">{h.positives.length}</span></button>
      </div>

      <details className="method">
        <summary>How restaurants land on this list</summary>
        <p>
          Every restaurant is ranked three ways: sales vs. forecast, sales vs. the comparable day last year, and labor hours vs. allowable hours.
          The worst {Math.round(h.share * 100)}% on each measure ({h.listSize} restaurants here) form the category lists. The overall list is the worst {Math.round(h.share * 100)}% by
          combined rank, and always includes any restaurant with sales down {Math.abs(meta.unusual_drop_pct)}% or more, or a possible opening-time issue.
          Critical means an unusually large drop, or sales down {Math.abs(meta.critical_sales_pct)}% or more together with labor {meta.critical_labor_pct}% or more over allowable. Watch means a restaurant is on one category list but not in the overall group.
          Flags report what the numbers show. Weather is shown as context. Neither claims a cause.
        </p>
      </details>

      {list.length === 0 && <div className="card"><p className="muted">No restaurants in this list for the current selection.</p></div>}
      <div className="hotspot-list">
        {list.map((s) => <HotspotCard key={s.id} s={s} single={single} />)}
      </div>
    </div>
  );
}
