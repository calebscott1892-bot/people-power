import { SERVER_BASE } from './serverBase';
import { httpFetch } from '@/utils/httpFetch';
import {
  MAX_UPLOAD_BYTES,
  ALLOWED_UPLOAD_MIME_TYPES,
  validateFileUpload,
} from '@/utils/uploadLimits';

const BASE_URL = SERVER_BASE;

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

  const maxBytes = Number.isFinite(options?.maxBytes) ? Number(options.maxBytes) : MAX_UPLOAD_BYTES;
  const allowedTypes =
    Array.isArray(options?.allowedMimeTypes) && options.allowedMimeTypes.length
      ? options.allowedMimeTypes
      : ALLOWED_UPLOAD_MIME_TYPES;

  const validationError = validateFileUpload({
    file,
    maxBytes,
    allowedMimeTypes: allowedTypes,
  });
  if (validationError) throw new Error(validationError);

  const url = `${BASE_URL.replace(/\/$/, '')}/uploads`;
  const form = new FormData();
  if (options?.kind) {
    // NOTE: Append kind before file so multipart parsers capture it reliably.
    form.append('kind', String(options.kind));
  }
  form.append('file', file);

  const res = await httpFetch(url, {
    method: 'POST',
    cache: 'no-store',
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
