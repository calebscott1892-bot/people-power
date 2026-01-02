import { getMessagesWsUrl } from '@/api/messagesClient';

// Best-effort realtime: must be quiet and always fall back to polling.
// Note: browsers may still print a single low-level WS failure message; we
// prevent repeated reconnect spam by disabling WS after repeated failures.
let wsDisabledForSession = false;
let wsLoggedFallback = false;
let wsLoggedStartup = false;

function isDev() {
  try {
    return !!import.meta?.env?.DEV;
  } catch {
    return false;
  }
}

function devLogOnce(kind, message) {
  if (!isDev()) return;
  if (kind === 'fallback') {
    if (wsLoggedFallback) return;
    wsLoggedFallback = true;
  }
  // eslint-disable-next-line no-console
  console.info(message);
}

function isOnline() {
  try {
    if (typeof navigator === 'undefined') return true;
    if (typeof navigator.onLine !== 'boolean') return true;
    return navigator.onLine;
  } catch {
    return true;
  }
}

export function connectMessagesRealtime({ accessToken, onEvent, onStatus }) {
  if (wsDisabledForSession) {
    try {
      if (typeof onStatus === 'function') onStatus('disabled');
    } catch {
      // ignore
    }
    return null;
  }

  const urlString = getMessagesWsUrl(accessToken);
  if (!urlString) return null;

  let socket = null;
  let closedByUser = false;
  let retryMs = 1000;
  let retryTimer = null;
  let failures = 0;
  let openedOnce = false;
  let onlineListenerAttached = false;

  function emitStatus(status) {
    try {
      if (typeof onStatus === 'function') onStatus(status);
    } catch {
      // ignore
    }
  }

  function safeEmitEvent(evt) {
    try {
      if (typeof onEvent === 'function') onEvent(evt);
    } catch {
      // ignore
    }
  }

  function connect() {
    if (closedByUser) return;

    if (!isOnline()) {
      emitStatus('offline');
      if (!onlineListenerAttached && typeof window !== 'undefined') {
        onlineListenerAttached = true;
        window.addEventListener(
          'online',
          () => {
            if (!closedByUser && !wsDisabledForSession) connect();
          },
          { once: true }
        );
      }
      return;
    }

    if (!wsLoggedStartup) {
      wsLoggedStartup = true;
      // eslint-disable-next-line no-console
      console.log(`[PeoplePower] Realtime: wsEnabled = true, url = ${urlString.split('?')[0]}`);
    }

    emitStatus('connecting');

    try {
      socket = new WebSocket(urlString);
    } catch {
      failures += 1;
      scheduleReconnectOrDisable();
      return;
    }

    socket.onopen = () => {
      openedOnce = true;
      failures = 0;
      retryMs = 1000;
      emitStatus('connected');
      try {
        socket.send(JSON.stringify({ type: 'ping' }));
      } catch {
        // ignore
      }
    };

    socket.onmessage = (ev) => {
      let data = null;
      try {
        data = JSON.parse(String(ev?.data || ''));
      } catch {
        return;
      }
      safeEmitEvent(data);
    };

    socket.onerror = () => {
      // handled by close; keep quiet
    };

    socket.onclose = () => {
      socket = null;
      emitStatus('disconnected');
      failures += openedOnce ? 1 : 2;
      scheduleReconnectOrDisable();
    };
  }

  function scheduleReconnectOrDisable() {
    if (closedByUser) return;
    if (retryTimer) return;

    // If WS repeatedly fails, disable for this page session to avoid console spam.
    if (failures >= 3) {
      wsDisabledForSession = true;
      emitStatus('disabled');
      devLogOnce('fallback', '[Messages] WebSocket unavailable, falling back to polling');
      return;
    }

    const wait = Math.min(10_000, retryMs);
    retryMs = Math.min(30_000, Math.floor(retryMs * 2));
    retryTimer = setTimeout(() => {
      retryTimer = null;
      connect();
    }, wait);
  }

  function send(payload) {
    try {
      if (!socket || socket.readyState !== WebSocket.OPEN) return false;
      socket.send(JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }

  function close() {
    closedByUser = true;
    emitStatus('closed');
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    try {
      socket?.close();
    } catch {
      // ignore
    }
    socket = null;
  }

  connect();

  return { send, close };
}
