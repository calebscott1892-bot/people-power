/**
 * Events API client (Node backend).
 *
 * Endpoints (see Server/index.js):
 * - GET  /movements/:id/events -> { events: Event[] }
 * - POST /movements/:id/events -> { event: Event }
 *
 * RSVP endpoints live in `eventRsvpsClient`.
 *
 * @typedef {Object} Event
 * @property {string} id
 * @property {string} movement_id
 * @property {string} title
 * @property {string|null} description
 * @property {string|null} start_date
 * @property {string|null} location
 * @property {string|null} event_type
 * @property {string|null} created_at
 */

import { SERVER_BASE } from './serverBase';
import { httpFetch } from '@/utils/httpFetch';

const BASE_URL = SERVER_BASE;

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

  const res = await httpFetch(url, {
    method,
    cache: 'no-store',
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

export async function listMovementEvents(movementId) {
  const id = normalizeId(movementId);
  if (!id) throw new Error('Movement ID is required');
  const url = `${base()}/movements/${encodeURIComponent(id)}/events`;
  const data = await authedFetch(url);
  return Array.isArray(data?.events) ? data.events : [];
}

export async function listMovementEventsPage(movementId, { limit = 20, offset = 0, fields } = {}) {
  const id = normalizeId(movementId);
  if (!id) throw new Error('Movement ID is required');

  const params = new URLSearchParams();
  if (limit != null) params.set('limit', String(limit));
  if (offset != null) params.set('offset', String(offset));
  const fieldsParam = toFieldsParam(fields);
  if (fieldsParam) params.set('fields', fieldsParam);

  const url = `${base()}/movements/${encodeURIComponent(id)}/events${params.toString() ? `?${params.toString()}` : ''}`;
  const data = await authedFetch(url);
  return Array.isArray(data?.events) ? data.events : [];
}

export async function createMovementEvent(movementId, payload, { accessToken } = {}) {
  const id = normalizeId(movementId);
  if (!id) throw new Error('Movement ID is required');
  const url = `${base()}/movements/${encodeURIComponent(id)}/events`;
  const data = await authedFetch(url, { method: 'POST', body: payload, accessToken });
  return data?.event ?? data;
}
