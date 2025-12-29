import { fetchMovementLocks } from '@/api/movementLocksClient';
// ✅ REMOVE any of these (if present):


import React, { useEffect, useMemo, useState } from 'react';
import { getCurrentBackendStatus, subscribeBackendStatus } from '../utils/backendStatus';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Sparkles, Upload, X, Zap } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { createMovement } from '@/api/movementsClient';
import { acceptPlatformAcknowledgment, fetchMyPlatformAcknowledgment } from '@/api/platformAckClient';
import { checkLeadershipCap, registerLeadershipRole } from '@/components/governance/PowerConcentrationLimiter';
import MovementCard from '@/components/home/MovementCard';
import AIMovementAssistant from '@/components/creation/AIMovementAssistant';
import { uploadFile } from '@/api/uploadsClient';
import toast from 'react-hot-toast';
import Filter from 'bad-words';
import { checkActionAllowed, formatWaitMs } from '@/utils/antiBrigading';
import { logError } from '@/utils/logError';

import ReactQuill from 'react-quill';
import 'quill/dist/quill.snow.css';

const TAG_OPTIONS = [
  // Movement-type categories requested
  { id: 'protest', label: 'Protest' },
  { id: 'meetup', label: 'Meet-up' },
  { id: 'boycott', label: 'Boycott' },
  { id: 'review_bomb', label: 'Review Bomb' },
  { id: 'community_support', label: 'Community Support' },
  { id: 'fundraising', label: 'Fundraising' },
  { id: 'awareness_campaign', label: 'Awareness Campaign' },
  { id: 'advocacy', label: 'Advocacy' },
  { id: 'other', label: 'Other' },

  // Existing theme categories
  { id: 'environment', label: 'Environment' },
  { id: 'social_justice', label: 'Social Justice' },
  { id: 'education', label: 'Education' },
  { id: 'health', label: 'Health & Wellness' },
  { id: 'community', label: 'Community' },
  { id: 'arts', label: 'Arts & Culture' },
  { id: 'technology', label: 'Technology' },
  { id: 'animals', label: 'Animal Rights' },
];

export default function CreateMovement() {
  const { user, session, loading: authLoading } = useAuth();
  const accessToken = session?.access_token ?? null;
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Field lock state (for edit mode)
  const [movementLocks, setMovementLocks] = useState({});
  const [locksLoading, setLocksLoading] = useState(false);
  const [locksError, setLocksError] = useState(null);
  // If editing an existing movement, fetch lock state
  // (Assume movementId is available in edit mode; for creation, all fields are editable)
  const movementId = null; // TODO (pre-production): set this if editing (affects edit mode permissions)
  const isOwnerOrAdmin = true; // TODO (pre-production): set this if editing (affects edit mode permissions)
  useEffect(() => {
    if (!movementId) return;
    setLocksLoading(true);
    fetchMovementLocks(movementId, { accessToken })
      .then(setMovementLocks)
      .catch((e) => setLocksError(e))
      .finally(() => setLocksLoading(false));
  }, [movementId, accessToken]);
  const [backendStatus, setBackendStatus] = useState(getCurrentBackendStatus());
  useEffect(() => {
    const unsub = subscribeBackendStatus(setBackendStatus);
    return () => unsub();
  }, []);

  // ✅ Define missing state to prevent runtime ReferenceErrors
  const [title, setTitle] = useState('');
  const [descriptionHtml, setDescriptionHtml] = useState('');
  const [selectedTags, setSelectedTags] = useState([]);
  const [showTagOptions, setShowTagOptions] = useState(false);
  const [saving, setSaving] = useState(false);

  const [locationCity, setLocationCity] = useState('');
  const [locationCountry, setLocationCountry] = useState('');

  const [mediaLinkInput, setMediaLinkInput] = useState('');
  const [mediaLinks, setMediaLinks] = useState([]);

  const [includeMapLocation, setIncludeMapLocation] = useState(false);
  const [mapCoords, setMapCoords] = useState(null); // { lat, lon }
  const [mapLoading, setMapLoading] = useState(false);

  const [coverFile, setCoverFile] = useState(null);
  const [coverUrl, setCoverUrl] = useState('');

  const [claims, setClaims] = useState([]);

  const [fieldErrors, setFieldErrors] = useState({ title: null, description: null, claims: null });

  const [submitBanner, setSubmitBanner] = useState(null);
  // submitBanner shape: { type: 'success' | 'error' | 'info', message: string }

  const [createdMovement, setCreatedMovement] = useState(null);

  const aiOptIn = useMemo(() => {
    if (!user) return false;
    try {
      return localStorage.getItem('peoplepower_ai_opt_in') === 'true';
    } catch {
      return false;
    }
  }, [user]);

  const [ackAccepted, setAckAccepted] = useState(false);
  const [ackLoading, setAckLoading] = useState(false);

  const quillModules = useMemo(
    () => ({
      toolbar: [
        [{ header: [1, 2, false] }],
        ['bold', 'italic', 'underline'],
        [{ list: 'ordered' }, { list: 'bullet' }],
        ['link'],
        ['clean'],
      ],
    }),
    []
  );

  const htmlToText = (html) => {
    const raw = String(html ?? '');
    if (!raw) return '';
    return raw
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  };

  const normalizeHttpUrl = (value) => {
    const raw = String(value ?? '').trim();
    if (!raw) return null;
    try {
      const url = new URL(raw);
      const protocol = url.protocol.toLowerCase();
      if (protocol !== 'http:' && protocol !== 'https:') return null;
      return url.toString();
    } catch {
      return null;
    }
  };

  const geocodeCityLevel = async ({ city, country }) => {
    const c = String(city || '').trim();
    const k = String(country || '').trim();
    const query = [c, k].filter(Boolean).join(', ');
    if (!query) return null;

    const cacheKey = `peoplepower_geocode_${query.toLowerCase()}`;
    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && typeof parsed === 'object' && parsed.lat != null && parsed.lon != null) {
          return parsed;
        }
      }
    } catch {
      // ignore
    }

    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const json = await res.json();
    const first = Array.isArray(json) ? json[0] : null;
    if (!first?.lat || !first?.lon) return null;

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
  };

  const toSafeHtmlParagraph = (text) => {
    const s = String(text ?? '').trim();
    if (!s) return '';
    const escaped = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<p>${escaped}</p>`;
  };

  useEffect(() => {
    let cancelled = false;
    async function loadAck() {
      if (!user || !accessToken) return;
      setAckLoading(true);
      try {
        const res = await fetchMyPlatformAcknowledgment({ accessToken, userEmail: user?.email ?? null });
        if (!cancelled) {
          setAckAccepted(!!res?.accepted);
        }
      } catch {
        if (!cancelled) {
          setAckAccepted(false);
        }
      } finally {
        if (!cancelled) setAckLoading(false);
      }
    }
    loadAck();
    return () => {
      cancelled = true;
    };
  }, [user, accessToken]);

  const previewMovement = useMemo(() => {
    const allowed = new Set(TAG_OPTIONS.map((t) => t.id));
    const tags = (Array.isArray(selectedTags) ? selectedTags : [])
      .map((t) => String(t).trim())
      .filter(Boolean)
      .filter((t) => allowed.has(t));

    return {
      id: 'preview',
      title: title || 'Your movement title',
      description: descriptionHtml || 'Your movement description will appear here.',
      tags,
      author_email: user?.email ?? 'you@example.com',
      upvotes: 0,
      downvotes: 0,
      score: 0,
      location_city: locationCity || undefined,
      location_country: locationCountry || undefined,
      location_lat: includeMapLocation ? mapCoords?.lat : undefined,
      location_lon: includeMapLocation ? mapCoords?.lon : undefined,
    };
  }, [title, descriptionHtml, selectedTags, user, locationCity, locationCountry, includeMapLocation, mapCoords]);

  const handleSubmit = async (e) => {
    e?.preventDefault?.();

    if (saving) return;

    try {
      setSaving(true);
      setSubmitBanner(null);
      setFieldErrors({ title: null, description: null, claims: null });

      const profanityFilter = new Filter();

      const cleanText = (v) => {
        const s = String(v ?? '').trim();
        if (!s) return '';
        try {
          return profanityFilter.clean(s);
        } catch {
          return s;
        }
      };

      const allowed = new Set(TAG_OPTIONS.map((t) => t.id));
      const tags = (Array.isArray(selectedTags) ? selectedTags : [])
        .map((t) => String(t).trim())
        .filter(Boolean)
        .filter((t) => allowed.has(t));

      const descriptionText = htmlToText(descriptionHtml);

      const nextClaims = Array.isArray(claims) ? claims : [];

      const normalizedLinks = (Array.isArray(mediaLinks) ? mediaLinks : [])
        .map((u) => normalizeHttpUrl(u))
        .filter(Boolean);

      const payload = {
        title: cleanText(title),
        description: cleanText(descriptionText),
        description_html: String(descriptionHtml || ''),
        tags,
        author_email: user?.email ?? null,
        location_city: String(locationCity || '').trim() || undefined,
        location_country: String(locationCountry || '').trim() || undefined,
        location_lat: includeMapLocation ? mapCoords?.lat : undefined,
        location_lon: includeMapLocation ? mapCoords?.lon : undefined,
        media_urls: undefined,
        claims: nextClaims.length ? nextClaims : undefined,
      };

      const nextErrors = {
        title: payload.title ? null : 'Title is required.',
        description: payload.description ? null : 'Description is required.',
        claims: null,
      };
      setFieldErrors(nextErrors);

      if (nextErrors.title || nextErrors.description || nextErrors.claims) {
        setSubmitBanner({ type: 'error', message: 'Please fix the highlighted fields.' });
        return;
      }

      if (!user) {
        setSubmitBanner({
          type: 'info',
          message: 'You need an account to create movements. Log in or sign up to continue.',
        });
        return;
      }

      const emailVerified = !!(user?.email_confirmed_at || user?.confirmed_at);
      if (!emailVerified) {
        setSubmitBanner({
          type: 'error',
          message: 'Please verify your email address before creating movements.',
        });
        return;
      }

      if (!accessToken) {
        setSubmitBanner({
          type: 'error',
          message: 'Your session is missing an access token. Please log in again.',
        });
        return;
      }

      if (!ackAccepted) {
        setSubmitBanner({
          type: 'error',
          message:
            'Before creating a movement, you must acknowledge that People Power is a neutral facilitation platform, not an organiser or endorser.',
        });
        return;
      }

      // Anti-brigading: rate-limit creation of new movements.
      try {
        const rateCheck = await checkActionAllowed({
          email: user?.email ?? null,
          action: 'movement_create',
          contextId: 'global',
          accessToken,
        });
        if (!rateCheck?.ok) {
          const wait = rateCheck?.retryAfterMs ? ` Try again in ${formatWaitMs(rateCheck.retryAfterMs)}.` : '';
          const msg = String(rateCheck?.reason || 'Please slow down.') + wait;
          setSubmitBanner({ type: 'error', message: msg });
          toast.error(msg);
          return;
        }
      } catch {
        // ignore limiter failures
      }

      // Anti-mob governance: cap simultaneous leadership roles.
      try {
        const cap = await checkLeadershipCap(user?.email ?? null, 'movement_creator');
        if (cap && cap.can_create === false) {
          const msg = cap.message || 'You have reached the leadership role cap.';
          setSubmitBanner({ type: 'error', message: msg });
          toast.error(msg);
          return;
        }
      } catch {
        // Ignore cap check failures (fallback to allowing creation).
      }

      // Upload cover media (optional) right before creation so we store a durable URL.
      let finalCoverUrl = coverUrl;
      if (!finalCoverUrl && coverFile) {
        try {
          const uploaded = await uploadFile(coverFile, { accessToken });
          finalCoverUrl = uploaded?.url ? String(uploaded.url) : '';
          setCoverUrl(finalCoverUrl);
        } catch (err) {
          const msg = err?.message ? String(err.message) : 'Failed to upload cover media';
          setSubmitBanner({ type: 'error', message: msg });
          toast.error(msg);
          return;
        }
      }

      if (finalCoverUrl) {
        payload.media_urls = [finalCoverUrl, ...normalizedLinks];
      } else if (normalizedLinks.length) {
        payload.media_urls = normalizedLinks;
      }

      // ✅ Real backend creation
      const created = await createMovement(payload, { accessToken });
      setCreatedMovement(created);

      // Best-effort register leadership role for decentralization tracking.
      try {
        const createdId = created?.id ?? created?._id;
        if (createdId && user?.email) {
          await registerLeadershipRole(String(user.email), 'movement_creator', String(createdId));
        }
      } catch {
        // ignore
      }

      // Update Home cache immediately so the new movement appears without reload
      try {
        queryClient.setQueryData(['movements'], (old) => {
          const arr = Array.isArray(old) ? old : [];
          const id = created?.id ?? created?._id;
          const exists = id ? arr.some((m) => (m?.id ?? m?._id) === id) : false;
          return exists ? arr : [created, ...arr];
        });
      } catch (e) {
        console.warn('[CreateMovement] failed to update movements cache (ignored)', e);
      }

      const successMessage = 'Movement created.';
      setSubmitBanner({ type: 'success', message: successMessage });
      toast.success(successMessage);

      const createdId = created?.id ?? created?._id;
      if (createdId) {
        navigate(`/movements/${encodeURIComponent(String(createdId))}`);
      } else {
        navigate('/');
      }
    } catch (err) {
      logError(err, 'Failed to create movement');
      const rawMessage = err?.message ? String(err.message) : '';
      const looksOffline =
        rawMessage.includes('Failed to fetch') ||
        rawMessage.includes('NetworkError') ||
        rawMessage.includes('Load failed');
      const message = looksOffline
        ? 'Could not reach the backend server (http://localhost:3001). Start the server and try again.'
        : rawMessage || "We couldn’t create your movement. Please try again.";
      setSubmitBanner({
        type: 'error',
        message,
      });
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center text-slate-600 font-semibold">
        Loading…
      </div>
    );
  }

  if (createdMovement) {
    const newId = createdMovement?.id ?? createdMovement?._id;
    const viewUrl = newId ? `/movements/${encodeURIComponent(String(newId))}` : null;

    return (
      <div className="max-w-2xl mx-auto px-4 py-12">
        <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden">
          <div className="bg-gradient-to-r from-[#FFC947] to-[#FFD666] px-6 py-8 text-slate-900">
            <h1 className="text-3xl font-black leading-tight">Congrats — your movement is created.</h1>
            <p className="mt-2 text-sm font-semibold text-slate-800">
              Choose what to do next.
            </p>
          </div>

          <div className="p-6 space-y-3">
            {viewUrl ? (
              <button
                type="button"
                onClick={() => navigate(viewUrl)}
                className="w-full inline-flex items-center justify-center px-4 py-3 rounded-2xl bg-[#3A3DFF] text-white font-black hover:opacity-90"
              >
                View your movement
              </button>
            ) : (
              <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50 text-slate-700 font-semibold">
                Movement was created, but an ID wasn’t returned.
              </div>
            )}

            <button
              type="button"
              onClick={() => navigate('/')}
              className="w-full inline-flex items-center justify-center px-4 py-3 rounded-2xl border border-slate-200 bg-white text-slate-900 font-black hover:bg-slate-50"
            >
              Back to home
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-10">
      {!user ? (
        <div className="mb-6 p-4 rounded-2xl border border-yellow-200 bg-yellow-50 text-slate-900">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-2 font-semibold">
              <Zap className="w-5 h-5 text-[#FFC947]" fill="#FFC947" />
              <span>
                You need an account to create movements. Log in or sign up to continue.
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => navigate('/login')}
                className="inline-flex items-center justify-center px-4 py-2 rounded-xl bg-gradient-to-r from-[#3A3DFF] to-[#3A3DFF] text-white font-bold shadow hover:opacity-90 transition"
              >
                Go to login
              </button>
            </div>
          </div>
        </div>
      ) : null}

        {submitBanner ? (
          <div
            className={`mb-6 p-4 rounded-2xl border font-semibold ${
              submitBanner.type === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                : submitBanner.type === 'error'
                  ? 'border-rose-200 bg-rose-50 text-rose-900'
                  : 'border-slate-200 bg-slate-50 text-slate-700'
            }`}
          >
            {submitBanner.message}
          </div>
        ) : null}

        <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden">
          <div className="bg-gradient-to-r from-[#FFC947] to-[#FFD666] px-6 py-6 sm:px-8 sm:py-8 text-slate-900">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/30 rounded-full text-xs font-black uppercase tracking-wide">
              <Sparkles className="w-4 h-4" />
              New Movement
            </div>
            <h1 className="mt-4 text-3xl sm:text-4xl font-black leading-tight">Start a People Power movement</h1>
            <p className="mt-2 text-sm sm:text-base font-semibold text-slate-800">
              Create a community-led movement and invite others to participate.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="p-6 sm:p-8 space-y-6 bg-white">
            {/* AI assistant (opt-in only) */}
            {aiOptIn ? (
              <AIMovementAssistant
                aiEnabled={aiOptIn}
                onApplySuggestion={(suggestion) => {
                  const next = suggestion && typeof suggestion === 'object' ? suggestion : {};
                  if (next.title && !title) setTitle(String(next.title));
                  if (next.description) setDescriptionHtml(toSafeHtmlParagraph(next.description));

                  if (Array.isArray(next.tags) && next.tags.length) {
                    const byId = new Map(TAG_OPTIONS.map((t) => [String(t.id).toLowerCase(), t.id]));
                    const byLabel = new Map(TAG_OPTIONS.map((t) => [String(t.label).toLowerCase(), t.id]));
                    const mapped = next.tags
                      .map((t) => String(t || '').trim().toLowerCase())
                      .map((k) => byId.get(k) || byLabel.get(k))
                      .filter(Boolean);
                    if (mapped.length) {
                      setSelectedTags((prev) => Array.from(new Set([...(Array.isArray(prev) ? prev : []), ...mapped])));
                    }
                  }
                }}
              />
            ) : null}

            {/* Platform role declaration acknowledgment */}
            {user ? (
              <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50">
                <div className="text-sm font-black text-slate-900">Platform Role Declaration</div>
                <p className="mt-2 text-sm text-slate-700 font-semibold">
                  People Power is a neutral facilitation platform. We do not organise, endorse, verify, or take responsibility
                  for user-created movements. Movements are user-led; responsibility lies with organisers and participants.
                </p>
                <label className="mt-3 flex items-start gap-3 text-sm font-semibold text-slate-800">
                  <input
                    type="checkbox"
                    checked={ackAccepted}
                    disabled={ackLoading}
                    onChange={async (e) => {
                      const next = !!e.target.checked;
                      setAckAccepted(next);
                      if (next && accessToken) {
                        try {
                          await acceptPlatformAcknowledgment({ accessToken, userEmail: user?.email ?? null });
                        } catch (err) {
                          setAckAccepted(false);
                          toast.error(err?.message || 'Failed to record acknowledgment');
                        }
                      }
                    }}
                    className="mt-1"
                  />
                  <span>I acknowledge and agree to the Platform Role Declaration.</span>
                </label>
              </div>
            ) : null}

            <div className="space-y-2">
              <label className="block text-sm font-bold text-slate-700">Movement title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Give your movement a clear, powerful name"
                className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-[#FFC947]"
                disabled={!!movementLocks.title && !isOwnerOrAdmin}
              />
              {fieldErrors.title ? (
                <div className="text-sm font-semibold text-rose-700">{fieldErrors.title}</div>
              ) : null}
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-bold text-slate-700">Description (rich text)</label>
              <div className="rounded-2xl border border-slate-200 overflow-hidden bg-white">
                <ReactQuill
                  theme="snow"
                  value={descriptionHtml}
                  onChange={setDescriptionHtml}
                  modules={quillModules}
                  placeholder="Summarize the purpose, who it’s for, and the impact you seek."
                  readOnly={!!movementLocks.description && !isOwnerOrAdmin}
                />
              </div>
              <div className="text-xs text-slate-500 font-semibold">
                Keep it factual and safety-conscious. If you include factual assertions, add evidence below.
              </div>
              {fieldErrors.description ? (
                <div className="text-sm font-semibold text-rose-700">{fieldErrors.description}</div>
              ) : null}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="block text-sm font-bold text-slate-700">City (optional)</label>
                <input
                  type="text"
                  value={locationCity}
                  onChange={(e) => setLocationCity(e.target.value)}
                  placeholder="City-level only for privacy"
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-[#FFC947]"
                />
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-bold text-slate-700">Country (optional)</label>
                <input
                  type="text"
                  value={locationCountry}
                  onChange={(e) => setLocationCountry(e.target.value)}
                  placeholder="Country"
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-[#FFC947]"
                />
              </div>
            </div>

            {/* Optional map location */}
            <div className="space-y-2">
              <label className="flex items-start gap-3 text-sm font-semibold text-slate-800">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={includeMapLocation}
                  onChange={(e) => {
                    const next = !!e.target.checked;
                    setIncludeMapLocation(next);
                    if (!next) setMapCoords(null);
                  }}
                />
                <span>
                  Add map location (optional). This uses an approximate city-level marker.
                </span>
              </label>

              {includeMapLocation ? (
                <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50 space-y-3">
                  <div className="text-xs text-slate-600 font-semibold">
                    Uses your City/Country fields. Coordinates are rounded to protect privacy.
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      disabled={mapLoading}
                      onClick={async () => {
                        setMapLoading(true);
                        try {
                          const coords = await geocodeCityLevel({ city: locationCity, country: locationCountry });
                          setMapCoords(coords);
                          if (!coords) {
                            toast.error('Could not find that city-level location');
                          }
                        } catch {
                          setMapCoords(null);
                          toast.error('Failed to load map location');
                        } finally {
                          setMapLoading(false);
                        }
                      }}
                      className="inline-flex items-center justify-center px-4 py-2 rounded-xl bg-white border border-slate-200 text-slate-900 font-black text-xs"
                    >
                      {mapLoading ? 'Loading…' : 'Preview map'}
                    </button>
                    {mapCoords ? (
                      <div className="text-xs font-semibold text-slate-600">
                        Saved: {mapCoords.lat}, {mapCoords.lon}
                      </div>
                    ) : null}
                  </div>

                  <div className="rounded-xl overflow-hidden border border-slate-200 bg-white">
                    {mapCoords ? (
                      <img
                        alt="City-level map preview"
                        loading="lazy"
                        className="w-full h-28 object-cover"
                        src={`https://staticmap.openstreetmap.de/staticmap.php?center=${mapCoords.lat},${mapCoords.lon}&zoom=11&size=640x220&maptype=mapnik&markers=${mapCoords.lat},${mapCoords.lon},lightblue1`}
                      />
                    ) : (
                      <div className="h-28 flex items-center justify-center text-xs text-slate-500 font-semibold">
                        No map preview yet.
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-bold text-slate-700">Cover media (optional)</label>
              <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50 space-y-3">
                {coverUrl ? (
                  <div className="flex items-center justify-between gap-3">
                    <a
                      href={coverUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm font-bold text-[#3A3DFF] hover:underline truncate"
                    >
                      {coverUrl}
                    </a>
                    <button
                      type="button"
                      onClick={() => {
                        setCoverUrl('');
                        setCoverFile(null);
                      }}
                      className="inline-flex items-center gap-1 text-xs font-black text-slate-700"
                    >
                      <X className="w-4 h-4" />
                      Remove
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/jpg,image/gif,application/pdf"
                      onChange={(e) => {
                        const file = e.target.files?.[0] ?? null;
                        e.target.value = '';
                        if (!file) return;
                        const MAX_UPLOAD_MB = 5;
                        const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'application/pdf'];
                        if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
                          toast.error(`File too large. Max size is ${MAX_UPLOAD_MB}MB.`);
                          return;
                        }
                        if (!ALLOWED_MIME_TYPES.includes(file.type)) {
                          toast.error('That file type isn’t supported. Please upload an image (JPG/PNG/GIF) or PDF.');
                          return;
                        }
                        setCoverFile(file);
                      }}
                      className="text-sm font-semibold text-slate-700"
                    />
                    {coverFile ? (
                      <div className="text-xs text-slate-600 font-semibold truncate">Selected: {coverFile.name}</div>
                    ) : null}
                  </div>
                )}
                <div className="text-xs text-slate-500 font-semibold">
                  Files upload when you submit.
                </div>
              </div>
            </div>

            {/* Media links */}
            <div className="space-y-2">
              <label className="block text-sm font-bold text-slate-700">Media links (optional)</label>
              <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50 space-y-3">
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="url"
                    value={mediaLinkInput}
                    onChange={(e) => setMediaLinkInput(e.target.value)}
                    placeholder="https://example.com"
                    className="flex-1 rounded-2xl border border-slate-200 px-4 py-3 text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-[#FFC947]"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const normalized = normalizeHttpUrl(mediaLinkInput);
                      if (!normalized) {
                        toast.error('Enter a valid http(s) URL');
                        return;
                      }
                      setMediaLinks((prev) => {
                        const arr = Array.isArray(prev) ? prev : [];
                        if (arr.includes(normalized)) return arr;
                        return [...arr, normalized];
                      });
                      setMediaLinkInput('');
                    }}
                    className="inline-flex items-center justify-center px-4 py-3 rounded-2xl bg-white border border-slate-200 text-slate-900 font-black"
                  >
                    Add link
                  </button>
                </div>

                {mediaLinks.length ? (
                  <div className="space-y-2">
                    {mediaLinks.map((u) => (
                      <div key={u} className="flex items-center justify-between gap-3 p-3 rounded-2xl border border-slate-200 bg-white">
                        <a href={u} target="_blank" rel="noreferrer" className="text-xs font-bold text-[#3A3DFF] hover:underline truncate">
                          {u}
                        </a>
                        <button
                          type="button"
                          onClick={() => setMediaLinks((prev) => (Array.isArray(prev) ? prev.filter((x) => x !== u) : []))}
                          className="inline-flex items-center gap-1 text-xs font-black text-slate-700"
                        >
                          <X className="w-4 h-4" />
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-slate-500 font-semibold">No links added.</div>
                )}
              </div>
            </div>

            {/* Live preview */}
            <div className="space-y-2">
              <div className="text-sm font-bold text-slate-700">Live preview</div>
              <MovementCard movement={previewMovement} />
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-black text-slate-900">Claims & evidence (optional)</div>
                  <div className="text-xs text-slate-500 font-semibold">
                    Factual assertions are treated as unverified by default. Evidence is user-submitted and not verified by People Power.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setClaims((prev) => [
                      ...(Array.isArray(prev) ? prev : []),
                      { id: (globalThis.crypto?.randomUUID?.() ?? `claim-${Date.now()}`), text: '', classification: 'opinion', evidence: [] },
                    ])
                  }
                  className="text-xs font-black text-[#3A3DFF]"
                  disabled={!!movementLocks.claims && !isOwnerOrAdmin}
                >
                  + Add claim
                </button>
              </div>

              {fieldErrors.claims ? (
                <div className="text-sm font-semibold text-rose-700">{fieldErrors.claims}</div>
              ) : null}

              {claims.length ? (
                <div className="space-y-3">
                  {claims.map((c, idx) => (
                    <div key={c.id ?? idx} className="p-4 rounded-2xl border border-slate-200 bg-white space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="text-xs font-black text-slate-600 uppercase tracking-wide">Claim {idx + 1}</div>
                        <button
                          type="button"
                          onClick={() => setClaims((prev) => (Array.isArray(prev) ? prev.filter((x) => x !== c) : []))}
                          className="inline-flex items-center gap-1 text-xs font-black text-slate-700"
                        >
                          <X className="w-4 h-4" />
                          Remove
                        </button>
                      </div>

                      <textarea
                        value={String(c?.text ?? '')}
                        onChange={(e) => {
                          const text = e.target.value;
                          setClaims((prev) =>
                            (Array.isArray(prev) ? prev : []).map((x) => (x === c ? { ...x, text } : x))
                          );
                        }}
                        rows={3}
                        placeholder="Write the claim as a single statement."
                        className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-[#FFC947]"
                        disabled={!!movementLocks.claims && !isOwnerOrAdmin}
                      />

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <div className="text-xs font-black text-slate-600">Classification</div>
                          <select
                            value={String(c?.classification ?? 'opinion')}
                            onChange={(e) => {
                              const classification = e.target.value;
                              setClaims((prev) =>
                                (Array.isArray(prev) ? prev : []).map((x) => (x === c ? { ...x, classification } : x))
                              );
                            }}
                            className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-slate-900 bg-white font-semibold"
                          >
                            <option value="opinion">Opinion / value judgment</option>
                            <option value="experience">Personal experience</option>
                            <option value="call_to_action">Call to action</option>
                            <option value="factual">Factual assertion (unverified; evidence optional)</option>
                          </select>
                        </div>

                        <div className="space-y-1">
                          <div className="text-xs font-black text-slate-600">Evidence upload</div>
                          <input
                            type="file"
                            onChange={async (e) => {
                              const file = e.target.files?.[0] ?? null;
                              e.target.value = '';
                              if (!file) return;
                              const MAX_UPLOAD_MB = 5;
                              const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'application/pdf'];
                              if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
                                toast.error(`File too large. Max size is ${MAX_UPLOAD_MB}MB.`);
                                return;
                              }
                              if (!ALLOWED_MIME_TYPES.includes(file.type)) {
                                toast.error('That file type isn’t supported. Please upload an image (JPG/PNG) or PDF.');
                                return;
                              }
                              if (!accessToken) {
                                toast.error('Log in to upload evidence');
                                return;
                              }
                              try {
                                const uploaded = await uploadFile(file, { accessToken });
                                const url = uploaded?.url ? String(uploaded.url) : '';
                                if (!url) throw new Error('Upload succeeded but no URL returned');
                                setClaims((prev) =>
                                  (Array.isArray(prev) ? prev : []).map((x) =>
                                    x === c
                                      ? {
                                          ...x,
                                          evidence: [
                                            ...(Array.isArray(x.evidence) ? x.evidence : []),
                                            {
                                              url,
                                              filename: file.name,
                                              mime: file.type,
                                              size: file.size,
                                            },
                                          ],
                                        }
                                      : x
                                  )
                                );
                              } catch (err) {
                                toast.error(err?.message || 'Failed to upload evidence');
                              }
                            }}
                            className="text-sm font-semibold text-slate-700"
                          />
                          <div className="text-xs text-slate-500 font-semibold">
                            Evidence is user-submitted and not verified by People Power.
                          </div>
                        </div>
                      </div>

                      {Array.isArray(c?.evidence) && c.evidence.length ? (
                        <div className="space-y-2">
                          <div className="text-xs font-black text-slate-600">Evidence</div>
                          <div className="space-y-2">
                            {c.evidence.map((ev, evIdx) => (
                              <div key={evIdx} className="flex items-center justify-between gap-3 p-3 rounded-2xl border border-slate-200 bg-slate-50">
                                <a
                                  href={String(ev?.url || '#')}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-xs font-bold text-[#3A3DFF] hover:underline truncate"
                                >
                                  {String(ev?.filename || ev?.url || 'Evidence')}
                                </a>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setClaims((prev) =>
                                      (Array.isArray(prev) ? prev : []).map((x) =>
                                        x === c
                                          ? {
                                              ...x,
                                              evidence: (Array.isArray(x.evidence) ? x.evidence : []).filter((_, i) => i !== evIdx),
                                            }
                                          : x
                                      )
                                    )
                                  }
                                  className="inline-flex items-center gap-1 text-xs font-black text-slate-700"
                                >
                                  <X className="w-4 h-4" />
                                  Remove
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-slate-500 font-semibold">No claims added.</div>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <label className="block text-sm font-bold text-slate-700">Tags (optional)</label>
                <button
                  type="button"
                  onClick={() => setShowTagOptions((v) => !v)}
                  className="text-xs font-black text-[#3A3DFF]"
                >
                  {showTagOptions ? 'Hide options' : 'Choose tags'}
                </button>
              </div>

              {selectedTags.length ? (
                <div className="flex flex-wrap gap-2">
                  {selectedTags.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setSelectedTags((prev) => prev.filter((x) => x !== t))}
                      className="px-3 py-1 rounded-full border border-slate-200 bg-slate-50 text-slate-700 text-xs font-bold"
                      aria-label={`Remove tag ${t}`}
                    >
                      {TAG_OPTIONS.find((x) => x.id === t)?.label ?? t} ×
                    </button>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-slate-500 font-semibold">Pick from the allowed tags.</div>
              )}

              {showTagOptions ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-2">
                  {TAG_OPTIONS.map((opt) => {
                    const active = selectedTags.includes(opt.id);
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() =>
                          setSelectedTags((prev) =>
                            active ? prev.filter((x) => x !== opt.id) : [...prev, opt.id]
                          )
                        }
                        className={
                          active
                            ? 'px-3 py-2 rounded-2xl border border-slate-200 bg-slate-900 text-white text-xs font-black'
                            : 'px-3 py-2 rounded-2xl border border-slate-200 bg-white text-slate-700 text-xs font-black'
                        }
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>

            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-2">
              <p className="text-xs sm:text-sm text-slate-500 font-semibold">Your movement will appear on the Home feed after creation.</p>
              {backendStatus === 'offline' ? (
                <div className="w-full text-center text-red-500 font-bold py-2">Offline: Cannot create movements while backend is offline.</div>
              ) : backendStatus === 'degraded' ? (
                <div className="w-full text-center text-yellow-600 font-bold py-2">Warning: Backend is degraded, creation may fail.</div>
              ) : null}
              <motion.button
                type="submit"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                disabled={saving || !user || !ackAccepted || backendStatus !== 'healthy'}
                className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-2xl bg-gradient-to-r from-[#3A3DFF] to-[#3A3DFF] text-white font-bold shadow-lg disabled:opacity-70"
              >
                {saving ? (
                  <>
                    <Upload className="w-4 h-4" />
                    Saving…
                  </>
                ) : user ? (ackAccepted ? 'Create movement' : 'Acknowledge to create') : 'Log in to create'}
              </motion.button>
            </div>
          </form>
        </div>
    </div>
  );
}
