import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Loader2, MapPin, Search as SearchIcon, User as UserIcon } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { searchMovements, searchUsers } from '@/api/searchClient';
import { fetchMyProfile } from '@/api/userProfileClient';
import { sanitizePublicLocation } from '@/utils/locationPrivacy';

function formatLocation(city, country) {
  const parts = [city, country].map((p) => String(p || '').trim()).filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

function MovementResult({ movement }) {
  const id = movement?.id ?? movement?._id;
  const title = String(movement?.title || movement?.name || 'Untitled movement');
  const summary = String(movement?.summary || '').trim();
  const tags = Array.isArray(movement?.tags) ? movement.tags : [];
  const locationLabel = formatLocation(movement?.location_city || movement?.city, movement?.location_country || movement?.country);
  const displayName = String(movement?.creator_display_name || movement?.author_display_name || '').trim();
  const usernameRaw = String(movement?.creator_username || movement?.author_username || '').trim();
  const username = usernameRaw ? usernameRaw.replace(/^@/, '') : '';
  const authorLabel = displayName || (username ? `@${username}` : 'Member');
  const authorPath = username ? `/u/${encodeURIComponent(username)}` : null;
  const isAdminAuthor = !!(movement?.creator_is_admin || movement?.author_is_admin);
  const to = id ? `/movements/${encodeURIComponent(String(id))}` : '/';

  return (
    <div className="p-4 rounded-2xl border border-slate-200 bg-white shadow-sm">
      <Link to={to} className="block">
        <h3 className="font-black text-slate-900 text-base sm:text-lg truncate">{title}</h3>
        {summary ? (
          <p className="text-sm text-slate-600 mt-1 line-clamp-2">{summary}</p>
        ) : null}
        <div className="mt-2 text-xs font-bold text-slate-500 flex flex-wrap items-center gap-2">
          <span>
            By{' '}
            {authorPath ? (
              <Link to={authorPath} className="hover:text-[#3A3DFF]">
                {authorLabel}
              </Link>
            ) : (
              <span>{authorLabel}</span>
            )}
          </span>
          {isAdminAuthor ? (
            <span className="inline-flex px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[10px] font-black uppercase">
              Admin
            </span>
          ) : null}
          {locationLabel ? (
            <span className="inline-flex items-center gap-1">
              <MapPin className="w-3 h-3" />
              {locationLabel}
            </span>
          ) : null}
        </div>
      </Link>
      {tags.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {tags.slice(0, 4).map((tag) => (
            <span key={tag} className="text-[11px] font-bold text-slate-700 bg-slate-100 px-2 py-1 rounded-full">
              {String(tag)}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function UserResult({ user }) {
  const displayName = String(user?.display_name || '').trim();
  const usernameRaw = String(user?.username || '').trim();
  const username = usernameRaw ? usernameRaw.replace(/^@/, '') : '';
  const label = displayName || (username ? `@${username}` : 'Member');
  const isAdminUser = !!user?.is_admin;
  const initial = label ? label[0].toUpperCase() : '?';
  const profilePath = username ? `/u/${encodeURIComponent(username)}` : null;
  const content = (
    <div className="flex items-center gap-3 p-3 rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center overflow-hidden">
        {user?.profile_photo_url ? (
          <img src={user.profile_photo_url} alt={label} className="w-full h-full object-cover" />
        ) : (
          <span className="text-sm font-black text-slate-700">{initial}</span>
        )}
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="font-black text-slate-900 truncate">{label}</div>
          {isAdminUser ? (
            <span className="inline-flex px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[10px] font-black uppercase">
              Admin
            </span>
          ) : null}
        </div>
        {username ? (
          <div className="text-xs text-slate-500 font-semibold">@{username}</div>
        ) : null}
      </div>
    </div>
  );

  return profilePath ? (
    <Link to={profilePath} className="block">
      {content}
    </Link>
  ) : (
    <div>{content}</div>
  );
}

export default function Search() {
  const { user, session } = useAuth();
  const accessToken = session?.access_token ? String(session.access_token) : null;
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [city, setCity] = useState('');
  const [country, setCountry] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 400);
    return () => clearTimeout(t);
  }, [query]);

  const trimmed = String(debounced || '').trim();
  const locationActive = Boolean(String(city || '').trim() || String(country || '').trim());
  const movementEnabled = Boolean(trimmed || locationActive);
  const userEnabled = Boolean(accessToken && trimmed.length >= 2);

  const { data: myProfile } = useQuery({
    queryKey: ['myProfile', user?.email],
    enabled: !!accessToken,
    queryFn: async () => {
      const profile = await fetchMyProfile({ accessToken });
      return profile ? { ...profile, location: sanitizePublicLocation(profile?.location) } : null;
    },
  });

  const { data: movementResults = [], isLoading: movementsLoading, isError: movementsError } = useQuery({
    queryKey: ['searchMovements', trimmed, city, country],
    enabled: movementEnabled,
    queryFn: () => searchMovements({ q: trimmed, city, country, limit: 20, offset: 0, accessToken }),
    retry: 1,
  });

  const { data: userResults = [], isLoading: usersLoading, isError: usersError } = useQuery({
    queryKey: ['searchUsers', trimmed],
    enabled: userEnabled,
    queryFn: () => searchUsers({ q: trimmed, limit: 20, offset: 0, accessToken }),
    retry: 1,
  });

  const hasQuery = Boolean(trimmed || locationActive);
  const showEmptyPrompt = !hasQuery;

  const applyProfileLocation = () => {
    const loc = myProfile?.location || null;
    if (!loc || (!loc.city && !loc.country)) return;
    setCity(String(loc.city || '').trim());
    setCountry(String(loc.country || '').trim());
  };

  const profileLocationLabel = formatLocation(myProfile?.location?.city, myProfile?.location?.country);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="bg-white rounded-3xl shadow-2xl border-3 border-slate-200 overflow-hidden">
        <div className="p-5 sm:p-6 border-b border-slate-200">
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 mb-3">Search</h1>
          <div className="relative">
            <SearchIcon className="w-5 h-5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search movements and people…"
              className="w-full rounded-2xl border-2 border-slate-200 bg-slate-50 pl-10 pr-4 py-3 text-sm font-semibold focus:outline-none focus:border-[#3A3DFF]"
            />
          </div>

          <div className="mt-4 grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3">
            <input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="City"
              className="w-full rounded-xl border-2 border-slate-200 bg-white px-3 py-2 text-sm font-semibold focus:outline-none focus:border-[#3A3DFF]"
            />
            <input
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              placeholder="Country"
              className="w-full rounded-xl border-2 border-slate-200 bg-white px-3 py-2 text-sm font-semibold focus:outline-none focus:border-[#3A3DFF]"
            />
            <button
              type="button"
              onClick={applyProfileLocation}
              disabled={!profileLocationLabel}
              className="rounded-xl px-4 py-2 text-sm font-bold border-2 border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Use my location
            </button>
          </div>
          {profileLocationLabel ? (
            <p className="mt-2 text-xs text-slate-500 font-semibold">
              Profile location: {profileLocationLabel}
            </p>
          ) : null}
        </div>

        {showEmptyPrompt ? (
          <div className="p-6 text-sm text-slate-600 font-semibold">
            Start typing to search movements and people, or filter by city/country.
          </div>
        ) : null}
      </div>

      {hasQuery ? (
        <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-black text-slate-900">Movements</h2>
              {movementsLoading ? (
                <div className="text-xs text-slate-500 font-semibold flex items-center gap-2">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Searching
                </div>
              ) : null}
            </div>

            {movementsError ? (
              <div className="p-4 rounded-2xl border border-slate-200 bg-white text-sm text-slate-600 font-semibold">
                Unable to search movements right now.
              </div>
            ) : null}

            {!movementsLoading && !movementsError && movementResults.length === 0 ? (
              <div className="p-4 rounded-2xl border border-slate-200 bg-white text-sm text-slate-600 font-semibold">
                No matches found. Try different keywords.
              </div>
            ) : null}

            <div className="space-y-3">
              {movementResults.map((movement) => (
                <MovementResult key={movement.id || movement._id} movement={movement} />
              ))}
            </div>
          </section>

          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-black text-slate-900">People</h2>
              {usersLoading ? (
                <div className="text-xs text-slate-500 font-semibold flex items-center gap-2">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Searching
                </div>
              ) : null}
            </div>

            {!accessToken ? (
              <div className="p-4 rounded-2xl border border-slate-200 bg-white text-sm text-slate-600 font-semibold">
                Sign in to search people.
              </div>
            ) : null}

            {usersError ? (
              <div className="p-4 rounded-2xl border border-slate-200 bg-white text-sm text-slate-600 font-semibold">
                Unable to search people right now.
              </div>
            ) : null}

            {!usersLoading && accessToken && !usersError && userResults.length === 0 ? (
              <div className="p-4 rounded-2xl border border-slate-200 bg-white text-sm text-slate-600 font-semibold">
                No matches found. Try different keywords.
              </div>
            ) : null}

            <div className="space-y-3">
              {userResults.map((u, idx) => (
                <UserResult
                  key={`${u?.username || u?.display_name || 'user'}-${idx}`}
                  user={u}
                />
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
