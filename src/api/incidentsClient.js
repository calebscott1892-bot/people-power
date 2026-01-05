/**
 * Incident Logs API client.
 *
 * Network-backed (Node server) endpoints (see Server/index.js):
 * - POST /incidents        -> { ok: true, incident }
 * - GET  /admin/incidents  -> { items, limit, offset, has_more } (requires admin auth)
 */

import { SERVER_BASE } from './serverBase';

const BASE_URL = SERVER_BASE;

async function safeReadJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function authHeaders(accessToken) {
  const token = accessToken ? String(accessToken) : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function fetchAdminIncidents(params, options) {
  const accessToken = options?.accessToken ? String(options.accessToken) : null;

  const query = new URLSearchParams();
  const q = params?.q ? String(params.q).trim() : '';
  const limit = params?.limit != null ? Number(params.limit) : null;
  const offset = params?.offset != null ? Number(params.offset) : null;

  if (q) query.set('q', q);
  if (Number.isFinite(limit)) query.set('limit', String(limit));
  if (Number.isFinite(offset)) query.set('offset', String(offset));

  const url = `${BASE_URL.replace(/\/$/, '')}/admin/incidents${query.toString() ? `?${query}` : ''}`;

  const res = await fetch(url, {
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      ...authHeaders(accessToken),
    },
  });

  const body = await safeReadJson(res);

  if (!res.ok) {
    const msg = (body && typeof body === 'object' && (body.error || body.message)) || null;
    throw new Error(msg ? String(msg) : `Failed to load incidents: ${res.status}`);
  }

  return body && typeof body === 'object'
    ? body
    : { items: [], limit: Number.isFinite(limit) ? limit : 50, offset: Number.isFinite(offset) ? offset : 0, has_more: false };
}

export async function createIncident(payload, options) {
  const accessToken = options?.accessToken ? String(options.accessToken) : null;
  const url = `${BASE_URL.replace(/\/$/, '')}/incidents`;

  const res = await fetch(url, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...authHeaders(accessToken),
    },
    body: JSON.stringify(payload ?? {}),
  });

  const body = await safeReadJson(res);

  if (!res.ok) {
    const msg = (body && typeof body === 'object' && (body.error || body.message)) || null;
    throw new Error(msg ? String(msg) : `Failed to create incident: ${res.status}`);
  }

  return body;
}
