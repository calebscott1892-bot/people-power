import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { isAdmin as isAdminEmail } from '@/utils/staff';
import { motion, useReducedMotion } from 'framer-motion';
import { Flame, MapPin, TrendingUp, ThumbsDown, ThumbsUp, Users } from 'lucide-react';
import { MapContainer, Marker, TileLayer } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

// Ensure Leaflet marker icons resolve correctly in Vite builds.
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png',
});

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function sanitizePublicName(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  return s.includes('@') ? '' : s;
}

function getAuthorInfo(movement) {
  const displayName =
    sanitizePublicName(movement?.creator_display_name) ||
    sanitizePublicName(movement?.author_display_name) ||
    sanitizePublicName(movement?.creator_name) ||
    sanitizePublicName(movement?.author_name) ||
    '';
  const usernameRaw = String(
    movement?.creator_username ||
    movement?.author_username ||
    movement?.creator_handle ||
    ''
  ).trim();
  const username = usernameRaw && !usernameRaw.includes('@') ? usernameRaw.replace(/^@/, '') : '';
  const label = displayName || (username ? `@${username}` : 'Unknown creator');
  const profilePath = username ? `/u/${encodeURIComponent(username)}` : null;
  const authorEmail = String(
    movement?.author_email ||
    movement?.creator_email ||
    movement?.owner_email ||
    ''
  ).trim();
  const isAdminAuthor = authorEmail ? isAdminEmail(authorEmail) : false;
  return { label, profilePath, isAdminAuthor };
}

function normalizeTags(movement) {
  const tags = movement?.tags ?? movement?.tag_list ?? movement?.categories ?? [];
  if (Array.isArray(tags)) return tags.map((t) => String(t).trim()).filter(Boolean);
  return String(tags || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

function formatTagLabel(tag) {
  const raw = String(tag || '').trim();
  if (!raw) return '';
  const spaced = raw.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  return spaced.replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatLocation(movement) {
  const city = String(movement?.city || movement?.location_city || movement?.location?.city || '').trim();
  const region = String(movement?.region || movement?.state || movement?.location_region || movement?.location?.region || '').trim();
  const country = String(movement?.country || movement?.location_country || movement?.location?.country || '').trim();

  const parts = [city, region, country].filter(Boolean);
  if (!parts.length) return null;
  return parts.slice(0, 2).join(', ');
}

function locationQueryParts(movement) {
  const city = String(movement?.city || movement?.location_city || movement?.location?.city || '').trim();
  const country = String(movement?.country || movement?.location_country || movement?.location?.country || '').trim();
  const parts = [city, country].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

function geocodeCacheKey(query) {
  return `peoplepower_geocode_${String(query || '').toLowerCase()}`;
}

async function geocodeCity(query) {
  const q = String(query || '').trim();
  if (!q) return null;

  const cacheKey = geocodeCacheKey(q);
  try {
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed && typeof parsed === 'object' && parsed.lat && parsed.lon) return parsed;
    }
  } catch {
    // ignore
  }

  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
    },
  });
  if (!res.ok) return null;
  const json = await res.json();
  const first = Array.isArray(json) ? json[0] : null;
  if (!first?.lat || !first?.lon) return null;

  // Privacy: round to ~1km resolution.
  const lat = Number(first.lat);
  const lon = Number(first.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const rounded = { lat: Number(lat.toFixed(2)), lon: Number(lon.toFixed(2)) };

  try {
    sessionStorage.setItem(cacheKey, JSON.stringify(rounded));
  } catch {
    // ignore
  }

  return rounded;
}

function getTeaser(movement) {
  const raw = movement?.summary || movement?.description || '';
  const s = String(raw || '').trim();
  // If description is rich text HTML, strip tags for the teaser.
  return s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

export default function MovementCard({ movement }) {
  const reduceMotion = useReducedMotion();
  const navigate = useNavigate();
  const id = movement?.id ?? movement?._id;
  const title = movement?.title || movement?.name || 'Untitled movement';
  const description = getTeaser(movement);
  const author = getAuthorInfo(movement);
  const tags = normalizeTags(movement);
  const locationLabel = formatLocation(movement);
  const locationQuery = useMemo(() => locationQueryParts(movement), [movement]);
  const [coords, setCoords] = useState(null);
  const hasCoords = Number.isFinite(coords?.lat) && Number.isFinite(coords?.lon);
  const [mapError, setMapError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      // Prefer stored, privacy-rounded coordinates when present.
      const directLat = movement?.location_lat ?? movement?.location?.coordinates?.lat ?? movement?.location?.lat;
      const directLon = movement?.location_lon ?? movement?.location?.coordinates?.lon ?? movement?.location?.coordinates?.lng ?? movement?.location?.lng;
      const lat = Number(directLat);
      const lon = Number(directLon);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        setCoords({ lat, lon });
        return;
      }

      if (!locationQuery) {
        setCoords(null);
        return;
      }
      try {
        const found = await geocodeCity(locationQuery);
        if (!cancelled) setCoords(found);
      } catch {
        if (!cancelled) setCoords(null);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [locationQuery, movement]);

  useEffect(() => {
    setMapError(false);
  }, [coords?.lat, coords?.lon]);

  const boosts = toNumber(movement?.upvotes ?? movement?.boosts);
  const downvotes = toNumber(movement?.downvotes);
  const score = toNumber(movement?.score ?? movement?.momentum_score);
  const isTrending = score >= 10;

  const verifiedParticipants = toNumber(
    movement?.verified_participants ?? movement?.verified_participants_count ?? movement?.verifiedParticipants
  );
  const unverifiedParticipants = toNumber(
    movement?.unverified_participants ?? movement?.unverified_participants_count ?? movement?.unverifiedParticipants
  );
  const supporters = toNumber(movement?.supporters ?? movement?.supporters_count ?? movement?.supporter_count);

  const to = id ? `/movements/${encodeURIComponent(String(id))}` : '/';

  if (!movement) return null;

  return (
    <motion.div whileHover={reduceMotion ? undefined : { y: -4 }} className="rounded-2xl border border-slate-200 bg-white shadow-sm w-full max-w-md mx-auto">
      <div
        role="button"
        tabIndex={0}
        onClick={() => navigate(to)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            navigate(to);
          }
        }}
        className="block p-3 sm:p-4 space-y-3 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3A3DFF]/40 rounded-2xl"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-base sm:text-lg font-black text-slate-900 truncate">{String(title)}</h3>
              {isTrending ? (
                <span className="inline-flex items-center gap-1 text-xs font-black text-[#FFC947]">
                  <Flame className="w-4 h-4" fill="#FFC947" strokeWidth={2.5} />
                  Trending
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-2 text-xs font-bold text-slate-500 truncate">
              <span>
                By{' '}
                {author.profilePath ? (
                  <Link
                    to={author.profilePath}
                    className="hover:text-[#3A3DFF]"
                    title={author.label}
                  >
                    {author.label}
                  </Link>
                ) : (
                  <span>{author.label}</span>
                )}
              </span>
              {author.isAdminAuthor ? (
                <span className="inline-flex px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[10px] font-black uppercase">
                  Admin
                </span>
              ) : null}
              {locationLabel ? <span>• {locationLabel}</span> : null}
            </div>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto">
            <div className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-100 text-slate-700 text-xs font-black">
              <TrendingUp className="w-4 h-4" />
              {score}
            </div>
          </div>
        </div>

        {tags.length ? (
          <div className="flex flex-wrap gap-2">
            {tags.slice(0, 4).map((t) => (
              <span key={t} className="text-[11px] sm:text-xs font-bold text-slate-700 bg-slate-100 px-2 py-1 rounded-full">
                {formatTagLabel(t)}
              </span>
            ))}
            {tags.length > 4 ? (
              <span className="text-[11px] sm:text-xs font-bold text-slate-500">+{tags.length - 4} more</span>
            ) : null}
          </div>
        ) : null}

        <p className="text-sm text-slate-600 line-clamp-3 sm:line-clamp-2">{String(description)}</p>

        {hasCoords ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="inline-flex items-center gap-2 text-xs font-black text-slate-700">
                <MapPin className="w-4 h-4 text-slate-500" />
                Map preview (city-level)
              </div>
              <div className="text-xs font-bold text-slate-600 truncate">
                {locationLabel || 'Location set'}
              </div>
            </div>

            <div className="mt-2 h-24 sm:h-28 rounded-xl overflow-hidden border border-slate-200 bg-white relative">
              <MapContainer
                center={[coords.lat, coords.lon]}
                zoom={11}
                zoomControl={false}
                scrollWheelZoom={false}
                dragging={false}
                doubleClickZoom={false}
                touchZoom={false}
                boxZoom={false}
                keyboard={false}
                attributionControl={false}
                className="h-full w-full pointer-events-none"
                style={{ height: '100%', width: '100%' }}
              >
                <TileLayer
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  eventHandlers={{
                    tileerror: () => setMapError(true),
                    tileload: () => setMapError(false),
                  }}
                />
                <Marker position={[coords.lat, coords.lon]} />
              </MapContainer>
              {mapError ? (
                <div className="absolute inset-0 flex items-center justify-center bg-white/80 text-xs font-bold text-slate-600">
                  Map preview unavailable
                </div>
              ) : null}
            </div>

            <div className="mt-2 text-[11px] text-slate-500 font-semibold">
              Approximate city-level location only.
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-3 text-xs font-semibold text-slate-600">
            No location set yet.
          </div>
        )}

        <div className="flex items-center gap-4 pt-1">
          <div className="inline-flex items-center gap-1 text-xs font-black text-slate-700">
            <Users className="w-4 h-4 text-slate-500" />
            Participants: {verifiedParticipants}
          </div>
          {unverifiedParticipants > 0 ? (
            <div className="inline-flex items-center gap-1 text-xs font-black text-slate-700">
              <Users className="w-4 h-4 text-slate-400" />
              Unverified interest: {unverifiedParticipants}
            </div>
          ) : null}
          <div className="inline-flex items-center gap-1 text-xs font-black text-slate-700">
            <Users className="w-4 h-4 text-[#FFC947]" />
            Supporters: {supporters}
          </div>
        </div>

        <div className="flex items-center gap-4 pt-1">
          <div className="inline-flex items-center gap-1 text-xs font-black text-slate-700">
            <ThumbsUp className="w-4 h-4 text-[#3A3DFF]" />
            Boosts: {boosts}
          </div>
          <div className="inline-flex items-center gap-1 text-xs font-black text-slate-700">
            <ThumbsDown className="w-4 h-4 text-slate-500" />
            Downvotes: {downvotes}
          </div>
        </div>

        <div className="pt-1 text-xs text-slate-500 font-semibold space-y-1">
          <div>Community-generated. Not verified by People Power.</div>
          <div>Always act safely and responsibly.</div>
        </div>
      </div>
    </motion.div>
  );
}
