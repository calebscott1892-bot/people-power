import { SERVER_BASE } from './serverBase';
import { httpFetch } from '@/utils/httpFetch';
import {
  MAX_UPLOAD_BYTES,
  ALLOWED_UPLOAD_MIME_TYPES,
  validateFileUpload,
} from '@/utils/uploadLimits';

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
    const messageFromBody =
      (body && typeof body === 'object' && (body.error || body.message)) || null;
    throw new Error(messageFromBody ? String(messageFromBody) : `Upload failed: ${res.status}`);
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
  return uploadFile(file, {
    ...options,
    kind: 'avatar',
  });
}

export async function uploadBanner(file, options) {
  return uploadFile(file, {
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
