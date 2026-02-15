import { SERVER_BASE } from '@/api/serverBase';
import { getValidAccessToken } from '@/api/supabaseClient';

const DEFAULT_TIMEOUT_MS = 45_000;

const AUTH_EXPIRED_EVENT = 'pp:auth-expired';
const DIAG_ENABLED = (() => {
  try {
    const raw = import.meta?.env?.VITE_ENABLE_DIAG_ENDPOINT;
    const s = raw != null ? String(raw).trim().toLowerCase() : '';
    return s === '1' || s === 'true' || s === 'yes';
  } catch {
    return false;
  }
})();

const DIAG_INVALID_SESSION_URL = '/__diag/invalid-session-401';

function isBackendApiUrl(url) {
  const raw = String(url || '');
  if (!raw) return false;

  if (raw.startsWith('/')) {
    return (
      raw.startsWith('/me/') ||
      raw.startsWith('/api/') ||
      raw.startsWith('/auth/') ||
      raw.startsWith('/users/') ||
      raw.startsWith('/movements') ||
      raw.startsWith('/platform-acknowledgment') ||
      raw.startsWith('/incidents') ||
      raw.startsWith('/events') ||
      raw.startsWith('/notifications') ||
      raw.startsWith('/reports') ||
      raw.startsWith('/resources') ||
      raw.startsWith('/uploads') ||
      raw.startsWith('/admin/')
    );
  }

  return SERVER_BASE ? raw.startsWith(String(SERVER_BASE)) : false;
}

function shouldTreat401AsExpired(responseText) {
  const text = String(responseText || '').toLowerCase();
  return (
    text.includes('invalid session') ||
    text.includes('unauthorized session') ||
    text.includes('auth session missing') ||
    text.includes('jwt expired') ||
    text.includes('session expired')
  );
}

async function readResponseTextSafe(res) {
  try {
    return await res.clone().text();
  } catch {
    return '';
  }
}

function dispatchAuthExpired(detail) {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(
      new CustomEvent(AUTH_EXPIRED_EVENT, {
        detail: {
          ...(detail && typeof detail === 'object' ? detail : null),
          at: Date.now(),
        },
      })
    );
  } catch {
    // ignore
  }
}

function withAuthHeader(existingHeaders, token) {
  const headers = new Headers(existingHeaders || {});
  if (token) headers.set('Authorization', `Bearer ${String(token)}`);
  return headers;
}

function ensureJsonContentType(headers, requestInit) {
  const h = new Headers(headers || {});
  if (h.has('content-type')) return h;
  const body = requestInit?.body;
  if (typeof body !== 'string') return h;
  const trimmed = body.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    h.set('content-type', 'application/json');
  }
  return h;
}

export function httpFetch(input, init) {
  const f = globalThis.fetch;
  if (typeof f !== 'function') {
    throw new Error('Fetch is not available in this environment');
  }

  const safeAbort = (controller, reason) => {
    if (!controller) return;
    try {
      // Newer runtimes allow an abort reason; older Safari may throw.
      if (reason !== undefined) return controller.abort(reason);
      return controller.abort();
    } catch {
      try {
        return controller.abort();
      } catch {
        // ignore
      }
    }
  };

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
      safeAbort(controller, existingSignal.reason);
    } else {
      abortListener = () => safeAbort(controller, existingSignal.reason);
      try {
        existingSignal.addEventListener('abort', abortListener, { once: true });
      } catch {
        // ignore
      }
    }
  }

  const timeoutId = setTimeout(() => {
    safeAbort(controller, 'Request timed out');
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

  const doFetch = async () => {
    const url = input instanceof Request ? input.url : String(input);

    // Dev-only diagnostic: simulate an invalid-session backend 401.
    if (DIAG_ENABLED) {
      try {
        const path = url.startsWith('http') ? new URL(url).pathname : url;
        if (String(path) === DIAG_INVALID_SESSION_URL) {
          const headers = new Headers({
            'content-type': 'text/plain; charset=utf-8',
            'x-request-id': 'diag-invalid-session-401',
          });
          const res = new Response('Invalid session', { status: 401, headers });
          dispatchAuthExpired({
            message: 'Your session has expired. Please sign in again.',
            reason: 'invalid_session',
            url,
            status: 401,
            request_id: 'diag-invalid-session-401',
          });
          return res;
        }
      } catch {
        // ignore
      }
    }

    const isBackend = isBackendApiUrl(url);

    let headers = requestInit?.headers;
    if (isBackend) {
      let token = null;
      try {
        token = await getValidAccessToken();
      } catch {
        token = null;
      }
      headers = withAuthHeader(headers, token);
      headers = ensureJsonContentType(headers, requestInit);
    }

    const res = await f(input, { ...requestInit, headers, signal: controller.signal });

    // Global 401 handling (final response after any authFetch retry):
    // if the backend says "Invalid session", ensure we don't leave the UI spinning.
    if (isBackend && res && res.status === 401) {
      const text = await readResponseTextSafe(res);
      if (shouldTreat401AsExpired(text)) {
        const requestId = res?.headers?.get ? res.headers.get('x-request-id') : null;
        dispatchAuthExpired({
          message: 'Your session has expired. Please sign in again.',
          reason: 'invalid_session',
          url,
          status: res.status,
          request_id: requestId || null,
        });
      }
    }

    return res;
  };

  return doFetch().finally(cleanup);
}

// Expose a tiny dev-only helper for manual verification:
// - In dev with VITE_ENABLE_DIAG_ENDPOINT=1, run:
//   await window.__ppDiagTriggerInvalidSession401?.()
if (DIAG_ENABLED) {
  try {
    if (typeof window !== 'undefined' && !window.__ppDiagTriggerInvalidSession401) {
      window.__ppDiagTriggerInvalidSession401 = async () => httpFetch(DIAG_INVALID_SESSION_URL, { cache: 'no-store' });
    }
  } catch {
    // ignore
  }
}
