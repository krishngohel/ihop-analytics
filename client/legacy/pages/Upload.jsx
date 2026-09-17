import { useEffect, useState } from "react";
import { getStores, uploadFile } from "../api.js";
import { fmtNum } from "../format.js";

export default function Upload() {
  const [stores, setStores] = useState([]);
  const [storeChoice, setStoreChoice] = useState("");
  const [newStoreName, setNewStoreName] = useState("");
  const [result, setResult] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { getStores().then(setStores).catch(() => {}); }, []);

  async function handleFile(file) {
    if (!file) return;
    setBusy(true); setErr(null); setResult(null);
    try {
      const opts = {};
      if (storeChoice === "__new__") opts.storeName = newStoreName.trim();
      else if (storeChoice) opts.storeId = storeChoice;
      const json = await uploadFile(file, opts);
      setResult(json);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  const needsNewName = storeChoice === "__new__" && !newStoreName.trim();

  return (
    <div className="card" style={{ maxWidth: 680 }}>
      <h3>Upload sales data (.xlsx)</h3>
      <p className="muted">
        Expected columns: <b>Date, Time, Item, Category, Quantity, Unit Price, Total, Payment Method</b>, plus optional
        <b> Store, Line Type</b> (sale/comp/void/discount) and <b>Manager</b> columns.
        Missing totals are computed from quantity × unit price.{" "}
        <a href="/api/template">Download the Excel template</a>.
      </p>
      <p className="muted">
        Your first real upload clears the built-in demo data and starts fresh. Every upload after that adds to your existing data.
      </p>

      <div className="form" style={{ marginBottom: 16 }}>
        <label>Which store is this file for?
          <select value={storeChoice} onChange={(e) => setStoreChoice(e.target.value)}>
            <option value="">This file already has a Store column (multiple stores)</option>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            <option value="__new__">+ Add a new store</option>
          </select>
        </label>
        {storeChoice === "__new__" && (
          <input placeholder="New store name" value={newStoreName} onChange={(e) => setNewStoreName(e.target.value)} />
        )}
      </div>

      <div
        className="dropzone"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); if (!needsNewName) handleFile(e.dataTransfer.files[0]); }}
      >
        <p>Drag an Excel file here, or</p>
        <input type="file" accept=".xlsx,.xls" disabled={needsNewName} onChange={(e) => handleFile(e.target.files[0])} />
        {needsNewName && <p className="muted">Enter a name for the new store first.</p>}
      </div>

      {busy && <p className="muted">Importing…</p>}
      {result && (
        <div className={`alert ${result.imported ? "ok" : "err"}`}>
          {result.wiped ? "Demo data cleared. This file is now your data. " : "Added to existing data. "}
          Imported {fmtNum(result.imported)} rows{result.skipped ? `, skipped ${fmtNum(result.skipped)}` : ""}.
          {result.detectedStoreColumn && <div>Detected a Store column. Rows were split across stores automatically.</div>}
          {result.stores?.length > 0 && (
            <ul>
              {result.stores.map((s) => (
                <li key={s.id ?? s.name}>{s.name}{s.isNew ? " (new)" : ""}: {fmtNum(s.rows)} rows</li>
              ))}
            </ul>
          )}
          {(result.managerColumnUsed || result.lineTypeColumnUsed) && (
            <div className="muted">
              {result.managerColumnUsed && "Manager column used to log duty. "}
              {result.lineTypeColumnUsed && "Line Type column used for comps/voids/discounts."}
            </div>
          )}
          {result.errors?.length > 0 && <ul>{result.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
        </div>
      )}
      {err && <div className="alert err">{err}</div>}
    </div>
  );
}
