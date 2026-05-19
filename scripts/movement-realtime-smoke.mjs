#!/usr/bin/env node
import { randomBytes } from 'node:crypto';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);

function log(line) {
  process.stdout.write(`${line}\n`);
}

function fail(reason) {
  log(`[movement-realtime] FAIL ${reason || 'unknown'}`);
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
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
    { email: `pp_mv_sender_${runId}@example.com`, password: randomPassword(), id: null },
    { email: `pp_mv_receiver_${runId}@example.com`, password: randomPassword(), id: null },
  ];
  let ws = null;
  let movementId = null;
  let senderToken = null;

  try {
    for (const user of users) {
      const created = await adminCreateUser({ supabaseUrl, serviceRole, email: user.email, password: user.password });
      user.id = created?.user?.id || created?.id || null;
    }

    senderToken = await signIn({ supabaseUrl, anonKey, email: users[0].email, password: users[0].password });
    const receiverToken = await signIn({ supabaseUrl, anonKey, email: users[1].email, password: users[1].password });

    await apiFetch(senderBase, '/platform-acknowledgment/me', senderToken, {
      method: 'POST',
      body: { accepted: true },
    });

    const movement = await apiFetch(senderBase, '/movements', senderToken, {
      method: 'POST',
      body: {
        title: `Movement realtime smoke ${runId}`,
        summary: 'Local verification movement for realtime engagement sync.',
        visibility: 'public',
        tags: ['smoke'],
      },
    });
    movementId = String(movement?.id || movement?.movement?.id || '');
    if (!movementId) throw new Error('movement create returned no id');

    ws = new WebSocket(toWsUrl(receiverBase, receiverToken));
    await waitForOpen(ws);
    await waitForEvent(ws, (msg) => msg?.type === 'hello' && msg?.ok === true, 'ws hello');

    const subscribed = waitForEvent(
      ws,
      (msg) => msg?.type === 'movement:subscribed' && String(msg?.movementId || '') === movementId,
      'movement:subscribed'
    );
    ws.send(JSON.stringify({ type: 'movement:subscribe', movementId }));
    await subscribed;

    const commentText = `movement realtime comment ${runId}`;
    const commentEvent = waitForEvent(
      ws,
      (msg) => msg?.type === 'movement:comment:new' && String(msg?.movementId || '') === movementId,
      'movement:comment:new'
    );
    await apiFetch(senderBase, `/movements/${encodeURIComponent(movementId)}/comments`, senderToken, {
      method: 'POST',
      body: { content: commentText },
    });
    await commentEvent;

    const voteEvent = waitForEvent(
      ws,
      (msg) => msg?.type === 'movement:vote:updated' && String(msg?.movementId || '') === movementId && Number(msg?.votes?.upvotes) >= 1,
      'movement:vote:updated'
    );
    await apiFetch(senderBase, `/movements/${encodeURIComponent(movementId)}/vote`, senderToken, {
      method: 'POST',
      body: { value: 1 },
    });
    await voteEvent;

    const followEvent = waitForEvent(
      ws,
      (msg) => msg?.type === 'movement:follow:updated' && String(msg?.movementId || '') === movementId && Number(msg?.followers_count) >= 1,
      'movement:follow:updated'
    );
    await apiFetch(senderBase, `/movements/${encodeURIComponent(movementId)}/follow`, senderToken, {
      method: 'POST',
      body: { following: true },
    });
    await followEvent;

    const comments = await apiFetch(receiverBase, `/movements/${encodeURIComponent(movementId)}/comments?limit=5`, receiverToken);
    const commentList = Array.isArray(comments?.comments) ? comments.comments : [];
    if (!commentList.some((comment) => comment?.content === commentText)) {
      throw new Error('receiver fetch did not include realtime comment');
    }

    const votes = await apiFetch(receiverBase, `/movements/${encodeURIComponent(movementId)}/votes`, receiverToken);
    if (Number(votes?.upvotes) < 1) throw new Error('receiver vote summary did not update');

    const followers = await apiFetch(receiverBase, `/movements/${encodeURIComponent(movementId)}/follow/count`, receiverToken);
    if (Number(followers?.count) < 1) throw new Error('receiver follow count did not update');

    log(`[movement-realtime] PASS sender=${new URL(senderBase).port || 'default'} receiver=${new URL(receiverBase).port || 'default'}`);
  } finally {
    try {
      if (ws) ws.close();
    } catch {
      // ignore
    }
    if (movementId && senderToken) {
      await apiFetch(senderBase, `/movements/${encodeURIComponent(movementId)}/delete`, senderToken, {
        method: 'POST',
        body: {
          reason: 'Local realtime smoke cleanup removes this temporary movement after verifying comments boosts follows and websocket propagation across backend processes during automated recovery checks today safely.',
        },
      }).catch(() => {});
    }
    await Promise.all(users.map((user) => adminDeleteUser({ supabaseUrl, serviceRole, userId: user.id })));
  }
}

main().catch((error) => {
  fail(error?.message || String(error));
});
