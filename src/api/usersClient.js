
import { SERVER_BASE } from './serverBase';
import { httpFetch } from '@/utils/httpFetch';
import { getAccessToken } from '../auth/AuthProvider';
const isProof = import.meta.env.VITE_C4_PROOF_PACK === "1";

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

  const res = await httpFetch(url.toString(), {
    cache: 'no-store',
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

export async function lookupUsers({ emails, userIds } = {}, options) {
  const accessToken = options?.accessToken ? String(options.accessToken) : null;
  if (!accessToken) throw new Error('Authentication required');

  const emailList = Array.isArray(emails)
    ? emails.map((e) => String(e || '').trim()).filter(Boolean)
    : [];
  const userIdList = Array.isArray(userIds)
    ? userIds.map((id) => String(id || '').trim()).filter(Boolean)
    : [];

  const dedupedEmails = Array.from(new Set(emailList.map((e) => e.toLowerCase())));
  const dedupedUserIds = Array.from(new Set(userIdList));

  if (!dedupedEmails.length && !dedupedUserIds.length) return [];

  const url = `${BASE_URL.replace(/\/$/, '')}/users/lookup`;
  const chunkSize = 50;
  const emailChunks = [];
  for (let i = 0; i < dedupedEmails.length; i += chunkSize) {
    emailChunks.push(dedupedEmails.slice(i, i + chunkSize));
  }
  const userIdChunks = [];
  for (let i = 0; i < dedupedUserIds.length; i += chunkSize) {
    userIdChunks.push(dedupedUserIds.slice(i, i + chunkSize));
  }

  const users = [];
  const maxChunks = Math.max(emailChunks.length, userIdChunks.length);
  for (let i = 0; i < maxChunks; i += 1) {
    const emailChunk = emailChunks[i] || [];
    const userIdChunk = userIdChunks[i] || [];
    const res = await httpFetch(url, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...authHeaders(accessToken),
      },
      body: JSON.stringify({ emails: emailChunk, user_ids: userIdChunk }),
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

export async function lookupUsersByEmail(emails, options) {
  return lookupUsers({ emails }, options);
}

// --- Backend user sync for persistence proof ---
export async function syncUserWithBackend() {
  if (isProof) return;
  const token = getAccessToken();
  if (!token) throw new Error('No Supabase access token');
  const res = await httpFetch(`${BASE_URL.replace(/\/$/, '')}/auth/sync`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) throw new Error('Failed to sync user with backend');
  return await res.json();
}

export async function fetchMeFromBackend() {
  if (isProof) {
    const res = await httpFetch('/auth/me', { credentials: 'include' });
    if (!res.ok) throw new Error('Failed to fetch user from backend');
    return await res.json();
  }
  const token = getAccessToken();
  if (!token) throw new Error('No Supabase access token');
  const res = await httpFetch(`${BASE_URL.replace(/\/$/, '')}/auth/me`, {
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });
  if (!res.ok) throw new Error('Failed to fetch user from backend');
  return await res.json();
}
