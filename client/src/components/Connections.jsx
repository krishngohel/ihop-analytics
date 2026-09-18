import { useEffect, useState } from "react";
import { getConnections, saveConnections, testConnection } from "../api.js";
import { useApp } from "../appContext.jsx";
import { ToneBadge } from "./Bits.jsx";
import { CheckIcon } from "./Icons.jsx";

// Everything the automatic inputs need is entered here: no settings file, no restart.
// Secrets are write-only. The server says whether one is on file and never sends it back,
// so a blank password box means "keep the one you have".

function useForm(fields, names) {
  const [form, setForm] = useState({});
  useEffect(() => {
    if (fields) setForm(Object.fromEntries(names.map((n) => [n, fields[n]?.value ?? ""])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields]);
  return [form, (name) => (e) => setForm((f) => ({ ...f, [name]: e.target.value })), setForm];
}

function TestResult({ result, children }) {
  if (!result) return null;
  if (!result.ok) return <div className="alert err">{result.error}</div>;
  return <div className="alert ok">{children(result)}</div>;
}

function Step({ n, done, title, children }) {
  return (
    <li className={`setup-step${done ? " done" : ""}`}>
      <span className="setup-mark" aria-hidden="true">{done ? <CheckIcon size={14} /> : n}</span>
      <div><strong>{title}</strong><span className="visually-hidden">{done ? " (done)" : " (to do)"}</span><div className="muted">{children}</div></div>
    </li>
  );
}

/** First-run checklist. Each line turns green from what is actually on file, not from a button press. */
export function SetupGuide({ setup }) {
  if (!setup) return null;
  const storesPlaced = setup.restaurants > 0 && setup.unassigned === 0;
  const steps = [setup.connected, storesPlaced, setup.results, setup.forecasts];
  if (steps.every(Boolean)) return null;
  return (
    <div className="brief-card setup-guide">
      <div className="page-title-row"><h2>Get connected</h2><span className="muted">{steps.filter(Boolean).length} of {steps.length} done</span></div>
      <ol className="setup-steps">
        <Step n={1} done={setup.connected} title="Connect Rosnet">
          Fastest: enter the client's Rosnet portal sign-in below and press Save — sales, forecast, labor and the store list load at once. Or use the reports mailbox, or an API key if the client has one. Any one is enough.
        </Step>
        <Step n={2} done={storesPlaced} title="Put restaurants in their regions and areas">
          The portal sign-in fills these in automatically. {setup.unassigned > 0 ? `${setup.unassigned} restaurants are waiting under "Unassigned" — ` : ""}{setup.unassigned > 0 ? "import a store list once (Store Number, Restaurant, Region, Area, Area Manager, City, State) to place them." : "With the mailbox or a plain API key, import a store list once to set regions and areas."}
        </Step>
        <Step n={3} done={setup.results} title="Load sales and labor">
          Export the last few weeks from Rosnet (sales, labor) and import them under Reports and layouts. The layout is remembered, so the emailed copies load on their own from then on. {setup.pending > 0 ? `${setup.pending} emailed ${setup.pending === 1 ? "report is" : "reports are"} waiting there for a one-time column check.` : ""}
        </Step>
        <Step n={4} done={setup.forecasts} title="Bring in forecast sales and allowable hours">
          Schedule the Rosnet report that has them to email the reports mailbox every morning, and import one copy once so its layout is known.
        </Step>
      </ol>
    </div>
  );
}

function RosnetCard({ fields, status, onSaved }) {
  const { refreshNow } = useApp();
  const [form, set] = useForm(fields, ["rosnet_api_user", "rosnet_client_id"]);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState("");
  const [result, setResult] = useState(null);
  const locked = fields.rosnet_api_user.from_environment || fields.rosnet_api_key.from_environment;
  const body = { ...form, rosnet_api_key: key };

  const test = async () => { setBusy("test"); setResult(null); try { setResult(await testConnection("rosnet", body)); } catch (e) { setResult({ ok: false, error: e.message }); } finally { setBusy(""); } };
  const save = async () => {
    setBusy("save"); setResult(null);
    try {
      const check = await testConnection("rosnet", body);
      setResult(check);
      if (!check.ok) return;
      await saveConnections(body);
      setKey("");
      await onSaved();
      await refreshNow(); // the first pull, so results are on screen without anyone pressing Refresh
      await onSaved();
    } catch (e) { setResult({ ok: false, error: e.message }); } finally { setBusy(""); }
  };

  return (
    <section className={`connection${status.rosnet_api?.configured ? " on" : ""}`}>
      <div className="channel-head"><strong>Rosnet API</strong><ToneBadge tone={status.rosnet_api?.configured ? "ok" : "neutral"}>{status.rosnet_api?.configured ? "Connected" : "Not set up"}</ToneBadge></div>
      <p className="muted">Optional. If Rosnet issues an API User ID and Key (api@rosnet.com), the dashboard also pulls net sales, last year, worked and scheduled labor and the store list straight from Rosnet on every refresh. This is not a Rosnet website sign-in.</p>
      {locked ? <p className="muted">Set on the server by ROSNET_API_USER and ROSNET_API_KEY.</p> : (
        <div className="connection-form">
          <label>API User ID<input value={form.rosnet_api_user || ""} onChange={set("rosnet_api_user")} autoComplete="off" spellCheck="false" /></label>
          <label>API User Key<input type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="new-password" placeholder={fields.rosnet_api_key.on_file ? "On file. Leave blank to keep it" : ""} /></label>
          <label className="span-2">Client ID <span className="neutral">(only if Rosnet gave you one)</span><input value={form.rosnet_client_id || ""} onChange={set("rosnet_client_id")} autoComplete="off" /></label>
          <div className="connection-actions">
            <button type="button" className="btn secondary small" onClick={test} disabled={Boolean(busy)}>{busy === "test" ? "Testing…" : "Test connection"}</button>
            <button type="button" className="btn small" onClick={save} disabled={Boolean(busy) || !form.rosnet_api_user || (!key && !fields.rosnet_api_key.on_file)}>{busy === "save" ? "Connecting and loading…" : "Save and load data"}</button>
          </div>
        </div>
      )}
      <TestResult result={result}>{(r) => <>Connected. Rosnet shows {r.locations} open restaurants{r.sample?.length ? `: ${r.sample.join(", ")}${r.locations > r.sample.length ? "…" : ""}` : ""}.</>}</TestResult>
    </section>
  );
}

function PortalCard({ fields, status, onSaved }) {
  const { refreshNow } = useApp();
  const [form, set] = useForm(fields, ["rosnet_portal_user", "rosnet_portal_client", "rosnet_portal_client_id"]);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState("");
  const [result, setResult] = useState(null);
  const locked = fields.rosnet_portal_user.from_environment || fields.rosnet_portal_password.from_environment;
  const body = { ...form, rosnet_portal_password: password };

  const test = async () => { setBusy("test"); setResult(null); try { setResult(await testConnection("portal", body)); } catch (e) { setResult({ ok: false, error: e.message }); } finally { setBusy(""); } };
  const save = async () => {
    setBusy("save"); setResult(null);
    try {
      const check = await testConnection("portal", body);
      setResult(check);
      if (!check.ok) return;
      await saveConnections(body);
      setPassword("");
      await onSaved();
      await refreshNow(); // first pull, so results land without anyone pressing Refresh
      await onSaved();
    } catch (e) { setResult({ ok: false, error: e.message }); } finally { setBusy(""); }
  };

  return (
    <section className={`connection${status.rosnet_portal?.configured ? " on" : ""}`}>
      <div className="channel-head"><strong>Rosnet portal sign-in</strong><ToneBadge tone={status.rosnet_portal?.configured ? "ok" : "neutral"}>{status.rosnet_portal?.configured ? "Connected" : "Not set up"}</ToneBadge></div>
      <p className="muted">The bridge until an API key arrives: the dashboard signs in to the Rosnet portal the way you do on the website, and reads sales, forecast, labor, allowable hours, regions and dayparts on every refresh — no reports to schedule. The password is stored encrypted. It only works while the account has no login code (MFA); if Rosnet ever asks for a code, use the reports mailbox instead.</p>
      {locked ? <p className="muted">Set on the server by ROSNET_PORTAL_USER and ROSNET_PORTAL_PASSWORD.</p> : (
        <div className="connection-form">
          <label>Portal username<input value={form.rosnet_portal_user || ""} onChange={set("rosnet_portal_user")} autoComplete="off" spellCheck="false" placeholder="the email you sign in with" /></label>
          <label>Portal password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" placeholder={fields.rosnet_portal_password.on_file ? "On file. Leave blank to keep it" : ""} /></label>
          <label>Client code <span className="neutral">(if you have more than one)</span><input value={form.rosnet_portal_client || ""} onChange={set("rosnet_portal_client")} autoComplete="off" spellCheck="false" placeholder="e.g. ACGTX" /></label>
          <div className="connection-actions">
            <button type="button" className="btn secondary small" onClick={test} disabled={Boolean(busy)}>{busy === "test" ? "Testing…" : "Test connection"}</button>
            <button type="button" className="btn small" onClick={save} disabled={Boolean(busy) || !form.rosnet_portal_user || (!password && !fields.rosnet_portal_password.on_file)}>{busy === "save" ? "Connecting and loading…" : "Save and load data"}</button>
          </div>
        </div>
      )}
      <TestResult result={result}>{(r) => <>Signed in{r.client ? ` to ${r.client}` : ""}. The portal shows {r.locations} restaurants{r.sample?.length ? `: ${r.sample.join(", ")}${r.locations > r.sample.length ? "…" : ""}` : ""}.</>}</TestResult>
    </section>
  );
}

function MailboxCard({ fields, status, onSaved }) {
  const names = ["reports_imap_user", "reports_imap_host", "reports_imap_port", "reports_imap_folder", "reports_allowed_senders"];
  const [form, set, setForm] = useForm(fields, names);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState("");
  const [result, setResult] = useState(null);
  const [saved, setSaved] = useState(false);
  const locked = fields.reports_imap_user.from_environment || fields.reports_imap_password.from_environment;
  const body = { ...form, reports_imap_password: password };
  const trusted = (form.reports_allowed_senders || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  // A vendor's own domain is trusted whole; an address at a public mail service is trusted alone,
  // or "gmail.com" would let anyone with a Gmail account send numbers in.
  const PUBLIC_MAIL = /^(gmail|googlemail|outlook|hotmail|live|msn|yahoo|ymail|icloud|me|mac|aol|proton|protonmail|zoho|fastmail)\./;
  const trust = (address) => {
    const domain = address.split("@")[1] || "";
    setForm((f) => ({ ...f, reports_allowed_senders: [...new Set([...trusted, domain && !PUBLIC_MAIL.test(domain) ? domain : address])].join(", ") }));
  };

  const test = async () => { setBusy("test"); setResult(null); try { setResult(await testConnection("mailbox", body)); } catch (e) { setResult({ ok: false, error: e.message }); } finally { setBusy(""); } };
  const save = async () => {
    setBusy("save"); setSaved(false);
    try { await saveConnections(body); setPassword(""); await onSaved(); setSaved(true); setTimeout(() => setSaved(false), 2000); } catch (e) { setResult({ ok: false, error: e.message }); } finally { setBusy(""); }
  };

  return (
    <section className={`connection${status.mailbox?.configured ? " on" : ""}`}>
      <div className="channel-head"><strong>Reports mailbox</strong><ToneBadge tone={status.mailbox?.configured ? (trusted.length ? "ok" : "watch") : "neutral"}>{status.mailbox?.configured ? (trusted.length ? `Reading ${status.mailbox.user}` : "Needs a trusted sender") : "Not set up"}</ToneBadge></div>
      <p className="muted">An inbox that exists only for reports. In Rosnet and STARS, schedule the daily reports to email it; attachments (or a table in the email itself) from trusted senders import on every refresh. Easiest: a new Gmail account made for this, with 2-Step Verification on and an <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer">app password</a> created for the dashboard. Microsoft mailboxes don't allow this kind of access any more.</p>
      {locked ? <p className="muted">Set on the server by the REPORTS_IMAP settings.</p> : (
        <div className="connection-form">
          <label>Mailbox address<input type="email" value={form.reports_imap_user || ""} onChange={set("reports_imap_user")} autoComplete="off" placeholder="ihop-reports@yourcompany.com" /></label>
          <label>App password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" placeholder={fields.reports_imap_password.on_file ? "On file. Leave blank to keep it" : ""} /></label>
          <label className="span-2">Trusted senders <span className="neutral">(addresses or domains, separated by commas)</span><input value={form.reports_allowed_senders || ""} onChange={set("reports_allowed_senders")} placeholder="rosnet.com, merchantcentric.com" spellCheck="false" /></label>
          <details className="span-2 method">
            <summary>Mail server (filled in for Gmail, Outlook, Yahoo, iCloud and others)</summary>
            <div className="connection-form" style={{ marginTop: 10 }}>
              <label>IMAP server<input value={form.reports_imap_host || ""} onChange={set("reports_imap_host")} placeholder="Worked out from the address" spellCheck="false" /></label>
              <label>Port<input type="number" value={form.reports_imap_port || ""} onChange={set("reports_imap_port")} placeholder="993" /></label>
              <label>Folder<input value={form.reports_imap_folder || ""} onChange={set("reports_imap_folder")} placeholder="INBOX" /></label>
            </div>
          </details>
          <div className="connection-actions">
            <button type="button" className="btn secondary small" onClick={test} disabled={Boolean(busy)}>{busy === "test" ? "Testing…" : "Test connection"}</button>
            <button type="button" className="btn small" onClick={save} disabled={Boolean(busy) || !form.reports_imap_user}>{saved ? "Saved" : "Save"}</button>
          </div>
        </div>
      )}
      <TestResult result={result}>{(r) => (
        <>
          Signed in to {r.host}. {r.messages} messages in the folder.
          {r.recent_senders?.length > 0 && (
            <div className="sender-picks">Recent senders, select to trust: {r.recent_senders.map((a) => (
              <button key={a} type="button" className="chip" onClick={() => trust(a)} disabled={trusted.some((t) => a === t || a.endsWith(`@${t}`) || a.endsWith(`.${t}`))}>{a}</button>
            ))}</div>
          )}
        </>
      )}</TestResult>
    </section>
  );
}

function FolderCard({ fields, status, onSaved }) {
  const [form, set] = useForm(fields, ["import_dir"]);
  const [saved, setSaved] = useState(false);
  const save = async () => { await saveConnections(form); await onSaved(); setSaved(true); setTimeout(() => setSaved(false), 2000); };
  return (
    <section className="connection on">
      <div className="channel-head"><strong>Reports folder</strong><ToneBadge tone="ok">Watching</ToneBadge></div>
      <p className="muted">Any Excel or CSV report saved into this folder imports on the next refresh, then moves to a "processed" folder inside it. Good for a synced drive or SFTP delivery.</p>
      <p className="folder-path"><code>{status.import_folder}</code></p>
      {!fields.import_dir.from_environment && (
        <details className="method">
          <summary>Use a different folder</summary>
          <div className="connection-form" style={{ marginTop: 10 }}>
            <label className="span-2">Folder path<input value={form.import_dir || ""} onChange={set("import_dir")} placeholder="Leave blank for the standard folder" spellCheck="false" /></label>
            <div className="connection-actions"><button type="button" className="btn small" onClick={save}>{saved ? "Saved" : "Save"}</button></div>
          </div>
        </details>
      )}
    </section>
  );
}

export default function Connections({ status, reload, version }) {
  const [data, setData] = useState(null);
  const load = () => getConnections().then(setData).catch(() => {});
  useEffect(() => { load(); }, [version]);
  if (!data) return null;
  const onSaved = async () => { await load(); await reload(); };
  return (
    <>
      <SetupGuide setup={data.setup} />
      <div className="card" id="connections">
        <h3>Connections</h3>
        <p className="muted card-sub">How results reach the dashboard with nobody involved. Every refresh, including the scheduled ones, checks each of these. Set up whichever one the client can give you — any single one fills the dashboard. Passwords entered here are stored encrypted and never shown again.</p>
        <div className="connections">
          <PortalCard fields={data.fields} status={status} onSaved={onSaved} />
          <RosnetCard fields={data.fields} status={status} onSaved={onSaved} />
          <MailboxCard fields={data.fields} status={status} onSaved={onSaved} />
          <FolderCard fields={data.fields} status={status} onSaved={onSaved} />
          {status.push_enabled && (
            <section className="connection on">
              <div className="channel-head"><strong>Push endpoint</strong><ToneBadge tone="ok">Accepting files</ToneBadge></div>
              <p className="muted">A vendor job or integration tool can POST report files to /api/ingest with the bearer token set on the server. The token can add data, never read it.</p>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
