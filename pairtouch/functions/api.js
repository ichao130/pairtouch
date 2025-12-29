import { getDeviceKey } from "./deviceStore";

const API_BASE =
  import.meta.env?.VITE_API_BASE_URL !== undefined
    ? import.meta.env.VITE_API_BASE_URL
    : "";

export async function apiGet(path) {
  const deviceKey = await getDeviceKey();
  const headers = {};
  if (deviceKey) headers["Authorization"] = `Device ${deviceKey}`;

  const res = await fetch(`${API_BASE}${path}`, { method: "GET", headers });
  if (!res.ok) throw new Error(`API ${res.status} ${res.statusText}`);
  return await res.json();
}

export async function apiPost(path, body) {
  const deviceKey = await getDeviceKey();
  const headers = { "Content-Type": "application/json" };
  if (deviceKey) headers["Authorization"] = `Device ${deviceKey}`;

  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body || {}),
  });

  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`API ${res.status} ${res.statusText}`);
  return await res.json();
}

export async function apiPost(path, body) {
  const deviceKey = await getDeviceKey();
  const headers = { "Content-Type": "application/json" };
  if (deviceKey) headers["Authorization"] = `Device ${deviceKey}`;

  const res = await fetch(path, {
    method: "POST",
    headers,
    body: JSON.stringify(body || {}),
  });

  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`API ${res.status}`);
  return await res.json();
}