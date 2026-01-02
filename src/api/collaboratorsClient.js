/**
 * Collaborators API client (Node backend).
 *
 * Endpoints (see Server/index.js):
 * - GET    /movements/:id/collaborators
 * - POST   /movements/:id/collaborators/invite
 * - GET    /user/collaboration-invites
 * - POST   /collaborators/:id/accept
 * - PATCH  /collaborators/:id
 * - DELETE /collaborators/:id
 */

import { SERVER_BASE } from './serverBase';

const BASE_URL = SERVER_BASE;

function base() {
  return String(BASE_URL || '').replace(/\/$/, '');
}

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

async function authedFetch(url, { accessToken, method = 'GET', body } = {}) {
  const headers = { Accept: 'application/json' };
  if (accessToken) headers.Authorization = `Bearer ${String(accessToken)}`;
  if (body != null) headers['Content-Type'] = 'application/json';

  const res = await fetch(url, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });

  const data = await safeReadJson(res);
  if (!res.ok) {
    const msg = data && (data.error || data.message) ? String(data.error || data.message) : `Request failed: ${res.status}`;
    throw new Error(msg);
  }

  return data;
}

export async function listMovementCollaborators(movementId, { accessToken } = {}) {
  const id = normalizeId(movementId);
  if (!id) throw new Error('Movement ID is required');
  const url = `${base()}/movements/${encodeURIComponent(id)}/collaborators`;
  const data = await authedFetch(url, { accessToken });
  return Array.isArray(data?.collaborators) ? data.collaborators : [];
}

export async function inviteCollaborator(movementId, { username, role } = {}, { accessToken } = {}) {
  const id = normalizeId(movementId);
  if (!id) throw new Error('Movement ID is required');
  if (!accessToken) throw new Error('Authentication required');
  const url = `${base()}/movements/${encodeURIComponent(id)}/collaborators/invite`;
  const data = await authedFetch(url, {
    method: 'POST',
    accessToken,
    body: {
      username: username != null ? String(username).trim().replace(/^@+/, '') : '',
      role: role != null ? String(role).trim() : undefined,
    },
  });
  return data?.collaborator ?? data;
}

export async function listMyCollaborationInvites({ accessToken } = {}) {
  if (!accessToken) throw new Error('Authentication required');
  const url = `${base()}/user/collaboration-invites`;
  const data = await authedFetch(url, { accessToken });
  return Array.isArray(data?.invites) ? data.invites : [];
}

export async function acceptCollaborationInvite(collabId, { accessToken } = {}) {
  const id = normalizeId(collabId);
  if (!id) throw new Error('Collaborator ID is required');
  if (!accessToken) throw new Error('Authentication required');
  const url = `${base()}/collaborators/${encodeURIComponent(id)}/accept`;
  const data = await authedFetch(url, { method: 'POST', accessToken });
  return data?.collaborator ?? data;
}

export async function updateCollaboratorRole(collabId, newRole, { accessToken } = {}) {
  const id = normalizeId(collabId);
  if (!id) throw new Error('Collaborator ID is required');
  if (!accessToken) throw new Error('Authentication required');
  const url = `${base()}/collaborators/${encodeURIComponent(id)}`;
  const data = await authedFetch(url, { method: 'PATCH', accessToken, body: { role: String(newRole || '').trim() } });
  return data?.collaborator ?? data;
}

export async function removeCollaborator(collabId, { accessToken } = {}) {
  const id = normalizeId(collabId);
  if (!id) throw new Error('Collaborator ID is required');
  if (!accessToken) throw new Error('Authentication required');
  const url = `${base()}/collaborators/${encodeURIComponent(id)}`;
  return authedFetch(url, { method: 'DELETE', accessToken });
}
