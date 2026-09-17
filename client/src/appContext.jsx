import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getMeta, getMe, getRefreshStatus, runRefresh } from "./api.js";
import { addDays, weekStart } from "./format.js";

const AppContext = createContext(null);
const RANGE_KEY = "ops.range";

// One date range and daypart for the whole dashboard, so drilling from company to
// region to area to store keeps looking at the same business days.
export function rangeForPreset(preset, meta) {
  const last = meta.last_final_day;
  switch (preset) {
    case "today": return { from: meta.today, to: meta.today };
    case "wtd": return { from: weekStart(last), to: last };
    case "ptd": return { from: meta.period.from, to: last };
    case "last7": return { from: addDays(last, -6), to: last };
    case "last28": return { from: addDays(last, -27), to: last };
    default: return { from: last, to: last };
  }
}

export function AppProvider({ children }) {
  const [user, setUser] = useState(undefined); // undefined = checking, null = signed out
  const [meta, setMeta] = useState(null);
  // The chosen range survives a page reload (per tab), so a refresh doesn't lose your place.
  const [range, setRangeState] = useState(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(RANGE_KEY));
      if (saved?.preset) return { preset: saved.preset, from: saved.preset === "custom" ? saved.from : null, to: saved.preset === "custom" ? saved.to : null, daypart: saved.daypart || "all" };
    } catch { /* fall through to the default */ }
    return { preset: "yesterday", from: null, to: null, daypart: "all" };
  });
  useEffect(() => { if (range.from) sessionStorage.setItem(RANGE_KEY, JSON.stringify(range)); }, [range]);
  const [refresh, setRefresh] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [dataVersion, setDataVersion] = useState(0);

  const loadMeta = useCallback(async () => {
    const m = await getMeta();
    setMeta(m);
    setRangeState((r) => (r.preset === "custom" && r.from ? r : { ...r, ...rangeForPreset(r.preset, m) }));
    getRefreshStatus().then(setRefresh).catch(() => {});
    return m;
  }, []);

  useEffect(() => {
    getMe().then(({ user: u }) => setUser(u || null)).catch(() => setUser(null));
    const onSignedOut = () => { setUser(null); setMeta(null); };
    window.addEventListener("ops:signed-out", onSignedOut);
    return () => window.removeEventListener("ops:signed-out", onSignedOut);
  }, []);

  useEffect(() => { if (user) loadMeta().catch(() => {}); }, [user, loadMeta]);

  const setPreset = useCallback((preset) => setRangeState((r) => ({ ...r, preset, ...rangeForPreset(preset, meta) })), [meta]);
  const setCustomRange = useCallback((from, to) => setRangeState((r) => ({ ...r, preset: "custom", from: from > to ? to : from, to })), []);
  const setDaypart = useCallback((daypart) => setRangeState((r) => ({ ...r, daypart })), []);

  const refreshNow = useCallback(async () => {
    setRefreshing(true);
    try {
      await runRefresh();
      await loadMeta();
      setDataVersion((v) => v + 1);
    } finally {
      setRefreshing(false);
    }
  }, [loadMeta]);

  const value = useMemo(() => ({
    user, setUser, meta, range, setPreset, setCustomRange, setDaypart, refresh, refreshing, refreshNow, dataVersion, reloadMeta: loadMeta,
    // Query params every data request shares.
    query: range.from ? { from: range.from, to: range.to, daypart: range.daypart } : null,
  }), [user, meta, range, setPreset, setCustomRange, setDaypart, refresh, refreshing, refreshNow, dataVersion, loadMeta]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}

/** Loads data whenever the shared range, the extra params, or the data version change. */
export function useData(loader, params, enabled = true) {
  const { query, dataVersion } = useApp();
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const key = JSON.stringify([query, params, dataVersion, enabled]);
  useEffect(() => {
    if (!query || !enabled) return undefined;
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    loader({ ...query, ...params })
      .then((data) => { if (!cancelled) setState({ data, error: null, loading: false }); })
      .catch((error) => { if (!cancelled) setState({ data: null, error, loading: false }); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}
