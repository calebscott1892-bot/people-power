/**
 * Resources API client (Node backend).
 *
 * Endpoints (see Server/index.js):
 * - GET    /movements/:id/resources  -> { resources: Resource[] }
 * - POST   /movements/:id/resources  -> { resource: Resource }
 * - POST   /resources/:id/download   -> { resource: Resource }
 * - DELETE /resources/:id            -> { ok: true }
 *
 * @typedef {Object} Resource
 * @property {string} id
 * @property {string} movement_id
 * @property {string} title
 * @property {string|null} description
 * @property {string|null} url
 * @property {string|null} file_url
 * @property {string|null} mime_type
 * @property {number|null} download_count
 * @property {string|null} created_at
 */

import { SERVER_BASE } from './serverBase';

const BASE_URL = SERVER_BASE;

function normalizeId(value) {
  if (value == null) return null;
  const s = String(value).trim();
  return s ? s : null;
}

function base() {
  return String(BASE_URL || '').replace(/\/$/, '');
}

async function safeReadJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function authedFetch(url, { accessToken, method = 'GET', body } = {}) {
  const headers = { Accept: 'application/json' };

  if (accessToken) headers.Authorization = `Bearer ${String(accessToken)}`;
  if (body != null) headers['Content-Type'] = 'application/json';

  const res = await fetch(url, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });

  const data = await safeReadJson(res);
  if (!res.ok) {
    const msg = data && (data.error || data.message) ? String(data.error || data.message) : `Request failed: ${res.status}`;
    throw new Error(msg);
  }

  return data;
}

export async function listMovementResources(movementId) {
  return listMovementResourcesPage(movementId, { limit: 200, offset: 0 });
}

export async function listMovementResourcesPage(movementId, { limit = 20, offset = 0, fields } = {}) {
  const id = normalizeId(movementId);
  if (!id) throw new Error('Movement ID is required');

  const params = new URLSearchParams();
  if (typeof limit === 'number') params.set('limit', String(limit));
  if (typeof offset === 'number') params.set('offset', String(offset));
  if (Array.isArray(fields) && fields.length) params.set('fields', fields.join(','));

  const url = `${base()}/movements/${encodeURIComponent(id)}/resources${params.toString() ? `?${params.toString()}` : ''}`;
  const data = await authedFetch(url);
  return Array.isArray(data?.resources) ? data.resources : [];
}

export async function createMovementResource(movementId, payload, { accessToken } = {}) {
  const id = normalizeId(movementId);
  if (!id) throw new Error('Movement ID is required');
  const url = `${base()}/movements/${encodeURIComponent(id)}/resources`;
  const data = await authedFetch(url, { method: 'POST', body: payload, accessToken });
  return data?.resource ?? data;
}

export async function incrementResourceDownload(resourceId, { accessToken } = {}) {
  const id = normalizeId(resourceId);
  if (!id) throw new Error('Resource ID is required');
  if (!accessToken) throw new Error('Authentication required');
  const url = `${base()}/resources/${encodeURIComponent(id)}/download`;
  const data = await authedFetch(url, { method: 'POST', accessToken });
  return data?.resource ?? data;
}

export async function deleteResource(resourceId, { accessToken } = {}) {
  const id = normalizeId(resourceId);
  if (!id) throw new Error('Resource ID is required');
  if (!accessToken) throw new Error('Authentication required');
  const url = `${base()}/resources/${encodeURIComponent(id)}`;
  return authedFetch(url, { method: 'DELETE', accessToken });
}
