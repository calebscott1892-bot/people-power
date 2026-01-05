import { SERVER_BASE } from './serverBase';

const BASE_URL = SERVER_BASE;

async function safeReadJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export async function searchMovements({ q, city, country, limit = 20, offset = 0, accessToken } = {}) {
  const url = new URL(`${BASE_URL.replace(/\/$/, '')}/search/movements`);
  if (q) url.searchParams.set('q', String(q));
  if (city) url.searchParams.set('city', String(city));
  if (country) url.searchParams.set('country', String(country));
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('offset', String(offset));

  const res = await fetch(url.toString(), {
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${String(accessToken)}` } : {}),
    },
  });
  const body = await safeReadJson(res);
  if (!res.ok) {
    const msg = body?.error || body?.message || `Failed to search movements: ${res.status}`;
    throw new Error(String(msg));
  }
  return Array.isArray(body?.movements) ? body.movements : [];
}

export async function searchUsers({ q, limit = 20, offset = 0, accessToken } = {}) {
  const token = accessToken ? String(accessToken) : null;
  if (!token) throw new Error('Authentication required');

  const url = new URL(`${BASE_URL.replace(/\/$/, '')}/search/users`);
  if (q) url.searchParams.set('q', String(q));
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('offset', String(offset));

  const res = await fetch(url.toString(), {
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });
  const body = await safeReadJson(res);
  if (!res.ok) {
    const msg = body?.error || body?.message || `Failed to search users: ${res.status}`;
    throw new Error(String(msg));
  }
  return Array.isArray(body?.users) ? body.users : [];
}
