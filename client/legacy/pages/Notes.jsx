import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getStores, getEntries, postEntry, getDuty, setDuty } from "../api.js";
import { fmt$ } from "../format.js";

const today = () => new Date().toISOString().slice(0, 10);

export default function Notes() {
  const [searchParams] = useSearchParams();
  const preselectedStore = searchParams.get("store") || "";

  const [stores, setStores] = useState([]);
  const [entries, setEntries] = useState([]);
  const [dutyRows, setDutyRows] = useState([]);
  const [noteForm, setNoteForm] = useState({ store_id: preselectedStore, entry_date: today(), type: "note", text: "", amount: "" });
  const [dutyForm, setDutyForm] = useState({ store_id: preselectedStore, duty_date: today(), manager_name: "" });
  const [noteMsg, setNoteMsg] = useState(null);
  const [dutyMsg, setDutyMsg] = useState(null);

  useEffect(() => { getStores().then(setStores).catch(() => {}); }, []);

  const loadEntries = () => getEntries({}).then(setEntries).catch(() => {});
  const loadDuty = () => getDuty({}).then(setDutyRows).catch(() => {});
  useEffect(() => { loadEntries(); loadDuty(); }, []);

  async function submitNote(e) {
    e.preventDefault();
    if (!noteForm.text.trim() || !noteForm.store_id) return;
    try {
      await postEntry({
        storeId: noteForm.store_id,
        entry_date: noteForm.entry_date,
        type: noteForm.type,
        text: noteForm.text,
        amount: noteForm.amount ? Number(noteForm.amount) : null,
      });
      setNoteForm({ store_id: noteForm.store_id, entry_date: today(), type: "note", text: "", amount: "" });
      setNoteMsg("Saved.");
      loadEntries();
      setTimeout(() => setNoteMsg(null), 2500);
    } catch (err) {
      setNoteMsg(`Error: ${err.message}`);
    }
  }

  async function submitDuty(e) {
    e.preventDefault();
    if (!dutyForm.store_id || !dutyForm.manager_name.trim()) return;
    try {
      await setDuty({ storeId: dutyForm.store_id, dutyDate: dutyForm.duty_date, managerName: dutyForm.manager_name });
      setDutyMsg("Saved.");
      loadDuty();
      setTimeout(() => setDutyMsg(null), 2500);
    } catch (err) {
      setDutyMsg(`Error: ${err.message}`);
    }
  }

  const storeName = (id) => stores.find((s) => String(s.id) === String(id))?.name || id;

  return (
    <div className="grid">
      <div className="card">
        <h3>Log an observation</h3>
        <p className="muted">Promos, waste, local events: anything that helps explain the numbers.</p>
        <form className="form" onSubmit={submitNote}>
          <label>Store
            <select value={noteForm.store_id} onChange={(e) => setNoteForm({ ...noteForm, store_id: e.target.value })} required>
              <option value="">Select a store…</option>
              {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label>Date <input type="date" value={noteForm.entry_date} onChange={(e) => setNoteForm({ ...noteForm, entry_date: e.target.value })} /></label>
          <label>Type
            <select value={noteForm.type} onChange={(e) => setNoteForm({ ...noteForm, type: e.target.value })}>
              <option value="note">Note</option>
              <option value="promo">Promotion</option>
              <option value="waste">Waste</option>
              <option value="event">Local event</option>
            </select>
          </label>
          <textarea rows={3} placeholder="What happened?" value={noteForm.text} onChange={(e) => setNoteForm({ ...noteForm, text: e.target.value })} />
          <input type="number" step="0.01" placeholder="Dollar amount (optional)" value={noteForm.amount} onChange={(e) => setNoteForm({ ...noteForm, amount: e.target.value })} />
          <button className="btn" type="submit">Save note</button>
          {noteMsg && <span className="muted">{noteMsg}</span>}
        </form>
      </div>

      <div className="card">
        <h3>Log manager on duty</h3>
        <p className="muted">One manager per store per day, used to explain spikes and dips.</p>
        <form className="form" onSubmit={submitDuty}>
          <label>Store
            <select value={dutyForm.store_id} onChange={(e) => setDutyForm({ ...dutyForm, store_id: e.target.value })} required>
              <option value="">Select a store…</option>
              {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label>Date <input type="date" value={dutyForm.duty_date} onChange={(e) => setDutyForm({ ...dutyForm, duty_date: e.target.value })} /></label>
          <input placeholder="Manager name" value={dutyForm.manager_name} onChange={(e) => setDutyForm({ ...dutyForm, manager_name: e.target.value })} />
          <button className="btn" type="submit">Save duty log</button>
          {dutyMsg && <span className="muted">{dutyMsg}</span>}
        </form>
      </div>

      <div className="card wide">
        <h3>Recent notes</h3>
        {entries.length === 0 ? <p className="muted">Nothing logged yet.</p> : (
          <table className="entries">
            <thead><tr><th>Date</th><th>Store</th><th>Type</th><th>Note</th><th>$</th></tr></thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td>{e.entry_date}</td>
                  <td>{storeName(e.store_id)}</td>
                  <td><span className="tag">{e.type}</span></td>
                  <td>{e.text}</td>
                  <td>{e.amount ? fmt$(e.amount) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card wide">
        <h3>Recent duty log</h3>
        {dutyRows.length === 0 ? <p className="muted">Nothing logged yet.</p> : (
          <table className="entries">
            <thead><tr><th>Date</th><th>Store</th><th>Manager</th></tr></thead>
            <tbody>
              {dutyRows.map((d, i) => (
                <tr key={i}><td>{d.duty_date}</td><td>{storeName(d.store_id)}</td><td>{d.manager_name}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
