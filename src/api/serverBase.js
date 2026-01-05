const DEV_BACKEND = 'http://localhost:3001';
const PROD_BACKEND = 'https://people-power.onrender.com';

function trimTrailingSlashes(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function isLocalhost() {
  if (typeof window === 'undefined') return false;
  const host = String(window.location?.hostname || '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1';
}

// Single source of truth for backend base URL.
// Rules (per spec):
// 1) If VITE_API_BASE_URL is defined -> ALWAYS use that
// 2) If running on localhost -> use http://localhost:3001
// 3) Otherwise -> use Render backend directly (no /api proxy)
const envBaseRaw = import.meta?.env?.VITE_API_BASE_URL;
const envBase = envBaseRaw ? String(envBaseRaw).trim() : '';

// Production safety: prevent accidentally routing through Cloudflare Pages `/api/*` proxy.
if (import.meta?.env?.PROD && envBase) {
  const isAbsoluteHttp = /^https?:\/\//i.test(envBase);
  if (!isAbsoluteHttp) {
    throw new Error(
      '[PeoplePower] VITE_API_BASE_URL must be an absolute http(s) URL in production. ' +
        'Do not use relative values like "/api". Omit it to use Render directly.'
    );
  }
  try {
    const parsed = new URL(envBase);
    if (String(parsed.pathname || '').startsWith('/api')) {
      throw new Error(
        '[PeoplePower] VITE_API_BASE_URL must not point at a /api proxy in production. ' +
          'Omit it to use Render directly, or set it to the Render origin (no /api prefix).'
      );
    }
  } catch (e) {
    // Re-throw with a stable message.
    throw e instanceof Error
      ? e
      : new Error('[PeoplePower] Invalid VITE_API_BASE_URL in production');
  }
}

export const SERVER_BASE = trimTrailingSlashes(
  envBase || (isLocalhost() ? DEV_BACKEND : PROD_BACKEND)
);

if (import.meta?.env?.DEV) {
  try {
    const key = '__PEOPLEPOWER_SERVER_BASE_LOGGED__';
    if (!globalThis[key]) {
      globalThis[key] = true;
      console.log(`[PeoplePower] SERVER_BASE (frontend API) = ${SERVER_BASE}`);
    }
  } catch {
    // ignore
  }
}

// Backwards-compatible helper (many clients historically imported a function).
export function getServerBaseUrl() {
  return SERVER_BASE;
}
