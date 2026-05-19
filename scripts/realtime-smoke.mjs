#!/usr/bin/env node
import { randomBytes } from 'node:crypto';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);

function log(line) {
  process.stdout.write(`${line}\n`);
}

function fail(reason) {
  log(`[realtime] FAIL ${reason || 'unknown'}`);
  process.exit(1);
}

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

function assertLocalUrl(name, value) {
  const url = new URL(value);
  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new Error(`${name} must be local; refusing to run against ${url.hostname}`);
  }
  return url;
}

function toWsUrl(base, token) {
  const url = new URL('/ws', base);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('access_token', token);
  return url.toString();
}

function randomPassword() {
  return `${randomBytes(24).toString('base64url')}Aa1!`;
}

async function readJson(res, label) {
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    throw new Error(`${label} status=${res.status} bodyLen=${text.length}`);
  }
  return body;
}

async function adminCreateUser({ supabaseUrl, serviceRole, email, password }) {
  const res = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: serviceRole,
      Authorization: `Bearer ${serviceRole}`,
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  return readJson(res, 'adminCreateUser');
}

async function adminDeleteUser({ supabaseUrl, serviceRole, userId }) {
  if (!userId) return;
  await fetch(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
    headers: {
      apikey: serviceRole,
      Authorization: `Bearer ${serviceRole}`,
    },
  }).catch(() => {});
}

async function signIn({ supabaseUrl, anonKey, email, password }) {
  const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
    },
    body: JSON.stringify({ email, password }),
  });
  const body = await readJson(res, 'signIn');
  const token = String(body?.access_token || '');
  if (!token) throw new Error('signIn returned no access token');
  return token;
}

async function apiFetch(base, path, token, { method = 'GET', body } = {}) {
  const res = await fetch(new URL(path, base), {
    method,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return readJson(res, `${method} ${path}`);
}

function waitForOpen(ws, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('ws open timeout')), timeoutMs);
    ws.addEventListener('open', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
    ws.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('ws error before open'));
    }, { once: true });
  });
}

function waitForEvent(ws, predicate, label, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeEventListener('message', onMessage);
      reject(new Error(`${label} timeout`));
    }, timeoutMs);

    function onMessage(event) {
      let msg = null;
      try {
        msg = JSON.parse(String(event.data || ''));
      } catch {
        return;
      }
      if (!predicate(msg)) return;
      clearTimeout(timer);
      ws.removeEventListener('message', onMessage);
      resolve(msg);
    }

    ws.addEventListener('message', onMessage);
  });
}

async function main() {
  if (typeof WebSocket !== 'function') {
    throw new Error('global WebSocket is unavailable; use Node 22+');
  }

  const senderBase = process.env.E2E_SENDER_BACKEND_BASE || process.env.E2E_BACKEND_BASE || process.env.VITE_API_BASE_URL || 'http://127.0.0.1:3001';
  const receiverBase = process.env.E2E_RECEIVER_BACKEND_BASE || senderBase;
  const supabaseUrl = requiredEnv('VITE_SUPABASE_URL').replace(/\/+$/, '');
  const anonKey = requiredEnv('VITE_SUPABASE_ANON_KEY');
  const serviceRole = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');

  assertLocalUrl('sender backend', senderBase);
  assertLocalUrl('receiver backend', receiverBase);
  assertLocalUrl('Supabase', supabaseUrl);

  const runId = `${Date.now()}_${randomBytes(4).toString('hex')}`;
  const users = [
    { email: `pp_rt_sender_${runId}@example.com`, password: randomPassword(), id: null },
    { email: `pp_rt_receiver_${runId}@example.com`, password: randomPassword(), id: null },
  ];
  let ws = null;

  try {
    for (const user of users) {
      const created = await adminCreateUser({ supabaseUrl, serviceRole, email: user.email, password: user.password });
      user.id = created?.user?.id || created?.id || null;
    }

    const senderToken = await signIn({ supabaseUrl, anonKey, email: users[0].email, password: users[0].password });
    const receiverToken = await signIn({ supabaseUrl, anonKey, email: users[1].email, password: users[1].password });

    ws = new WebSocket(toWsUrl(receiverBase, receiverToken));
    await waitForOpen(ws);
    await waitForEvent(ws, (msg) => msg?.type === 'hello' && msg?.ok === true, 'ws hello');

    const conversationPromise = waitForEvent(
      ws,
      (msg) => msg?.type === 'conversation:updated' && Array.isArray(msg?.conversation?.participant_emails),
      'conversation:updated'
    );

    const conversation = await apiFetch(senderBase, '/conversations', senderToken, {
      method: 'POST',
      body: { recipient_email: users[1].email },
    });
    await conversationPromise;

    const messageText = `realtime smoke ${runId}`;
    const messagePromise = waitForEvent(
      ws,
      (msg) => msg?.type === 'message:new' && msg?.message?.body === messageText,
      'message:new'
    );

    await apiFetch(senderBase, `/conversations/${encodeURIComponent(conversation.id)}/messages`, senderToken, {
      method: 'POST',
      body: { body: messageText },
    });
    const delivered = await messagePromise;

    const messages = await apiFetch(receiverBase, `/conversations/${encodeURIComponent(conversation.id)}/messages`, receiverToken);
    const receiverCanRead = Array.isArray(messages) && messages.some((message) => message?.id === delivered?.message?.id);
    if (!receiverCanRead) throw new Error('receiver fetch did not include realtime message');

    log(`[realtime] PASS sender=${new URL(senderBase).port || 'default'} receiver=${new URL(receiverBase).port || 'default'}`);
  } finally {
    try {
      if (ws) ws.close();
    } catch {
      // ignore
    }
    await Promise.all(users.map((user) => adminDeleteUser({ supabaseUrl, serviceRole, userId: user.id })));
  }
}

main().catch((error) => {
  fail(error?.message || String(error));
});
