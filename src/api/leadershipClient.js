import { SERVER_BASE } from './serverBase';
import { httpFetch } from '@/utils/httpFetch';

async function safeReadJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export async function fetchLeadershipCounts(roleType, options) {
  const accessToken = options?.accessToken ? String(options.accessToken) : null;
  if (!accessToken) throw new Error('Authentication required');

  const rt = String(roleType || '').trim();
  if (!rt) throw new Error('roleType is required');

  const url = `${SERVER_BASE.replace(/\/$/, '')}/leadership/counts?role_type=${encodeURIComponent(rt)}`;
  const res = await httpFetch(url, {
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const body = await safeReadJson(res);
  if (!res.ok) {
    const messageFromBody =
      (body && typeof body === 'object' && (body.message || body.error)) || null;
    throw new Error(messageFromBody ? String(messageFromBody) : `Failed to load leadership counts: ${res.status}`);
  }
  return (body && typeof body === 'object' && body.counts) || {};
}

export async function checkLeadershipCap(roleType, options) {
  const accessToken = options?.accessToken ? String(options.accessToken) : null;
  if (!accessToken) throw new Error('Authentication required');

  const rt = String(roleType || '').trim();
  if (!rt) throw new Error('roleType is required');

  const url = `${SERVER_BASE.replace(/\/$/, '')}/me/leadership/cap?role_type=${encodeURIComponent(rt)}`;
  const res = await httpFetch(url, {
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const body = await safeReadJson(res);
  if (!res.ok) {
    const messageFromBody =
      (body && typeof body === 'object' && (body.message || body.error)) || null;
    throw new Error(messageFromBody ? String(messageFromBody) : `Failed to check cap: ${res.status}`);
  }
  return body;
}

export async function registerLeadershipRole(roleType, movementId, options) {
  const accessToken = options?.accessToken ? String(options.accessToken) : null;
  if (!accessToken) throw new Error('Authentication required');

  const url = `${SERVER_BASE.replace(/\/$/, '')}/me/leadership/register`;
  const res = await httpFetch(url, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ role_type: String(roleType || '').trim(), movement_id: movementId ?? null }),
  });

  const body = await safeReadJson(res);
  if (!res.ok) {
    const messageFromBody =
      (body && typeof body === 'object' && (body.message || body.error)) || null;
    const err = new Error(messageFromBody ? String(messageFromBody) : `Failed to register role: ${res.status}`);
    err.code = body?.error || undefined;
    throw err;
  }

  return body?.role || null;
}

export async function deactivateLeadershipRole(roleType, movementId, options) {
  const accessToken = options?.accessToken ? String(options.accessToken) : null;
  if (!accessToken) throw new Error('Authentication required');

  const url = `${SERVER_BASE.replace(/\/$/, '')}/me/leadership/deactivate`;
  const res = await httpFetch(url, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ role_type: String(roleType || '').trim(), movement_id: movementId ?? null }),
  });

  const body = await safeReadJson(res);
  if (!res.ok) {
    const messageFromBody =
      (body && typeof body === 'object' && (body.message || body.error)) || null;
    throw new Error(messageFromBody ? String(messageFromBody) : `Failed to deactivate role: ${res.status}`);
  }

  return true;
}
