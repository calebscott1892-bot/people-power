import { SERVER_BASE } from './serverBase';

const BASE_URL = SERVER_BASE;

// Follows data model:
// - Stored in `user_follows` table: (follower_email, following_email, created_at)
// - Relationship + counts: GET/POST /users/:email/follow -> { following, followers_count, following_count, my_following_count }
// - List views:
//   - GET /me/followers and /me/following-users (own lists)
//   - GET /users/:email/followers and /users/:email/following-users (other users; may be blocked for private accounts)

async function safeReadJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function getErrorMessage(res, body, fallback) {
  const msg = body && typeof body === 'object' && (body.error || body.message) ? String(body.error || body.message) : '';
  return msg || fallback || `Request failed (${res.status})`;
}

function toApiError(res, body, fallbackMessage) {
  const err = new Error(getErrorMessage(res, body, fallbackMessage));
  if (body && typeof body === 'object' && body.code) err.code = String(body.code);
  err.status = res.status;
  return err;
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
    throw toApiError(res, body, `Failed to load follow state: ${res.status}`);
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
    throw toApiError(res, body, `Failed to update follow state: ${res.status}`);
  }

  return body && typeof body === 'object' ? body : { ok: true };
}

export async function fetchUserFollowingUsers(targetEmail, options) {
  const email = String(targetEmail || '').trim();
  if (!email) throw new Error('targetEmail is required');

  const accessToken = options?.accessToken ? String(options.accessToken) : null;
  if (!accessToken) throw new Error('Authentication required');

  const url = `${BASE_URL.replace(/\/$/, '')}/users/${encodeURIComponent(email)}/following-users`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const body = await safeReadJson(res);
  if (res.status === 403) {
    return {
      allowed: false,
      message: getErrorMessage(res, body, 'Followers list is only visible to people you follow.'),
      users: [],
    };
  }
  if (!res.ok) {
    throw toApiError(res, body, `Failed to load following: ${res.status}`);
  }

  const users = body && typeof body === 'object' && Array.isArray(body.users) ? body.users : [];
  return { allowed: true, users };
}

export async function fetchUserFollowers(targetEmail, options) {
  const email = String(targetEmail || '').trim();
  if (!email) throw new Error('targetEmail is required');

  const accessToken = options?.accessToken ? String(options.accessToken) : null;
  if (!accessToken) throw new Error('Authentication required');

  const url = `${BASE_URL.replace(/\/$/, '')}/users/${encodeURIComponent(email)}/followers`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const body = await safeReadJson(res);
  if (res.status === 403) {
    return {
      allowed: false,
      message: getErrorMessage(res, body, 'Followers list is only visible to people you follow.'),
      users: [],
    };
  }
  if (!res.ok) {
    throw toApiError(res, body, `Failed to load followers: ${res.status}`);
  }

  const users = body && typeof body === 'object' && Array.isArray(body.users) ? body.users : [];
  return { allowed: true, users };
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
    throw toApiError(res, body, `Failed to load following: ${res.status}`);
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
    throw toApiError(res, body, `Failed to load followers: ${res.status}`);
  }

  const users = body && typeof body === 'object' && Array.isArray(body.users) ? body.users : [];
  return users;
}
