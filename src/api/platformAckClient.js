import { entities } from '@/api/appClient';
import { getServerBaseUrl } from './serverBase';

const BASE_URL = getServerBaseUrl();

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

function normalizeEmail(value) {
  const s = value == null ? '' : String(value).trim().toLowerCase();
  return s || null;
}

function looksLikeNetworkError(err) {
  const msg = String(err?.message || '');
  return (
    msg.includes('Failed to fetch') ||
    msg.includes('NetworkError') ||
    msg.includes('Load failed') ||
    msg.includes('ECONNREFUSED')
  );
}

async function fetchLocalAck(userEmail) {
  const email = normalizeEmail(userEmail);
  if (!email) return { accepted: false };
  const existing = await entities.PlatformAcknowledgment.filter({ user_email: email });
  const record = Array.isArray(existing) && existing.length ? existing[0] : null;
  return { accepted: !!record?.accepted };
}

async function acceptLocalAck(userEmail) {
  const email = normalizeEmail(userEmail);
  if (!email) throw new Error('User email is required');
  const existing = await entities.PlatformAcknowledgment.filter({ user_email: email });
  const record = Array.isArray(existing) && existing.length ? existing[0] : null;
  if (record?.id) {
    await entities.PlatformAcknowledgment.update(record.id, {
      accepted: true,
      accepted_at: new Date().toISOString(),
    });
  } else {
    await entities.PlatformAcknowledgment.create({
      user_email: email,
      accepted: true,
      accepted_at: new Date().toISOString(),
    });
  }
  return { accepted: true };
}

export async function fetchMyPlatformAcknowledgment(options) {
  const accessToken = options?.accessToken ? String(options.accessToken) : null;
  const userEmail = options?.userEmail ? String(options.userEmail) : null;
  const url = `${BASE_URL.replace(/\/$/, '')}/platform-acknowledgment/me`;

  // If we have no token, fall back to local storage.
  if (!accessToken) return fetchLocalAck(userEmail);

  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        ...authHeaders(accessToken),
      },
    });

    const body = await safeReadJson(res);
    if (!res.ok) {
      const messageFromBody =
        (body && typeof body === 'object' && (body.error || body.message)) || null;
      throw new Error(
        messageFromBody ? String(messageFromBody) : `Failed to load acknowledgment: ${res.status}`
      );
    }

    return body ?? { accepted: false };
  } catch (e) {
    if (!looksLikeNetworkError(e)) throw e;
    return fetchLocalAck(userEmail);
  }
}

export async function acceptPlatformAcknowledgment(options) {
  const accessToken = options?.accessToken ? String(options.accessToken) : null;
  const userEmail = options?.userEmail ? String(options.userEmail) : null;
  const url = `${BASE_URL.replace(/\/$/, '')}/platform-acknowledgment/me`;

  // If we have no token, fall back to local storage.
  if (!accessToken) return acceptLocalAck(userEmail);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...authHeaders(accessToken),
      },
      body: JSON.stringify({ accepted: true }),
    });

    const body = await safeReadJson(res);
    if (!res.ok) {
      const messageFromBody =
        (body && typeof body === 'object' && (body.error || body.message)) || null;
      throw new Error(
        messageFromBody ? String(messageFromBody) : `Failed to record acknowledgment: ${res.status}`
      );
    }

    return body ?? { ok: true };
  } catch (e) {
    if (!looksLikeNetworkError(e)) throw e;
    return acceptLocalAck(userEmail);
  }
}
