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

export async function fetchMovementComments(movementId, options) {
  return fetchMovementCommentsPage(movementId, { limit: 50, offset: 0, accessToken: options?.accessToken });
}

export async function fetchMovementCommentsPage(movementId, { limit = 20, offset = 0, fields, accessToken } = {}) {
  const id = normalizeId(movementId);
  if (!id) throw new Error('Movement ID is required');

  const params = new URLSearchParams();
  if (typeof limit === 'number') params.set('limit', String(limit));
  if (typeof offset === 'number') params.set('offset', String(offset));
  if (Array.isArray(fields) && fields.length) params.set('fields', fields.join(','));

  const url = `${BASE_URL.replace(/\/$/, '')}/movements/${encodeURIComponent(id)}/comments${params.toString() ? `?${params.toString()}` : ''}`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${String(accessToken)}` } : {}),
    },
  });
  const body = await safeReadJson(res);

  if (!res.ok) {
    const msg = (body && (body.error || body.message)) ? String(body.error || body.message) : `Failed to load comments: ${res.status}`;
    throw new Error(msg);
  }

  return Array.isArray(body?.comments) ? body.comments : Array.isArray(body) ? body : [];
}

export async function fetchMovementCommentSettings(movementId) {
  const id = normalizeId(movementId);
  if (!id) throw new Error('Movement ID is required');

  const url = `${BASE_URL.replace(/\/$/, '')}/movements/${encodeURIComponent(id)}/comment-settings`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const body = await safeReadJson(res);

  if (!res.ok) {
    const msg = (body && (body.error || body.message)) ? String(body.error || body.message) : `Failed to load comment settings: ${res.status}`;
    throw new Error(msg);
  }

  return body && typeof body === 'object' ? body : { locked: false, slow_mode_seconds: 0 };
}

export async function updateMovementCommentSettings(movementId, patch, options) {
  const id = normalizeId(movementId);
  if (!id) throw new Error('Movement ID is required');

  const accessToken = options?.accessToken ? String(options.accessToken) : null;
  if (!accessToken) throw new Error('Authentication required');

  const url = `${BASE_URL.replace(/\/$/, '')}/movements/${encodeURIComponent(id)}/comment-settings`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(patch ?? {}),
  });

  const body = await safeReadJson(res);
  if (!res.ok) {
    const msg = (body && (body.error || body.message)) ? String(body.error || body.message) : `Failed to update comment settings: ${res.status}`;
    throw new Error(msg);
  }

  return body && typeof body === 'object' ? body : { ok: true };
}

export async function createMovementComment(movementId, content, options) {
  const id = normalizeId(movementId);
  if (!id) throw new Error('Movement ID is required');

  const accessToken = options?.accessToken ? String(options.accessToken) : null;
  if (!accessToken) throw new Error('Authentication required');

  const text = String(content ?? '').trim();
  if (!text) throw new Error('Comment cannot be empty');

  const url = `${BASE_URL.replace(/\/$/, '')}/movements/${encodeURIComponent(id)}/comments`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ content: text }),
  });

  const body = await safeReadJson(res);
  if (!res.ok) {
    const msg = (body && (body.error || body.message)) ? String(body.error || body.message) : `Failed to post comment: ${res.status}`;
    throw new Error(msg);
  }

  return body?.comment ?? body;
}
