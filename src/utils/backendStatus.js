// Lightweight backend status checker for People Power
// Exports: checkBackendHealth, subscribeBackendStatus, getCurrentBackendStatus

const STATUS = {
  HEALTHY: 'healthy',
  DEGRADED: 'degraded',
  OFFLINE: 'offline',
};

let currentStatus = STATUS.HEALTHY;
const listeners = new Set();
let lastCheck = 0;
let checkTimeout = null;

function notify(status) {
  if (currentStatus !== status) {
    currentStatus = status;
    listeners.forEach((fn) => {
      try { fn(currentStatus); } catch {}
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

export async function checkBackendHealth({ timeoutMs = 3000 } = {}) {
  lastCheck = Date.now();
  let status = STATUS.HEALTHY;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch('/health', { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) status = STATUS.DEGRADED;
    else status = STATUS.HEALTHY;
  } catch (e) {
    status = STATUS.OFFLINE;
  }
  notify(status);
  return status;
}

// Poll every 10s
function startPolling() {
  if (checkTimeout) clearTimeout(checkTimeout);
  const poll = async () => {
    await checkBackendHealth({ timeoutMs: 3000 });
    checkTimeout = setTimeout(poll, 10000);
  };
  poll();
}

startPolling();
