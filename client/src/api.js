const qs = (params) =>
  Object.entries(params).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join("&");

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
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error((await res.json()).error || res.status);
  return res.json();
};
