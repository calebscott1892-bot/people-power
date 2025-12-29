/**
 * Notifications client (local stub entities; NOT Node REST).
 *
 * Current behavior:
 * - There is no `/notifications` route in the Node server.
 * - Notifications are stored via `entities.Notification` (localStorage-backed stub in dev).
 *
 * @typedef {Object} Notification
 * @property {string} id
 * @property {string} recipient_email
 * @property {string} type
 * @property {string|null} actor_name
 * @property {string|null} actor_email
 * @property {string|null} content_id
 * @property {string|null} content_ref
 * @property {string|null} content_title
 * @property {string|null} created_date
 * @property {boolean|null} is_read
 * @property {Object|null} metadata
 */

import { entities } from '@/api/appClient';

function normalizeEmail(value) {
  const s = value ? String(value).trim().toLowerCase() : '';
  return s || null;
}

export async function listNotificationsForUser(userEmail) {
  const email = normalizeEmail(userEmail);
  if (!email) return [];
  const res = await entities.Notification.filter({ recipient_email: email }, '-created_date');
  return Array.isArray(res) ? res : [];
}

export async function listNotificationsForUserPage(userEmail, { limit = 20, offset = 0, fields } = {}) {
  const email = normalizeEmail(userEmail);
  if (!email) return [];
  const res = await entities.Notification.filter(
    { recipient_email: email },
    '-created_date',
    { limit, offset, fields }
  );
  return Array.isArray(res) ? res : [];
}

export async function filterNotifications(where) {
  const safeWhere = where && typeof where === 'object' ? where : {};
  const res = await entities.Notification.filter(safeWhere);
  return Array.isArray(res) ? res : [];
}

export async function markNotificationRead(notificationId) {
  if (!notificationId) return null;
  return entities.Notification.update(notificationId, { is_read: true });
}

export async function markNotificationsRead(notificationIds) {
  const ids = Array.isArray(notificationIds) ? notificationIds : [];
  const unique = Array.from(new Set(ids.map((x) => (x == null ? '' : String(x))).filter(Boolean)));
  if (unique.length === 0) return [];
  return Promise.all(unique.map((id) => entities.Notification.update(id, { is_read: true })));
}

export async function upsertNotification(payload) {
  return entities.Notification.create(payload);
}
