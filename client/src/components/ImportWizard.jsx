import { useState } from "react";
import { previewImport, commitImport } from "../api.js";

// Two steps. First the dashboard shows how it read the file and which columns it matched.
// The person corrects any column it got wrong, names the layout, and imports. From then on
// a report in that layout imports by itself from the folder, the mailbox or the push endpoint.
export default function ImportWizard({ onDone }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [mapping, setMapping] = useState({});
  const [kind, setKind] = useState("performance");
  const [profileName, setProfileName] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const look = async (f, forcedKind) => {
    setBusy(true); setError(null); setResult(null);
    try {
      const p = await previewImport(f, forcedKind);
      setPreview(p); setMapping(p.mapping); setKind(p.kind);
      setProfileName(p.profile?.name || f.name.replace(/\.[^.]+$/, "").replace(/[\d_-]+$/g, "").trim());
    } catch (e) { setError(e.message); setPreview(null); } finally { setBusy(false); }
  };

  const pick = (e) => { const f = e.target.files?.[0]; if (f) { setFile(f); look(f, null); } };
  const changeKind = (k) => { setKind(k); look(file, k); };
  const setField = (field, column) => setMapping((m) => { const next = { ...m }; if (column) next[field] = column; else delete next[field]; return next; });

  const commit = async () => {
    setBusy(true); setError(null);
    try {
      const r = await commitImport(file, { kind, mapping, profileName: profileName.trim() });
      setResult(r);
      if (r.imported) { setPreview(null); setFile(null); onDone(); }
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const hasStore = mapping.store_number || mapping.restaurant_name;
  const used = new Set(Object.values(mapping));

  return (
    <div className="import-box">
      <h4>Import a report, or teach the dashboard a new report layout</h4>
      <p className="muted">
        Choose any Rosnet sales, labor or forecast report, or a Merchant Centric STARS export (CSV or Excel). Check the column matches once and save the layout.
        After that, the same report arriving by folder, email or push imports with no one involved.
        Templates: <a href="/api/import/template/performance">sales and labor</a>, <a href="/api/import/template/guest">guest metrics</a>.
      </p>
      <input type="file" accept=".csv,.xlsx,.xls" onChange={pick} disabled={busy} key={file ? "has" : "none"} />
      {busy && <p className="muted">Working…</p>}
      {error && <div className="alert err">{error}</div>}

      {preview && (
        <div className="wizard">
          <div className="wizard-head">
            <span>Read <strong>{preview.row_count}</strong> rows. Column names found on row {preview.header_row}.{preview.profile ? ` Recognized as "${preview.profile.name}".` : ""}</span>
            <label>This file is{" "}
              <select value={kind} onChange={(e) => changeKind(e.target.value)}>
                <option value="performance">Sales / labor / forecast (Rosnet)</option>
                <option value="guest">Guest metrics / reviews (Merchant Centric STARS)</option>
              </select>
            </label>
          </div>

          <div className="mapping-grid">
            {preview.fields.map((f) => (
              <label key={f.key} className={mapping[f.key] ? "mapped" : ""}>
                <span>{f.label}</span>
                <select value={mapping[f.key] || ""} onChange={(e) => setField(f.key, e.target.value)}>
                  <option value="">Not in this report</option>
                  {preview.headers.map((h) => <option key={h} value={h}>{h}{used.has(h) && mapping[f.key] !== h ? " (already used)" : ""}</option>)}
                </select>
              </label>
            ))}
          </div>

          {!mapping.date && (
            <div className="alert warn">
              No date column. {preview.date_fallback ? `The date in the report title (${preview.date_fallback}) will be used.` : "Rows will be filed under the date in the file name, or under the prior business day when the report arrives automatically."}
            </div>
          )}
          {!hasStore && <div className="alert err">Choose the column that identifies the restaurant (store number or name).</div>}

          <div className="table-scroll">
            <table className="ledger small">
              <thead><tr>{preview.headers.map((h) => <th key={h} className={used.has(h) ? "col-used" : ""}>{h}</th>)}</tr></thead>
              <tbody>{preview.sample.map((r, i) => <tr key={i}>{preview.headers.map((h) => <td key={h}>{r[h]}</td>)}</tr>)}</tbody>
            </table>
          </div>

          <div className="wizard-foot">
            <label>Save this layout as <input value={profileName} onChange={(e) => setProfileName(e.target.value)} placeholder="e.g. Rosnet Daily Sales Flash" /></label>
            <button type="button" className="btn" disabled={busy || !hasStore} onClick={commit}>Import{profileName.trim() ? " and remember this layout" : ""}</button>
          </div>
        </div>
      )}

      {result && (
        <div className={`alert ${result.imported ? "ok" : "err"}`}>
          {result.imported} rows imported{result.skipped ? `, ${result.skipped} skipped` : ""}{result.first_date ? ` (${result.first_date}${result.last_date !== result.first_date ? ` to ${result.last_date}` : ""})` : ""}.
          {result.profile && ` Layout saved as "${result.profile}".`}
          {result.clearedDemoData && " Demonstration data was cleared."}
          {result.newRestaurants?.length > 0 && ` ${result.newRestaurants.length} new restaurants added.`}
          {result.errors?.length > 0 && <ul>{result.errors.slice(0, 8).map((x) => <li key={x}>{x}</li>)}</ul>}
        </div>
      )}
    </div>
  );
}
