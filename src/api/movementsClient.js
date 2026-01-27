/**
 * Movements API client (Node backend).
 *
 * Endpoints (see Server/index.js):
 * - GET    /movements            -> Movement[] | { movements: Movement[] }
 * - GET    /movements/:id        -> Movement
 * - POST   /movements            -> Movement
 * - DELETE /movements/:id        -> { ok: true }
 * - GET    /movements/:id/votes  -> { upvotes: number, downvotes: number, score: number }
 * - POST   /movements/:id/vote   -> { ok: true, votes: { upvotes, downvotes, score } }
 * - GET    /movements/:id/follow -> { following: boolean }
 * - POST   /movements/:id/follow -> { following: boolean }
 *
 * @typedef {Object} Movement
 * @property {string} id
 * @property {string} title
 * @property {string|null} description
 * @property {string[]|null} tags
 * @property {string|null} created_at
 * @property {string|null} created_date
 * @property {string|null} author_email
 */

import { SERVER_BASE } from './serverBase';
import { httpFetch } from '@/utils/httpFetch';

function withCanonicalBoostsCount(movement) {
  if (!movement || typeof movement !== 'object') return movement;
  const boostsCount =
    typeof movement.boosts_count === 'number'
      ? movement.boosts_count
      : (typeof movement.upvotes === 'number'
          ? movement.upvotes
          : (typeof movement.boosts === 'number' ? movement.boosts : 0));
  return { ...movement, boosts_count: boostsCount };
}

function normalizeMovements(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    const fromMovementsKey = payload.movements;
    if (Array.isArray(fromMovementsKey)) return fromMovementsKey;
    const fromDataKey = payload.data;
    if (Array.isArray(fromDataKey)) return fromDataKey;
  }
  return [];
}

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
  const messageFromBody =
    (body && typeof body === 'object' && (body.error || body.message)) || null;
  const message = messageFromBody
    ? String(messageFromBody)
    : String(fallbackMessage || `Request failed: ${res.status}`);
  const err = new Error(message);
  if (body && typeof body === 'object' && body.code) err.code = String(body.code);
  err.status = res.status;
  return err;
}

export async function fetchMovementsPage({ limit = 20, offset = 0, accessToken, mine = false, fields } = {}) {
  // This is the canonical engagement source for boosts.
  const base = SERVER_BASE.replace(/\/$/, '');
  const params = new URLSearchParams();
  if (limit != null) params.set('limit', String(limit));
  if (offset != null) params.set('offset', String(offset));
  if (mine) params.set('mine', '1');
  if (fields) {
    const list = Array.isArray(fields)
      ? fields.map((f) => String(f).trim()).filter(Boolean)
      : String(fields).split(',').map((f) => f.trim()).filter(Boolean);
    if (list.length) params.set('fields', list.join(','));
  }

  const url = `${base}/movements${params.toString() ? `?${params.toString()}` : ''}`;
  const res = await httpFetch(url, {
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${String(accessToken)}` } : {}),
    },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch movements: ${res.status}`);
  }
  const data = await res.json();
  return normalizeMovements(data).map(withCanonicalBoostsCount);
}

export async function fetchMovements(options) {
  // Backwards-compatible: fetch the first page with server defaults.
  return fetchMovementsPage({ limit: 50, offset: 0, accessToken: options?.accessToken });
}

export async function fetchMyFollowedMovements(options) {
  const accessToken = options?.accessToken ? String(options.accessToken) : null;
  if (!accessToken) throw new Error('Authentication required');

  const url = `${SERVER_BASE.replace(/\/$/, '')}/followed-movements`;
  const res = await httpFetch(url, {
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const body = await safeReadJson(res);
  if (!res.ok) {
    const messageFromBody =
      (body && typeof body === 'object' && (body.error || body.message)) || null;
    const message = messageFromBody
      ? String(messageFromBody)
      : `Failed to fetch followed movements: ${res.status}`;
    throw new Error(message);
  }

  return normalizeMovements(body).map(withCanonicalBoostsCount);
}

export async function fetchMovementById(id, options) {
  const movementId = normalizeId(id);
  if (!movementId) throw new Error('Movement ID is required');
  const accessToken = options?.accessToken ? String(options.accessToken) : null;

  // Prefer GET /movements/:id if the server supports it.
  // If not supported (404), fall back to fetching all and searching.
  const directUrl = `${SERVER_BASE.replace(/\/$/, '')}/movements/${encodeURIComponent(movementId)}`;

  try {
    const res = await httpFetch(directUrl, {
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
    });
    if (res.ok) {
      const body = await res.json();
      // body may be { movement }, { data }, or the movement object itself
      if (body && typeof body === 'object') {
        if (body.movement && typeof body.movement === 'object') return withCanonicalBoostsCount(body.movement);
        if (body.data && typeof body.data === 'object') return withCanonicalBoostsCount(body.data);
      }
      return withCanonicalBoostsCount(body ?? null);
    }

    // Only fall back on not-found; bubble up other errors.
    if (res.status !== 404) {
      throw new Error(`Failed to fetch movement: ${res.status}`);
    }
  } catch (_err) {
    // Network errors or parsing issues: fall back to list search. Use structured logging if needed.
    void _err;
  }

  const all = await fetchMovements({ accessToken });
  const found =
    all.find((m) => normalizeId(m?.id) === movementId) ||
    all.find((m) => normalizeId(m?._id) === movementId) ||
    null;

  return withCanonicalBoostsCount(found);
}

export async function createMovement(payload, options) {
  const accessToken = options?.accessToken ? String(options.accessToken) : null;
  const url = `${SERVER_BASE.replace(/\/$/, '')}/movements`;

  const res = await httpFetch(url, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(payload ?? {}),
  });

  const body = await safeReadJson(res);

  if (!res.ok) {
    const messageFromBody =
      (body && typeof body === 'object' && (body.error || body.message)) || null;
    const message =
      messageFromBody ? String(messageFromBody) : `Failed to create movement: ${res.status}`;
    const requestId = body && typeof body === 'object' && body.request_id ? String(body.request_id) : '';
    throw new Error(requestId ? `${message} (request_id: ${requestId})` : message);
  }

  if (body && typeof body === 'object') {
    if (body.movement && typeof body.movement === 'object') return body.movement;
    if (body.data && typeof body.data === 'object') return body.data;
  }

  return body;
}

export async function deleteMovement(id, options) {
  const movementId = normalizeId(id);
  if (!movementId) throw new Error('Movement ID is required');

  const accessToken = options?.accessToken ? String(options.accessToken) : null;
  const url = `${SERVER_BASE.replace(/\/$/, '')}/movements/${encodeURIComponent(movementId)}`;

  const res = await httpFetch(url, {
    method: 'DELETE',
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
  });

  const body = await safeReadJson(res);

  if (!res.ok) {
    const messageFromBody =
      (body && typeof body === 'object' && (body.error || body.message)) || null;
    const message = messageFromBody ? String(messageFromBody) : `Failed to delete movement: ${res.status}`;
    throw new Error(message);
  }

  return body ?? { ok: true };
}

export async function updateMovement(id, payload, options) {
  const movementId = normalizeId(id);
  if (!movementId) throw new Error('Movement ID is required');

  const accessToken = options?.accessToken ? String(options.accessToken) : null;
  const url = `${SERVER_BASE.replace(/\/$/, '')}/movements/${encodeURIComponent(movementId)}`;

  const res = await httpFetch(url, {
    method: 'PATCH',
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(payload ?? {}),
  });

  const body = await safeReadJson(res);

  if (!res.ok) {
    const messageFromBody =
      (body && typeof body === 'object' && (body.error || body.message)) || null;
    const message =
      messageFromBody ? String(messageFromBody) : `Failed to update movement: ${res.status}`;
    throw new Error(message);
  }

  return body;
}

export async function fetchMovementVotes(id, options) {
  const movementId = normalizeId(id);
  if (!movementId) throw new Error('Movement ID is required');

  const accessToken = options?.accessToken ? String(options.accessToken) : null;
  const url = `${SERVER_BASE.replace(/\/$/, '')}/movements/${encodeURIComponent(movementId)}/votes`;

  const res = await httpFetch(url, {
    headers: {
      Accept: 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
  });

  const body = await safeReadJson(res);

  if (!res.ok) {
    const messageFromBody =
      (body && typeof body === 'object' && (body.error || body.message)) || null;
    const message = messageFromBody
      ? String(messageFromBody)
      : `Failed to fetch votes: ${res.status}`;
    throw new Error(message);
  }

  return body ?? { upvotes: 0, downvotes: 0, score: 0, myVote: 0 };
}

export async function voteMovement(id, value, options) {
  const movementId = normalizeId(id);
  if (!movementId) throw new Error('Movement ID is required');

  const accessToken = options?.accessToken ? String(options.accessToken) : null;
  const url = `${SERVER_BASE.replace(/\/$/, '')}/movements/${encodeURIComponent(movementId)}/vote`;

  const res = await httpFetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({ value }),
  });

  const body = await safeReadJson(res);

  if (!res.ok) {
    throw toApiError(res, body, `Failed to vote: ${res.status}`);
  }

  return body ?? { upvotes: 0, downvotes: 0, score: 0, myVote: 0 };
}
