import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { isAdmin as isAdminEmail } from '@/utils/staff';
import { motion, useReducedMotion } from 'framer-motion';
import { Flame, MapPin, TrendingUp, Clock } from 'lucide-react';

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
  const initial = label && label !== 'Unknown creator' ? label[0].toUpperCase() : '?';
  return { label, profilePath, isAdminAuthor, initial };
}

function relativeTime(dateStr) {
  try {
    const now = Date.now();
    const then = new Date(dateStr).getTime();
    if (!Number.isFinite(then)) return null;
    const diffMs = now - then;
    if (diffMs < 0) return 'just now';
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months}mo ago`;
    return `${Math.floor(months / 12)}y ago`;
  } catch {
    return null;
  }
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

function getTeaser(movement) {
  const raw = movement?.summary || movement?.description || '';
  const s = String(raw || '').trim();
  return s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function MovementCard({ movement }) {
  const reduceMotion = useReducedMotion();
  const id = movement?.id ?? movement?._id;
  const title = movement?.title || movement?.name || 'Untitled movement';
  const description = getTeaser(movement);
  const author = getAuthorInfo(movement);
  const tags = normalizeTags(movement);
  const locationLabel = formatLocation(movement);
  const createdAt = movement?.created_at || movement?.created_date || null;
  const timeAgo = useMemo(() => relativeTime(createdAt), [createdAt]);
  const boosts = toNumber(movement?.boosts_count ?? movement?.upvotes ?? movement?.boosts);
  const score = toNumber(movement?.score ?? movement?.momentum_score);
  const isTrending = score >= 10;

  const to = id ? `/movement/${encodeURIComponent(String(id))}` : '/';

  if (!movement) return null;

  return (
    <motion.div whileHover={reduceMotion ? undefined : { y: -2 }} transition={{ duration: 0.2 }} className="rounded-2xl border border-slate-200 bg-white shadow-sm hover:shadow-md transition-all w-full max-w-md mx-auto">
      <Link
        to={to}
        className="block p-4 space-y-2.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3A3DFF]/40 rounded-2xl"
      >
        {/* Title row */}
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-base font-bold text-slate-900 line-clamp-2 leading-snug">{String(title)}</h3>
          <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
            {isTrending ? (
              <Flame className="w-4 h-4 text-amber-500" fill="currentColor" strokeWidth={0} />
            ) : null}
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500">
              <TrendingUp className="w-3.5 h-3.5" />
              {score}
            </span>
          </div>
        </div>

        {/* Description */}
        {description ? (
          <p className="text-sm text-slate-600 line-clamp-2 leading-relaxed">{String(description)}</p>
        ) : null}

        {/* Tags — max 3, quieter */}
        {tags.length ? (
          <div className="flex flex-wrap gap-1.5">
            {tags.slice(0, 3).map((t) => (
              <span key={t} className="text-[11px] font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full">
                {formatTagLabel(t)}
              </span>
            ))}
            {tags.length > 3 ? (
              <span className="text-[11px] font-medium text-slate-400">+{tags.length - 3}</span>
            ) : null}
          </div>
        ) : null}

        {/* Meta row — author · location · time · boosts */}
        <div className="flex items-center gap-1.5 text-xs text-slate-500 pt-0.5">
          <div className="w-4 h-4 rounded-full bg-gradient-to-br from-[#3A3DFF] to-[#5B5EFF] flex items-center justify-center text-white text-[9px] font-semibold shrink-0">
            {author.initial}
          </div>
          <span className="truncate font-medium">{author.label}</span>
          {locationLabel ? (
            <>
              <span className="text-slate-300">·</span>
              <span className="inline-flex items-center gap-0.5 truncate">
                <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                {locationLabel}
              </span>
            </>
          ) : null}
          {timeAgo ? (
            <>
              <span className="text-slate-300">·</span>
              <span className="inline-flex items-center gap-0.5 text-slate-400 shrink-0">
                <Clock className="w-3 h-3" />
                {timeAgo}
              </span>
            </>
          ) : null}
          {boosts > 0 ? (
            <>
              <span className="text-slate-300">·</span>
              <span className="font-semibold text-slate-500">{boosts} boost{boosts !== 1 ? 's' : ''}</span>
            </>
          ) : null}
        </div>
      </Link>
    </motion.div>
  );
}

export default React.memo(MovementCard);
