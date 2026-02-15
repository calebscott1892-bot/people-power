import { SERVER_BASE } from '@/api/serverBase';

const AUTH_EXPIRED_EVENT = 'pp:auth-expired';
const BACKEND_AUTH_FAILED_EVENT = 'backend-auth-failed';
const DEV = !!import.meta?.env?.DEV;

let installed = false;
let originalFetch = null;

let getAccessToken = () => null;
let getSession = () => null;
let getAccessTokenAsync = async () => null;
let getSessionAsync = async () => null;
let onAuthExpired = () => {};
let refreshSession = async () => null;

function isBackendUrl(url) {
  const raw = String(url || '');

  // Same-origin relative requests should only be treated as backend if they
  // look like API calls. Avoid attaching auth headers to asset/document fetches.
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

  // Absolute requests to the configured backend base.
  return raw.startsWith(String(SERVER_BASE || ''));
}

function shouldTreatForbiddenAsAuthFailure(responseText) {
  const text = String(responseText || '').toLowerCase();
  return (
    text.includes('invalid session') ||
    text.includes('unauthorized session') ||
    text.includes('auth session missing') ||
    text.includes('jwt expired') ||
    text.includes('no authorization')
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

function dispatchBackendAuthFailed(detail) {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(
      new CustomEvent(BACKEND_AUTH_FAILED_EVENT, {
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

function normalizeFetchArgs(input, init) {
  // Normalize into { url, requestInit } so we can safely retry.
  if (input instanceof Request) {
    const req = input;
    return {
      url: req.url,
      requestInit: {
        method: req.method,
        headers: req.headers,
        body: req.body,
        mode: req.mode,
        credentials: req.credentials,
        cache: req.cache,
        redirect: req.redirect,
        referrer: req.referrer,
        referrerPolicy: req.referrerPolicy,
        integrity: req.integrity,
        keepalive: req.keepalive,
        signal: req.signal,
        ...(init || {}),
      },
    };
  }

  return {
    url: String(input),
    requestInit: init || {},
  };
}

function withAuthHeader(existingHeaders, token) {
  const headers = new Headers(existingHeaders || {});
  // If we have a current token, always prefer it. This prevents stale caller-provided
  // tokens from causing "invalid session" loops after refresh (common on mobile).
  if (token) headers.set('Authorization', `Bearer ${String(token)}`);
  return headers;
}

function ensureJsonContentType(headers, requestInit) {
  const h = new Headers(headers || {});
  if (h.has('content-type')) return h;
  const body = requestInit?.body;
  if (typeof body !== 'string') return h;
  const trimmed = body.trim();
  // Heuristic: only auto-set JSON content-type for JSON-looking strings.
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    h.set('content-type', 'application/json');
  }
  return h;
}

function isSessionNearExpiry(session, withinSeconds = 60) {
  const expiresAt = session?.expires_at;
  if (!expiresAt) return false;
  const nowSeconds = Math.floor(Date.now() / 1000);
  return Number(expiresAt) - nowSeconds <= withinSeconds;
}

export function configureAuthFetch(options) {
  getAccessToken = options?.getAccessToken || getAccessToken;
  getSession = options?.getSession || getSession;
  getAccessTokenAsync = options?.getAccessTokenAsync || getAccessTokenAsync;
  getSessionAsync = options?.getSessionAsync || getSessionAsync;
  onAuthExpired = options?.onAuthExpired || onAuthExpired;
  refreshSession = options?.refreshSession || refreshSession;
}

export function installAuthFetch() {
  if (typeof window === 'undefined') return;
  if (installed) return;

  installed = true;
  originalFetch = window.fetch.bind(window);

  let handlingAuthFailure = false;
  let refreshInFlight = null;

  const refreshOnce = async () => {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = (async () => {
      await refreshSession();
      return true;
    })();
    try {
      return await refreshInFlight;
    } finally {
      refreshInFlight = null;
    }
  };

  window.fetch = async (input, init) => {
    const { url, requestInit } = normalizeFetchArgs(input, init);

    const isBackend = isBackendUrl(url);
    const currentSession = isBackend ? (getSession() || (await getSessionAsync().catch(() => null))) : null;

    // Proactively refresh if we're about to expire (mobile background/resume case).
    if (isBackend && currentSession && isSessionNearExpiry(currentSession)) {
      try {
        await refreshOnce();
      } catch {
        // ignore; we'll fall through and handle errors from the API if needed
      }
    }

    const attempt = async () => {
      let tokenNow = isBackend ? getAccessToken() : null;
      if (isBackend && !tokenNow) {
        try {
          tokenNow = await getAccessTokenAsync();
        } catch {
          // ignore
        }
      }

      const authAttached = isBackend && !!tokenNow;
      let headersNow = isBackend ? withAuthHeader(requestInit.headers, tokenNow) : requestInit.headers;
      headersNow = isBackend ? ensureJsonContentType(headersNow, requestInit) : headersNow;

      if (DEV && isBackend) {
        try {
          console.debug('[PeoplePower] backend request', {
            url,
            authAttached,
            method: requestInit?.method || 'GET',
          });
        } catch {
          // ignore
        }
      }

      return originalFetch(input, {
        ...requestInit,
        headers: headersNow,
      });
    };

    let res = await attempt();

    // If we got a clear auth failure, try one refresh+retry before forcing logout.
    if (isBackend && (res.status === 401 || res.status === 403)) {
      if (DEV) {
        try {
          console.debug('[PeoplePower] backend auth response', { url, status: res.status });
        } catch {
          // ignore
        }
      }

      const text = await readResponseTextSafe(res);
      const isAuthFailure =
        res.status === 401 ||
        (res.status === 403 && shouldTreatForbiddenAsAuthFailure(text));

      if (isAuthFailure) {
        try {
          await refreshOnce();
          res = await attempt();
        } catch {
          // ignore
        }
      }

      if (isAuthFailure && (res.status === 401 || res.status === 403)) {
        if (!handlingAuthFailure) {
          handlingAuthFailure = true;

          const requestId = res?.headers?.get ? res.headers.get('x-request-id') : null;
          const expired = shouldTreatForbiddenAsAuthFailure(text) || String(text || '').toLowerCase().includes('invalid session');
          const reason = expired ? 'invalid_session' : 'auth_failed';
          const message = expired
            ? 'Your session has expired. Please sign in again.'
            : 'Backend authentication failed (401). Check that requests include an Authorization header and that the backend points at the same Supabase project.';

          dispatchBackendAuthFailed({ message, url, status: res.status, request_id: requestId || null });
          dispatchAuthExpired({ message, url, status: res.status, request_id: requestId || null, reason });

          try {
            await onAuthExpired({ message, url, status: res.status, request_id: requestId || null, reason });
          } finally {
            // allow future auth failures to be handled if user signs in again
            setTimeout(() => {
              handlingAuthFailure = false;
            }, 1000);
          }
        }
      }
    }

    return res;
  };
}

export function onAuthExpiredEvent(listener) {
  if (typeof window === 'undefined') return () => {};
  const handler = (event) => listener?.(event?.detail);
  window.addEventListener(AUTH_EXPIRED_EVENT, handler);
  return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handler);
}
