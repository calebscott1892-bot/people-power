/**
 * Notifications client.
 *
 * Production: backed by Node + Postgres (`/me/notifications`).
 * Dev: will fall back to local stub entities if the server is unavailable.
 */

import { entities } from '@/api/appClient';
import { SERVER_BASE } from './serverBase';

function normalizeEmail(value) {
  const s = value ? String(value).trim().toLowerCase() : '';
  return s || null;
}

async function safeReadJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function allowDevFallback() {
  return !!import.meta?.env?.DEV;
}

function requireAccessToken(options) {
  const accessToken = options?.accessToken ? String(options.accessToken) : null;
  if (!accessToken) throw new Error('Authentication required');
  return accessToken;
}

export async function listNotificationsForUser(userEmail, options) {
  const email = normalizeEmail(userEmail);
  if (!email) return [];

  const accessToken = requireAccessToken(options);
  const url = `${SERVER_BASE.replace(/\/$/, '')}/me/notifications?limit=200&offset=0`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const body = await safeReadJson(res);
  if (!res.ok) {
    if (allowDevFallback()) {
      const fallback = await entities.Notification.filter({ recipient_email: email }, '-created_date');
      return Array.isArray(fallback) ? fallback : [];
    }
    const messageFromBody =
      (body && typeof body === 'object' && (body.message || body.error)) || null;
    throw new Error(messageFromBody ? String(messageFromBody) : `Failed to load notifications: ${res.status}`);
  }
  const list = body && typeof body === 'object' && Array.isArray(body.notifications) ? body.notifications : [];
  return list;
}

export async function listNotificationsForUserPage(userEmail, { limit = 20, offset = 0, types, unreadOnly } = {}, options) {
  const email = normalizeEmail(userEmail);
  if (!email) return [];

  const accessToken = requireAccessToken(options);
  const qs = new URLSearchParams();
  qs.set('limit', String(Math.max(1, Math.min(200, Number(limit) || 20))));
  qs.set('offset', String(Math.max(0, Number(offset) || 0)));
  if (unreadOnly) qs.set('unread', '1');
  if (Array.isArray(types) && types.length) qs.set('types', types.map((t) => String(t)).join(','));

  const url = `${SERVER_BASE.replace(/\/$/, '')}/me/notifications?${qs.toString()}`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const body = await safeReadJson(res);
  if (!res.ok) {
    if (allowDevFallback()) {
      const fallback = await entities.Notification.filter(
        { recipient_email: email },
        '-created_date',
        { limit, offset }
      );
      return Array.isArray(fallback) ? fallback : [];
    }
    const messageFromBody =
      (body && typeof body === 'object' && (body.message || body.error)) || null;
    throw new Error(messageFromBody ? String(messageFromBody) : `Failed to load notifications: ${res.status}`);
  }
  const list = body && typeof body === 'object' && Array.isArray(body.notifications) ? body.notifications : [];
  return list;
}

export async function filterNotifications(where, options) {
  const accessToken = requireAccessToken(options);

  const safeWhere = where && typeof where === 'object' ? where : {};
  const type = safeWhere.type ? String(safeWhere.type).trim() : '';
  const contentRef = safeWhere.content_ref ? String(safeWhere.content_ref).trim() : '';
  const contentId = safeWhere.content_id ? String(safeWhere.content_id).trim() : '';

  const qs = new URLSearchParams();
  if (type) qs.set('type', type);
  if (contentRef) qs.set('content_ref', contentRef);
  if (contentId) qs.set('content_id', contentId);

  const url = `${SERVER_BASE.replace(/\/$/, '')}/me/notifications/search?${qs.toString()}`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const body = await safeReadJson(res);
  if (!res.ok) {
    if (allowDevFallback()) {
      const fallback = await entities.Notification.filter(safeWhere);
      return Array.isArray(fallback) ? fallback : [];
    }
    const messageFromBody =
      (body && typeof body === 'object' && (body.message || body.error)) || null;
    throw new Error(messageFromBody ? String(messageFromBody) : `Failed to search notifications: ${res.status}`);
  }
  const list = body && typeof body === 'object' && Array.isArray(body.notifications) ? body.notifications : [];
  return list;
}

export async function markNotificationRead(notificationId, options) {
  if (!notificationId) return null;
  const accessToken = requireAccessToken(options);
  const id = String(notificationId).trim();
  if (!id) return null;

  const url = `${SERVER_BASE.replace(/\/$/, '')}/me/notifications/${encodeURIComponent(id)}/read`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const body = await safeReadJson(res);
  if (!res.ok) {
    if (allowDevFallback()) {
      return entities.Notification.update(id, { is_read: true });
    }
    const messageFromBody =
      (body && typeof body === 'object' && (body.message || body.error)) || null;
    throw new Error(messageFromBody ? String(messageFromBody) : `Failed to mark notification read: ${res.status}`);
  }
  return true;
}

export async function markNotificationsRead(notificationIds, options) {
  const ids = Array.isArray(notificationIds) ? notificationIds : [];
  const unique = Array.from(new Set(ids.map((x) => (x == null ? '' : String(x))).filter(Boolean)));
  if (unique.length === 0) return [];

  const accessToken = requireAccessToken(options);
  const url = `${SERVER_BASE.replace(/\/$/, '')}/me/notifications/read`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ ids: unique }),
  });
  const body = await safeReadJson(res);
  if (!res.ok) {
    if (allowDevFallback()) {
      return Promise.all(unique.map((id) => entities.Notification.update(id, { is_read: true })));
    }
    const messageFromBody =
      (body && typeof body === 'object' && (body.message || body.error)) || null;
    throw new Error(messageFromBody ? String(messageFromBody) : `Failed to mark notifications read: ${res.status}`);
  }
  return true;
}

export async function upsertNotification(payload, options) {
  const accessToken = requireAccessToken(options);
  const url = `${SERVER_BASE.replace(/\/$/, '')}/notifications`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload ?? {}),
  });
  const body = await safeReadJson(res);
  if (!res.ok) {
    if (allowDevFallback()) {
      return entities.Notification.create(payload);
    }
    const messageFromBody =
      (body && typeof body === 'object' && (body.message || body.error)) || null;
    throw new Error(messageFromBody ? String(messageFromBody) : `Failed to create notification: ${res.status}`);
  }
  return body?.notification ?? body;
}
