/**
 * Minimal frontend error logger.
 *
 * Today: logs to console in a structured way.
 * Future: this can be extended to POST to a backend /logs endpoint.
 *
 * Constraints:
 * - Avoid PII; prefer IDs and high-level context.
 */

function sanitizeValue(value) {
  if (value == null) return value;
  const t = typeof value;
  if (t === 'number' || t === 'boolean') return value;
  if (t === 'string') return value.length > 300 ? `${value.slice(0, 300)}…` : value;
  if (Array.isArray(value)) return value.slice(0, 20).map(sanitizeValue);
  if (t === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (k.toLowerCase().includes('token') || k.toLowerCase().includes('password')) continue;
      out[k] = sanitizeValue(v);
    }
    return out;
  }
  return String(value);
}

function normalizeError(error) {
  if (error instanceof Error) return error;
  const msg = typeof error === 'string' ? error : 'Unknown error';
  const e = new Error(msg);
  // Preserve a little context if we got a non-Error object.
  if (error && typeof error === 'object') {
    try {
      e.name = String(error.name || e.name);
    } catch {
      // ignore
    }
  }
  return e;
}

/**
 * @param {unknown} error
 * @param {string} context
 * @param {Record<string, unknown>=} meta
 */
export function logError(error, context, meta) {
  const err = normalizeError(error);

  const payload = {
    ts: new Date().toISOString(),
    context: String(context || 'Unknown context'),
    name: String(err.name || 'Error'),
    message: String(err.message || ''),
    stack: import.meta?.env?.DEV ? String(err.stack || '') : undefined,
    meta: meta ? sanitizeValue(meta) : undefined,
  };

  if (import.meta?.env?.DEV) {
    // Only log in development, not production
    console.error('[PeoplePower]', payload);
  }

  return payload;
}
