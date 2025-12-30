import { getServerBaseUrl } from './serverBase';

const BASE_URL = getServerBaseUrl();

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

// API client for movement field locks
export async function fetchMovementLocks(movementId, options) {
  const id = normalizeId(movementId);
  if (!id) return {};

  const accessToken = options?.accessToken ? String(options.accessToken) : null;
  const url = `${BASE_URL.replace(/\/$/, '')}/movements/${encodeURIComponent(id)}/locks`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
  });
  const body = await safeReadJson(res);
  if (!res.ok) {
    const msg = (body && (body.error || body.message)) ? String(body.error || body.message) : `Failed to fetch movement locks: ${res.status}`;
    throw new Error(msg);
  }
  return body?.locks || {};
}

export async function setMovementLock(movementId, field, locked, options) {
  const id = normalizeId(movementId);
  if (!id) throw new Error('Movement ID is required');

  const accessToken = options?.accessToken ? String(options.accessToken) : null;
  if (!accessToken) throw new Error('Authentication required');

  const url = `${BASE_URL.replace(/\/$/, '')}/movements/${encodeURIComponent(id)}/locks`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ field, locked }),
  });

  const body = await safeReadJson(res);
  if (!res.ok) {
    const msg = (body && (body.error || body.message)) ? String(body.error || body.message) : `Failed to update lock: ${res.status}`;
    throw new Error(msg);
  }

  return body;
}
