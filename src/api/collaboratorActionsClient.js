import { getServerBaseUrl } from './serverBase';

// API client for CollaboratorActionLog
const BASE_URL = getServerBaseUrl();

function normalizeId(value) {
  if (value == null) return null;
  const s = String(value).trim();
  return s ? s : null;
}

async function safeReadJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export async function fetchCollaboratorActions(movementId, options) {
  const id = normalizeId(movementId);
  if (!id) return [];

  const accessToken = options?.accessToken ? String(options.accessToken) : null;
  if (!accessToken) throw new Error('Authentication required');

  const url = `${BASE_URL.replace(/\/$/, '')}/movements/${encodeURIComponent(id)}/collaborator-actions`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const body = await safeReadJson(res);
  if (!res.ok) {
    const msg = (body && (body.error || body.message)) ? String(body.error || body.message) : `Failed to fetch collaborator actions: ${res.status}`;
    throw new Error(msg);
  }
  return body?.actions || [];
}
