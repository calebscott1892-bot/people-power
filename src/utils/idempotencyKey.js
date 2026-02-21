export function newIdempotencyKey(prefix = '') {
  const p = String(prefix || '').trim();
  try {
    if (typeof crypto !== 'undefined' && crypto?.randomUUID) {
      const id = crypto.randomUUID();
      return p ? `${p}_${id}` : id;
    }
  } catch {
    // ignore
  }

  const fallback = `idemp_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  return p ? `${p}_${fallback}` : fallback;
}
