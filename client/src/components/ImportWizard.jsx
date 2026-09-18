import { useEffect, useState } from "react";
import { previewImport, commitImport, getPendingImports, previewPending, commitPending, discardPending } from "../api.js";
import { prettyTime } from "../format.js";

const CHANNEL = { folder: "reports folder", mailbox: "reports mailbox", push: "push endpoint", rosnet_api: "Rosnet API" };

// Two steps. First the dashboard shows how it read the file and which columns it matched.
// The person corrects any column it got wrong, names the layout, and imports. From then on
// a report in that layout imports by itself from the folder, the mailbox or the push endpoint.
export default function ImportWizard({ onDone, version = 0 }) {
  const [file, setFile] = useState(null); // a chosen upload, or { pending: name, name: filename } for a kept file
  const [pending, setPending] = useState([]);
  const loadPending = () => getPendingImports().then(setPending).catch(() => {});
  useEffect(() => { loadPending(); }, [version]);
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
      const p = f.pending ? await previewPending(f.pending, forcedKind) : await previewImport(f, forcedKind);
      setPreview(p); setMapping(p.mapping); setKind(p.kind);
      setProfileName(p.profile?.name || f.name.replace(/\.[^.]+$/, "").replace(/[\d_-]+$/g, "").trim());
    } catch (e) { setError(e.message); setPreview(null); } finally { setBusy(false); }
  };

  const pick = (e) => { const f = e.target.files?.[0]; if (f) { setFile(f); look(f, null); } };
  const fix = (p) => { const f = { pending: p.name, name: p.filename }; setFile(f); look(f, null); };
  const discard = async (p) => { await discardPending(p.name); if (file?.pending === p.name) { setFile(null); setPreview(null); } loadPending(); };
  const changeKind = (k) => { setKind(k); look(file, k); };
  const setField = (field, column) => setMapping((m) => { const next = { ...m }; if (column) next[field] = column; else delete next[field]; return next; });

  const commit = async () => {
    setBusy(true); setError(null);
    try {
      const r = file.pending ? await commitPending(file.pending, { kind, mapping, profileName: profileName.trim() }) : await commitImport(file, { kind, mapping, profileName: profileName.trim() });
      setResult(r);
      if (r.imported) { setPreview(null); setFile(null); loadPending(); onDone(); }
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
      {pending.length > 0 && (
        <div className="alert warn pending-files">
          <strong>{pending.length === 1 ? "A report arrived in a layout the dashboard doesn't know yet." : `${pending.length} reports arrived in layouts the dashboard doesn't know yet.`}</strong> Fix the columns once here and every later copy imports by itself.
          <ul>{pending.map((p) => (
            <li key={p.name}>
              <span>{p.filename} <span className="neutral">· {CHANNEL[p.channel] || p.channel} · {prettyTime(p.received_at)}</span></span>
              <button type="button" className="btn small" onClick={() => fix(p)} disabled={busy}>Fix layout</button>
              <button type="button" className="link-button dark" onClick={() => discard(p)} disabled={busy}>Discard</button>
            </li>
          ))}</ul>
        </div>
      )}
      <input type="file" accept=".csv,.xlsx,.xls" onChange={pick} disabled={busy} key={file && !file.pending ? "has" : "none"} />
      {file?.pending && <p className="muted" style={{ margin: "8px 0 0" }}>Fixing <strong>{file.name}</strong>.</p>}
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
