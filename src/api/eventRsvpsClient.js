/**
 * Event RSVP API client (Node backend).
 *
 * Endpoints (see Server/index.js):
 * - GET  /events/:id/rsvps       -> { summary: { going_count, interested_count, attended_count }, my_rsvp: EventRsvp|null }
 * - POST /events/:id/rsvp        -> { rsvp: EventRsvp|null }
 * - POST /events/:id/attendance  -> { rsvp: EventRsvp }
 *
 * @typedef {Object} EventRsvp
 * @property {string} id
 * @property {string} movement_id
 * @property {string} event_id
 * @property {string} user_email
 * @property {'going'|'interested'|string} status
 * @property {boolean} attended
 * @property {string|null} created_at
 * @property {string|null} updated_at
 */

import { SERVER_BASE } from './serverBase';
import { httpFetch } from '@/utils/httpFetch';

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

function base() {
  return String(BASE_URL || '').replace(/\/$/, '');
}

async function authedFetch(url, { accessToken, method = 'GET', body } = {}) {
  const headers = {
    Accept: 'application/json',
  };

  if (accessToken) {
    headers.Authorization = `Bearer ${String(accessToken)}`;
  }

  if (body != null) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await httpFetch(url, {
    method,
    cache: 'no-store',
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });

  const data = await safeReadJson(res);
  if (!res.ok) {
    const msg = (data && (data.error || data.message))
      ? String(data.error || data.message)
      : `Request failed: ${res.status}`;
    throw new Error(msg);
  }

  return data;
}

export async function fetchEventRsvpSummary(eventId, { accessToken } = {}) {
  const id = normalizeId(eventId);
  if (!id) throw new Error('Event ID is required');
  const url = `${base()}/events/${encodeURIComponent(id)}/rsvps`;
  return authedFetch(url, { accessToken });
}

export async function setMyEventRsvp(eventId, status, { accessToken } = {}) {
  const id = normalizeId(eventId);
  if (!id) throw new Error('Event ID is required');
  if (!accessToken) throw new Error('Authentication required');
  const safeStatus = String(status || '').trim();
  const url = `${base()}/events/${encodeURIComponent(id)}/rsvp`;
  return authedFetch(url, { method: 'POST', accessToken, body: { status: safeStatus } });
}

export async function setMyEventAttendance(eventId, attended, { accessToken } = {}) {
  const id = normalizeId(eventId);
  if (!id) throw new Error('Event ID is required');
  if (!accessToken) throw new Error('Authentication required');
  const url = `${base()}/events/${encodeURIComponent(id)}/attendance`;
  return authedFetch(url, { method: 'POST', accessToken, body: { attended: !!attended } });
}
