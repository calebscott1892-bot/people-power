/**
 * Petitions API client (Node backend).
 *
 * Endpoints (see Server/index.js):
 * - GET  /movements/:id/petitions -> { petitions: Petition[] }
 * - POST /movements/:id/petitions -> { petition: Petition }
 *
 * Signature endpoints live in `petitionSignaturesClient`.
 *
 * @typedef {Object} Petition
 * @property {string} id
 * @property {string} movement_id
 * @property {string} title
 * @property {string|null} description
 * @property {number|null} signature_goal
 * @property {string|null} created_at
 */

import { getServerBaseUrl } from './serverBase';

const BASE_URL = getServerBaseUrl();

function normalizeId(value) {
  if (value == null) return null;
  const s = String(value).trim();
  return s ? s : null;
}

function base() {
  return String(BASE_URL || '').replace(/\/$/, '');
}

function toFieldsParam(fields) {
  if (!fields) return null;
  if (Array.isArray(fields)) {
    const joined = fields.map((f) => String(f || '').trim()).filter(Boolean).join(',');
    return joined || null;
  }
  const s = String(fields || '').trim();
  return s || null;
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

export async function listMovementPetitions(movementId) {
  const id = normalizeId(movementId);
  if (!id) throw new Error('Movement ID is required');
  const url = `${base()}/movements/${encodeURIComponent(id)}/petitions`;
  const data = await authedFetch(url);
  return Array.isArray(data?.petitions) ? data.petitions : [];
}

export async function listMovementPetitionsPage(movementId, { limit = 20, offset = 0, fields } = {}) {
  const id = normalizeId(movementId);
  if (!id) throw new Error('Movement ID is required');

  const params = new URLSearchParams();
  if (limit != null) params.set('limit', String(limit));
  if (offset != null) params.set('offset', String(offset));
  const fieldsParam = toFieldsParam(fields);
  if (fieldsParam) params.set('fields', fieldsParam);

  const url = `${base()}/movements/${encodeURIComponent(id)}/petitions${params.toString() ? `?${params.toString()}` : ''}`;
  const data = await authedFetch(url);
  return Array.isArray(data?.petitions) ? data.petitions : [];
}

export async function createMovementPetition(movementId, payload, { accessToken } = {}) {
  const id = normalizeId(movementId);
  if (!id) throw new Error('Movement ID is required');
  const url = `${base()}/movements/${encodeURIComponent(id)}/petitions`;
  const data = await authedFetch(url, { method: 'POST', body: payload, accessToken });
  return data?.petition ?? data;
}
