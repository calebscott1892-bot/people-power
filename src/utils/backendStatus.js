// Lightweight backend status checker for People Power
// Exports: checkBackendHealth, subscribeBackendStatus, getCurrentBackendStatus

import { SERVER_BASE } from '@/api/serverBase';
import { httpFetch } from '@/utils/httpFetch';

const STATUS = {
  HEALTHY: 'healthy',
  DEGRADED: 'degraded',
  OFFLINE: 'offline',
};

let currentStatus = STATUS.HEALTHY;
const listeners = new Set();
let checkTimeout = null;

function notify(status) {
  if (currentStatus !== status) {
    currentStatus = status;
    listeners.forEach((fn) => {
      try { fn(currentStatus); } catch {
        // Ignore listener failures to keep status updates flowing.
      }
    });
  }
}

export function getCurrentBackendStatus() {
  return currentStatus;
}

export function subscribeBackendStatus(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const DEFAULT_TIMEOUT_MS = 8000;

export async function checkBackendHealth({ timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  let status = STATUS.HEALTHY;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const res = await httpFetch(`${SERVER_BASE}/health`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    clearTimeout(timeout);
    if (!res.ok) status = STATUS.DEGRADED;
    else status = STATUS.HEALTHY;
  } catch {
    // If the browser reports online, treat backend failures as degraded to avoid false "offline" banners.
    const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
    status = isOnline ? STATUS.DEGRADED : STATUS.OFFLINE;
  }
  notify(status);
  return status;
}

// Poll every 10s
function startPolling() {
  if (checkTimeout) clearTimeout(checkTimeout);
  const poll = async () => {
    await checkBackendHealth({ timeoutMs: DEFAULT_TIMEOUT_MS });
    checkTimeout = setTimeout(poll, 10000);
  };
  poll();
}

startPolling();
