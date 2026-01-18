import { SERVER_BASE } from './serverBase';
import { httpFetch } from '@/utils/httpFetch';

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

function normalizeProfileMediaForClient(profile) {
  if (!profile || typeof profile !== 'object') return profile;

  const rawPhoto = profile.profile_photo_url;
  const rawBanner = profile.banner_url;
  const photoPath = toUploadsPath(rawPhoto);
  const bannerPath = toUploadsPath(rawBanner);

  const photoRender = toRenderUrl(photoPath || rawPhoto);
  const bannerRender = toRenderUrl(bannerPath || rawBanner);

  return {
    ...profile,
    // Raw persisted form (preferred): path-only.
    profile_photo_url_path: photoPath,
    banner_url_path: bannerPath,
    // Render-safe absolute URLs.
    profile_photo_url_render: photoRender,
    banner_url_render: bannerRender,
    // Back-compat: keep existing fields renderable.
    profile_photo_url: photoRender || rawPhoto || '',
    banner_url: bannerRender || rawBanner || '',
  };
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

  const BASE_URL = SERVER_BASE;

  const url = `${BASE_URL.replace(/\/$/, '')}/me/profile`;
  const nextPayload = payload && typeof payload === 'object' ? { ...payload } : {};
  // Persist canonical path-only uploads URLs.
  if ('profile_photo_url' in nextPayload) {
    nextPayload.profile_photo_url = toUploadsPath(nextPayload.profile_photo_url) || null;
  }
  if ('banner_url' in nextPayload) {
    nextPayload.banner_url = toUploadsPath(nextPayload.banner_url) || null;
  }

  const res = await httpFetch(url, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(nextPayload),
  });

  const body = await safeReadJson(res);

  if (!res.ok) {
    const messageFromBody =
      (body && typeof body === 'object' && (body.message || body.error)) || null;
    const error = new Error(messageFromBody ? String(messageFromBody) : `Failed to update profile: ${res.status}`);
    if (body && typeof body === 'object' && body.error === 'USERNAME_TAKEN') {
      error.code = 'USERNAME_TAKEN';
    }
    error.status = res.status;
    throw error;
  }

  if (body && typeof body === 'object' && body.profile) return normalizeProfileMediaForClient(body.profile);
  return body;
}

export async function fetchMyProfile(options) {
  const accessToken = options?.accessToken ? String(options.accessToken) : null;
  const includeMeta = options?.includeMeta === true;
  if (!accessToken) throw new Error('Authentication required');

  const BASE_URL = SERVER_BASE;

  const url = `${BASE_URL.replace(/\/$/, '')}/me/profile${includeMeta ? '?include_meta=1' : ''}`;
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

  if (includeMeta) {
    if (body && typeof body === 'object' && body.profile) {
      return { ...body, profile: normalizeProfileMediaForClient(body.profile) };
    }
    return body;
  }
  if (body && typeof body === 'object' && 'profile' in body) return normalizeProfileMediaForClient(body.profile);
  return normalizeProfileMediaForClient(body);
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
