const isDev = import.meta?.env?.DEV;
const BASE_URL = isDev
  ? (import.meta?.env?.VITE_SERVER_URL && String(import.meta.env.VITE_SERVER_URL)) || 'http://localhost:3001'
  : (import.meta?.env?.VITE_API_BASE_URL && String(import.meta.env.VITE_API_BASE_URL)) || '/api';

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'application/pdf'];

async function safeReadJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function absolutizeUrl(url) {
  const s = url ? String(url) : '';
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith('/')) return `${BASE_URL.replace(/\/$/, '')}${s}`;
  return `${BASE_URL.replace(/\/$/, '')}/${s}`;
}

export async function uploadFile(file, options) {
  const accessToken = options?.accessToken ? String(options.accessToken) : null;
  if (!accessToken) throw new Error('Authentication required');
  if (!file) throw new Error('File is required');

  if (typeof file.size === 'number' && file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`File too large. Max size is ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))}MB.`);
  }
  if (file.type && !ALLOWED_MIME_TYPES.includes(file.type)) {
    throw new Error('That file type is not supported. Please upload an image (JPG/PNG/GIF) or PDF.');
  }

  const url = `${BASE_URL.replace(/\/$/, '')}/uploads`;
  const form = new FormData();
  form.append('file', file);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: form,
  });

  const body = await safeReadJson(res);
  if (!res.ok) {
    const messageFromBody =
      (body && typeof body === 'object' && (body.error || body.message)) || null;
    throw new Error(messageFromBody ? String(messageFromBody) : `Upload failed: ${res.status}`);
  }

  const fileUrl =
    body && typeof body === 'object' && (body.url || body.file_url || body.path) ? String(body.url || body.file_url || body.path) : null;

  return {
    ...(body && typeof body === 'object' ? body : {}),
    url: absolutizeUrl(fileUrl),
  };
}
