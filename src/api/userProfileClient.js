import { SERVER_BASE } from './serverBase';

async function safeReadJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export async function upsertMyProfile(payload, options) {
  const accessToken = options?.accessToken ? String(options.accessToken) : null;
  if (!accessToken) throw new Error('Authentication required');

  const BASE_URL = SERVER_BASE;

  const url = `${BASE_URL.replace(/\/$/, '')}/me/profile`;
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
    const messageFromBody =
      (body && typeof body === 'object' && (body.message || body.error)) || null;
    const error = new Error(messageFromBody ? String(messageFromBody) : `Failed to update profile: ${res.status}`);
    if (body && typeof body === 'object' && body.error === 'USERNAME_TAKEN') {
      error.code = 'USERNAME_TAKEN';
    }
    error.status = res.status;
    throw error;
  }

  if (body && typeof body === 'object' && body.profile) return body.profile;
  return body;
}

export async function fetchMyProfile(options) {
  const accessToken = options?.accessToken ? String(options.accessToken) : null;
  const includeMeta = options?.includeMeta === true;
  if (!accessToken) throw new Error('Authentication required');

  const BASE_URL = SERVER_BASE;

  const url = `${BASE_URL.replace(/\/$/, '')}/me/profile${includeMeta ? '?include_meta=1' : ''}`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const body = await safeReadJson(res);

  if (!res.ok) {
    const messageFromBody =
      (body && typeof body === 'object' && (body.message || body.error)) || null;
    throw new Error(messageFromBody ? String(messageFromBody) : `Failed to load profile: ${res.status}`);
  }

  if (includeMeta) return body;
  if (body && typeof body === 'object' && 'profile' in body) return body.profile;
  return body;
}

export async function fetchPublicProfileByUsername(username, options) {
  const accessToken = options?.accessToken ? String(options.accessToken) : null;
  if (!accessToken) throw new Error('Authentication required');

  const BASE_URL = SERVER_BASE;

  const handle = String(username || '').trim();
  if (!handle) throw new Error('Username is required');

  const url = `${BASE_URL.replace(/\/$/, '')}/profiles/username/${encodeURIComponent(handle)}`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const body = await safeReadJson(res);
  if (!res.ok) {
    const messageFromBody =
      (body && typeof body === 'object' && (body.message || body.error)) || null;
    throw new Error(messageFromBody ? String(messageFromBody) : `Failed to load profile: ${res.status}`);
  }

  if (body && typeof body === 'object' && body.profile) return body.profile;
  return body;
}
