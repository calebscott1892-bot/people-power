/**
 * Lightweight performance logging for People Power.
 *
 * Provides console-level timing logs for key operations:
 * - profile fetch
 * - feed fetch
 * - vote mutation
 * - comment mutation
 * - follow mutation
 *
 * Logs include: operation, endpoint, duration, status, request_id.
 * No external dependencies. All console-only — zero production overhead.
 */

const PERF_LOG_PREFIX = '[PeoplePower:perf]';

/**
 * Start a performance timer. Returns a function to call when the operation completes.
 *
 * @param {string} operation - e.g. 'profile_fetch', 'vote_mutation'
 * @param {{ endpoint?: string, method?: string }} meta
 * @returns {{ end: (result?: { status?: number, request_id?: string, ok?: boolean, error?: string }) => void }}
 */
export function startPerfTimer(operation, meta = {}) {
  const startedAt =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();

  return {
    end(result = {}) {
      const elapsed =
        (typeof performance !== 'undefined' && typeof performance.now === 'function'
          ? performance.now()
          : Date.now()) - startedAt;

      try {
        console.debug(PERF_LOG_PREFIX, {
          operation,
          endpoint: meta.endpoint || null,
          method: meta.method || 'GET',
          duration_ms: Math.round(elapsed),
          status: result.status ?? null,
          ok: result.ok ?? null,
          request_id: result.request_id ?? null,
          error: result.error ?? null,
        });
      } catch {
        // Never let logging break the app.
      }
    },
  };
}

/**
 * Wrap an async function with performance logging.
 *
 * @param {string} operation
 * @param {{ endpoint?: string, method?: string }} meta
 * @param {() => Promise<any>} fn
 * @returns {Promise<any>}
 */
export async function withPerfLog(operation, meta, fn) {
  const timer = startPerfTimer(operation, meta);
  try {
    const result = await fn();
    timer.end({ ok: true });
    return result;
  } catch (e) {
    timer.end({ ok: false, error: e?.message || 'unknown' });
    throw e;
  }
}
