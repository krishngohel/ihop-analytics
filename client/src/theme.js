import { useEffect, useState } from "react";

// The theme follows the operating system until the person picks one; the choice is remembered.
const KEY = "theme";
const stored = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const systemDark = () => window.matchMedia?.("(prefers-color-scheme: dark)").matches;

export function applyStoredTheme() {
  const t = stored();
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
}

export function useTheme() {
  const [theme, setTheme] = useState(() => stored() || (systemDark() ? "dark" : "light"));
  useEffect(() => {
    if (stored()) return undefined;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e) => setTheme(e.matches ? "dark" : "light");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);
  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    try { localStorage.setItem(KEY, next); } catch { /* private window: the choice lasts for this visit */ }
    document.documentElement.dataset.theme = next;
    setTheme(next);
  };
  return { theme, toggle };
}
