const qs = (params) =>
  Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");

export class ApiError extends Error {
  constructor(message, status, body) { super(message); this.status = status; this.body = body; }
}

async function request(path, options = {}) {
  const res = await fetch(path, { credentials: "same-origin", ...options });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith("/api/auth/")) window.dispatchEvent(new Event("ops:signed-out"));
  if (!res.ok) throw new ApiError(body.error || `${path}: ${res.status}`, res.status, body);
  return body;
}

const getJSON = (path, params = {}) => { const q = qs(params); return request(`${path}${q ? "?" + q : ""}`); };
const sendJSON = (method, path, body) => request(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

// Auth
export const getMe = () => getJSON("/api/auth/me");
export const signIn = (email, password) => sendJSON("POST", "/api/auth/login", { email, password });
export const signOut = () => sendJSON("POST", "/api/auth/logout", {});
export const setupFirstAdmin = (body) => sendJSON("POST", "/api/auth/setup", body);

// Dashboard
export const getMeta = () => getJSON("/api/meta");
export const getOverview = (params) => getJSON("/api/overview", params); // { from, to, daypart, regionId?, areaId? }
export const getHotspots = (params) => getJSON("/api/hotspots", params); // + category
export const getRollup = (params) => getJSON("/api/rollup", params); // { level: region|area|store, regionId?, areaId? }
export const getStore = (id, params) => getJSON(`/api/stores/${id}`, params);
export const getDailySummary = (params) => getJSON("/api/summary/daily", params);

// Weekly forecasting form
export const getForecastForm = (params) => getJSON("/api/forecast/form", params);
export const getForecastRollup = (params) => getJSON("/api/forecast/rollup", params);
export const saveForecast = (body) => sendJSON("PUT", "/api/forecast/submission", body);

// Refresh, imports, administration
export const getRefreshStatus = () => getJSON("/api/refresh/status");
export const runRefresh = () => sendJSON("POST", "/api/refresh", {});
export const saveRefreshSettings = (body) => sendJSON("PUT", "/api/refresh/settings", body);
export const getUsers = () => getJSON("/api/admin/users");
export const createUser = (body) => sendJSON("POST", "/api/admin/users", body);
export const setUserActive = (id, is_active) => sendJSON("PATCH", `/api/admin/users/${id}`, { is_active });
export const getAudit = () => getJSON("/api/admin/audit");

// Connections: secrets go up and never come back; the response says only whether one is on file.
export const getConnections = () => getJSON("/api/connections");
export const saveConnections = (body) => sendJSON("PUT", "/api/connections", body);
export const testConnection = (which, body) => sendJSON("POST", `/api/connections/test/${which}`, body);

// Imports: look at a file first, then commit it (optionally saving the column mapping as a profile).
export async function previewImport(file, kind) {
  const fd = new FormData();
  fd.append("file", file);
  if (kind) fd.append("kind", kind);
  return request("/api/import/preview", { method: "POST", body: fd });
}

export async function commitImport(file, { kind, mapping, profileName }) {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("kind", kind);
  fd.append("mapping", JSON.stringify(mapping));
  if (profileName) fd.append("profileName", profileName);
  return request("/api/import/commit", { method: "POST", body: fd });
}

export const getImportProfiles = () => getJSON("/api/import/profiles");

// Files that arrived by email, folder or push in a layout nobody has mapped yet.
export const getPendingImports = () => getJSON("/api/import/pending");
export const previewPending = (name, kind) => sendJSON("POST", `/api/import/pending/${encodeURIComponent(name)}/preview`, { kind });
export const commitPending = (name, { kind, mapping, profileName }) => sendJSON("POST", `/api/import/pending/${encodeURIComponent(name)}/commit`, { kind, mapping, profileName });
export const discardPending = (name) => request(`/api/import/pending/${encodeURIComponent(name)}`, { method: "DELETE" });
export const deleteImportProfile = (id) => request(`/api/import/profiles/${id}`, { method: "DELETE" });
