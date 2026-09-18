import { useNavigate, Link } from "react-router-dom";
import { useData } from "../appContext.jsx";
import { getRollup } from "../api.js";
import RangeBar from "./RangeBar.jsx";
import PerfTable from "./PerfTable.jsx";
import { VarianceBars } from "./Charts.jsx";
import { PerformanceStrip, Crumbs, Loading, Stat } from "./Bits.jsx";
import { fmt$signed, fmtPct } from "../format.js";

const CHILD = {
  region: { plural: "Regions", label: "Region", path: (r) => `/regions/${r.id}` },
  area: { plural: "Areas", label: "Area", path: (r) => `/areas/${r.id}` },
  store: { plural: "Restaurants", label: "Restaurant", path: (r) => `/stores/${r.id}` },
};

function Drivers({ rows, level }) {
  const withVar = rows.filter((r) => r.sales_variance !== null);
  const drag = [...withVar].filter((r) => r.sales_variance < 0).sort((a, b) => a.sales_variance - b.sales_variance).slice(0, 3);
  const lift = [...withVar].filter((r) => r.sales_variance > 0).sort((a, b) => b.sales_variance - a.sales_variance).slice(0, 3);
  const item = (r) => <li key={r.id}><Link to={CHILD[level].path(r)}>{r.name}</Link> <span className="money">{fmt$signed(r.sales_variance)}</span> <span className="neutral">({fmtPct(r.sales_variance_pct)})</span></li>;
  return (
    <div className="grid">
      <div className="card"><h3>Pulling the result down</h3>{drag.length ? <ul className="driver-list negative-list">{drag.map(item)}</ul> : <p className="muted">Nothing below forecast.</p>}</div>
      <div className="card"><h3>Lifting the result</h3>{lift.length ? <ul className="driver-list positive-list">{lift.map(item)}</ul> : <p className="muted">Nothing above forecast.</p>}</div>
    </div>
  );
}

/** Region list, one region's areas, or one area's restaurants: same layout, one level down each time. */
export default function RollupPage({ level, regionId = null, areaId = null }) {
  const navigate = useNavigate();
  const { data, error, loading } = useData(getRollup, { level, regionId, areaId });
  if (!data) return <><RangeBar /><Loading error={error} /></>;
  const child = CHILD[level];
  const parent = data.parent;
  if ((regionId || areaId) && !data.rows.length) return <><RangeBar /><div className="card"><p className="muted">Nothing to show here. It may be outside your access.</p></div></>;

  const crumbs = [{ label: "Company", to: "/regions" }];
  if (level === "area") crumbs.push({ label: parent?.region_name });
  if (level === "store") crumbs.push({ label: parent?.region_name, to: `/regions/${parent?.region_id}` }, { label: `${parent?.area_name} area` });
  if (level === "region") crumbs[0] = { label: "Company" };

  const title = level === "region" ? "Regions compared" : level === "area" ? `${parent?.region_name} region` : `${parent?.area_name} area`;
  const hotspotTotal = level === "store" ? data.rows.filter((r) => r.severity === "critical" || r.severity === "needs_review").length : data.rows.reduce((t, r) => t + r.hotspot_count, 0);

  return (
    <div style={{ opacity: loading ? 0.6 : 1 }}>
      <RangeBar />
      <Crumbs items={crumbs} />
      <div className="brief-card">
        <div className="page-title-row">
          <h2>{title}</h2>
          {level === "store" && parent?.area_manager && <span className="muted">Area manager: {parent.area_manager}</span>}
        </div>
        <PerformanceStrip t={data.totals} extra={<Stat label="Hotspots" value={hotspotTotal} lines={[<span key="n" className="neutral">of {data.totals?.restaurants ?? 0} restaurants</span>]} />} />
      </div>

      <div className="grid">
        <div className="card">
          <h3>Sales vs. forecast</h3>
          <VarianceBars data={[...data.rows].sort((a, b) => (a.sales_variance_pct ?? 0) - (b.sales_variance_pct ?? 0))} dataKey="sales_variance_pct" onSelect={(d) => navigate(child.path(d))} />
        </div>
        <div className="card">
          <h3>Labor vs. allowable hours</h3>
          <VarianceBars data={[...data.rows].sort((a, b) => (b.labor_variance_pct ?? 0) - (a.labor_variance_pct ?? 0))} dataKey="labor_variance_pct" goodWhenPositive={false} onSelect={(d) => navigate(child.path(d))} />
        </div>
      </div>

      <Drivers rows={data.rows} level={level} />

      <div className="card">
        <h3>{child.plural}</h3>
        <p className="muted card-sub">Select a column heading to rank by it.</p>
        <PerfTable rows={data.rows} linkFor={child.path} nameLabel={child.label} showSeverity={level === "store"} hideGuest={!data.rows.some((r) => r.survey_count > 0)}
          subtitleFor={level === "area" ? (r) => r.area_manager : level === "store" ? (r) => (r.flags?.length ? r.flags.join(" · ") : null) : null} />
      </div>
    </div>
  );
}
