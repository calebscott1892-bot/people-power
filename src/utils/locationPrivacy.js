/**
 * Location privacy helpers.
 *
 * Goals:
 * - Never persist exact user coordinates in shared/public profile data.
 * - Allow "Local" filtering using precise coordinates stored only on-device.
 */

const STORAGE_PREFIX = 'peoplepower_private_location:';
const STUB_ENTITIES_PREFIX = 'peoplepower_stub_entities:';

function safeJsonParse(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeEmail(value) {
  const s = value == null ? '' : String(value).trim().toLowerCase();
  return s || null;
}

function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function sanitizePublicLocation(location) {
  const city = location?.city != null ? String(location.city).trim() : '';
  const country = location?.country != null ? String(location.country).trim() : '';
  const region = location?.region != null ? String(location.region).trim() : '';

  const out = {
    ...(city ? { city } : {}),
    ...(region ? { region } : {}),
    ...(country ? { country } : {}),
  };

  return Object.keys(out).length ? out : null;
}

export function readPrivateUserCoordinates(userEmail) {
  const email = normalizeEmail(userEmail);
  if (!email) return null;

  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${email}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const lat = toFiniteNumber(parsed?.lat);
    const lng = toFiniteNumber(parsed?.lng);
    if (lat == null || lng == null) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}

export function writePrivateUserCoordinates(userEmail, coords) {
  const email = normalizeEmail(userEmail);
  const lat = toFiniteNumber(coords?.lat);
  const lng = toFiniteNumber(coords?.lng);
  if (!email || lat == null || lng == null) return false;

  try {
    localStorage.setItem(
      `${STORAGE_PREFIX}${email}`,
      JSON.stringify({ lat, lng, updated_at: new Date().toISOString() })
    );
    return true;
  } catch {
    return false;
  }
}

export function clearPrivateUserCoordinates(userEmail) {
  const email = normalizeEmail(userEmail);
  if (!email) return;
  try {
    localStorage.removeItem(`${STORAGE_PREFIX}${email}`);
  } catch {
    // ignore
  }
}

export function getMovementCoordinates(movement) {
  const lat = toFiniteNumber(movement?.location_lat ?? movement?.lat);
  const lng = toFiniteNumber(movement?.location_lon ?? movement?.location_lng ?? movement?.lng);
  if (lat == null || lng == null) return null;
  return { lat, lng };
}

export function haversineDistanceKm(a, b) {
  const lat1 = toFiniteNumber(a?.lat);
  const lng1 = toFiniteNumber(a?.lng);
  const lat2 = toFiniteNumber(b?.lat);
  const lng2 = toFiniteNumber(b?.lng);
  if (lat1 == null || lng1 == null || lat2 == null || lng2 == null) return null;

  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371; // km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lng2 - lng1);
  const sLat1 = toRad(lat1);
  const sLat2 = toRad(lat2);

  const sin1 = Math.sin(dLat / 2);
  const sin2 = Math.sin(dLon / 2);

  const h = sin1 * sin1 + Math.cos(sLat1) * Math.cos(sLat2) * sin2 * sin2;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return R * c;
}

/**
 * One-time local cleanup for dev/stub persistence.
 * Removes any legacy `location.coordinates` from locally stored UserProfile records.
 */
export function scrubLegacyCoordinatesFromLocalUserProfiles() {
  try {
    if (typeof window === 'undefined' || !window?.localStorage) return { scanned: 0, updated: 0 };
    const key = `${STUB_ENTITIES_PREFIX}UserProfile`;
    const records = safeJsonParse(window.localStorage.getItem(key), []);
    if (!Array.isArray(records) || records.length === 0) return { scanned: 0, updated: 0 };

    let updated = 0;
    const next = records.map((record) => {
      if (!record?.location?.coordinates) return record;
      updated += 1;
      return { ...record, location: sanitizePublicLocation(record.location) };
    });

    if (updated > 0) window.localStorage.setItem(key, JSON.stringify(next));
    return { scanned: records.length, updated };
  } catch {
    return { scanned: 0, updated: 0 };
  }
}
