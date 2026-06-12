import { useEffect, useState } from "react";
import { getJSON, postJSON } from "./api.js";

const today = () => new Date().toISOString().slice(0, 10);

export default function Entries() {
  const [entries, setEntries] = useState([]);
  const [form, setForm] = useState({ entry_date: today(), type: "note", text: "", amount: "" });
  const [msg, setMsg] = useState(null);

  const load = () => getJSON("/api/entries").then(setEntries).catch(() => {});
  useEffect(() => { load(); }, []);

  async function submit(e) {
    e.preventDefault();
    if (!form.text.trim()) return;
    try {
      await postJSON("/api/entries", { ...form, amount: form.amount ? Number(form.amount) : null });
      setForm({ entry_date: today(), type: "note", text: "", amount: "" });
      setMsg("Saved.");
      load();
      setTimeout(() => setMsg(null), 2500);
    } catch (err) {
      setMsg(`Error: ${err.message}`);
    }
  }

  return (
    <div className="grid">
      <div className="card">
        <h3>Log an Observation</h3>
        <p className="muted">Promos, waste, local events — anything that helps explain the numbers.</p>
        <form className="form" onSubmit={submit}>
          <label>Date <input type="date" value={form.entry_date}
            onChange={(e) => setForm({ ...form, entry_date: e.target.value })} /></label>
          <label>Type{" "}
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option value="note">Note</option>
              <option value="promo">Promotion</option>
              <option value="waste">Waste</option>
              <option value="event">Local event</option>
            </select>
          </label>
          <textarea rows={3} placeholder="What happened?" value={form.text}
            onChange={(e) => setForm({ ...form, text: e.target.value })} />
          <input type="number" step="0.01" placeholder="Dollar amount (optional)" value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          <button className="btn" type="submit">Save Entry</button>
          {msg && <span className="muted">{msg}</span>}
        </form>
      </div>
      <div className="card">
        <h3>Recent Entries</h3>
        {entries.length === 0 ? <p className="muted">Nothing logged yet.</p> : (
          <table className="entries">
            <thead><tr><th>Date</th><th>Type</th><th>Note</th><th>$</th></tr></thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td>{e.entry_date}</td>
                  <td><span className="tag">{e.type}</span></td>
                  <td>{e.text}</td>
                  <td>{e.amount ? `$${e.amount}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
