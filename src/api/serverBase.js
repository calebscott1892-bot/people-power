const DEFAULT_SERVER_URL = 'http://localhost:3001';
const DEFAULT_PROD_BASE = '/api';

function isAbsoluteUrl(value) {
  return /^https?:\/\//i.test(String(value || '').trim());
}

function isLocalServerUrl(value) {
  try {
    const url = new URL(String(value));
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

export function getServerBaseUrl() {
  const serverUrlRaw = import.meta?.env?.VITE_SERVER_URL;
  const apiBaseRaw = import.meta?.env?.VITE_API_BASE_URL;
  const appApiBaseRaw = import.meta?.env?.VITE_APP_API_BASE_URL;
  const serverUrl = serverUrlRaw ? String(serverUrlRaw).trim() : '';
  const apiBase = apiBaseRaw ? String(apiBaseRaw).trim() : '';
  const appApiBase = appApiBaseRaw ? String(appApiBaseRaw).trim() : '';
  const isDev = import.meta?.env?.DEV;
  const isLocalHost =
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

  if (isDev) {
    if (isAbsoluteUrl(serverUrl)) {
      if (isLocalHost && !isLocalServerUrl(serverUrl)) {
        return DEFAULT_SERVER_URL;
      }
      return serverUrl.replace(/\/+$/, '');
    }
    // If dev env only provides relative base hints, force the local backend.
    if (serverUrl && serverUrl.startsWith('/')) {
      return DEFAULT_SERVER_URL;
    }
    if (appApiBase.toLowerCase() === 'relative') {
      return DEFAULT_SERVER_URL;
    }
    return DEFAULT_SERVER_URL;
  }

  if (apiBase.toLowerCase() === 'relative') return '';
  const base = apiBase || serverUrl || DEFAULT_PROD_BASE;
  const trimmed = base ? base.replace(/\/+$/, '') : '';
  if (isLocalHost && trimmed.startsWith('/')) {
    return DEFAULT_SERVER_URL;
  }
  if (!trimmed) {
    return typeof window !== 'undefined' ? window.location.origin : '';
  }
  if (trimmed.startsWith('/') && typeof window !== 'undefined') {
    return `${window.location.origin}${trimmed}`;
  }
  return trimmed;
}
