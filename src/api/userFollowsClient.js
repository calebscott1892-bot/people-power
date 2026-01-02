import { SERVER_BASE } from './serverBase';

const BASE_URL = SERVER_BASE;

async function safeReadJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export async function fetchUserFollow(targetEmail, options) {
  const email = String(targetEmail || '').trim();
  if (!email) throw new Error('targetEmail is required');

  const accessToken = options?.accessToken ? String(options.accessToken) : null;
  if (!accessToken) throw new Error('Authentication required');

  const url = `${BASE_URL.replace(/\/$/, '')}/users/${encodeURIComponent(email)}/follow`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const body = await safeReadJson(res);
  if (!res.ok) {
    const msg = (body && (body.error || body.message)) ? String(body.error || body.message) : `Failed to load follow state: ${res.status}`;
    throw new Error(msg);
  }

  return body && typeof body === 'object'
    ? body
    : { following: false, followers_count: 0, following_count: 0 };
}

export async function setUserFollow(targetEmail, following, options) {
  const email = String(targetEmail || '').trim();
  if (!email) throw new Error('targetEmail is required');

  const accessToken = options?.accessToken ? String(options.accessToken) : null;
  if (!accessToken) throw new Error('Authentication required');

  const url = `${BASE_URL.replace(/\/$/, '')}/users/${encodeURIComponent(email)}/follow`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ following: !!following }),
  });

  const body = await safeReadJson(res);
  if (!res.ok) {
    const msg = (body && (body.error || body.message)) ? String(body.error || body.message) : `Failed to update follow state: ${res.status}`;
    throw new Error(msg);
  }

  return body && typeof body === 'object' ? body : { ok: true };
}

export async function fetchMyFollowingUsers(options) {
  const accessToken = options?.accessToken ? String(options.accessToken) : null;
  if (!accessToken) throw new Error('Authentication required');

  const url = `${BASE_URL.replace(/\/$/, '')}/me/following-users`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const body = await safeReadJson(res);
  if (!res.ok) {
    const msg = (body && (body.error || body.message)) ? String(body.error || body.message) : `Failed to load following: ${res.status}`;
    throw new Error(msg);
  }

  const users = body && typeof body === 'object' && Array.isArray(body.users) ? body.users : [];
  return users;
}

export async function fetchMyFollowers(options) {
  const accessToken = options?.accessToken ? String(options.accessToken) : null;
  if (!accessToken) throw new Error('Authentication required');

  const url = `${BASE_URL.replace(/\/$/, '')}/me/followers`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const body = await safeReadJson(res);
  if (!res.ok) {
    const msg = (body && (body.error || body.message)) ? String(body.error || body.message) : `Failed to load followers: ${res.status}`;
    throw new Error(msg);
  }

  const users = body && typeof body === 'object' && Array.isArray(body.users) ? body.users : [];
  return users;
}
