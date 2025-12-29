/**
 * Durable Object backing store for generic entity CRUD.
 *
 * This is intentionally simple and mirrors the local stub behavior:
 * - equality-only filtering (where: { field: value })
 * - optional sort (e.g. -created_date)
 * - limit/offset pagination
 * - optional fields projection
 *
 * Next step: replace this with Postgres via Hyperdrive.
 */

function json(data, init = {}) {
  const headers = new Headers(init.headers);
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  return new Response(JSON.stringify(data), { ...init, headers });
}

function safeJsonParse(value, fallback) {
  try {
    if (value == null) return fallback;
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeSort(sort) {
  if (!sort) return null;
  const s = String(sort).trim();
  return s || null;
}

function normalizeFields(fields) {
  if (!fields) return null;
  const list = String(fields)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length ? Array.from(new Set(list)) : null;
}

function projectFields(record, fields) {
  if (!fields) return record;
  const out = {};
  const want = new Set(['id', ...fields]);
  for (const key of want) {
    if (Object.prototype.hasOwnProperty.call(record, key)) out[key] = record[key];
  }
  return out;
}

function sortRecords(records, sort) {
  const s = normalizeSort(sort);
  if (!s) return records;

  const desc = s.startsWith('-');
  const field = desc ? s.slice(1) : s;
  if (!field) return records;

  const copy = [...records];
  copy.sort((a, b) => {
    const av = a?.[field];
    const bv = b?.[field];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;

    const an = typeof av === 'number' ? av : Number(av);
    const bn = typeof bv === 'number' ? bv : Number(bv);
    if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;

    const at = (() => {
      try {
        const t = new Date(av).getTime();
        return Number.isFinite(t) ? t : null;
      } catch {
        return null;
      }
    })();
    const bt = (() => {
      try {
        const t = new Date(bv).getTime();
        return Number.isFinite(t) ? t : null;
      } catch {
        return null;
      }
    })();
    if (at != null && bt != null) return at - bt;

    return String(av).localeCompare(String(bv));
  });

  return desc ? copy.reverse() : copy;
}

function matchesWhere(record, where) {
  if (!where) return true;
  const entries = Object.entries(where);
  for (const [k, v] of entries) {
    if (record?.[k] !== v) return false;
  }
  return true;
}

function newId() {
  try {
    if (typeof crypto !== 'undefined' && crypto?.randomUUID) return crypto.randomUUID();
  } catch {
    // ignore
  }
  return `cf_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export class EntityStore {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);

    // Routes:
    // - GET    /entities/:entity
    // - POST   /entities/:entity
    // - PATCH  /entities/:entity/:id
    // - DELETE /entities/:entity/:id
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] !== 'entities') return new Response('Not Found', { status: 404 });

    const entityName = parts[1];
    const id = parts[2] || null;
    if (!entityName) return json({ error: 'Missing entity name' }, { status: 400 });

    const storageKey = `entities:${entityName}:records`;
    const records = (await this.state.storage.get(storageKey)) || [];

    if (request.method === 'GET') {
      const where = safeJsonParse(url.searchParams.get('where'), null);
      const sort = url.searchParams.get('sort');
      const limitRaw = url.searchParams.get('limit');
      const offsetRaw = url.searchParams.get('offset');
      const fields = normalizeFields(url.searchParams.get('fields'));

      const limit = Number.isFinite(Number(limitRaw)) ? Math.max(0, Number(limitRaw)) : null;
      const offset = Number.isFinite(Number(offsetRaw)) ? Math.max(0, Number(offsetRaw)) : 0;

      const filtered = records.filter((r) => matchesWhere(r, where));
      const sorted = sortRecords(filtered, sort);
      const sliced = limit != null ? sorted.slice(offset, offset + limit) : sorted.slice(offset);
      const projected = fields ? sliced.map((r) => projectFields(r, fields)) : sliced;

      return json(projected);
    }

    if (request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const record = { ...body };
      if (!record.id) record.id = newId();
      if (!record.created_date) record.created_date = new Date().toISOString();

      const next = [...records, record];
      await this.state.storage.put(storageKey, next);
      return json(record, { status: 201 });
    }

    if (request.method === 'PATCH') {
      if (!id) return json({ error: 'Missing id' }, { status: 400 });
      const patch = await request.json().catch(() => ({}));

      let updated = null;
      const next = records.map((r) => {
        if (r?.id !== id) return r;
        updated = { ...r, ...patch, id };
        return updated;
      });

      if (!updated) return json({ error: 'Not Found' }, { status: 404 });
      await this.state.storage.put(storageKey, next);
      return json(updated);
    }

    if (request.method === 'DELETE') {
      if (!id) return json({ error: 'Missing id' }, { status: 400 });
      const next = records.filter((r) => r?.id !== id);
      await this.state.storage.put(storageKey, next);
      return json({ ok: true });
    }

    return new Response('Method Not Allowed', { status: 405 });
  }
}
