import { SERVER_BASE } from './serverBase';
import { httpFetch } from '@/utils/httpFetch';
import {
  MAX_UPLOAD_BYTES,
  ALLOWED_UPLOAD_MIME_TYPES,
  MIN_IMAGE_BYTES,
  validateFileUpload,
} from '@/utils/uploadLimits';
import { captureRequestDebugInfo, captureRequestId } from '@/utils/requestDebug';

const BASE_URL = SERVER_BASE;

function normalizeUploadKind(value) {
  const raw = value == null ? '' : String(value).trim().toLowerCase();
  if (!raw) return null;
  if (raw === 'group_avatar') return 'avatar';
  if (raw === 'movement') return 'movement-media';
  if (raw === 'movement_media') return 'movement-media';
  if (raw === 'movement-media') return 'movement-media';
  if (raw === 'avatar') return 'avatar';
  if (raw === 'banner') return 'banner';
  return null;
}

async function safeReadJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function toUploadsPath(input) {
  const raw = input == null ? '' : String(input);
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('/uploads/')) return trimmed;
  if (trimmed.startsWith('uploads/')) return `/${trimmed}`;

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      const pathname = String(parsed.pathname || '');
      const idx = pathname.indexOf('/uploads/');
      if (idx >= 0) return pathname.slice(idx);
      return null;
    } catch {
      return null;
    }
  }

  if (trimmed.startsWith('/')) {
    const idx = trimmed.indexOf('/uploads/');
    if (idx >= 0) return trimmed.slice(idx);
  }

  return null;
}

function toRenderUrl(pathOrUrl) {
  const s = pathOrUrl ? String(pathOrUrl).trim() : '';
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

  const kind = normalizeUploadKind(options?.kind) || null;
  const endpointPath = kind ? `/uploads/${encodeURIComponent(kind)}` : '/uploads';
  const url = `${BASE_URL.replace(/\/$/, '')}${endpointPath}`;
  const form = new FormData();
  // NOTE: Append kind before file so multipart parsers capture it reliably.
  // Keep sending `kind` for back-compat even when using /uploads/:kind.
  if (options?.kind) form.append('kind', String(options.kind));
  if (options?.movementId) form.append('movement_id', String(options.movementId));
  if (options?.movement_id) form.append('movement_id', String(options.movement_id));
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
    const requestIdFromHeader = res?.headers?.get ? res.headers.get('x-request-id') : null;
    const requestIdFromBody = body && typeof body === 'object' ? (body.request_id || body.requestId) : null;
    const requestId = requestIdFromHeader || requestIdFromBody || null;
    const messageFromBody =
      (body && typeof body === 'object' && (body.error || body.message)) || null;
    captureRequestDebugInfo({ endpoint: endpointPath, request_id: requestId, error_message: messageFromBody || `Upload failed: ${res.status}` });
    throw new Error(messageFromBody ? String(messageFromBody) : `Upload failed: ${res.status}`);
  }

  {
    const requestIdFromHeader = res?.headers?.get ? res.headers.get('x-request-id') : null;
    const requestIdFromBody = body && typeof body === 'object' ? (body.request_id || body.requestId) : null;
    const requestId = requestIdFromHeader || requestIdFromBody || null;
    if (requestId) captureRequestId({ endpoint: endpointPath, request_id: requestId });
  }

  const fileUrl =
    body && typeof body === 'object' && (body.url || body.file_url || body.path) ? String(body.url || body.file_url || body.path) : null;

  // New behavior (required for production persistence):
  // - If the server returns an absolute URL (e.g. Supabase Storage public URL), persist it as-is.
  // - If the server returns a legacy /uploads/... path (local dev), keep it as a path.
  const normalizedUrl = fileUrl ? String(fileUrl).trim() : null;
  const legacyUploadsPath = toUploadsPath(normalizedUrl);
  const persistUrl = normalizedUrl && /^https?:\/\//i.test(normalizedUrl) ? normalizedUrl : legacyUploadsPath;

  return {
    ...(body && typeof body === 'object' ? body : {}),
    url: persistUrl,
    // Convenience for immediate rendering if needed.
    render_url: persistUrl ? toRenderUrl(persistUrl) : null,
  };
}

export async function uploadAvatar(file, options) {
  return uploadDirectToStorage(file, {
    ...options,
    kind: 'avatar',
  });
}

export async function uploadBanner(file, options) {
  return uploadDirectToStorage(file, {
    ...options,
    kind: 'banner',
  });
}

export async function uploadMovementMedia(file, options) {
  return uploadFile(file, {
    ...options,
    kind: 'movement-media',
  });
}

const DIRECT_UPLOAD_TIMEOUT_MS = 30_000;

function bucketForDirectKind(kind) {
  if (kind === 'avatar') return 'avatars';
  if (kind === 'banner') return 'banners';
  return null;
}

function xhrPutWithProgress(url, file, { contentType, timeoutMs, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    const resolvedTimeout = Number.isFinite(timeoutMs) ? Number(timeoutMs) : DIRECT_UPLOAD_TIMEOUT_MS;
    if (resolvedTimeout && resolvedTimeout > 0) xhr.timeout = resolvedTimeout;

    xhr.open('PUT', url, true);
    if (contentType) {
      try {
        xhr.setRequestHeader('Content-Type', String(contentType));
      } catch {
        // ignore
      }
    }

    xhr.upload.onprogress = (evt) => {
      if (!evt || !evt.lengthComputable) return;
      const pct = evt.total ? (evt.loaded / evt.total) * 100 : 0;
      if (typeof onProgress === 'function') onProgress(pct);
    };

    xhr.onload = () => {
      // Supabase signed upload returns 200/201 depending on path.
      if (xhr.status >= 200 && xhr.status < 300) return resolve(true);
      const err = new Error(`Upload failed: ${xhr.status}`);
      err.status = xhr.status;
      return reject(err);
    };

    xhr.onerror = () => reject(new Error('Upload failed: network error'));
    xhr.ontimeout = () => reject(new Error('Upload failed: timed out'));
    xhr.onabort = () => reject(new Error('Upload failed: aborted'));

    try {
      xhr.send(file);
    } catch (e) {
      reject(e);
    }
  });
}

async function signUpload(file, { accessToken, kind } = {}) {
  const bucket = bucketForDirectKind(kind);
  if (!bucket) throw new Error('Invalid upload kind');

  const url = `${BASE_URL.replace(/\/$/, '')}/uploads/sign`;
  const res = await httpFetch(url, {
    method: 'POST',
    cache: 'no-store',
    timeoutMs: 15_000,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      bucket,
      content_type: String(file.type || '').toLowerCase(),
      bytes: Number(file.size) || 0,
    }),
  });

  const body = await safeReadJson(res);
  const requestIdFromHeader = res?.headers?.get ? res.headers.get('x-request-id') : null;
  const requestIdFromBody = body && typeof body === 'object' ? (body.request_id || body.requestId) : null;
  const requestId = requestIdFromHeader || requestIdFromBody || null;
  if (requestId) captureRequestId({ endpoint: '/uploads/sign', request_id: requestId });
  if (!res.ok) {
    const messageFromBody =
      (body && typeof body === 'object' && (body.error || body.message)) || null;
    captureRequestDebugInfo({ endpoint: '/uploads/sign', request_id: requestId, error_message: messageFromBody || `Failed to sign upload: ${res.status}` });
    throw new Error(messageFromBody ? String(messageFromBody) : `Failed to sign upload: ${res.status}`);
  }

  const upload_url = body?.upload_url ? String(body.upload_url) : null;
  const object_key = body?.object_key ? String(body.object_key) : null;
  const public_url = body?.public_url ? String(body.public_url) : null;
  const resolved_bucket = body?.bucket ? String(body.bucket) : null;
  const expires_in = body?.expires_in != null ? Number(body.expires_in) : null;

  if (!upload_url || !object_key) {
    captureRequestDebugInfo({ endpoint: '/uploads/sign', request_id: requestId, error_message: 'Upload signing succeeded but response was incomplete' });
    throw new Error('Upload signing succeeded but response was incomplete');
  }

  return { upload_url, object_key, public_url, bucket: resolved_bucket, expires_in, request_id: requestId };
}

async function verifyDirectUpload({ accessToken, kind, object_key, expectedBytes } = {}) {
  const url = `${BASE_URL.replace(/\/$/, '')}/uploads/verify`;
  const res = await httpFetch(url, {
    method: 'POST',
    cache: 'no-store',
    timeoutMs: 15_000,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      kind,
      object_key,
      expected_bytes: Number(expectedBytes) || 0,
    }),
  });

  const body = await safeReadJson(res);
  const requestIdFromHeader = res?.headers?.get ? res.headers.get('x-request-id') : null;
  const requestIdFromBody = body && typeof body === 'object' ? (body.request_id || body.requestId) : null;
  const requestId = requestIdFromHeader || requestIdFromBody || null;
  if (requestId) captureRequestId({ endpoint: '/uploads/verify', request_id: requestId });

  if (!res.ok) {
    const messageFromBody =
      (body && typeof body === 'object' && (body.error || body.message)) || null;
    captureRequestDebugInfo({ endpoint: '/uploads/verify', request_id: requestId, error_message: messageFromBody || `Upload verify failed: ${res.status}` });
    throw new Error(messageFromBody ? String(messageFromBody) : `Upload verify failed: ${res.status}`);
  }

  if (body && typeof body === 'object' && body.ok === true) return body;
  throw new Error('Upload verify succeeded but response was incomplete');
}

async function uploadDirectToStorage(file, options) {
  const accessToken = options?.accessToken ? String(options.accessToken) : null;
  if (!accessToken) throw new Error('Authentication required');
  if (!file) throw new Error('File is required');

  const kind = normalizeUploadKind(options?.kind) || null;
  if (kind !== 'avatar' && kind !== 'banner') {
    throw new Error('Invalid upload kind');
  }

  const maxBytes = Number.isFinite(options?.maxBytes) ? Number(options.maxBytes) : MAX_UPLOAD_BYTES;
  const allowedTypes = ['image/png', 'image/jpeg', 'image/webp'];

  const validationError = validateFileUpload({
    file,
    maxBytes,
    minBytes: MIN_IMAGE_BYTES,
    allowedMimeTypes: allowedTypes,
  });
  if (validationError) throw new Error(validationError);

  const signed = await signUpload(file, { accessToken, kind });

  // Upload directly to the signed URL.
  try {
    await xhrPutWithProgress(signed.upload_url, file, {
      contentType: file.type,
      timeoutMs: options?.timeoutMs,
      onProgress: options?.onProgress,
    });
  } catch (e) {
    captureRequestDebugInfo({ endpoint: 'PUT signed upload', request_id: signed.request_id || null, error: e });
    throw e;
  }

  // Post-upload safeguard: ensure the stored object length matches local file size.
  // This catches cases where a tiny placeholder/error payload was uploaded instead of the image.
  await verifyDirectUpload({
    accessToken,
    kind,
    object_key: signed.object_key,
    expectedBytes: file.size,
  });

  return {
    ok: true,
    kind,
    bucket: signed.bucket || bucketForDirectKind(kind),
    path: signed.object_key,
    url: signed.public_url || null,
    expires_in: signed.expires_in ?? null,
    request_id: signed.request_id ?? null,
  };
}
