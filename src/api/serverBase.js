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

export const SERVER_BASE = trimTrailingSlashes(
  envBase || (isLocalhost() ? DEV_BACKEND : PROD_BACKEND)
);

// Backwards-compatible helper (many clients historically imported a function).
export function getServerBaseUrl() {
  return SERVER_BASE;
}
