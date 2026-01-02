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

export async function upsertMyPublicKey(publicKey, options) {
  const accessToken = options?.accessToken ? String(options.accessToken) : null;
  const url = `${BASE_URL.replace(/\/$/, '')}/me/public-key`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...authHeaders(accessToken),
    },
    body: JSON.stringify({ public_key: publicKey }),
  });

  const body = await safeReadJson(res);
  if (!res.ok) {
    const messageFromBody = (body && typeof body === 'object' && (body.error || body.message)) || null;
    throw new Error(messageFromBody ? String(messageFromBody) : `Failed to publish public key: ${res.status}`);
  }

  return body ?? { ok: true };
}

export async function fetchPublicKey(email, options) {
  const accessToken = options?.accessToken ? String(options.accessToken) : null;
  const encoded = encodeURIComponent(String(email || '').trim());
  const url = `${BASE_URL.replace(/\/$/, '')}/public-keys/${encoded}`;

  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      ...authHeaders(accessToken),
    },
  });

  const body = await safeReadJson(res);
  if (!res.ok) {
    const messageFromBody = (body && typeof body === 'object' && (body.error || body.message)) || null;
    throw new Error(messageFromBody ? String(messageFromBody) : `Failed to fetch public key: ${res.status}`);
  }

  const key = body?.public_key || body?.publicKey || null;
  if (!key) throw new Error('Recipient has no published public key');
  return String(key);
}
