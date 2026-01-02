/**
 * Petition signatures API client (Node backend).
 *
 * Endpoints (see Server/index.js):
 * - GET  /petitions/:id/signatures -> { summary: { count, velocity_7d, velocity_24h }, my_signature: PetitionSignature|null }
 * - POST /petitions/:id/sign       -> { signature: PetitionSignature|null }
 *
 * @typedef {Object} PetitionSignature
 * @property {string} id
 * @property {string} movement_id
 * @property {string} petition_id
 * @property {string} user_email
 * @property {string|null} comment
 * @property {boolean|null} is_public
 * @property {string|null} created_at
 */

import { SERVER_BASE } from './serverBase';

const BASE_URL = SERVER_BASE;

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

function base() {
  return String(BASE_URL || '').replace(/\/$/, '');
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
    const msg = (data && (data.error || data.message))
      ? String(data.error || data.message)
      : `Request failed: ${res.status}`;
    throw new Error(msg);
  }

  return data;
}

export async function fetchPetitionSignatureSummary(petitionId, { accessToken } = {}) {
  const id = normalizeId(petitionId);
  if (!id) throw new Error('Petition ID is required');
  const url = `${base()}/petitions/${encodeURIComponent(id)}/signatures`;
  return authedFetch(url, { accessToken });
}

export async function signPetition(petitionId, { comment, isPublic = true } = {}, { accessToken } = {}) {
  const id = normalizeId(petitionId);
  if (!id) throw new Error('Petition ID is required');
  if (!accessToken) throw new Error('Authentication required');
  const url = `${base()}/petitions/${encodeURIComponent(id)}/sign`;
  return authedFetch(url, {
    method: 'POST',
    accessToken,
    body: {
      action: 'sign',
      comment: comment != null ? String(comment) : undefined,
      is_public: !!isPublic,
    },
  });
}

export async function withdrawPetitionSignature(petitionId, { accessToken } = {}) {
  const id = normalizeId(petitionId);
  if (!id) throw new Error('Petition ID is required');
  if (!accessToken) throw new Error('Authentication required');
  const url = `${base()}/petitions/${encodeURIComponent(id)}/sign`;
  return authedFetch(url, { method: 'POST', accessToken, body: { action: 'withdraw' } });
}
