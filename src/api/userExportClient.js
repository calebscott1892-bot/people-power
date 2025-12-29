/**
 * User data export client (Node backend).
 *
 * Endpoint (see Server/index.js):
 * - GET /user/export
 */

const isDev = import.meta?.env?.DEV;
const BASE_URL = isDev
  ? (import.meta?.env?.VITE_SERVER_URL && String(import.meta.env.VITE_SERVER_URL)) || 'http://localhost:3001'
  : (import.meta?.env?.VITE_API_BASE_URL && String(import.meta.env.VITE_API_BASE_URL)) || '/api';

async function safeReadJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export async function exportMyData({ accessToken }) {
  const token = accessToken ? String(accessToken).trim() : '';
  if (!token) throw new Error('Please log in');

  const base = BASE_URL.replace(/\/$/, '');
  const res = await fetch(`${base}/user/export`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    const payload = await safeReadJson(res);
    const msg = payload?.error ? String(payload.error) : `Export failed (${res.status})`;
    throw new Error(msg);
  }

  const data = await safeReadJson(res);
  if (!data) throw new Error('Export failed: invalid response');
  return data;
}
