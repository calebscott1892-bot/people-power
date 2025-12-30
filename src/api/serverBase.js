const DEFAULT_SERVER_URL = 'http://localhost:3001';

export function getServerBaseUrl() {
  const fromEnv = import.meta?.env?.VITE_SERVER_URL;
  const base = (fromEnv && String(fromEnv).trim()) || DEFAULT_SERVER_URL;
  return base.replace(/\/+$/, '');
}
