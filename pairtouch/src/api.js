// src/api.js
import { getDeviceKey } from "./deviceStore";

// 本番は同一オリジンで /api/** が Hosting rewrite → Functions に流れる前提
const API_BASE =
  import.meta?.env?.VITE_API_BASE_URL !== undefined
    ? import.meta.env.VITE_API_BASE_URL
    : "";

async function buildHeaders(withJson = false) {
  const deviceKey = await getDeviceKey();
  const headers = {};
  if (withJson) headers["Content-Type"] = "application/json";
  if (deviceKey) headers["Authorization"] = `Device ${deviceKey}`;
  return headers;
}

export async function apiGet(path) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "GET",
    headers: await buildHeaders(false),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${res.status} ${res.statusText} ${text}`);
  }

  return await res.json();
}

export async function apiPost(path, body = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: await buildHeaders(true),
    body: JSON.stringify(body),
  });

  if (res.status === 204) return null;

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${res.status} ${res.statusText} ${text}`);
  }

  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return await res.json();
  return null;
}