const isDev = import.meta?.env?.DEV;
const BASE_URL = isDev
  ? (import.meta?.env?.VITE_SERVER_URL && String(import.meta.env.VITE_SERVER_URL)) || 'http://localhost:3001'
  : (import.meta?.env?.VITE_API_BASE_URL && String(import.meta.env.VITE_API_BASE_URL)) || '/api';

function normalizeId(value) {
  if (value == null) return null;
  const s = String(value).trim();
  return s ? s : null;
}

async function safeReadJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export async function fetchMyMovementFollow(movementId, options) {
  const id = normalizeId(movementId);
  if (!id) throw new Error('Movement ID is required');

  const accessToken = options?.accessToken ? String(options.accessToken) : null;
  if (!accessToken) throw new Error('Authentication required');

  const url = `${BASE_URL.replace(/\/$/, '')}/movements/${encodeURIComponent(id)}/follow`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const body = await safeReadJson(res);

  if (!res.ok) {
    const msg = (body && (body.error || body.message)) ? String(body.error || body.message) : `Failed to load follow state: ${res.status}`;
    throw new Error(msg);
  }

  return body && typeof body === 'object' ? body : { following: false, followers_count: 0 };
}

export async function setMyMovementFollow(movementId, following, options) {
  const id = normalizeId(movementId);
  if (!id) throw new Error('Movement ID is required');

  const accessToken = options?.accessToken ? String(options.accessToken) : null;
  if (!accessToken) throw new Error('Authentication required');

  const url = `${BASE_URL.replace(/\/$/, '')}/movements/${encodeURIComponent(id)}/follow`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ following: !!following }),
  });

  const body = await safeReadJson(res);
  if (!res.ok) {
    const msg = (body && (body.error || body.message)) ? String(body.error || body.message) : `Failed to update follow state: ${res.status}`;
    throw new Error(msg);
  }

  return body && typeof body === 'object' ? body : { ok: true };
}
