import { SERVER_BASE } from './serverBase';
import { httpFetch } from '@/utils/httpFetch';
import { captureRequestDebugInfo, captureRequestId } from '@/utils/requestDebug';

const DEV = !!import.meta?.env?.DEV;
const FETCH_MY_PROFILE_COOLDOWN_MS = 2000;
const fetchMyProfileInflightByKey = new Map();
const fetchMyProfileCooldownCacheByKey = new Map();
let fetchMyProfileSeq = 0;

function toUploadsPath(input) {
  const raw = input == null ? '' : String(input);
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('/uploads/')) return trimmed;
  if (trimmed.startsWith('uploads/')) return `/${trimmed}`;

  // Examples:
  // - http://localhost:8787/uploads/a.png -> /uploads/a.png
  // - https://people-power.onrender.com/uploads/a.png -> /uploads/a.png
  // - /uploads/a.png -> /uploads/a.png
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
  if (s.startsWith('/')) return `${SERVER_BASE.replace(/\/$/, '')}${s}`;
  return `${SERVER_BASE.replace(/\/$/, '')}/${s}`;
}

function toCacheBustToken(profile) {
  if (!profile || typeof profile !== 'object') return null;
  const raw = profile.updated_at ?? profile.updatedAt ?? null;
  const s = raw == null ? '' : String(raw).trim();
  if (!s) return null;
  // Prefer a stable numeric token when possible.
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? String(Math.floor(ms)) : s;
}

function appendCacheBuster(urlString, token) {
  const url = urlString != null ? String(urlString).trim() : '';
  const v = token != null ? String(token).trim() : '';
  if (!url || !v) return urlString;
  try {
    const u = new URL(url);
    u.searchParams.set('v', v);
    return u.toString();
  } catch {
    // Fallback: naive append.
    const encoded = encodeURIComponent(v);
    return url.includes('?') ? `${url}&v=${encoded}` : `${url}?v=${encoded}`;
  }
}

function normalizeProfileMediaForClient(profile) {
  if (!profile || typeof profile !== 'object') return profile;

  const cacheToken = toCacheBustToken(profile);

  const rawPhoto = profile.profile_photo_url;
  const rawBanner = profile.banner_url;
  const photoPath = toUploadsPath(rawPhoto);
  const bannerPath = toUploadsPath(rawBanner);

  const photoRender = toRenderUrl(photoPath || rawPhoto);
  const bannerRender = toRenderUrl(bannerPath || rawBanner);
  const photoRenderBusted = photoRender ? appendCacheBuster(photoRender, cacheToken) : photoRender;
  const bannerRenderBusted = bannerRender ? appendCacheBuster(bannerRender, cacheToken) : bannerRender;

  return {
    ...profile,
    // Raw persisted form (preferred): path-only.
    profile_photo_url_path: photoPath,
    banner_url_path: bannerPath,
    // Render-safe absolute URLs.
    profile_photo_url_render: photoRenderBusted,
    banner_url_render: bannerRenderBusted,
    // Back-compat: keep existing fields renderable.
    profile_photo_url: photoRenderBusted || rawPhoto || '',
    banner_url: bannerRenderBusted || rawBanner || '',
  };
}

function normalizeProfileMediaForPersistence(value) {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  // Production persistent form: absolute URL (Supabase Storage).
  if (/^https?:\/\//i.test(raw)) return raw;
  // Local dev/back-compat: allow /uploads paths.
  const uploadsPath = toUploadsPath(raw);
  if (uploadsPath) return uploadsPath;

  // Two-phase commit (preferred): storage object key/path (or bucket:path).
  // Server will normalize + verify before persisting.
  if (!/\s/.test(raw) && raw.length <= 2048) return raw;
  return null;
}

async function safeReadJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export async function upsertMyProfile(payload, options) {
  const accessToken = options?.accessToken ? String(options.accessToken) : null;
  if (!accessToken) throw new Error('Authentication required');
  const timeoutMs = options?.timeoutMs;

  const BASE_URL = SERVER_BASE;

  const url = `${BASE_URL.replace(/\/$/, '')}/me/profile`;
  const nextPayload = payload && typeof payload === 'object' ? { ...payload } : {};
  // Persist absolute URLs (Supabase Storage) when provided.
  if ('profile_photo_url' in nextPayload) {
    nextPayload.profile_photo_url = normalizeProfileMediaForPersistence(nextPayload.profile_photo_url);
  }
  if ('banner_url' in nextPayload) {
    nextPayload.banner_url = normalizeProfileMediaForPersistence(nextPayload.banner_url);
  }

  const res = await httpFetch(url, {
    method: 'POST',
    cache: 'no-store',
    timeoutMs,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(nextPayload),
  });

  const body = await safeReadJson(res);

  const requestIdFromHeader = res?.headers?.get ? res.headers.get('x-request-id') : null;
  const requestIdFromBody = body && typeof body === 'object' ? (body.request_id || body.requestId) : null;
  const requestId = requestIdFromHeader || requestIdFromBody || null;
  if (requestId) captureRequestId({ endpoint: '/me/profile', request_id: requestId });

  if (!res.ok) {
    const messageFromBody =
      (body && typeof body === 'object' && (body.message || body.error)) || null;
    const error = new Error(messageFromBody ? String(messageFromBody) : `Failed to update profile: ${res.status}`);
    if (body && typeof body === 'object' && body.error === 'USERNAME_TAKEN') {
      error.code = 'USERNAME_TAKEN';
    }
    error.status = res.status;

    captureRequestDebugInfo({ endpoint: '/me/profile', request_id: requestId, error_message: error.message });
    throw error;
  }

  if (body && typeof body === 'object' && body.profile) return normalizeProfileMediaForClient(body.profile);
  return body;
}

export async function fetchMyProfile(options) {
  const accessToken = options?.accessToken ? String(options.accessToken) : null;
  const includeMeta = options?.includeMeta === true;
  const force = options?.force === true;
  const profileEmailRaw = options?.profileEmail != null ? String(options.profileEmail) : '';
  const profileEmail = profileEmailRaw.trim().toLowerCase() || 'unknown';
  if (!accessToken) throw new Error('Authentication required');

  const BASE_URL = SERVER_BASE;

  const key = `${profileEmail}|${includeMeta ? 'meta' : 'base'}`;
  const now = Date.now();

  if (!force) {
    const cached = fetchMyProfileCooldownCacheByKey.get(key);
    if (cached && now - cached.at < FETCH_MY_PROFILE_COOLDOWN_MS) {
      if (DEV) {
        console.debug('[PeoplePower] fetchMyProfile cooldown_hit', {
          key,
          includeMeta,
          ageMs: now - cached.at,
        });
      }
      return cached.value;
    }
  }

  const inflight = fetchMyProfileInflightByKey.get(key);
  if (inflight) {
    if (DEV) {
      console.debug('[PeoplePower] fetchMyProfile dedupe_inflight', { key, includeMeta });
    }
    return inflight;
  }

  const reqId = ++fetchMyProfileSeq;
  const startedAt = now;

  const url = `${BASE_URL.replace(/\/$/, '')}/me/profile${includeMeta ? '?include_meta=1' : ''}`;

  const promise = (async () => {
    if (DEV) {
      console.debug('[PeoplePower] fetchMyProfile start', {
        reqId,
        key,
        includeMeta,
        force,
      });
    }

    const res = await httpFetch(url, {
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const body = await safeReadJson(res);

    if (!res.ok) {
      const messageFromBody =
        (body && typeof body === 'object' && (body.message || body.error)) || null;
      const error = new Error(
        messageFromBody ? String(messageFromBody) : `Failed to load profile: ${res.status}`
      );
      error.status = res.status;
      throw error;
    }

    let value;
    if (includeMeta) {
      if (body && typeof body === 'object' && body.profile) {
        value = { ...body, profile: normalizeProfileMediaForClient(body.profile) };
      } else {
        value = body;
      }
    } else if (body && typeof body === 'object' && 'profile' in body) {
      value = normalizeProfileMediaForClient(body.profile);
    } else {
      value = normalizeProfileMediaForClient(body);
    }

    fetchMyProfileCooldownCacheByKey.set(key, { at: Date.now(), value });
    return value;
  })();

  fetchMyProfileInflightByKey.set(key, promise);

  try {
    const value = await promise;
    if (DEV) {
      console.debug('[PeoplePower] fetchMyProfile end', {
        reqId,
        key,
        includeMeta,
        ok: true,
        durationMs: Date.now() - startedAt,
      });
    }
    return value;
  } catch (e) {
    if (DEV) {
      console.debug('[PeoplePower] fetchMyProfile end', {
        reqId,
        key,
        includeMeta,
        ok: false,
        status: e?.status ?? e?.statusCode ?? null,
        durationMs: Date.now() - startedAt,
        message: e?.message ? String(e.message) : null,
      });
    }
    throw e;
  } finally {
    fetchMyProfileInflightByKey.delete(key);
  }
}

export async function fetchPublicProfileByUsername(username, options) {
  const accessToken = options?.accessToken ? String(options.accessToken) : null;
  if (!accessToken) throw new Error('Authentication required');

  const BASE_URL = SERVER_BASE;

  const handle = String(username || '').trim();
  if (!handle) throw new Error('Username is required');

  const url = `${BASE_URL.replace(/\/$/, '')}/profiles/username/${encodeURIComponent(handle)}`;
  const res = await httpFetch(url, {
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const body = await safeReadJson(res);
  if (!res.ok) {
    const messageFromBody =
      (body && typeof body === 'object' && (body.message || body.error)) || null;
    throw new Error(messageFromBody ? String(messageFromBody) : `Failed to load profile: ${res.status}`);
  }

  if (body && typeof body === 'object' && body.profile) return normalizeProfileMediaForClient(body.profile);
  return normalizeProfileMediaForClient(body);
}

export async function fetchPublicProfileByEmail(email, options) {
  const accessToken = options?.accessToken ? String(options.accessToken) : null;
  if (!accessToken) throw new Error('Authentication required');

  const BASE_URL = SERVER_BASE;

  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) throw new Error('Email is required');

  const url = `${BASE_URL.replace(/\/$/, '')}/profiles/email/${encodeURIComponent(normalized)}`;
  const res = await httpFetch(url, {
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const body = await safeReadJson(res);
  if (!res.ok) {
    const messageFromBody =
      (body && typeof body === 'object' && (body.message || body.error)) || null;
    throw new Error(messageFromBody ? String(messageFromBody) : `Failed to load profile: ${res.status}`);
  }

  if (body && typeof body === 'object' && body.profile) return normalizeProfileMediaForClient(body.profile);
  return normalizeProfileMediaForClient(body);
}
