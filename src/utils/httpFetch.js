const DEFAULT_TIMEOUT_MS = 45_000;

export function httpFetch(input, init) {
  const f = globalThis.fetch;
  if (typeof f !== 'function') {
    throw new Error('Fetch is not available in this environment');
  }

  const { timeoutMs, ...requestInit } = init || {};
  const resolvedTimeoutMs = Number.isFinite(timeoutMs) ? Number(timeoutMs) : DEFAULT_TIMEOUT_MS;

  if (!resolvedTimeoutMs || resolvedTimeoutMs <= 0) {
    return f(input, requestInit);
  }

  const existingSignal = requestInit?.signal;
  const controller = new AbortController();

  let abortListener = null;
  if (existingSignal) {
    if (existingSignal.aborted) {
      controller.abort(existingSignal.reason);
    } else {
      abortListener = () => controller.abort(existingSignal.reason);
      try {
        existingSignal.addEventListener('abort', abortListener, { once: true });
      } catch {
        // ignore
      }
    }
  }

  const timeoutId = setTimeout(() => {
    controller.abort('Request timed out');
  }, resolvedTimeoutMs);

  const cleanup = () => {
    clearTimeout(timeoutId);
    if (existingSignal && abortListener) {
      try {
        existingSignal.removeEventListener('abort', abortListener);
      } catch {
        // ignore
      }
    }
  };

  return f(input, { ...requestInit, signal: controller.signal }).finally(cleanup);
}
