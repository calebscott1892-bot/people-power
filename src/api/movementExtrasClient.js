/**
 * Legacy Movement Extras client (Node backend).
 *
 * Note:
 * - Core entities have dedicated clients now:
 *   - Events: `eventsClient`
 *   - Petitions: `petitionsClient`
 *   - Resources: `resourcesClient`
 * - This file remains for non-core movement extras that are still movement-scoped:
 *   impact updates, tasks, and discussions.
 */

import { getServerBaseUrl } from './serverBase';

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

async function authedFetch(url, { accessToken, method = 'GET', body } = {}) {
  const headers = {
    Accept: 'application/json',
  };

  if (accessToken) {
    headers.Authorization = `Bearer ${String(accessToken)}`;
  }

  if (body != null) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });

  const data = await safeReadJson(res);
  if (!res.ok) {
    const msg = (data && (data.error || data.message)) ? String(data.error || data.message) : `Request failed: ${res.status}`;
    throw new Error(msg);
  }

  return data;
}

function base() {
  return String(BASE_URL || '').replace(/\/$/, '');
}

export async function fetchMovementResources(movementId) {
  const id = normalizeId(movementId);
  if (!id) throw new Error('Movement ID is required');
  const url = `${base()}/movements/${encodeURIComponent(id)}/resources`;
  const data = await authedFetch(url);
  return Array.isArray(data?.resources) ? data.resources : [];
}

export async function createMovementResource(movementId, payload, { accessToken } = {}) {
  const id = normalizeId(movementId);
  if (!id) throw new Error('Movement ID is required');
  const url = `${base()}/movements/${encodeURIComponent(id)}/resources`;
  const data = await authedFetch(url, { method: 'POST', body: payload, accessToken });
  return data?.resource ?? data;
}

export async function incrementResourceDownload(resourceId, { accessToken } = {}) {
  const id = normalizeId(resourceId);
  if (!id) throw new Error('Resource ID is required');
  if (!accessToken) throw new Error('Authentication required');
  const url = `${base()}/resources/${encodeURIComponent(id)}/download`;
  const data = await authedFetch(url, { method: 'POST', accessToken });
  return data?.resource ?? data;
}

export async function deleteResource(resourceId, { accessToken } = {}) {
  const id = normalizeId(resourceId);
  if (!id) throw new Error('Resource ID is required');
  if (!accessToken) throw new Error('Authentication required');
  const url = `${base()}/resources/${encodeURIComponent(id)}`;
  return authedFetch(url, { method: 'DELETE', accessToken });
}

export async function fetchMovementEvents(movementId) {
  const id = normalizeId(movementId);
  if (!id) throw new Error('Movement ID is required');
  const url = `${base()}/movements/${encodeURIComponent(id)}/events`;
  const data = await authedFetch(url);
  return Array.isArray(data?.events) ? data.events : [];
}

export async function createMovementEvent(movementId, payload, { accessToken } = {}) {
  const id = normalizeId(movementId);
  if (!id) throw new Error('Movement ID is required');
  const url = `${base()}/movements/${encodeURIComponent(id)}/events`;
  const data = await authedFetch(url, { method: 'POST', body: payload, accessToken });
  return data?.event ?? data;
}

export async function fetchMovementPetitions(movementId) {
  const id = normalizeId(movementId);
  if (!id) throw new Error('Movement ID is required');
  const url = `${base()}/movements/${encodeURIComponent(id)}/petitions`;
  const data = await authedFetch(url);
  return Array.isArray(data?.petitions) ? data.petitions : [];
}

export async function createMovementPetition(movementId, payload, { accessToken } = {}) {
  const id = normalizeId(movementId);
  if (!id) throw new Error('Movement ID is required');
  const url = `${base()}/movements/${encodeURIComponent(id)}/petitions`;
  const data = await authedFetch(url, { method: 'POST', body: payload, accessToken });
  return data?.petition ?? data;
}

export async function fetchMovementImpactUpdates(movementId) {
  return fetchMovementImpactUpdatesPage(movementId, { limit: 200, offset: 0 });
}

export async function fetchMovementImpactUpdatesPage(movementId, { limit = 20, offset = 0, fields } = {}) {
  const id = normalizeId(movementId);
  if (!id) throw new Error('Movement ID is required');

  const params = new URLSearchParams();
  if (typeof limit === 'number') params.set('limit', String(limit));
  if (typeof offset === 'number') params.set('offset', String(offset));
  if (Array.isArray(fields) && fields.length) params.set('fields', fields.join(','));

  const url = `${base()}/movements/${encodeURIComponent(id)}/impact${params.toString() ? `?${params.toString()}` : ''}`;
  const data = await authedFetch(url);
  return Array.isArray(data?.updates) ? data.updates : [];
}

export async function createMovementImpactUpdate(movementId, payload, { accessToken } = {}) {
  const id = normalizeId(movementId);
  if (!id) throw new Error('Movement ID is required');
  const url = `${base()}/movements/${encodeURIComponent(id)}/impact`;
  const data = await authedFetch(url, { method: 'POST', body: payload, accessToken });
  return data?.update ?? data;
}

export async function fetchMovementTasks(movementId) {
  return fetchMovementTasksPage(movementId, { limit: 200, offset: 0 });
}

export async function fetchMovementTasksPage(movementId, { limit = 20, offset = 0, fields } = {}) {
  const id = normalizeId(movementId);
  if (!id) throw new Error('Movement ID is required');

  const params = new URLSearchParams();
  if (typeof limit === 'number') params.set('limit', String(limit));
  if (typeof offset === 'number') params.set('offset', String(offset));
  if (Array.isArray(fields) && fields.length) params.set('fields', fields.join(','));

  const url = `${base()}/movements/${encodeURIComponent(id)}/tasks${params.toString() ? `?${params.toString()}` : ''}`;
  const data = await authedFetch(url);
  return Array.isArray(data?.tasks) ? data.tasks : [];
}

export async function createMovementTask(movementId, payload, { accessToken } = {}) {
  const id = normalizeId(movementId);
  if (!id) throw new Error('Movement ID is required');
  const url = `${base()}/movements/${encodeURIComponent(id)}/tasks`;
  const data = await authedFetch(url, { method: 'POST', body: payload, accessToken });
  return data?.task ?? data;
}

export async function updateTask(taskId, payload, { accessToken } = {}) {
  const id = normalizeId(taskId);
  if (!id) throw new Error('Task ID is required');
  if (!accessToken) throw new Error('Authentication required');
  const url = `${base()}/tasks/${encodeURIComponent(id)}`;
  const data = await authedFetch(url, { method: 'PATCH', body: payload, accessToken });
  return data?.task ?? data;
}

export async function fetchMovementDiscussions(movementId) {
  return fetchMovementDiscussionsPage(movementId, { limit: 200, offset: 0 });
}

export async function fetchMovementDiscussionsPage(movementId, { limit = 20, offset = 0, fields } = {}) {
  const id = normalizeId(movementId);
  if (!id) throw new Error('Movement ID is required');

  const params = new URLSearchParams();
  if (typeof limit === 'number') params.set('limit', String(limit));
  if (typeof offset === 'number') params.set('offset', String(offset));
  if (Array.isArray(fields) && fields.length) params.set('fields', fields.join(','));

  const url = `${base()}/movements/${encodeURIComponent(id)}/discussions${params.toString() ? `?${params.toString()}` : ''}`;
  const data = await authedFetch(url);
  return Array.isArray(data?.messages) ? data.messages : [];
}

export async function createMovementDiscussionMessage(movementId, payload, { accessToken } = {}) {
  const id = normalizeId(movementId);
  if (!id) throw new Error('Movement ID is required');
  const url = `${base()}/movements/${encodeURIComponent(id)}/discussions`;
  const data = await authedFetch(url, { method: 'POST', body: payload, accessToken });
  return data?.message ?? data;
}

export async function fetchMovementEvidencePage(
  movementId,
  { limit = 20, offset = 0, status = 'approved', fields, accessToken } = {}
) {
  const id = normalizeId(movementId);
  if (!id) throw new Error('Movement ID is required');

  const params = new URLSearchParams();
  if (typeof limit === 'number') params.set('limit', String(limit));
  if (typeof offset === 'number') params.set('offset', String(offset));
  if (status) params.set('status', String(status));
  if (Array.isArray(fields) && fields.length) params.set('fields', fields.join(','));

  const url = `${base()}/movements/${encodeURIComponent(id)}/evidence${params.toString() ? `?${params.toString()}` : ''}`;
  const data = await authedFetch(url, { accessToken });
  return Array.isArray(data?.evidence) ? data.evidence : [];
}

export async function createMovementEvidence(movementId, payload, { accessToken } = {}) {
  const id = normalizeId(movementId);
  if (!id) throw new Error('Movement ID is required');
  if (!accessToken) throw new Error('Authentication required');
  const url = `${base()}/movements/${encodeURIComponent(id)}/evidence`;
  const data = await authedFetch(url, { method: 'POST', body: payload, accessToken });
  return data?.evidence ?? data;
}

export async function verifyMovementEvidence(movementId, evidenceId, payload, { accessToken } = {}) {
  const id = normalizeId(movementId);
  const evidence = normalizeId(evidenceId);
  if (!id) throw new Error('Movement ID is required');
  if (!evidence) throw new Error('Evidence ID is required');
  if (!accessToken) throw new Error('Authentication required');
  const url = `${base()}/movements/${encodeURIComponent(id)}/evidence/${encodeURIComponent(evidence)}/verify`;
  const data = await authedFetch(url, { method: 'POST', body: payload, accessToken });
  return data?.evidence ?? data;
}
