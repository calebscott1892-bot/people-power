const lastDebugInfoByKey = new Map();
let lastDebugInfo = null;

const lastRequestIdByKey = new Map();
let lastRequestId = null;

function normalizeEmail(value) {
  const raw = value == null ? '' : String(value);
  const trimmed = raw.trim().toLowerCase();
  return trimmed || null;
}

function parseAdminEmailsEnv() {
  const raw =
    typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_ADMIN_EMAILS
      ? String(import.meta.env.VITE_ADMIN_EMAILS)
      : '';
  const emails = raw
    .split(',')
    .map((s) => normalizeEmail(s))
    .filter(Boolean);
  return new Set(emails);
}

function isDiagUiEnabledViaEnv() {
  const raw =
    typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_ENABLE_DIAG_ENDPOINT
      ? String(import.meta.env.VITE_ENABLE_DIAG_ENDPOINT).trim().toLowerCase()
      : '';
  return raw === '1' || raw === 'true' || raw === 'yes';
}

export function isDebugUiEnabledForUser(userEmail) {
  if (isDiagUiEnabledViaEnv()) return true;
  const adminEmails = parseAdminEmailsEnv();
  const email = normalizeEmail(userEmail);
  if (!email) return false;
  return adminEmails.has(email);
}

export function captureRequestDebugInfo(input) {
  const endpoint = input?.endpoint != null ? String(input.endpoint) : '';
  const requestId = input?.request_id != null ? String(input.request_id) : (input?.requestId != null ? String(input.requestId) : '');
  const errorMessage =
    input?.error_message != null
      ? String(input.error_message)
      : input?.error?.message
        ? String(input.error.message)
        : input?.message
          ? String(input.message)
          : input?.error != null
            ? String(input.error)
            : '';

  let userAgent = null;
  try {
    userAgent = typeof navigator !== 'undefined' && navigator.userAgent ? String(navigator.userAgent) : null;
  } catch {
    userAgent = null;
  }

  const record = {
    request_id: requestId || null,
    endpoint: endpoint || null,
    timestamp: new Date().toISOString(),
    error_message: errorMessage || null,
    user_agent: userAgent,
  };

  lastDebugInfo = record;
  if (endpoint) lastDebugInfoByKey.set(endpoint, record);

  if (requestId) {
    lastRequestId = requestId;
    if (endpoint) lastRequestIdByKey.set(endpoint, requestId);
  }
  return record;
}

export function captureRequestId(input) {
  const endpoint = input?.endpoint != null ? String(input.endpoint) : '';
  const requestId = input?.request_id != null ? String(input.request_id) : (input?.requestId != null ? String(input.requestId) : '');
  if (!requestId) return null;
  lastRequestId = requestId;
  if (endpoint) lastRequestIdByKey.set(endpoint, requestId);
  return requestId;
}

export function getLastRequestId() {
  return lastRequestId;
}

export function getRequestIdForEndpoint(endpoint) {
  const key = endpoint != null ? String(endpoint) : '';
  if (!key) return null;
  return lastRequestIdByKey.get(key) || null;
}

export function getLastRequestDebugInfo() {
  return lastDebugInfo;
}

export function getRequestDebugInfoForEndpoint(endpoint) {
  const key = endpoint != null ? String(endpoint) : '';
  if (!key) return null;
  return lastDebugInfoByKey.get(key) || null;
}

export function formatRequestDebugInfo(record) {
  if (!record || typeof record !== 'object') return '';
  const lines = [
    `request_id: ${record.request_id || ''}`,
    `endpoint: ${record.endpoint || ''}`,
    `timestamp: ${record.timestamp || ''}`,
    `error_message: ${record.error_message || ''}`,
    `user_agent: ${record.user_agent || ''}`,
  ];
  return lines.join('\n');
}

export async function copyRequestDebugInfoToClipboard(record) {
  const text = formatRequestDebugInfo(record);
  if (!text) return false;

  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'absolute';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return !!ok;
  } catch {
    return false;
  }
}
