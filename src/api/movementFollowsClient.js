import { SERVER_BASE } from './serverBase';

const BASE_URL = SERVER_BASE;

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

function toApiError(res, body, fallbackMessage) {
  const message = (body && (body.error || body.message))
    ? String(body.error || body.message)
    : String(fallbackMessage || `Request failed: ${res.status}`);
  const err = new Error(message);
  if (body && typeof body === 'object' && body.code) err.code = String(body.code);
  err.status = res.status;
  return err;
}

export async function fetchMyMovementFollow(movementId, options) {
  const id = normalizeId(movementId);
  if (!id) throw new Error('Movement ID is required');

  const accessToken = options?.accessToken ? String(options.accessToken) : null;
  if (!accessToken) throw new Error('Authentication required');

  const url = `${BASE_URL.replace(/\/$/, '')}/movements/${encodeURIComponent(id)}/follow`;
  const res = await fetch(url, {
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const body = await safeReadJson(res);

  if (!res.ok) {
    throw toApiError(res, body, `Failed to load follow state: ${res.status}`);
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
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ following: !!following }),
  });

  const body = await safeReadJson(res);
  if (!res.ok) {
    throw toApiError(res, body, `Failed to update follow state: ${res.status}`);
  }

  return body && typeof body === 'object' ? body : { ok: true };
}

export async function fetchMovementFollowersCount(movementId) {
  const id = normalizeId(movementId);
  if (!id) throw new Error('Movement ID is required');

  const url = `${BASE_URL.replace(/\/$/, '')}/movements/${encodeURIComponent(id)}/follow/count`;
  const res = await fetch(url, { cache: 'no-store', headers: { Accept: 'application/json' } });
  const body = await safeReadJson(res);

  if (!res.ok) {
    throw toApiError(res, body, `Failed to load followers count: ${res.status}`);
  }

  const count = body && typeof body === 'object' ? Number(body.count) : NaN;
  return Number.isFinite(count) ? count : 0;
}
