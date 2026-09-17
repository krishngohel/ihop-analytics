import { createContext, useContext, useEffect, useState } from "react";

const ViewModeContext = createContext(null);
const KEY = "ihop.viewMode";

export function ViewModeProvider({ children }) {
  const [mode, setMode] = useState(() => (localStorage.getItem(KEY) === "detail" ? "detail" : "scan"));

  useEffect(() => {
    localStorage.setItem(KEY, mode);
  }, [mode]);

  const value = {
    mode,
    isScan: mode === "scan",
    isDetail: mode === "detail",
    toggle: () => setMode((m) => (m === "scan" ? "detail" : "scan")),
  };

  return <ViewModeContext.Provider value={value}>{children}</ViewModeContext.Provider>;
}

export function useViewMode() {
  const ctx = useContext(ViewModeContext);
  if (!ctx) throw new Error("useViewMode must be used within ViewModeProvider");
  return ctx;
}
