import { useEffect, useMemo, useState } from "react";
import { useApp } from "../appContext.jsx";
import { getRefreshStatus, saveRefreshSettings, getImportProfiles, deleteImportProfile, getUsers, createUser, setUserActive, getAudit } from "../api.js";
import ImportWizard from "../components/ImportWizard.jsx";
import Connections from "../components/Connections.jsx";
import { Loading, ToneBadge } from "../components/Bits.jsx";
import { prettyTime } from "../format.js";

const TRIGGER = { manual: "Manual", scheduled_daily: "Scheduled daily", intraday: "Intraday", startup: "Server start" };
const RUN_TONE = { ok: "ok", partial: "watch", failed: "attention", running: "neutral" };

const CHANNEL = { upload: "Upload", folder: "Watched folder", mailbox: "Reports mailbox", push: "Push endpoint", rosnet_api: "Rosnet API" };
const FILE_TONE = { ok: "ok", partial: "watch", needs_mapping: "attention", rejected: "attention" };
const FILE_LABEL = { ok: "Imported", partial: "Imported with skips", needs_mapping: "Needs column mapping", rejected: "Rejected" };

function Channel({ title, on, status, children }) {
  return (
    <div className={`channel ${on ? "on" : ""}`}>
      <div className="channel-head"><strong>{title}</strong><ToneBadge tone={on ? "ok" : "neutral"}>{status}</ToneBadge></div>
      <p className="muted">{children}</p>
    </div>
  );
}

// The ways Rosnet and Merchant Centric STARS can feed the dashboard with nobody logging in to
// either. Whichever the vendor supports is switched on with environment settings on the server.
function AutomaticInputs({ status, isExec }) {
  const f = status.freshness;
  return (
    <div className="card">
      <h3>{isExec ? "Data status" : "Automatic data inputs"}</h3>
      {!isExec && (
        <p className="muted card-sub">
          Rosnet (sales, labor, forecasts) is read through its API, and both Rosnet and Merchant Centric STARS (reviews and guest ratings) can send scheduled reports here. The dashboard never signs in to either website. An administrator sets these up.
        </p>
      )}
      {f.stale && <div className="alert err"><strong>{f.message}</strong> Check that the scheduled reports are still being sent.</div>}
      {f.files_needing_mapping > 0 && <div className="alert warn">{f.files_needing_mapping} received file{f.files_needing_mapping === 1 ? "" : "s"} could not be read because the layout is new. Fix the columns under Reports and layouts below; the file is waiting there.</div>}
      {!isExec && <div className="channels">
        <Channel title="Rosnet API" on={Boolean(status.rosnet_api?.configured)} status={status.rosnet_api?.configured ? "Connected" : "Not set up"}>
          Net sales (live through the day), last year, worked and scheduled labor, and the store list, straight from Rosnet on every refresh.
        </Channel>
        <Channel title="Reports mailbox" on={status.mailbox.configured} status={status.mailbox.configured ? `Reading ${status.mailbox.user}` : "Not set up"}>
          Rosnet and STARS email their scheduled reports to a dedicated inbox. Attachments from trusted senders are imported.
        </Channel>
        <Channel title="Reports folder" on={Boolean(status.import_folder)} status="Watching">
          Reports saved into the dashboard's folder are imported, then moved to processed or rejected.
        </Channel>
      </div>}
      <p className="muted">Latest complete business day on file: <strong>{f.last_final_day || "none"}</strong> · guest metrics through <strong>{f.last_guest_day || "none"}</strong>{f.last_file ? ` · last file received ${prettyTime(f.last_file.received_at)} via ${CHANNEL[f.last_file.channel] || f.last_file.channel}` : ""}</p>
    </div>
  );
}

function FilesReceived({ files }) {
  return (
    <div className="card">
      <h3>Files received</h3>
      {files.length === 0 ? <p className="muted">No files yet.</p> : (
        <div className="table-scroll tall">
          <table className="ledger small">
            <thead><tr><th>Received</th><th>Channel</th><th>File</th><th>Type</th><th>Layout</th><th className="num">Rows</th><th>Business days</th><th>Result</th></tr></thead>
            <tbody>{files.map((x) => (
              <tr key={x.ingest_id}>
                <td>{prettyTime(x.received_at)}</td><td>{CHANNEL[x.channel] || x.channel}{x.sender ? <div className="cell-sub">{x.sender}</div> : null}</td>
                <td>{x.filename}</td><td>{x.kind === "guest" ? "Guest metrics" : x.kind === "performance" ? "Sales / labor" : "-"}</td><td>{x.profile_name || "Standard columns"}</td>
                <td className="num money">{x.imported}{x.skipped ? <span className="neutral"> (+{x.skipped} skipped)</span> : null}</td>
                <td>{x.first_date ? (x.first_date === x.last_date ? x.first_date : `${x.first_date} to ${x.last_date}`) : "-"}</td>
                <td><ToneBadge tone={FILE_TONE[x.status] || "neutral"}>{FILE_LABEL[x.status] || x.status}</ToneBadge>{x.detail && x.status !== "ok" ? <div className="cell-sub wrap">{x.detail}</div> : null}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Layouts({ version }) {
  const [profiles, setProfiles] = useState(null);
  const load = () => getImportProfiles().then(setProfiles).catch(() => {});
  useEffect(() => { load(); }, [version]);
  if (!profiles?.length) return null;
  return (
    <div className="card">
      <h3>Saved report layouts</h3>
      <p className="muted card-sub">Reports in these layouts import automatically.</p>
      <table className="ledger small">
        <thead><tr><th>Layout</th><th>Type</th><th>Columns used</th><th>Last used</th><th /></tr></thead>
        <tbody>{profiles.map((p) => (
          <tr key={p.profile_id}>
            <td><strong>{p.name}</strong></td><td>{p.kind === "guest" ? "Guest metrics" : "Sales / labor"}</td>
            <td><div className="cell-sub wrap">{Object.values(p.mapping).join(", ")}</div></td><td>{prettyTime(p.last_used_at)}</td>
            <td className="num"><button type="button" className="link-button dark" onClick={() => deleteImportProfile(p.profile_id).then(load)}>Remove</button></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function Users({ meta }) {
  const [users, setUsers] = useState(null);
  const [form, setForm] = useState({ email: "", display_name: "", role: "area", scope_id: "" });
  const [created, setCreated] = useState(null);
  const [error, setError] = useState(null);
  const load = () => getUsers().then(setUsers).catch(() => {});
  useEffect(() => { load(); }, []);

  const scopes = useMemo(() => ({
    region: meta.hierarchy.map((r) => ({ id: r.region_id, name: r.region_name })),
    area: meta.hierarchy.flatMap((r) => r.areas.map((a) => ({ id: a.area_id, name: `${r.region_name}: ${a.area_name}` }))),
    store: meta.hierarchy.flatMap((r) => r.areas.flatMap((a) => a.restaurants.map((s) => ({ id: s.restaurant_id, name: s.restaurant_name })))),
  }), [meta]);

  const submit = async (e) => {
    e.preventDefault();
    setError(null); setCreated(null);
    try { setCreated(await createUser(form)); setForm({ email: "", display_name: "", role: "area", scope_id: "" }); load(); } catch (err) { setError(err.message); }
  };

  return (
    <div className="card">
      <h3>People and access</h3>
      <p className="muted card-sub">Executives see every restaurant. Region, area and store users see only their own, including on the forecasting form.</p>
      {!users ? <Loading /> : (
        <div className="table-scroll">
          <table className="ledger small">
            <thead><tr><th>Name</th><th>Email</th><th>Access</th><th>Sees</th><th /></tr></thead>
            <tbody>{users.map((u) => (
              <tr key={u.user_id} className={u.is_active ? "" : "inactive-row"}>
                <td>{u.display_name}</td><td>{u.email}</td><td style={{ textTransform: "capitalize" }}>{u.role}</td><td>{u.scope_name}</td>
                <td className="num"><button type="button" className="link-button dark" onClick={() => setUserActive(u.user_id, !u.is_active).then(load).catch((e) => setError(e.message))}>{u.is_active ? "Deactivate" : "Reactivate"}</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <form className="inline-form" onSubmit={submit}>
        <input placeholder="Full name" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} required />
        <input type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value, scope_id: "" })}>
          <option value="executive">Executive (company-wide)</option><option value="region">Region</option><option value="area">Area</option><option value="store">Store</option>
        </select>
        {form.role !== "executive" && (
          <select value={form.scope_id} onChange={(e) => setForm({ ...form, scope_id: e.target.value })} required>
            <option value="">Choose…</option>
            {scopes[form.role].map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        <button className="btn small" type="submit">Add person</button>
      </form>
      {error && <div className="alert err">{error}</div>}
      {created && <div className="alert ok">Account created for {created.email}. Temporary password (shown once): <code>{created.temporary_password}</code></div>}
    </div>
  );
}

export default function DataRefresh() {
  const { user, meta, refreshNow, refreshing, reloadMeta, dataVersion } = useApp();
  const [status, setStatus] = useState(null);
  const [settings, setSettings] = useState(null);
  const [saved, setSaved] = useState(false);
  const [audit, setAudit] = useState(null);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const isExec = user.role === "executive";

  const load = () => getRefreshStatus().then((s) => { setStatus(s); setSettings(s.settings); }).catch(() => {});
  useEffect(() => { load(); if (isExec) getAudit().then(setAudit).catch(() => {}); }, [dataVersion, isExec]);

  const save = async () => {
    const s = await saveRefreshSettings(settings);
    setStatus(s); setSettings(s.settings); setSaved(true); setTimeout(() => setSaved(false), 1800);
  };

  if (!status) return <Loading />;
  return (
    <div>
      {isExec && <Connections status={status} reload={load} version={layoutVersion + dataVersion} />}
      <div className="card">
        <div className="card-header">
          <h3>Refresh</h3>
          <button type="button" className="btn" onClick={() => refreshNow().then(load)} disabled={refreshing}>{refreshing ? "Refreshing…" : "Refresh now"}</button>
        </div>
        <p className="muted card-sub">
          Final prior-day results, weather and the morning summary load on the daily schedule. Live sales refresh through the day while restaurants are open. Anyone can refresh by hand before a review.
        </p>
        <div className="settings-grid">
          <label>Daily refresh time<input type="time" value={settings.daily_refresh_time} disabled={!isExec} onChange={(e) => setSettings({ ...settings, daily_refresh_time: e.target.value })} /></label>
          <label className="check"><input type="checkbox" checked={settings.intraday_refresh_enabled} disabled={!isExec} onChange={(e) => setSettings({ ...settings, intraday_refresh_enabled: e.target.checked })} /> Intraday refresh of live sales</label>
          <label>Every (minutes)<input type="number" min="5" max="240" step="5" value={settings.intraday_refresh_minutes} disabled={!isExec || !settings.intraday_refresh_enabled} onChange={(e) => setSettings({ ...settings, intraday_refresh_minutes: Number(e.target.value) })} /></label>
          <label>Operating hours from<input type="time" value={settings.operating_hours_start} disabled={!isExec} onChange={(e) => setSettings({ ...settings, operating_hours_start: e.target.value })} /></label>
          <label>to<input type="time" value={settings.operating_hours_end} disabled={!isExec} onChange={(e) => setSettings({ ...settings, operating_hours_end: e.target.value })} /></label>
          {isExec && <button type="button" className="btn secondary small" onClick={save}>{saved ? "Saved" : "Save schedule"}</button>}
        </div>
      </div>

      <AutomaticInputs status={status} isExec={isExec} />

      {isExec && (
        <div className="card">
          <h3>Reports and layouts</h3>
          <ImportWizard version={dataVersion} onDone={() => { reloadMeta(); load(); setLayoutVersion((v) => v + 1); }} />
        </div>
      )}
      {isExec && <Layouts version={layoutVersion} />}
      <FilesReceived files={status.files} />

      <div className="card">
        <h3>Refresh history</h3>
        <div className="table-scroll">
          <table className="ledger small">
            <thead><tr><th>Started</th><th>Trigger</th><th>Result</th><th>Steps</th></tr></thead>
            <tbody>{status.runs.map((r) => (
              <tr key={r.run_id}>
                <td>{prettyTime(r.started_at)}</td><td>{TRIGGER[r.trigger] || r.trigger}</td>
                <td><ToneBadge tone={RUN_TONE[r.status] || "neutral"}>{r.status}</ToneBadge></td>
                <td>{r.steps.map((s) => <div key={s.name} className={s.ok ? "" : "negative"}>{s.ok ? "✓" : "✕"} {s.name}{s.ok ? "" : `: ${s.error}`} <span className="neutral">({s.ms} ms)</span></div>)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </div>

      {isExec && <Users meta={meta} />}

      {isExec && audit && (
        <div className="card">
          <h3>Audit log</h3>
          <p className="muted card-sub">Sign-ins, imports, refreshes and errors. Most recent 200.</p>
          <div className="table-scroll tall">
            <table className="ledger small">
              <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Detail</th></tr></thead>
              <tbody>{audit.map((a) => <tr key={a.audit_id} className={/error|failed/.test(a.action) ? "negative-row" : ""}><td>{prettyTime(a.at)}</td><td>{a.user_email || "system"}</td><td>{a.action.replace(/_/g, " ")}</td><td>{a.detail}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
