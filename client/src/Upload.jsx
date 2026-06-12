import { useState } from "react";

export default function Upload() {
  const [result, setResult] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  async function handleFile(file) {
    if (!file) return;
    setBusy(true); setErr(null); setResult(null);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || res.status);
      setResult(json);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ maxWidth: 640 }}>
      <h3>Upload Sales Data (.xlsx)</h3>
      <p className="muted">
        Expected columns: <b>Date, Time, Item, Category, Quantity, Unit Price, Total, Payment Method</b>.
        Missing totals are computed from quantity x unit price.{" "}
        <a href="/api/template">Download the Excel template</a>.
      </p>
      <p className="muted">
        Your first upload clears the built-in sample data and starts fresh.
        Every upload after that adds to your existing data.
      </p>
      <div
        className="dropzone"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); }}
      >
        <p>Drag an Excel file here, or</p>
        <input type="file" accept=".xlsx,.xls" onChange={(e) => handleFile(e.target.files[0])} />
      </div>
      {busy && <p className="muted">Importing...</p>}
      {result && (
        <div className={`alert ${result.imported ? "ok" : "err"}`}>
          {result.replaced ? "Sample data cleared - this file is now your data. " : "Added to existing data. "}
          Imported {result.imported} rows{result.skipped ? `, skipped ${result.skipped}` : ""}.
          {result.errors?.length > 0 && (
            <ul>{result.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
          )}
        </div>
      )}
      {err && <div className="alert err">{err}</div>}
    </div>
  );
}
