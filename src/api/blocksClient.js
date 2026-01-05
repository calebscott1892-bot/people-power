import { SERVER_BASE } from './serverBase';

const BASE_URL = SERVER_BASE;

// Blocking behavior (server-enforced):
// - Creates a record in `user_blocks (blocker_email, blocked_email)` via POST /me/blocks.
// - Core interactions between two accounts are rejected when either user has blocked the other
//   (e.g. follow/unfollow, commenting on the other user's movements, movement votes/follows, and DM creation).
// - List + profile reads may also be hidden/filtered in some places for privacy.
// Client note: error responses use a generic message so we don't reveal who blocked whom.

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

export async function fetchMyBlocks(options) {
  const accessToken = options?.accessToken ? String(options.accessToken) : null;
  if (!accessToken) throw new Error('Authentication required');

  const url = `${BASE_URL.replace(/\/$/, '')}/me/blocks`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      ...authHeaders(accessToken),
    },
  });

  const body = await safeReadJson(res);
  if (!res.ok) {
    const message = (body && (body.message || body.error)) || `Failed to load blocks: ${res.status}`;
    throw new Error(String(message));
  }

  return body;
}

export async function blockUser(blockedEmail, options) {
  const accessToken = options?.accessToken ? String(options.accessToken) : null;
  if (!accessToken) throw new Error('Authentication required');
  const email = String(blockedEmail || '').trim();
  if (!email) throw new Error('Blocked email is required');

  const url = `${BASE_URL.replace(/\/$/, '')}/me/blocks`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...authHeaders(accessToken),
    },
    body: JSON.stringify({ blocked_email: email }),
  });

  const body = await safeReadJson(res);
  if (!res.ok) {
    const message = (body && (body.message || body.error)) || `Failed to block user: ${res.status}`;
    throw new Error(String(message));
  }
  return body;
}

export async function unblockUser(blockedEmail, options) {
  const accessToken = options?.accessToken ? String(options.accessToken) : null;
  if (!accessToken) throw new Error('Authentication required');
  const email = String(blockedEmail || '').trim();
  if (!email) throw new Error('Blocked email is required');

  const url = `${BASE_URL.replace(/\/$/, '')}/me/blocks/${encodeURIComponent(email)}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: {
      Accept: 'application/json',
      ...authHeaders(accessToken),
    },
  });

  const body = await safeReadJson(res);
  if (!res.ok) {
    const message = (body && (body.message || body.error)) || `Failed to unblock user: ${res.status}`;
    throw new Error(String(message));
  }
  return body;
}
