import { SERVER_BASE } from './serverBase';

const BASE_URL = SERVER_BASE;

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

export async function searchUsers(query, options) {
  const accessToken = options?.accessToken ? String(options.accessToken) : null;
  if (!accessToken) throw new Error('Authentication required');

  const q = String(query || '').trim();
  if (!q) return [];

  const limit = Number.isFinite(options?.limit) ? Number(options.limit) : 10;
  const url = new URL(`${BASE_URL.replace(/\/$/, '')}/users/search`);
  url.searchParams.set('query', q);
  url.searchParams.set('limit', String(Math.max(1, Math.min(25, limit))));

  const res = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
      ...authHeaders(accessToken),
    },
  });

  const body = await safeReadJson(res);
  if (!res.ok) {
    const msg = body?.error || body?.message || `Failed to search users: ${res.status}`;
    throw new Error(String(msg));
  }

  return Array.isArray(body?.users) ? body.users : [];
}

export async function lookupUsersByEmail(emails, options) {
  const accessToken = options?.accessToken ? String(options.accessToken) : null;
  if (!accessToken) throw new Error('Authentication required');

  const list = Array.isArray(emails) ? emails.map((e) => String(e || '').trim()).filter(Boolean) : [];
  if (!list.length) return [];

  const deduped = Array.from(new Set(list.map((e) => e.toLowerCase())));

  const url = `${BASE_URL.replace(/\/$/, '')}/users/lookup`;
  const chunkSize = 50;
  const chunks = [];
  for (let i = 0; i < deduped.length; i += chunkSize) {
    chunks.push(deduped.slice(i, i + chunkSize));
  }

  const users = [];
  for (const chunk of chunks) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...authHeaders(accessToken),
      },
      body: JSON.stringify({ emails: chunk }),
    });

    const body = await safeReadJson(res);
    if (!res.ok) {
      const msg = body?.error || body?.message || `Failed to lookup users: ${res.status}`;
      throw new Error(String(msg));
    }

    if (Array.isArray(body?.users)) users.push(...body.users);
  }

  const out = [];
  const seen = new Set();
  for (const u of users) {
    const email = String(u?.email || u?.user_email || '').trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    out.push(u);
  }
  return out;
}
