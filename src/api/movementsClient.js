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

import { getServerBaseUrl } from './serverBase';

const BASE_URL = getServerBaseUrl();

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

export async function fetchMovementsPage({ limit = 20, offset = 0, accessToken } = {}) {
  const base = BASE_URL.replace(/\/$/, '');
  const params = new URLSearchParams();
  if (limit != null) params.set('limit', String(limit));
  if (offset != null) params.set('offset', String(offset));

  const url = `${base}/movements${params.toString() ? `?${params.toString()}` : ''}`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${String(accessToken)}` } : {}),
    },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch movements: ${res.status}`);
  }
  const data = await res.json();
  return normalizeMovements(data);
}

export async function fetchMovements(options) {
  // Backwards-compatible: fetch the first page with server defaults.
  return fetchMovementsPage({ limit: 50, offset: 0, accessToken: options?.accessToken });
}

export async function fetchMyFollowedMovements(options) {
  const accessToken = options?.accessToken ? String(options.accessToken) : null;
  if (!accessToken) throw new Error('Authentication required');

  const url = `${BASE_URL.replace(/\/$/, '')}/me/followed-movements`;
  const res = await fetch(url, {
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

  return normalizeMovements(body);
}

export async function fetchMovementById(id, options) {
  const movementId = normalizeId(id);
  if (!movementId) throw new Error('Movement ID is required');
  const accessToken = options?.accessToken ? String(options.accessToken) : null;

  // Prefer GET /movements/:id if the server supports it.
  // If not supported (404), fall back to fetching all and searching.
  const directUrl = `${BASE_URL.replace(/\/$/, '')}/movements/${encodeURIComponent(movementId)}`;

  try {
    const res = await fetch(directUrl, {
      headers: {
        Accept: 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
    });
    if (res.ok) {
      const body = await res.json();
      // body may be { movement }, { data }, or the movement object itself
      if (body && typeof body === 'object') {
        if (body.movement && typeof body.movement === 'object') return body.movement;
        if (body.data && typeof body.data === 'object') return body.data;
      }
      return body ?? null;
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

  return found;
}

export async function createMovement(payload, options) {
  const accessToken = options?.accessToken ? String(options.accessToken) : null;
  const url = `${BASE_URL.replace(/\/$/, '')}/movements`;

  const res = await fetch(url, {
    method: 'POST',
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
    throw new Error(message);
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
  const url = `${BASE_URL.replace(/\/$/, '')}/movements/${encodeURIComponent(movementId)}`;

  const res = await fetch(url, {
    method: 'DELETE',
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
  const url = `${BASE_URL.replace(/\/$/, '')}/movements/${encodeURIComponent(movementId)}`;

  const res = await fetch(url, {
    method: 'PATCH',
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
  const url = `${BASE_URL.replace(/\/$/, '')}/movements/${encodeURIComponent(movementId)}/votes`;

  const res = await fetch(url, {
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
  const url = `${BASE_URL.replace(/\/$/, '')}/movements/${encodeURIComponent(movementId)}/vote`;

  const res = await fetch(url, {
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
    const messageFromBody =
      (body && typeof body === 'object' && (body.error || body.message)) || null;
    const message = messageFromBody
      ? String(messageFromBody)
      : `Failed to vote: ${res.status}`;
    throw new Error(message);
  }

  return body ?? { upvotes: 0, downvotes: 0, score: 0, myVote: 0 };
}
