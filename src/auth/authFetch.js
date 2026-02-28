import { SERVER_BASE } from '@/api/serverBase';
import { captureRequestDebugInfo } from '@/utils/requestDebug';
import { classifyResponse, hasHtmlContentType } from '@/utils/responseClassifier';

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

  const now = () =>
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();

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

    // -- Instrumentation: session retrieval timing --
    const sessionStart = isBackend ? now() : 0;
    const currentSession = isBackend ? (getSession() || (await getSessionAsync().catch(() => null))) : null;
    const sessionElapsed = isBackend ? Math.round(now() - sessionStart) : 0;

    // Proactively refresh if we're about to expire (mobile background/resume case).
    let proactiveRefreshElapsed = 0;
    if (isBackend && currentSession && isSessionNearExpiry(currentSession)) {
      const refreshStart = now();
      try {
        await refreshOnce();
      } catch {
        // ignore; we'll fall through and handle errors from the API if needed
      }
      proactiveRefreshElapsed = Math.round(now() - refreshStart);
    }

    const attempt = async () => {
      const tokenStart = now();
      let tokenNow = isBackend ? getAccessToken() : null;
      if (isBackend && !tokenNow) {
        try {
          tokenNow = await getAccessTokenAsync();
        } catch {
          // ignore
        }
      }
      const tokenElapsed = isBackend ? Math.round(now() - tokenStart) : 0;

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

      const fetchStart = now();
      let res;
      try {
        res = await originalFetch(input, {
          ...requestInit,
          headers: headersNow,
        });
      } catch (fetchErr) {
        const fetchElapsed = Math.round(now() - fetchStart);
        // Capture timing even on network errors / aborts so the debug output
        // shows where time was spent before the failure.
        if (isBackend) {
          const endpoint = (() => {
            try {
              if (url.startsWith('/')) return url.split('?')[0];
              return new URL(url).pathname;
            } catch {
              return url;
            }
          })();
          captureRequestDebugInfo({
            label: 'authFetch',
            endpoint,
            method: requestInit?.method || 'GET',
            status: null,
            request_id: null,
            elapsed_ms: fetchElapsed,
            error_message: fetchErr?.message ? String(fetchErr.message) : 'fetch failed',
            timing: {
              session_ms: sessionElapsed,
              proactive_refresh_ms: proactiveRefreshElapsed,
              token_ms: tokenElapsed,
              fetch_ms: fetchElapsed,
            },
          });
        }
        throw fetchErr;
      }
      const fetchElapsed = Math.round(now() - fetchStart);

      // Structured timing capture for backend requests.
      // This is the primary instrumentation for diagnosing stall points.
      if (isBackend) {
        const endpoint = (() => {
          try {
            if (url.startsWith('/')) return url.split('?')[0];
            return new URL(url).pathname;
          } catch {
            return url;
          }
        })();
        captureRequestDebugInfo({
          label: 'authFetch',
          endpoint,
          method: requestInit?.method || 'GET',
          status: res.status,
          request_id: res?.headers?.get ? res.headers.get('x-request-id') : null,
          elapsed_ms: fetchElapsed,
          error_message: res.ok ? null : `HTTP ${res.status}`,
          timing: {
            session_ms: sessionElapsed,
            proactive_refresh_ms: proactiveRefreshElapsed,
            token_ms: tokenElapsed,
            fetch_ms: fetchElapsed,
          },
        });
      }

      return res;
    };

    let res = await attempt();

    // If we got a clear auth failure, try one refresh+retry before forcing logout.
    // BUT: first check if this is actually an HTML challenge/interstitial page
    // (e.g. Cloudflare) rather than a real API auth response.
    if (isBackend && (res.status === 401 || res.status === 403)) {
      // Quick synchronous check before the more expensive async classification.
      const isHtml = hasHtmlContentType(res);

      if (isHtml) {
        // This is likely a Cloudflare challenge or WAF block -- NOT a real auth failure.
        // Do NOT trigger auth-refresh/logout. Classify and capture diagnostics instead.
        const classification = await classifyResponse(res, { snippetLength: 400 });
        const endpoint = (() => {
          try {
            if (url.startsWith('/')) return url.split('?')[0];
            return new URL(url).pathname;
          } catch {
            return url;
          }
        })();

        captureRequestDebugInfo({
          label: 'authFetch:html-intercept',
          endpoint,
          method: requestInit?.method || 'GET',
          status: res.status,
          request_id: res?.headers?.get ? res.headers.get('x-request-id') : null,
          elapsed_ms: null,
          error_message: `HTML response on API request (${classification.classification})`,
          response_class: {
            classification: classification.classification,
            content_type: classification.contentType,
            is_html: classification.isHtml,
            looks_like_cf_challenge: classification.looksLikeCfChallenge,
            looks_like_interstitial: classification.looksLikeInterstitial,
            cf_markers_found: classification.cfMarkersFound,
            snippet: classification.snippet ? classification.snippet.slice(0, 200) : null,
          },
        });

        // Return the response as-is. The caller (httpFetch / React Query) will see
        // the non-ok status and handle it as a normal API error, which is correct --
        // retries may succeed once the challenge clears.
        return res;
      }

      // Not HTML -- proceed with normal auth-failure handling.
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

      // After retry, check again -- but also re-check for HTML interstitial on the retry response.
      if (isAuthFailure && (res.status === 401 || res.status === 403)) {
        const retryIsHtml = hasHtmlContentType(res);
        if (retryIsHtml) {
          // Retry also got an HTML page. Capture and return without forcing logout.
          const retryClassification = await classifyResponse(res, { snippetLength: 400 });
          const endpoint = (() => {
            try {
              if (url.startsWith('/')) return url.split('?')[0];
              return new URL(url).pathname;
            } catch {
              return url;
            }
          })();
          captureRequestDebugInfo({
            label: 'authFetch:html-intercept-retry',
            endpoint,
            method: requestInit?.method || 'GET',
            status: res.status,
            request_id: res?.headers?.get ? res.headers.get('x-request-id') : null,
            elapsed_ms: null,
            error_message: `HTML response on retry (${retryClassification.classification})`,
            response_class: {
              classification: retryClassification.classification,
              content_type: retryClassification.contentType,
              is_html: retryClassification.isHtml,
              looks_like_cf_challenge: retryClassification.looksLikeCfChallenge,
              looks_like_interstitial: retryClassification.looksLikeInterstitial,
              cf_markers_found: retryClassification.cfMarkersFound,
              snippet: retryClassification.snippet ? retryClassification.snippet.slice(0, 200) : null,
            },
          });
          return res;
        }

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
