import { SERVER_BASE } from './serverBase';

const BASE_URL = SERVER_BASE;

async function safeReadJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export async function fetchChallenges() {
  const url = `${BASE_URL.replace(/\/$/, '')}/challenges`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const body = await safeReadJson(res);
  if (!res.ok) {
    const msg = body && typeof body === 'object' && (body.error || body.message) ? String(body.error || body.message) : 'Failed to load challenges';
    throw new Error(msg);
  }
  return Array.isArray(body) ? body : body?.challenges || [];
}

export async function fetchAdminChallenges(accessToken) {
  const url = `${BASE_URL.replace(/\/$/, '')}/admin/challenges`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const body = await safeReadJson(res);
  if (!res.ok) {
    const msg = body && typeof body === 'object' && (body.error || body.message) ? String(body.error || body.message) : 'Failed to load challenges';
    throw new Error(msg);
  }
  return Array.isArray(body) ? body : body?.challenges || [];
}

export async function saveAdminChallenge(payload, accessToken) {
  const url = `${BASE_URL.replace(/\/$/, '')}/admin/challenges`;
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
    const msg = body && typeof body === 'object' && (body.error || body.message) ? String(body.error || body.message) : 'Failed to save challenge';
    throw new Error(msg);
  }
  return body?.challenge ?? body;
}

export async function archiveAdminChallenge(id, accessToken) {
  const url = `${BASE_URL.replace(/\/$/, '')}/admin/challenges/${encodeURIComponent(String(id))}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const body = await safeReadJson(res);
  if (!res.ok) {
    const msg = body && typeof body === 'object' && (body.error || body.message) ? String(body.error || body.message) : 'Failed to archive challenge';
    throw new Error(msg);
  }
  return body;
}
