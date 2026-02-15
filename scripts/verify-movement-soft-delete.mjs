#!/usr/bin/env node

const SERVER_BASE = String(process.env.SERVER_BASE || 'http://127.0.0.1:8787').replace(/\/$/, '');
const ACCESS_TOKEN = String(process.env.ACCESS_TOKEN || '').trim();
const FOLLOWER_ACCESS_TOKEN = String(process.env.FOLLOWER_ACCESS_TOKEN || '').trim();

function requireEnv(name, value) {
  if (!value) {
    console.error(`Missing ${name}`);
    process.exit(1);
  }
}

function words(n) {
  return Array.from({ length: n }, (_v, i) => `word${i + 1}`).join(' ');
}

async function httpJson(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${SERVER_BASE}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body != null ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    // ignore
  }
  return { res, json };
}

async function main() {
  requireEnv('ACCESS_TOKEN', ACCESS_TOKEN);

  console.log('[verify] server', SERVER_BASE);

  // 1) Create a movement we can safely delete.
  const title = `Soft-delete verify ${Date.now()}`;
  const { res: createRes, json: created } = await httpJson('/movements', {
    method: 'POST',
    token: ACCESS_TOKEN,
    body: {
      title,
      description: 'Created by verify-movement-soft-delete.mjs',
      tags: ['verify', 'soft-delete'],
    },
  });
  if (!createRes.ok) {
    console.error('[verify] create failed', createRes.status, created);
    process.exit(1);
  }
  const movementId = created?.id ? String(created.id) : null;
  if (!movementId) {
    console.error('[verify] create missing id', created);
    process.exit(1);
  }
  console.log('[verify] created movement', movementId);

  // 2) Optional: follow as a second user.
  if (FOLLOWER_ACCESS_TOKEN) {
    const { res: followRes, json: followBody } = await httpJson(`/movements/${encodeURIComponent(movementId)}/follow`, {
      method: 'POST',
      token: FOLLOWER_ACCESS_TOKEN,
      body: { following: true },
    });
    if (!followRes.ok) {
      console.error('[verify] follower follow failed', followRes.status, followBody);
      process.exit(1);
    }
    console.log('[verify] follower now following');
  }

  // 3) Enforce 25+ words.
  {
    const { res, json } = await httpJson(`/movements/${encodeURIComponent(movementId)}/delete`, {
      method: 'POST',
      token: ACCESS_TOKEN,
      body: { reason: words(10) },
    });
    if (res.status !== 400) {
      console.error('[verify] expected 400 for short reason', res.status, json);
      process.exit(1);
    }
    console.log('[verify] short reason rejected (ok)');
  }

  // 4) Soft delete succeeds.
  const longReason = `${words(26)}. This is a verification reason for accountable deletion.`;
  {
    const { res, json } = await httpJson(`/movements/${encodeURIComponent(movementId)}/delete`, {
      method: 'POST',
      token: ACCESS_TOKEN,
      body: { reason: longReason },
    });
    if (!res.ok) {
      console.error('[verify] delete failed', res.status, json);
      process.exit(1);
    }
    if (!json?.movement?.is_deleted) {
      console.error('[verify] expected tombstone movement in delete response', json);
      process.exit(1);
    }
    console.log('[verify] delete succeeded (ok)');
  }

  // 5) Excluded from feeds.
  {
    const { res, json } = await httpJson('/movements?limit=100', { method: 'GET' });
    if (!res.ok) {
      console.error('[verify] list failed', res.status, json);
      process.exit(1);
    }
    const list = Array.isArray(json) ? json : (Array.isArray(json?.movements) ? json.movements : []);
    const found = list.some((m) => String(m?.id || '') === movementId);
    if (found) {
      console.error('[verify] expected movement to be excluded from /movements');
      process.exit(1);
    }
    console.log('[verify] excluded from /movements (ok)');
  }

  // 6) Excluded from search.
  {
    const { res, json } = await httpJson(`/search/movements?q=${encodeURIComponent(title)}&limit=50`, { method: 'GET' });
    if (!res.ok) {
      console.error('[verify] search failed', res.status, json);
      process.exit(1);
    }
    const list = Array.isArray(json?.movements) ? json.movements : [];
    const found = list.some((m) => String(m?.id || '') === movementId);
    if (found) {
      console.error('[verify] expected movement to be excluded from /search/movements');
      process.exit(1);
    }
    console.log('[verify] excluded from /search/movements (ok)');
  }

  // 7) Owner can fetch tombstone.
  {
    const { res, json } = await httpJson(`/movements/${encodeURIComponent(movementId)}`, {
      method: 'GET',
      token: ACCESS_TOKEN,
    });
    if (!res.ok) {
      console.error('[verify] detail failed for owner', res.status, json);
      process.exit(1);
    }
    if (!json?.is_deleted) {
      console.error('[verify] expected is_deleted tombstone', json);
      process.exit(1);
    }
    if (!json?.deletion_reason) {
      console.error('[verify] expected deletion_reason', json);
      process.exit(1);
    }
    console.log('[verify] owner tombstone visible (ok)');
  }

  // 8) Follower can fetch tombstone.
  if (FOLLOWER_ACCESS_TOKEN) {
    const { res, json } = await httpJson(`/movements/${encodeURIComponent(movementId)}`, {
      method: 'GET',
      token: FOLLOWER_ACCESS_TOKEN,
    });
    if (!res.ok) {
      console.error('[verify] detail failed for follower', res.status, json);
      process.exit(1);
    }
    if (!json?.is_deleted) {
      console.error('[verify] expected follower tombstone', json);
      process.exit(1);
    }
    console.log('[verify] follower tombstone visible (ok)');
  }

  console.log('[verify] all checks passed');
}

main().catch((e) => {
  console.error('[verify] fatal', e);
  process.exit(1);
});
