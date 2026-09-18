import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Delta, SeverityBadge, VarCell } from "./Bits.jsx";
import { fmt$, fmt$signed, fmtHoursSigned, fmtNum, fmtRating, salesTone, laborTone } from "../format.js";

const COLUMNS = [
  { key: "name", label: "Name", text: true },
  { key: "actual_sales", label: "Sales" },
  { key: "sales_variance", label: "vs. forecast $" },
  { key: "sales_variance_pct", label: "vs. forecast %" },
  { key: "prior_year_variance_pct", label: "vs. last year %" },
  { key: "labor_variance", label: "Labor var. hrs" },
  { key: "labor_variance_pct", label: "Labor var. %" },
  { key: "average_rating", label: "Guest rating" },
  { key: "survey_count", label: "Surveys" },
  { key: "hotspot_count", label: "Hotspots" },
];

// Sortable comparison table used for regions, areas and restaurants alike.
export default function PerfTable({ rows, linkFor, nameLabel = "Name", showSeverity = false, subtitleFor = null, hideGuest = false, defaultSort = "sales_variance_pct" }) {
  const [sort, setSort] = useState({ key: defaultSort, dir: 1 });
  const sorted = useMemo(() => {
    const out = [...rows];
    out.sort((a, b) => {
      const av = a[sort.key]; const bv = b[sort.key];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      return (typeof av === "string" ? av.localeCompare(bv) : av - bv) * sort.dir;
    });
    return out;
  }, [rows, sort]);
  const maxOf = (key) => rows.reduce((m, r) => Math.max(m, Math.abs(r[key] ?? 0)), 0);
  const maxSales = maxOf("sales_variance_pct");
  const maxLabor = maxOf("labor_variance_pct");
  const columns = COLUMNS.filter((c) => (c.key !== "hotspot_count" || !showSeverity) && !(hideGuest && (c.key === "average_rating" || c.key === "survey_count")));
  const clickSort = (key) => setSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: key === "name" ? 1 : key.includes("labor") ? -1 : 1 }));

  return (
    <div className="table-scroll">
      <table className="ledger perf">
        <thead>
          <tr>
            <th>#</th>
            {columns.map((c) => (
              <th key={c.key} className={c.text ? "" : "num"} aria-sort={sort.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
                <button type="button" onClick={() => clickSort(c.key)}>{c.key === "name" ? nameLabel : c.label}{sort.key === c.key ? (sort.dir === 1 ? " ↑" : " ↓") : ""}</button>
              </th>
            ))}
            {showSeverity && <th>Status</th>}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={r.id}>
              <td className="neutral">{i + 1}</td>
              <td>
                {linkFor ? <Link to={linkFor(r)}>{r.name}</Link> : r.name}
                {subtitleFor && <div className="cell-sub">{subtitleFor(r)}</div>}
              </td>
              <td className="num money">{fmt$(r.actual_sales)}</td>
              <td className={`num money ${salesTone(r.sales_variance)}`}>{fmt$signed(r.sales_variance)}</td>
              <td className="num"><VarCell value={r.sales_variance_pct} max={maxSales} /></td>
              <td className="num"><Delta value={r.prior_year_variance_pct} /></td>
              <td className={`num money ${laborTone(r.labor_variance)}`}>{fmtHoursSigned(r.labor_variance)}</td>
              <td className="num"><VarCell value={r.labor_variance_pct} max={maxLabor} kind="labor" /></td>
              {!hideGuest && <td className="num money">{fmtRating(r.average_rating)}</td>}
              {!hideGuest && <td className="num money">{fmtNum(r.survey_count)}</td>}
              {!showSeverity && <td className="num money">{r.hotspot_count ? <strong>{r.hotspot_count}</strong> : 0}<span className="neutral"> / {r.restaurants}</span></td>}
              {showSeverity && <td><SeverityBadge severity={r.severity} /></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
