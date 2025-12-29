const PREFIX = 'pp_e2ee_v1:';

function safeParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function packEncryptedPayload(payloadObj) {
  const json = JSON.stringify(payloadObj);
  return `${PREFIX}${btoa(unescape(encodeURIComponent(json)))}`;
}

export function unpackEncryptedPayload(body) {
  const s = String(body || '');
  if (!s.startsWith(PREFIX)) return null;
  const b64 = s.slice(PREFIX.length);
  try {
    const json = decodeURIComponent(escape(atob(b64)));
    const parsed = safeParse(json);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function isEncryptedBody(body) {
  return typeof body === 'string' && body.startsWith(PREFIX);
}
