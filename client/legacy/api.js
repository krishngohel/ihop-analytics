const qs = (params) =>
  Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");

export const getJSON = async (path, params = {}) => {
  const q = qs(params);
  const res = await fetch(`${path}${q ? "?" + q : ""}`);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
};

export const postJSON = async (path, body) => {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `${path}: ${res.status}`);
  return res.json();
};

export const patchJSON = async (path, body) => {
  const res = await fetch(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `${path}: ${res.status}`);
  return res.json();
};

export const putJSON = async (path, body) => {
  const res = await fetch(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `${path}: ${res.status}`);
  return res.json();
};

// Stores
export const getStores = () => getJSON("/api/stores");
export const patchStore = (id, body) => patchJSON(`/api/stores/${id}`, body);

// Region + store analytics
export const getRegionSummary = (params) => getJSON("/api/region/summary", params);
export const getRevenue = (params) => getJSON("/api/revenue", params); // { grain, from, to, storeId? }
export const getStoreRanking = (params) => getJSON("/api/stores/ranking", params);
export const getStoreDayparts = (params) => getJSON("/api/stores/dayparts", params);
export const getStoreCategories = (params) => getJSON("/api/stores/categories", params);
export const getOpportunities = (params) => getJSON("/api/opportunities", params);

// Existing single-store-capable analytics (now storeId-aware)
export const getSummary = (params) => getJSON("/api/summary", params);
export const getRevenueTrend = (params) => getJSON("/api/revenue-trend", params);
export const getTopItems = (params) => getJSON("/api/top-items", params);
export const getCategories = (params) => getJSON("/api/categories", params);
export const getDayparts = (params) => getJSON("/api/dayparts", params);

// Duty (manager on duty)
export const getDuty = (params) => getJSON("/api/duty", params);
export const setDuty = (body) => putJSON("/api/duty", body); // { storeId, dutyDate, managerName }

// Notes / staff observations
export const getEntries = (params) => getJSON("/api/entries", params);
export const postEntry = (body) => postJSON("/api/entries", body);

// Reports
export const getReport = (params) => getJSON("/api/report", params); // { scope: "store"|"region", storeId?, from, to }

// Upload
export async function uploadFile(file, { storeId, storeName } = {}) {
  const fd = new FormData();
  fd.append("file", file);
  if (storeId) fd.append("storeId", storeId);
  if (storeName) fd.append("storeName", storeName);
  const res = await fetch("/api/upload", { method: "POST", body: fd });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `upload: ${res.status}`);
  return json;
}
