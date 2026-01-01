import { getServerBaseUrl } from './serverBase';

const BASE_URL = getServerBaseUrl();

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
