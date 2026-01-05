const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

function safeParse(json) {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function getPageCache(key) {
  const k = String(key || '').trim();
  if (!k) return null;
  try {
    const raw = localStorage.getItem(k);
    if (!raw) return null;
    const parsed = safeParse(raw);
    if (!parsed || typeof parsed !== 'object') return null;

    const ts = typeof parsed.ts === 'number' ? parsed.ts : 0;
    const ttlMs = typeof parsed.ttlMs === 'number' ? parsed.ttlMs : DEFAULT_TTL_MS;
    if (!ts || Date.now() - ts > ttlMs) return null;

    return parsed.data ?? null;
  } catch {
    return null;
  }
}

export function setPageCache(key, data, { ttlMs = DEFAULT_TTL_MS } = {}) {
  const k = String(key || '').trim();
  if (!k) return;
  try {
    localStorage.setItem(
      k,
      JSON.stringify({ ts: Date.now(), ttlMs: Number(ttlMs) || DEFAULT_TTL_MS, data })
    );
  } catch {
    // ignore storage failures
  }
}
