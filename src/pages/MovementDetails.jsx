import { fetchMovementLocks, setMovementLock } from '@/api/movementLocksClient';
import { fetchCollaboratorActions } from '@/api/collaboratorActionsClient';
import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { getCurrentBackendStatus, subscribeBackendStatus } from '../utils/backendStatus';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { BadgeCheck, Check, Heart, MapPin, MessageSquare, User as UserIcon, UserPlus, Users, X } from 'lucide-react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';

import { fetchMovementById, deleteMovement, updateMovement } from '@/api/movementsClient';
import { useAuth } from '@/auth/AuthProvider';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { fetchMovementFollowersCount, fetchMyMovementFollow, setMyMovementFollow } from '@/api/movementFollowsClient';
import { listMovementCollaborators } from '@/api/collaboratorsClient';
import { lookupUsers } from '@/api/usersClient';
import { fetchMovementCommentsCount } from '@/api/commentsClient';

import CommentSection from '@/components/details/CommentSection';
import BoostButtons from '@/components/shared/BoostButtons';
import ShareButton from '@/components/shared/ShareButton';
import ReportButton from '@/components/safety/ReportButton';
import ErrorBoundary from '@/components/shared/ErrorBoundary';
import BackButton from '@/components/shared/BackButton';
const PublicImpactReport = React.lazy(() => import('@/components/impact/PublicImpactReport'));
const CreatorDashboard = React.lazy(() => import('@/components/analytics/CreatorDashboard'));
import CollaboratorsList from '@/components/collaboration/CollaboratorsList';
import InviteCollaboratorModal from '@/components/collaboration/InviteCollaboratorModal';
import { fetchMyProfile, fetchPublicProfileByUsername } from '@/api/userProfileClient';
import PollManager from '@/components/collaboration/PollManager';

import {
  createMovementDiscussionMessage,
  createMovementEvidence,
  createMovementImpactUpdate,
  createMovementTask,
  fetchMovementDiscussionsPage,
  fetchMovementEvidencePage,
  fetchMovementImpactUpdatesPage,
  fetchMovementTasksPage,
  updateTask,
  verifyMovementEvidence,
} from '@/api/movementExtrasClient';

import {
  listMovementResourcesPage,
  createMovementResource,
  incrementResourceDownload,
  deleteResource,
} from '@/api/resourcesClient';
import { listMovementEventsPage, createMovementEvent } from '@/api/eventsClient';
import { listMovementPetitionsPage, createMovementPetition } from '@/api/petitionsClient';
import { filterNotifications, upsertNotification } from '@/api/notificationsClient';

import { fetchEventRsvpSummary, setMyEventAttendance, setMyEventRsvp } from '@/api/eventRsvpsClient';
import { fetchPetitionSignatureSummary, signPetition, withdrawPetitionSignature } from '@/api/petitionSignaturesClient';
import { uploadFile } from '@/api/uploadsClient';
import { getServerBaseUrl } from '@/api/serverBase';
import { checkActionAllowed, formatWaitMs } from '@/utils/antiBrigading';
import { logError } from '@/utils/logError';
import { isAdmin as isAdminEmail } from '@/utils/staff';
import { toast } from 'sonner';
import { toastFriendlyError } from '@/utils/toastErrors';
import { getInteractionErrorMessage } from '@/utils/interactionErrors';
import { useFeatureFlag } from '@/utils/featureFlags';
import { getPageCache, setPageCache } from '@/utils/pageCache';
import { queryKeys } from '@/lib/queryKeys';
import {
  ALLOWED_IMAGE_WITH_GIF_MIME_TYPES,
  ALLOWED_UPLOAD_MIME_TYPES,
  MAX_UPLOAD_BYTES,
  validateFileUpload,
} from '@/utils/uploadLimits';

function absolutizeMaybe(url) {
  const s = url ? String(url).trim() : '';
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith('/')) {
    const base = getServerBaseUrl();
    return `${base}${s}`;
  }
  return s;
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function maskEmail(email) {
  const raw = String(email || '').trim();
  if (!raw.includes('@')) return raw;
  const [name, domain] = raw.split('@');
  const prefix = name ? `${name.slice(0, 2)}***` : '***';
  return domain ? `${prefix}@${domain}` : prefix;
}

function formatShortWhen(iso) {
  try {
    const d = iso ? new Date(String(iso)) : null;
    if (!d || Number.isNaN(d.getTime())) return '';
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
}

function guessPreviewType(resource) {
  const mime = resource?.mime_type ? String(resource.mime_type).toLowerCase() : '';
  const url = String(resource?.file_url || resource?.url || '').toLowerCase();

  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf') return 'pdf';
  if (/(\.png|\.jpg|\.jpeg|\.gif|\.webp)$/.test(url)) return 'image';
  if (/\.pdf$/.test(url)) return 'pdf';
  return 'none';
}

function isPastIso(iso) {
  if (!iso) return false;
  try {
    return new Date(iso).getTime() < Date.now();
  } catch {
    return false;
  }
}

function SignInCallout({ action }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-600">
      Please sign in to {action}.
    </div>
  );
}

function EventRsvpControls({ event, movementId, accessToken, myEmail, backendStatus = 'healthy' }) {
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ['eventRsvps', String(event?.id || ''), myEmail],
    enabled: !!event?.id,
    retry: 1,
    queryFn: async () => fetchEventRsvpSummary(event.id, { accessToken: accessToken || undefined }),
  });

  const summary = data?.summary || { going_count: 0, interested_count: 0, attended_count: 0 };
  const myRsvp = data?.my_rsvp || null;

  const rsvpMutation = useMutation({
    mutationFn: async (status) => {
      if (!accessToken) throw new Error('Please log in to RSVP');
      return setMyEventRsvp(event.id, status, { accessToken });
    },
    onSuccess: async (_res, status) => {
      await queryClient.invalidateQueries({ queryKey: ['eventRsvps', String(event?.id || ''), myEmail] });

      const safeStatus = String(status || '').trim();
      if (safeStatus === 'cancel') return;

      if (myEmail && safeStatus === 'going') {
        try {
          const existing = await filterNotifications(
            {
              recipient_email: myEmail,
              type: 'event_reminder',
              content_ref: String(event.id),
            },
            { accessToken }
          );
          if (!Array.isArray(existing) || existing.length === 0) {
            await upsertNotification({
              recipient_email: myEmail,
              type: 'event_reminder',
              actor_name: 'People Power',
              actor_email: null,
              content_id: String(movementId || ''),
              content_ref: String(event.id),
              content_title: `Upcoming event: ${String(event?.title || 'Event')}`,
              created_date: new Date().toISOString(),
              is_read: false,
              starts_at: event?.starts_at ? String(event.starts_at) : null,
            }, { accessToken });
          }
        } catch (e) {
          logError(e, 'Event RSVP reminder notification failed', { movementId });
        }
      }
    },
  });

  const attendanceMutation = useMutation({
    mutationFn: async (attended) => {
      if (!accessToken) throw new Error('Please log in');
      return setMyEventAttendance(event.id, attended, { accessToken });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['eventRsvps', String(event?.id || ''), myEmail] });
    },
  });

  const max = typeof event?.max_attendees === 'number' ? event.max_attendees : null;
  const isPast = isPastIso(event?.starts_at);
  const canMarkAttendance = !!myRsvp && isPast;

  return (
    <div className="mt-3 p-3 rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-black text-slate-600 flex items-center gap-2">
          <Users className="w-4 h-4" />
          <span>
            {summary.going_count} going
            {summary.interested_count ? ` • ${summary.interested_count} interested` : ''}
            {summary.attended_count ? ` • ${summary.attended_count} attended` : ''}
            {max ? ` • ${max} capacity` : ''}
          </span>
        </div>

        {accessToken ? (
          backendStatus === 'offline' ? (
            <div className="text-xs text-red-500 font-bold">Offline: RSVP disabled</div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => rsvpMutation.mutate('going')}
                disabled={rsvpMutation.isPending || backendStatus !== 'healthy'}
                className={`h-9 w-9 rounded-xl border-2 flex items-center justify-center font-black ${
                  myRsvp?.status === 'going'
                    ? 'bg-green-500 border-green-600 text-white'
                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
                title="RSVP going"
              >
                <Check className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => rsvpMutation.mutate('interested')}
                disabled={rsvpMutation.isPending || backendStatus !== 'healthy'}
                className={`h-9 w-9 rounded-xl border-2 flex items-center justify-center font-black ${
                  myRsvp?.status === 'interested'
                    ? 'bg-blue-500 border-blue-600 text-white'
                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
                title="RSVP interested"
              >
                ?
              </button>
              {myRsvp ? (
                <button
                  type="button"
                  onClick={() => rsvpMutation.mutate('cancel')}
                  disabled={rsvpMutation.isPending || backendStatus !== 'healthy'}
                  className="h-9 w-9 rounded-xl border-2 border-slate-200 bg-white text-slate-700 hover:bg-slate-50 flex items-center justify-center"
                  title="Cancel RSVP"
                >
                  <X className="w-4 h-4" />
                </button>
              ) : null}
            </div>
          )
        ) : (
          <div className="text-xs text-slate-500 font-bold">Log in to RSVP</div>
        )}
      </div>

      {canMarkAttendance ? (
        backendStatus === 'offline' ? (
          <div className="text-xs text-red-500 font-bold mt-2">Offline: Attendance marking disabled</div>
        ) : (
          <div className="mt-2 flex items-center justify-between">
            <div className="text-xs text-slate-600 font-bold">
              {myRsvp?.attended ? 'Marked attended' : 'Did you attend?'}
            </div>
            <button
              type="button"
              onClick={() => attendanceMutation.mutate(!myRsvp?.attended)}
              disabled={attendanceMutation.isPending || backendStatus !== 'healthy'}
              className={`px-3 py-2 rounded-xl border text-xs font-black ${
                myRsvp?.attended
                  ? 'border-green-600 bg-green-50 text-green-700'
                  : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50'
              }`}
            >
              {myRsvp?.attended ? 'Unmark' : 'Mark attended'}
            </button>
          </div>
        )
      ) : null}
    </div>
  );
}

function PetitionSignControls({ petition, accessToken, myEmail, backendStatus = 'healthy' }) {
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ['petitionSignatures', String(petition?.id || ''), myEmail],
    enabled: !!petition?.id,
    retry: 1,
    queryFn: async () => fetchPetitionSignatureSummary(petition.id, { accessToken: accessToken || undefined }),
  });

  const summary = data?.summary || { count: 0, velocity_7d: 0, velocity_24h: 0 };
  const mySig = data?.my_signature || null;

  const signMutation = useMutation({
    mutationFn: async () => {
      if (!accessToken) throw new Error('Please log in to sign');

      const rateCheck = await checkActionAllowed({
        email: myEmail ?? null,
        action: 'petition_sign',
        contextId: petition?.id ?? null,
        accessToken,
      });
      if (!rateCheck?.ok) {
        const wait = rateCheck?.retryAfterMs ? ` Try again in ${formatWaitMs(rateCheck.retryAfterMs)}.` : '';
        throw new Error(String(rateCheck?.reason || 'Please slow down.') + wait);
      }

      const comment = window.prompt('Optional comment (leave blank for none):', '') ?? '';
      return signPetition(petition.id, { comment, isPublic: true }, { accessToken });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['petitionSignatures', String(petition?.id || ''), myEmail] });
    },
    onError: (e) => {
      toast.error(getInteractionErrorMessage(e, 'Failed to sign petition'));
    },
  });

  const withdrawMutation = useMutation({
    mutationFn: async () => {
      if (!accessToken) throw new Error('Please log in');
      return withdrawPetitionSignature(petition.id, { accessToken });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['petitionSignatures', String(petition?.id || ''), myEmail] });
    },
    onError: (e) => {
      toast.error(getInteractionErrorMessage(e, 'Failed to withdraw signature'));
    },
  });

  const effectiveBackendStatus = backendStatus || 'healthy';

  return (
    <div className="mt-3 p-3 rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-black text-slate-600 flex items-center gap-2">
          <Users className="w-4 h-4" />
          <span>
            {summary.count} signatures
            {summary.velocity_7d ? ` • ${summary.velocity_7d} last 7d` : ''}
            {summary.velocity_24h ? ` • ${summary.velocity_24h} last 24h` : ''}
          </span>
        </div>
        {accessToken ? (
          effectiveBackendStatus === 'offline' ? (
            <div className="text-xs text-red-500 font-bold">Offline: Petition signing disabled</div>
          ) : mySig ? (
            <button
              type="button"
              onClick={() => withdrawMutation.mutate()}
              disabled={withdrawMutation.isPending || effectiveBackendStatus !== 'healthy'}
              className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-800 text-xs font-black hover:bg-slate-50 disabled:opacity-60"
            >
              Withdraw
            </button>
          ) : (
            <button
              type="button"
              onClick={() => signMutation.mutate()}
              disabled={signMutation.isPending || effectiveBackendStatus !== 'healthy'}
              className="px-3 py-2 rounded-xl bg-slate-900 text-white text-xs font-black hover:opacity-90 disabled:opacity-60"
            >
              Sign
            </button>
          )
        ) : (
          <div className="text-xs text-slate-500 font-bold">Log in to sign</div>
        )}
      </div>
    </div>
  );
}

function normalizeId(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function normalizeEvidenceUrlInput(value) {
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
}

function isEvidenceImage(evidence) {
  const type = String(evidence?.media_type || '').toLowerCase();
  if (type === 'image') return true;
  const mime = String(evidence?.mime_type || '').toLowerCase();
  if (mime.startsWith('image/')) return true;
  const url = String(evidence?.url || '').toLowerCase();
  return /\.(png|jpg|jpeg|gif)$/.test(url);
}

function SectionCard({ title, children }) {
  return (
    <div className="p-5 rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="text-lg font-black text-slate-900">{title}</div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function EmptyState({ children }) {
  return <div className="text-sm text-slate-600 font-semibold">{children}</div>;
}

function Label({ children }) {
  return <div className="text-xs font-black text-slate-600">{children}</div>;
}

function TextInput({ value, onChange, placeholder, type = 'text' }) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full h-11 px-3 rounded-xl border-2 border-slate-200 bg-white text-slate-900 font-semibold outline-none"
    />
  );
}

function TextArea({ value, onChange, placeholder }) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full min-h-24 p-3 rounded-xl border-2 border-slate-200 bg-white text-slate-900 font-semibold outline-none"
    />
  );
}

function formatDate(value) {
  if (!value) return '';
  try {
    const d = new Date(value);
    return d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

function sanitizeRichText(html) {
  const raw = String(html ?? '');
  if (!raw) return '';

  // If it's plain text (no tags), just return escaped via text rendering elsewhere.
  if (!/[<>]/.test(raw)) return raw;

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(raw, 'text/html');

    // Remove dangerous nodes
    doc.querySelectorAll('script, style, iframe, object, embed, link, meta').forEach((n) => n.remove());

    // Strip event handlers and javascript: URLs
    doc.querySelectorAll('*').forEach((el) => {
      [...el.attributes].forEach((attr) => {
        const name = attr.name.toLowerCase();
        const value = String(attr.value || '');
        if (name.startsWith('on')) el.removeAttribute(attr.name);
        if ((name === 'href' || name === 'src') && value.trim().toLowerCase().startsWith('javascript:')) {
          el.removeAttribute(attr.name);
        }
      });
    });

    return doc.body.innerHTML || '';
  } catch {
    // Fallback: remove tags
    return raw.replace(/<[^>]*>/g, '');
  }
}

export default function MovementDetails() {
  const { user, session, isAdmin } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { id } = useParams();
  const movementId = useMemo(() => normalizeId(id), [id]);
  const accessToken = session?.access_token ? String(session.access_token) : null;

  const [backendStatus, setBackendStatus] = useState(getCurrentBackendStatus());
  const [offlineMovement, setOfflineMovement] = useState(null);
  const [showOfflineLabel, setShowOfflineLabel] = useState(false);

  const movementCacheKey = useMemo(
    () => (movementId ? `pp_movement_details_v1:${encodeURIComponent(String(movementId))}` : null),
    [movementId]
  );

  // Listen for backend status changes
  useEffect(() => {
    const unsub = subscribeBackendStatus(setBackendStatus);
    return () => unsub();
  }, []);

  const [organizerToolsOpen, setOrganizerToolsOpen] = useState(false);
  const [deleteMovementOpen, setDeleteMovementOpen] = useState(false);
  const [deletingMovement, setDeletingMovement] = useState(false);
  const [resourceToDelete, setResourceToDelete] = useState(null);
  const [editMovementOpen, setEditMovementOpen] = useState(false);
  const [editMovementSaving, setEditMovementSaving] = useState(false);
  const [editForm, setEditForm] = useState({
    title: '',
    summary: '',
    description: '',
    tags: '',
    location_city: '',
    location_country: '',
    media_urls: '',
  });

  const myEmail = String(user?.email || '').trim().toLowerCase();
  const userId = user?.id || user?.email || null;
  const { enabled: petitionsEnabled } = useFeatureFlag('petitions', userId);
  const { enabled: donationsEnabled } = useFeatureFlag('donations', userId);
  const { enabled: creatorAnalyticsEnabled } = useFeatureFlag('creator_analytics_dashboard', userId);
  const allowOfflineMovementCache = !!import.meta?.env?.DEV;

  const {
    data: movementData,
    isLoading: isMovementLoading,
    isError: isMovementError,
    error: movementError,
    refetch,
  } = useQuery({
    queryKey: queryKeys.movements.detail(movementId),
    enabled: !!movementId,
    retry: 1,
    queryFn: async () => {
      if (!movementId) return null;
      const m = await fetchMovementById(movementId, { accessToken });
      // Cache compact movement details on success
      if (allowOfflineMovementCache && m && movementCacheKey) {
        try {
          const compact = {
            id: m.id,
            title: m.title,
            summary: m.summary,
            description: m.description,
            tags: m.tags,
            author_email: m.author_email,
            creator_display_name: m.creator_display_name,
            creator_username: m.creator_username,
            city: m.city,
            country: m.country,
            momentum_score: m.momentum_score,
            upvotes: m.upvotes,
            downvotes: m.downvotes,
            score: m.score,
            created_at: m.created_at,
            updated_at: m.updated_at,
          };
          setPageCache(movementCacheKey, compact);
        } catch {
          // Ignore cache write failures (storage disabled or full).
        }
      }
      return m;
    },
  });

  // Load from cache only when truly offline.
  // (When degraded or errored, show the error state rather than silently falling back.)
  useEffect(() => {
    if (!allowOfflineMovementCache) {
      setOfflineMovement(null);
      setShowOfflineLabel(false);
      return;
    }
    if (backendStatus === 'offline' && movementCacheKey) {
      try {
        const cached = getPageCache(movementCacheKey);
        if (cached) {
          setOfflineMovement(cached);
          setShowOfflineLabel(true);
          return;
        }
      } catch {
        // Ignore cache read failures.
      }
    }

    setOfflineMovement(null);
    setShowOfflineLabel(false);
  }, [backendStatus, movementCacheKey, allowOfflineMovementCache]);

  // Prefer last-known-good data when offline.
  const movement = (allowOfflineMovementCache && offlineMovement) ? offlineMovement : movementData;

  useEffect(() => {
    const currentMovement = (allowOfflineMovementCache && offlineMovement) ? offlineMovement : movementData;
    if (!currentMovement) return;
    const tagsArray = Array.isArray(currentMovement?.tags) ? currentMovement.tags : [];
    const tagsText = tagsArray.map((t) => String(t).trim()).filter(Boolean).join(', ');
    const mediaUrls = Array.isArray(currentMovement?.media_urls) ? currentMovement.media_urls : [];
    setEditForm({
      title: String(currentMovement?.title || currentMovement?.name || ''),
      summary: String(currentMovement?.summary || ''),
      description: String(currentMovement?.description || ''),
      tags: tagsText,
      location_city: String(currentMovement?.location_city || currentMovement?.city || ''),
      location_country: String(currentMovement?.location_country || currentMovement?.country || ''),
      media_urls: mediaUrls.map((u) => String(u)).filter(Boolean).join('\n'),
    });
  }, [offlineMovement, movementData, allowOfflineMovementCache]);

  // Note: avoid early returns before hooks; render an early view at the end instead.
  const earlyView = !movementId ? (
    <div className="max-w-4xl mx-auto px-3 sm:px-4 py-10 sm:py-12 space-y-6">
      <BackButton />
      <div className="p-6 rounded-2xl border border-slate-200 bg-white shadow-sm space-y-2">
        <h1 className="text-2xl font-black text-slate-900">Movement not found</h1>
        <p className="text-slate-600 font-semibold">
          This movement could not be found or is temporarily unavailable.
        </p>
      </div>
    </div>
  ) : isMovementLoading && !movement ? (
    <div className="max-w-4xl mx-auto px-3 sm:px-4 py-10 sm:py-12 space-y-6">
      <BackButton />
      <div className="p-6 rounded-2xl border border-slate-200 bg-slate-50 text-slate-700">
        <div className="font-black text-slate-900">Loading movement…</div>
        <div className="text-sm text-slate-600 font-semibold mt-1">Please wait.</div>
      </div>
    </div>
  ) : isMovementError && !movement ? (
    <div className="max-w-4xl mx-auto px-3 sm:px-4 py-10 sm:py-12 space-y-6">
      <BackButton />
      <div className="p-6 rounded-2xl border border-slate-200 bg-white shadow-sm space-y-3">
        <h1 className="text-2xl font-black text-slate-900">Couldn’t load movement</h1>
        <p className="text-slate-600 font-semibold">We couldn’t load this movement. Please try again.</p>
        <button
          onClick={() => refetch()}
          className="inline-flex items-center justify-center px-4 py-2 rounded-xl bg-[#3A3DFF] text-white font-black hover:opacity-90"
        >
          Retry
        </button>
      </div>
    </div>
  ) : !movement ? (
    <div className="max-w-4xl mx-auto px-3 sm:px-4 py-10 sm:py-12 space-y-6">
      <BackButton />
      <div className="p-6 rounded-2xl border border-slate-200 bg-white shadow-sm space-y-2">
        <h1 className="text-2xl font-black text-slate-900">Movement not found</h1>
        <p className="text-slate-600 font-semibold">
          This movement could not be found or may have been removed.
        </p>
      </div>
    </div>
  ) : null;

  const title = String(movement?.title || movement?.name || 'Untitled movement');
  const description = String(movement?.description_html || movement?.description || movement?.summary || '');
  const tags = Array.isArray(movement?.tags) ? movement.tags : [];
  const ownerEmail = movement?.author_email ? String(movement.author_email) : '';
  const ownerDisplayName = String(
    movement?.creator_display_name ||
    movement?.author_display_name ||
    movement?.author_name ||
    ''
  ).trim();
  const safeOwnerDisplayName = ownerDisplayName && !ownerDisplayName.includes('@') ? ownerDisplayName : '';
  const ownerUsername = String(
    movement?.creator_username ||
    movement?.author_username ||
    ''
  ).trim();
  const safeOwnerUsername = ownerUsername && !ownerUsername.includes('@') ? ownerUsername : '';
  const ownerLabel = safeOwnerDisplayName || (safeOwnerUsername ? `@${safeOwnerUsername}` : 'Unknown author');
  const ownerProfilePath = safeOwnerUsername ? `/u/${encodeURIComponent(safeOwnerUsername)}` : null;
  const ownerIsAdmin = ownerEmail ? isAdminEmail(ownerEmail) : false;
  const canDelete = !!(user?.email && ownerEmail && String(user.email) === ownerEmail);
  const canModerate = !!((myEmail && ownerEmail && myEmail === String(ownerEmail).toLowerCase()) || isAdmin);
  const isOwner = !!(myEmail && ownerEmail && myEmail === String(ownerEmail).toLowerCase());

  const [movementLocks, setMovementLocks] = useState({});
  const [locksLoading, setLocksLoading] = useState(false);
  const [locksError, setLocksError] = useState(null);
  useEffect(() => {
    if (!(isOwner || isAdmin) || !movementId) return;
    setLocksLoading(true);
    fetchMovementLocks(movementId, { accessToken })
      .then(setMovementLocks)
      .catch((e) => setLocksError(e))
      .finally(() => setLocksLoading(false));
  }, [isOwner, isAdmin, movementId, accessToken]);

  const handleLockToggle = async (field, locked) => {
    if (!movementId) return;
    setLocksLoading(true);
    try {
      const res = await setMovementLock(movementId, field, locked, { accessToken });
      setMovementLocks(res.locks || {});
    } catch (e) {
      setLocksError(e);
    } finally {
      setLocksLoading(false);
    }
  };

  const handleMovementUpdate = async () => {
    if (!movementId) return;
    if (!accessToken) {
      toast.error('Please sign in to edit this movement.');
      return;
    }
    const title = String(editForm.title || '').trim();
    if (!title) {
      toast.error('Title is required.');
      return;
    }
    const tags = String(editForm.tags || '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    const mediaUrls = String(editForm.media_urls || '')
      .split('\n')
      .map((t) => t.trim())
      .filter(Boolean);

    const payload = {
      title,
      summary: editForm.summary ? String(editForm.summary) : null,
      description: editForm.description ? String(editForm.description) : null,
      tags,
      location_city: editForm.location_city ? String(editForm.location_city) : null,
      location_country: editForm.location_country ? String(editForm.location_country) : null,
      media_urls: mediaUrls.length ? mediaUrls : null,
    };

    try {
      setEditMovementSaving(true);
      const updated = await updateMovement(movementId, payload, { accessToken });
      queryClient.setQueryData(queryKeys.movements.detail(movementId), updated);
      queryClient.invalidateQueries({ queryKey: ['movements'] });
      setEditMovementOpen(false);
      toast.success('Movement updated.');
    } catch (err) {
      logError(err, 'Failed to update movement');
      toastFriendlyError(err, 'Failed to update movement');
    } finally {
      setEditMovementSaving(false);
    }
  };

  // Collaborator activity log (owner/admin only)
  const [activityOpen, setActivityOpen] = useState(false);
  const [activityLog, setActivityLog] = useState([]);
  const [activityLoading, setActivityLoading] = useState(false);
  useEffect(() => {
    if ((isOwner || isAdmin) && movementId && activityOpen) {
      setActivityLoading(true);
      fetchCollaboratorActions(movementId, { accessToken })
        .then(setActivityLog)
        .catch(() => setActivityLog([]))
        .finally(() => setActivityLoading(false));
    }
  }, [isOwner, isAdmin, movementId, activityOpen, accessToken]);

  // Show lock state for all users
  const isTitleLocked = !!movementLocks.title;
  const isDescriptionLocked = !!movementLocks.description;
  const isClaimsLocked = !!movementLocks.claims;

  const createdAt = movement?.created_at || movement?.created_date || movement?.createdAt || null;

  const verifiedParticipants = typeof movement?.verified_participants === 'number' ? movement.verified_participants : null;
  const unverifiedParticipants = typeof movement?.unverified_participants === 'number' ? movement.unverified_participants : null;
  const supporters = typeof movement?.supporters === 'number' ? movement.supporters : null;

  const locationCity =
    (movement?.location && typeof movement.location === 'object' && movement.location?.city)
      ? String(movement.location.city)
      : (movement?.city ? String(movement.city) : (typeof movement?.location === 'string' ? String(movement.location) : ''));

  const {
    data: followState,
  } = useQuery({
    queryKey: ['movementFollow', movementId],
    enabled: !!movementId && !!accessToken,
    queryFn: async () => fetchMyMovementFollow(movementId, { accessToken }),
    retry: 1,
  });

  const followMutation = useMutation({
    mutationFn: async (nextFollowing) => {
      if (!accessToken) throw new Error('Please log in to follow');

      if (nextFollowing) {
        const rateCheck = await checkActionAllowed({
          email: myEmail ?? null,
          action: 'movement_follow',
          contextId: movementId,
          accessToken,
        });
        if (!rateCheck?.ok) {
          const wait = rateCheck?.retryAfterMs ? ` Try again in ${formatWaitMs(rateCheck.retryAfterMs)}.` : '';
          throw new Error(String(rateCheck?.reason || 'Please slow down.') + wait);
        }
      }

      return setMyMovementFollow(movementId, !!nextFollowing, { accessToken });
    },
    onSuccess: (next, nextFollowing) => {
      queryClient.setQueryData(['movementFollow', movementId], next);

      if (next && typeof next.followers_count === 'number') {
        queryClient.setQueryData(queryKeys.movements.followersCount(movementId), next.followers_count);

        queryClient.setQueryData(queryKeys.movements.detail(movementId), (old) => {
          if (!old || typeof old !== 'object') return old;
          return { ...old, followers_count: next.followers_count };
        });

        queryClient.setQueriesData({ queryKey: ['movements'] }, (old) => {
          const patchMovement = (m) => {
            if (!m || typeof m !== 'object') return m;
            const mid = String(m?.id ?? m?._id ?? '').trim();
            if (!mid || mid !== String(movementId)) return m;
            return { ...m, followers_count: next.followers_count };
          };

          if (old && typeof old === 'object' && Array.isArray(old.pages)) {
            return {
              ...old,
              pages: old.pages.map((page) => (Array.isArray(page) ? page.map(patchMovement) : page)),
            };
          }

          if (Array.isArray(old)) return old.map(patchMovement);
          return old;
        });
      }

      // Best-effort activity item (for creators/admins) when someone follows this movement.
      try {
        const justFollowed = !!nextFollowing && !following;
        if (justFollowed && ownerEmail && myEmail && movementId && myEmail !== String(ownerEmail).toLowerCase()) {
          const actorName =
            (userProfile?.display_name ? String(userProfile.display_name).trim() : '') ||
            (userProfile?.username ? `@${String(userProfile.username).trim()}` : null);
          upsertNotification({
            recipient_email: String(ownerEmail).trim().toLowerCase(),
            type: 'movement_follow',
            actor_name: actorName,
            actor_email: String(myEmail).trim().toLowerCase(),
            content_id: String(movementId),
            content_ref: null,
            content_title: String(movement?.title || movement?.name || '').trim() || null,
            created_date: new Date().toISOString(),
            is_read: false,
            metadata: null,
          }).catch(() => {});
        }
      } catch {
        // best-effort
      }
    },
    onError: (e) => {
      toast.error(getInteractionErrorMessage(e, 'Failed to update follow'));
    },
  });

  const following = !!followState?.following;
  const followersCount = typeof followState?.followers_count === 'number' ? followState.followers_count : null;

  const { data: followersCountPublic } = useQuery({
    queryKey: queryKeys.movements.followersCount(movementId),
    enabled: !!movementId,
    retry: 1,
    staleTime: 30 * 1000,
    queryFn: async () => fetchMovementFollowersCount(movementId),
  });

  const { data: commentsCount } = useQuery({
    queryKey: queryKeys.movements.commentsCount(movementId),
    enabled: !!movementId,
    retry: 1,
    staleTime: 30 * 1000,
    queryFn: async () => fetchMovementCommentsCount(movementId),
  });

  const boostsCount = useMemo(() => {
    const v = movement?.boosts_count ?? movement?.upvotes ?? movement?.boosts;
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }, [movement]);

  const displayedFollowersCount = typeof followersCount === 'number'
    ? followersCount
    : (typeof followersCountPublic === 'number' ? followersCountPublic : 0);

  const { data: recentActivity = [] } = useQuery({
    queryKey: queryKeys.movements.engagementActivity(movementId, ownerEmail),
    enabled: !!movementId && !!ownerEmail && (isOwner || isAdmin),
    retry: 0,
    staleTime: 10 * 1000,
    queryFn: async () => {
      if (!accessToken) return [];
      const list = await filterNotifications(
        {
          recipient_email: String(ownerEmail).trim().toLowerCase(),
          content_id: String(movementId),
        },
        { accessToken }
      );
      const allowed = new Set(['movement_boost', 'comment', 'movement_follow']);
      return (Array.isArray(list) ? list : [])
        .filter((n) => allowed.has(String(n?.type || '')))
        .sort((a, b) => String(b?.created_date || '').localeCompare(String(a?.created_date || '')))
        .slice(0, 25);
    },
  });

  const safeHtml = sanitizeRichText(description);
  const shouldRenderHtml = /<[^>]+>/.test(String(description || ''));

  const reportMovement = useMemo(() => {
    if (!movement) return null;
    const descText = shouldRenderHtml
      ? String(safeHtml || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
      : String(description || '');
    return {
      ...movement,
      title,
      description: descText,
      created_date: createdAt || movement?.created_date || movement?.created_at || movement?.createdAt || null,
    };
  }, [movement, title, description, shouldRenderHtml, safeHtml, createdAt]);

  const currentUserForCollab = useMemo(() => {
    if (!user?.email) return null;
    const emailLocal = String(user.email).split('@')[0] || null;
    return {
      email: String(user.email),
      full_name: emailLocal,
    };
  }, [user]);

  const [inviteOpen, setInviteOpen] = useState(false);

  const {
    data: resourcesPages,
    isLoading: resourcesLoading,
    isError: resourcesError,
    error: resourcesErrorObj,
    refetch: refetchResources,
    fetchNextPage: fetchNextResourcesPage,
    hasNextPage: hasNextResourcesPage,
    isFetchingNextPage: isFetchingNextResourcesPage,
  } = useInfiniteQuery({
    queryKey: ['resources', movementId],
    enabled: !!movementId,
    initialPageParam: 0,
    queryFn: ({ pageParam = 0 }) =>
      listMovementResourcesPage(movementId, {
        limit: 10,
        offset: pageParam,
        fields: [
          'id',
          'movement_id',
          'title',
          'url',
          'file_url',
          'file_name',
          'mime_type',
          'file_size',
          'category',
          'description',
          'download_count',
          'created_by_email',
          'created_at',
        ],
      }),
    getNextPageParam: (lastPage, pages) => {
      const list = Array.isArray(lastPage) ? lastPage : [];
      if (list.length < 10) return undefined;
      return pages.length * 10;
    },
    retry: 1,
  });

  const resources = useMemo(() => {
    const pages = Array.isArray(resourcesPages?.pages) ? resourcesPages.pages : [];
    return pages.flatMap((p) => (Array.isArray(p) ? p : []));
  }, [resourcesPages]);

  const {
    data: evidencePages,
    isLoading: evidenceLoading,
    isError: evidenceError,
    error: evidenceErrorObj,
    refetch: refetchEvidence,
    fetchNextPage: fetchNextEvidencePage,
    hasNextPage: hasNextEvidencePage,
    isFetchingNextPage: isFetchingNextEvidencePage,
  } = useInfiniteQuery({
    queryKey: ['movementEvidence', movementId],
    enabled: !!movementId,
    initialPageParam: 0,
    queryFn: ({ pageParam = 0 }) =>
      fetchMovementEvidencePage(movementId, {
        limit: 8,
        offset: pageParam,
        status: 'approved',
      }),
    getNextPageParam: (lastPage, pages) => {
      const list = Array.isArray(lastPage) ? lastPage : [];
      if (list.length < 8) return undefined;
      return pages.length * 8;
    },
    retry: 1,
  });

  const evidence = useMemo(() => {
    const pages = Array.isArray(evidencePages?.pages) ? evidencePages.pages : [];
    return pages.flatMap((p) => (Array.isArray(p) ? p : []));
  }, [evidencePages]);

  const { data: collaboratorRecords = [] } = useQuery({
    queryKey: ['movementCollaborators', movementId, myEmail],
    enabled: !!movementId && !!accessToken,
    queryFn: async () => {
      return await listMovementCollaborators(movementId, { accessToken });
    },
    retry: 1,
    onError: (e) => {
      toastFriendlyError(e, 'Failed to load collaborators');
    },
  });

  const myCollaboratorRole = useMemo(() => {
    if (!myEmail) return null;
    const record = Array.isArray(collaboratorRecords)
      ? collaboratorRecords.find((c) => String(c?.user_email || '').trim().toLowerCase() === myEmail)
      : null;
    return record?.role ? String(record.role).toLowerCase() : null;
  }, [collaboratorRecords, myEmail]);

  const canReviewEvidence =
    isOwner || isAdmin || myCollaboratorRole === 'admin' || myCollaboratorRole === 'editor';

  const {
    data: pendingEvidence = [],
    isLoading: pendingEvidenceLoading,
    isError: pendingEvidenceError,
    error: pendingEvidenceErrorObj,
    refetch: refetchPendingEvidence,
  } = useQuery({
    queryKey: ['movementEvidencePending', movementId],
    enabled: !!movementId && !!accessToken && canReviewEvidence,
    queryFn: async () =>
      fetchMovementEvidencePage(movementId, {
        limit: 50,
        offset: 0,
        status: 'pending',
        accessToken,
      }),
    retry: 1,
  });

  const {
    data: approvedEvidenceForGroup = [],
    isLoading: groupEvidenceLoading,
  } = useQuery({
    queryKey: ['movementEvidenceApprovedForGroup', movementId],
    enabled: !!movementId && !!accessToken && isOwner,
    queryFn: async () =>
      fetchMovementEvidencePage(movementId, {
        limit: 200,
        offset: 0,
        status: 'approved',
        accessToken,
        fields: ['id', 'submitter_email', 'submitter_user_id'],
      }),
    retry: 1,
  });

  const { verifiedParticipantEmails, verifiedParticipantUserIds } = useMemo(() => {
    const list = Array.isArray(approvedEvidenceForGroup) ? approvedEvidenceForGroup : [];
    const emails = list.map((ev) => normalizeEmail(ev?.submitter_email)).filter(Boolean);
    const userIds = list
      .map((ev) => (ev?.submitter_user_id ? String(ev.submitter_user_id).trim() : ''))
      .filter(Boolean);
    const uniqueEmails = Array.from(new Set(emails));
    const uniqueUserIds = Array.from(new Set(userIds));
    return {
      verifiedParticipantEmails: ownerEmail ? uniqueEmails.filter((e) => e !== normalizeEmail(ownerEmail)) : uniqueEmails,
      verifiedParticipantUserIds: uniqueUserIds,
    };
  }, [approvedEvidenceForGroup, ownerEmail]);

  const { data: verifiedParticipantProfiles = [] } = useQuery({
    queryKey: [
      'movementVerifiedParticipantProfiles',
      verifiedParticipantUserIds.join('|'),
      verifiedParticipantEmails.join('|'),
    ],
    enabled: (verifiedParticipantUserIds.length > 0 || verifiedParticipantEmails.length > 0) && !!accessToken && isOwner,
    queryFn: async () => lookupUsers({ userIds: verifiedParticipantUserIds, emails: verifiedParticipantEmails }, { accessToken }),
    retry: 1,
  });

  const verifiedProfileMap = useMemo(() => {
    const map = new Map();
    const list = Array.isArray(verifiedParticipantProfiles) ? verifiedParticipantProfiles : [];
    for (const profile of list) {
      const email = normalizeEmail(profile?.email || profile?.user_email);
      const userId = profile?.user_id ? String(profile.user_id).trim() : '';
      if (userId) map.set(userId, profile);
      if (email) map.set(email, profile);
    }
    return map;
  }, [verifiedParticipantProfiles]);

  const {
    data: eventsPages,
    isLoading: eventsLoading,
    isError: eventsError,
    error: eventsErrorObj,
    refetch: refetchEvents,
    fetchNextPage: fetchNextEventsPage,
    hasNextPage: hasNextEventsPage,
    isFetchingNextPage: isFetchingNextEventsPage,
  } = useInfiniteQuery({
    queryKey: ['events', movementId],
    enabled: !!movementId,
    initialPageParam: 0,
    queryFn: ({ pageParam = 0 }) =>
      listMovementEventsPage(movementId, {
        limit: 20,
        offset: pageParam,
        fields: [
          'id',
          'movement_id',
          'title',
          'starts_at',
          'location',
          'url',
          'virtual_link',
          'max_attendees',
          'description',
          'created_at',
        ],
      }),
    getNextPageParam: (lastPage, pages) => {
      const list = Array.isArray(lastPage) ? lastPage : [];
      if (list.length < 20) return undefined;
      return pages.length * 20;
    },
    retry: 1,
  });

  const events = useMemo(() => {
    const pages = Array.isArray(eventsPages?.pages) ? eventsPages.pages : [];
    return pages.flatMap((p) => (Array.isArray(p) ? p : []));
  }, [eventsPages]);
  const {
    data: petitionsPages,
    isLoading: petitionsLoading,
    isError: petitionsError,
    error: petitionsErrorObj,
    refetch: refetchPetitions,
    fetchNextPage: fetchNextPetitionsPage,
    hasNextPage: hasNextPetitionsPage,
    isFetchingNextPage: isFetchingNextPetitionsPage,
  } = useInfiniteQuery({
    queryKey: ['petitions', movementId],
    enabled: !!movementId && petitionsEnabled,
    initialPageParam: 0,
    queryFn: ({ pageParam = 0 }) =>
      listMovementPetitionsPage(movementId, {
        limit: 20,
        offset: pageParam,
        fields: ['id', 'movement_id', 'title', 'url', 'goal_signatures', 'created_at'],
      }),
    getNextPageParam: (lastPage, pages) => {
      const list = Array.isArray(lastPage) ? lastPage : [];
      if (list.length < 20) return undefined;
      return pages.length * 20;
    },
    retry: 1,
  });

  const petitions = useMemo(() => {
    const pages = Array.isArray(petitionsPages?.pages) ? petitionsPages.pages : [];
    return pages.flatMap((p) => (Array.isArray(p) ? p : []));
  }, [petitionsPages]);
  const {
    data: impactPages,
    isLoading: impactLoading,
    isError: impactError,
    error: impactErrorObj,
    refetch: refetchImpact,
    fetchNextPage: fetchNextImpactPage,
    hasNextPage: hasNextImpactPage,
    isFetchingNextPage: isFetchingNextImpactPage,
  } = useInfiniteQuery({
    queryKey: ['movementImpact', movementId],
    enabled: !!movementId,
    initialPageParam: 0,
    queryFn: ({ pageParam = 0 }) =>
      fetchMovementImpactUpdatesPage(movementId, {
        limit: 10,
        offset: pageParam,
        fields: ['id', 'movement_id', 'title', 'content', 'created_by_email', 'created_at'],
      }),
    getNextPageParam: (lastPage, pages) => {
      const list = Array.isArray(lastPage) ? lastPage : [];
      if (list.length < 10) return undefined;
      return pages.length * 10;
    },
    retry: 1,
  });

  const impactUpdates = useMemo(() => {
    const pages = Array.isArray(impactPages?.pages) ? impactPages.pages : [];
    return pages.flatMap((p) => (Array.isArray(p) ? p : []));
  }, [impactPages]);

  useEffect(() => {
    if (isMovementError && movementError) {
      logError(movementError, 'Failed to load movement', { movementId });
    }
  }, [isMovementError, movementError, movementId]);

  useEffect(() => {
    if (resourcesError && resourcesErrorObj) logError(resourcesErrorObj, 'Movement resources load failed', { movementId });
  }, [resourcesError, resourcesErrorObj, movementId]);

  useEffect(() => {
    if (evidenceError && evidenceErrorObj) logError(evidenceErrorObj, 'Movement evidence load failed', { movementId });
  }, [evidenceError, evidenceErrorObj, movementId]);

  useEffect(() => {
    if (pendingEvidenceError && pendingEvidenceErrorObj) {
      logError(pendingEvidenceErrorObj, 'Movement evidence pending load failed', { movementId });
    }
  }, [pendingEvidenceError, pendingEvidenceErrorObj, movementId]);

  useEffect(() => {
    if (eventsError && eventsErrorObj) logError(eventsErrorObj, 'Movement events load failed', { movementId });
  }, [eventsError, eventsErrorObj, movementId]);

  useEffect(() => {
    if (petitionsError && petitionsErrorObj) logError(petitionsErrorObj, 'Movement petitions load failed', { movementId });
  }, [petitionsError, petitionsErrorObj, movementId]);

  useEffect(() => {
    if (impactError && impactErrorObj) logError(impactErrorObj, 'Movement impact updates load failed', { movementId });
  }, [impactError, impactErrorObj, movementId]);
  const {
    data: tasksPages,
    isLoading: tasksLoading,
    fetchNextPage: fetchNextTasksPage,
    hasNextPage: hasNextTasksPage,
    isFetchingNextPage: isFetchingNextTasksPage,
  } = useInfiniteQuery({
    queryKey: ['movementTasks', movementId],
    enabled: !!movementId,
    initialPageParam: 0,
    queryFn: ({ pageParam = 0 }) =>
      fetchMovementTasksPage(movementId, {
        limit: 12,
        offset: pageParam,
        fields: [
          'id',
          'movement_id',
          'title',
          'description',
          'status',
          'assigned_to_email',
          'assigned_to_user_id',
          'created_by_email',
          'created_by_user_id',
          'created_at',
          'updated_at',
        ],
      }),
    getNextPageParam: (lastPage, pages) => {
      const list = Array.isArray(lastPage) ? lastPage : [];
      if (list.length < 12) return undefined;
      return pages.length * 12;
    },
    retry: 1,
  });

  const tasks = useMemo(() => {
    const pages = Array.isArray(tasksPages?.pages) ? tasksPages.pages : [];
    return pages.flatMap((p) => (Array.isArray(p) ? p : []));
  }, [tasksPages]);

  const {
    data: discussionsPages,
    isLoading: discussionsLoading,
    fetchNextPage: fetchNextDiscussionsPage,
    hasNextPage: hasNextDiscussionsPage,
    isFetchingNextPage: isFetchingNextDiscussionsPage,
  } = useInfiniteQuery({
    queryKey: ['movementDiscussions', movementId],
    enabled: !!movementId,
    initialPageParam: 0,
    queryFn: ({ pageParam = 0 }) =>
      fetchMovementDiscussionsPage(movementId, {
        limit: 12,
        offset: pageParam,
        fields: ['id', 'movement_id', 'author_email', 'author_user_id', 'message', 'created_at'],
      }),
    getNextPageParam: (lastPage, pages) => {
      const list = Array.isArray(lastPage) ? lastPage : [];
      if (list.length < 12) return undefined;
      return pages.length * 12;
    },
    retry: 1,
  });

  const discussions = useMemo(() => {
    const pages = Array.isArray(discussionsPages?.pages) ? discussionsPages.pages : [];
    return pages.flatMap((p) => (Array.isArray(p) ? p : []));
  }, [discussionsPages]);

  const [discussionAuthors, setDiscussionAuthors] = useState({ byEmail: {}, byUserId: {} });

  useEffect(() => {
    let cancelled = false;
    async function loadAuthorProfiles() {
      if (!accessToken) return;
      const userIds = Array.from(
        new Set(
          (Array.isArray(discussions) ? discussions : [])
            .map((m) => (m?.author_user_id ? String(m.author_user_id).trim() : ''))
            .filter(Boolean)
        )
      );
      const emails = Array.from(new Set((Array.isArray(discussions) ? discussions : []).map((m) => String(m?.author_email || '').trim().toLowerCase()).filter(Boolean)));
      if (!userIds.length && !emails.length) return;
      try {
        const users = await lookupUsers({ userIds, emails }, { accessToken });
        if (cancelled) return;
        const nextByEmail = {};
        const nextByUserId = {};
        for (const u of Array.isArray(users) ? users : []) {
          const email = String(u?.email || '').trim().toLowerCase();
          const userId = u?.user_id ? String(u.user_id).trim() : '';
          const record = {
            display_name: u?.display_name ?? null,
            username: u?.username ?? null,
          };
          if (email) nextByEmail[email] = record;
          if (userId) nextByUserId[userId] = record;
        }
        setDiscussionAuthors({ byEmail: nextByEmail, byUserId: nextByUserId });
      } catch {
        if (!cancelled) setDiscussionAuthors({ byEmail: {}, byUserId: {} });
      }
    }
    loadAuthorProfiles();
    return () => {
      cancelled = true;
    };
  }, [accessToken, discussions]);

  const acceptedCollaborators = useMemo(() => {
    const list = Array.isArray(collaboratorRecords) ? collaboratorRecords : [];
    return list.filter((c) => String(c?.status || '').toLowerCase() === 'accepted');
  }, [collaboratorRecords]);

  const isLoggedIn = !!accessToken;
  const isCollaborator = useMemo(() => {
    if (!myEmail) return false;
    if (!Array.isArray(acceptedCollaborators)) return false;
    return acceptedCollaborators.some((c) => String(c?.user_email || '').trim().toLowerCase() === myEmail);
  }, [acceptedCollaborators, myEmail]);

  const isTeamMember = isLoggedIn && (isOwner || isAdmin || isCollaborator);

  useEffect(() => {
    if (!isTeamMember) return;
    if (location?.hash !== '#collaborators') return;

    setOrganizerToolsOpen(true);

    const t = window.setTimeout(() => {
      const el = document.getElementById('collaborators');
      if (el && typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 0);

    return () => window.clearTimeout(t);
  }, [isTeamMember, location?.hash]);

  const { data: userProfile = null } = useQuery({
    queryKey: queryKeys.userProfile.me(myEmail),
    enabled: !!accessToken,
    retry: 0,
    queryFn: async () => {
      return await fetchMyProfile({ accessToken });
    },
    onError: (e) => {
      toastFriendlyError(e, 'Failed to load your profile');
    },
  });

  const aiOptIn = useMemo(() => {
    if (!myEmail) return false;
    if (userProfile && typeof userProfile === 'object' && 'ai_features_enabled' in userProfile) {
      return !!userProfile.ai_features_enabled;
    }
    if (!import.meta?.env?.DEV) return false;
    try {
      return localStorage.getItem('peoplepower_ai_opt_in') === 'true';
    } catch {
      return false;
    }
  }, [myEmail, userProfile]);

  const impactSummary = useMemo(() => {
    const totalParticipants =
      typeof movement?.verified_participants === 'number' ? movement.verified_participants : 0;
    const totalResourceDownloads = Array.isArray(resources)
      ? resources.reduce((sum, r) => sum + (typeof r?.download_count === 'number' ? r.download_count : 0), 0)
      : 0;

    return {
      momentum: typeof movement?.momentum_score === 'number' ? movement.momentum_score : 0,
      boosts:
        typeof movement?.boosts_count === 'number'
          ? movement.boosts_count
          : (typeof movement?.upvotes === 'number'
              ? movement.upvotes
              : (typeof movement?.boosts === 'number' ? movement.boosts : 0)),
      supporters: typeof movement?.supporters === 'number' ? movement.supporters : (supporters ?? 0),
      participants: totalParticipants,
      events: Array.isArray(events) ? events.length : 0,
      petitions: Array.isArray(petitions) ? petitions.length : 0,
      resources: Array.isArray(resources) ? resources.length : 0,
      resourceDownloads: totalResourceDownloads,
    };
  }, [movement, resources, events, petitions, supporters]);

  const [resourceTitle, setResourceTitle] = useState('');
  const [resourceUrl, setResourceUrl] = useState('');
  const [resourceDesc, setResourceDesc] = useState('');
  const [resourceCategory, setResourceCategory] = useState('');
  const [resourceFile, setResourceFile] = useState(null);
  const addResourceMutation = useMutation({
    mutationFn: async () => {
      if (!accessToken) throw new Error('Please log in to add resources');

      const file = resourceFile;
      let uploadedUrl = null;
      let uploadedName = null;
      let uploadedMime = null;
      let uploadedSize = null;

      if (file) {
        const validationError = validateFileUpload({
          file,
          maxBytes: MAX_UPLOAD_BYTES,
          allowedMimeTypes: ALLOWED_UPLOAD_MIME_TYPES,
        });
        if (validationError) throw new Error(validationError);
        const uploaded = await uploadFile(file, {
          accessToken,
          maxBytes: MAX_UPLOAD_BYTES,
          allowedMimeTypes: ALLOWED_UPLOAD_MIME_TYPES,
        });
        uploadedUrl = uploaded?.url ? String(uploaded.url) : null;
        uploadedName = uploaded?.filename ? String(uploaded.filename) : (file?.name ? String(file.name) : null);
        uploadedMime = uploaded?.mime ? String(uploaded.mime) : (file?.type ? String(file.type) : null);
        uploadedSize = typeof file?.size === 'number' ? file.size : null;
      }

      return createMovementResource(
        movementId,
        {
          title: String(resourceTitle).trim(),
          category: String(resourceCategory).trim() || undefined,
          url: String(resourceUrl).trim() || undefined,
          file_url: uploadedUrl || undefined,
          file_name: uploadedName || undefined,
          mime_type: uploadedMime || undefined,
          file_size: uploadedSize || undefined,
          description: String(resourceDesc).trim() || undefined,
        },
        { accessToken }
      );
    },
    onSuccess: async () => {
      setResourceTitle('');
      setResourceUrl('');
      setResourceDesc('');
      setResourceCategory('');
      setResourceFile(null);
      await queryClient.invalidateQueries({ queryKey: ['resources', movementId] });
    },
  });

  const deleteResourceMutation = useMutation({
    mutationFn: async (resourceId) => {
      if (!accessToken) throw new Error('Please log in');
      return deleteResource(resourceId, { accessToken });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['resources', movementId] });
    },
  });

  const downloadResourceMutation = useMutation({
    mutationFn: async (resourceId) => {
      if (!accessToken) return null;
      return incrementResourceDownload(resourceId, { accessToken });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['resources', movementId] });
    },
  });

  const [evidenceType, setEvidenceType] = useState('image');
  const [evidenceUrlInput, setEvidenceUrlInput] = useState('');
  const [evidenceCaption, setEvidenceCaption] = useState('');
  const [evidenceFile, setEvidenceFile] = useState(null);
  const [evidenceText, setEvidenceText] = useState('');
  const [groupChatOpen, setGroupChatOpen] = useState(false);
  const [groupSelectedEmails, setGroupSelectedEmails] = useState([]);

  const maxGroupParticipants = 10;
  const maxSelectableParticipants = Math.max(0, maxGroupParticipants - 1);

  useEffect(() => {
    if (!groupChatOpen) return;
    if (groupSelectedEmails.length) return;
    if (!verifiedParticipantEmails.length) return;
    setGroupSelectedEmails(verifiedParticipantEmails.slice(0, maxSelectableParticipants));
  }, [groupChatOpen, verifiedParticipantEmails, groupSelectedEmails.length, maxSelectableParticipants]);

  const toggleGroupEmail = (email) => {
    const normalized = normalizeEmail(email);
    if (!normalized) return;
    setGroupSelectedEmails((prev) => {
      const list = Array.isArray(prev) ? prev : [];
      if (list.includes(normalized)) {
        return list.filter((e) => e !== normalized);
      }
      if (list.length >= maxSelectableParticipants) return list;
      return [...list, normalized];
    });
  };

  const submitEvidenceMutation = useMutation({
    mutationFn: async () => {
      if (!accessToken) throw new Error('Please log in to submit evidence');
      if (backendStatus === 'offline') throw new Error('Offline: evidence submissions are disabled');

      const rateCheck = await checkActionAllowed({
        email: myEmail ?? null,
        action: 'movement_evidence_submit',
        contextId: movementId,
        accessToken,
      });
      if (!rateCheck?.ok) {
        const wait = rateCheck?.retryAfterMs ? ` Try again in ${formatWaitMs(rateCheck.retryAfterMs)}.` : '';
        throw new Error(String(rateCheck?.reason || 'Please slow down.') + wait);
      }

      const caption = String(evidenceCaption || '').trim() || undefined;
      const mediaType = String(evidenceType || 'image');

      if (mediaType === 'image') {
        const file = evidenceFile;
        if (!file) throw new Error('Please select an image');
        const validationError = validateFileUpload({
          file,
          maxBytes: MAX_UPLOAD_BYTES,
          allowedMimeTypes: ALLOWED_IMAGE_WITH_GIF_MIME_TYPES,
        });
        if (validationError) throw new Error(validationError);

        const uploaded = await uploadFile(file, {
          accessToken,
          maxBytes: MAX_UPLOAD_BYTES,
          allowedMimeTypes: ALLOWED_IMAGE_WITH_GIF_MIME_TYPES,
        });
        const url = uploaded?.url ? String(uploaded.url) : '';
        if (!url) throw new Error('Upload succeeded but no URL returned');

        return createMovementEvidence(
          movementId,
          {
            media_type: 'image',
            url,
            caption,
            file_name: file.name,
            mime_type: file.type,
            file_size: file.size,
          },
          { accessToken }
        );
      }

      if (mediaType === 'text') {
        const text = String(evidenceText || '').trim();
        if (!text) throw new Error('Please add a short note');
        return createMovementEvidence(
          movementId,
          {
            media_type: 'text',
            text,
            caption,
          },
          { accessToken }
        );
      }

      const normalizedUrl = normalizeEvidenceUrlInput(evidenceUrlInput);
      if (!normalizedUrl) {
        throw new Error('Enter a valid http(s) URL');
      }

      return createMovementEvidence(
        movementId,
        {
          media_type: mediaType === 'video' ? 'video' : 'link',
          url: normalizedUrl,
          caption,
        },
        { accessToken }
      );
    },
    onSuccess: async () => {
      setEvidenceUrlInput('');
      setEvidenceCaption('');
      setEvidenceFile(null);
      setEvidenceText('');
      await queryClient.invalidateQueries({ queryKey: ['movementEvidence', movementId] });
      await queryClient.invalidateQueries({ queryKey: ['movementEvidencePending', movementId] });
      await queryClient.invalidateQueries({ queryKey: queryKeys.movements.detail(movementId) });
    },
    onError: (e) => {
      toast.error(getInteractionErrorMessage(e, 'Failed to submit evidence'));
    },
  });

  const verifyEvidenceMutation = useMutation({
    mutationFn: async ({ evidenceId, status }) => {
      if (!accessToken) throw new Error('Please log in');
      return verifyMovementEvidence(movementId, evidenceId, { status }, { accessToken });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['movementEvidence', movementId] });
      await queryClient.invalidateQueries({ queryKey: ['movementEvidencePending', movementId] });
      await queryClient.invalidateQueries({ queryKey: queryKeys.movements.detail(movementId) });
    },
    onError: (e) => {
      toast.error(getInteractionErrorMessage(e, 'Failed to verify evidence'));
    },
  });

  const createGroupChatMutation = useMutation({
    mutationFn: async () => {
      if (import.meta?.env?.PROD) throw new Error('Messaging is temporarily disabled');
      if (!accessToken) throw new Error('Please log in to start a group chat');
      if (!movementId) throw new Error('Movement is required');
      if (!isOwner) throw new Error('Only the movement owner can start this chat');

      const rateCheck = await checkActionAllowed({
        email: myEmail ?? null,
        action: 'conversation_create',
        contextId: movementId,
        accessToken,
      });
      if (!rateCheck?.ok) {
        const wait = rateCheck?.retryAfterMs ? ` Try again in ${formatWaitMs(rateCheck.retryAfterMs)}.` : '';
        throw new Error(String(rateCheck?.reason || 'Please slow down.') + wait);
      }

      const selected = groupSelectedEmails.slice(0, maxSelectableParticipants);
      if (!selected.length) {
        throw new Error('Select at least one verified participant');
      }

      const { createMovementGroupConversation } = await import('@/api/messagesClient');
      return createMovementGroupConversation(movementId, selected, { accessToken });
    },
    onSuccess: (conversation) => {
      setGroupChatOpen(false);
      setGroupSelectedEmails([]);
      toast.success('Verified group chat ready');
      const id = conversation?.id ? String(conversation.id) : '';
      if (id) {
        navigate(`/messages?conversationId=${encodeURIComponent(id)}`);
      }
    },
    onError: (e) => {
      toast.error(getInteractionErrorMessage(e, 'Failed to create group chat'));
    },
  });

  const [eventTitle, setEventTitle] = useState('');
  const [eventStartsAt, setEventStartsAt] = useState('');
  const [eventLocation, setEventLocation] = useState('');
  const [eventUrl, setEventUrl] = useState('');
  const [eventVirtualLink, setEventVirtualLink] = useState('');
  const [eventMaxAttendees, setEventMaxAttendees] = useState('');
  const [eventDesc, setEventDesc] = useState('');
  const addEventMutation = useMutation({
    mutationFn: async () => {
      if (!accessToken) throw new Error('Please log in to create events');

      const rateCheck = await checkActionAllowed({
        email: myEmail ?? null,
        action: 'event_create',
        contextId: movementId,
        accessToken,
      });
      if (!rateCheck?.ok) {
        const wait = rateCheck?.retryAfterMs ? ` Try again in ${formatWaitMs(rateCheck.retryAfterMs)}.` : '';
        throw new Error(String(rateCheck?.reason || 'Please slow down.') + wait);
      }

      const capRaw = String(eventMaxAttendees || '').trim();
      const cap = capRaw ? Number(capRaw) : undefined;
      return createMovementEvent(
        movementId,
        {
          title: String(eventTitle).trim(),
          starts_at: String(eventStartsAt).trim() || undefined,
          location: String(eventLocation).trim() || undefined,
          url: String(eventUrl).trim() || undefined,
          virtual_link: String(eventVirtualLink).trim() || undefined,
          max_attendees: Number.isFinite(cap) ? cap : undefined,
          description: String(eventDesc).trim() || undefined,
        },
        { accessToken }
      );
    },
    onSuccess: async () => {
      setEventTitle('');
      setEventStartsAt('');
      setEventLocation('');
      setEventUrl('');
      setEventVirtualLink('');
      setEventMaxAttendees('');
      setEventDesc('');
      await queryClient.invalidateQueries({ queryKey: ['events', movementId] });
    },
    onError: (e) => {
      toast.error(getInteractionErrorMessage(e, 'Failed to create event'));
    },
  });

  const [petitionTitle, setPetitionTitle] = useState('');
  const [petitionUrl, setPetitionUrl] = useState('');
  const [petitionGoal, setPetitionGoal] = useState('');
  const addPetitionMutation = useMutation({
    mutationFn: async () => {
      if (!accessToken) throw new Error('Please log in to add petitions');
      if (!petitionsEnabled) throw new Error('Petitions are currently disabled');

      const rateCheck = await checkActionAllowed({
        email: myEmail ?? null,
        action: 'petition_create',
        contextId: movementId,
        accessToken,
      });
      if (!rateCheck?.ok) {
        const wait = rateCheck?.retryAfterMs ? ` Try again in ${formatWaitMs(rateCheck.retryAfterMs)}.` : '';
        throw new Error(String(rateCheck?.reason || 'Please slow down.') + wait);
      }

      const goal = String(petitionGoal || '').trim();
      return createMovementPetition(
        movementId,
        {
          title: String(petitionTitle).trim(),
          url: String(petitionUrl).trim(),
          goal_signatures: goal ? Number(goal) : undefined,
        },
        { accessToken }
      );
    },
    onSuccess: async () => {
      setPetitionTitle('');
      setPetitionUrl('');
      setPetitionGoal('');
      await queryClient.invalidateQueries({ queryKey: ['petitions', movementId] });
    },
    onError: (e) => {
      toast.error(getInteractionErrorMessage(e, 'Failed to add petition'));
    },
  });

  const donationStorageKey = useMemo(() => `donation_link_${movementId}`, [movementId]);
  const [donationStoredLink, setDonationStoredLink] = useState(() => {
    try {
      return localStorage.getItem(`donation_link_${movementId}`) || '';
    } catch {
      return '';
    }
  });
  const [donationLinkDraft, setDonationLinkDraft] = useState(donationStoredLink);
  const [showDonationEdit, setShowDonationEdit] = useState(false);

  useEffect(() => {
    try {
      const next = localStorage.getItem(donationStorageKey) || '';
      setDonationStoredLink(next);
      setDonationLinkDraft(next);
    } catch {
      setDonationStoredLink('');
      setDonationLinkDraft('');
    }
    setShowDonationEdit(false);
  }, [donationStorageKey]);

  const [impactTitle, setImpactTitle] = useState('');
  const [impactContent, setImpactContent] = useState('');
  const addImpactMutation = useMutation({
    mutationFn: async () => {
      if (!accessToken) throw new Error('Please log in to post updates');
      return createMovementImpactUpdate(
        movementId,
        { title: String(impactTitle).trim() || undefined, content: String(impactContent).trim() },
        { accessToken }
      );
    },
    onSuccess: async () => {
      setImpactTitle('');
      setImpactContent('');
      await queryClient.invalidateQueries({ queryKey: ['movementImpact', movementId] });
    },
  });

  const [discussionDraft, setDiscussionDraft] = useState('');
  const postDiscussionMutation = useMutation({
    mutationFn: async () => {
      if (!accessToken) throw new Error('Please log in to post');
      return createMovementDiscussionMessage(movementId, { message: String(discussionDraft).trim() }, { accessToken });
    },
    onSuccess: async () => {
      setDiscussionDraft('');
      await queryClient.invalidateQueries({ queryKey: ['movementDiscussions', movementId] });
    },
  });

  const [taskTitle, setTaskTitle] = useState('');
  const [taskDesc, setTaskDesc] = useState('');
  const [taskAssignee, setTaskAssignee] = useState('');

  const normalizeHandle = (value) => String(value || '').trim().replace(/^@+/, '');
  const createTaskMutation = useMutation({
    mutationFn: async () => {
      if (!accessToken) throw new Error('Please log in to add tasks');

      let assignedToEmail;
      const handle = normalizeHandle(taskAssignee);
      if (handle) {
        const prof = await fetchPublicProfileByUsername(handle, { accessToken });
        assignedToEmail = prof?.user_email ? String(prof.user_email).trim() : undefined;
      }

      return createMovementTask(
        movementId,
        {
          title: String(taskTitle).trim(),
          description: String(taskDesc).trim() || undefined,
          assigned_to_email: assignedToEmail,
        },
        { accessToken }
      );
    },
    onSuccess: async () => {
      setTaskTitle('');
      setTaskDesc('');
      setTaskAssignee('');
      await queryClient.invalidateQueries({ queryKey: ['movementTasks', movementId] });
    },
  });

  const { assignedTaskEmails, assignedTaskUserIds } = useMemo(() => {
    const list = Array.isArray(tasks) ? tasks : [];
    const emails = list.map((t) => (t?.assigned_to_email ? String(t.assigned_to_email).trim().toLowerCase() : '')).filter(Boolean);
    const userIds = list.map((t) => (t?.assigned_to_user_id ? String(t.assigned_to_user_id).trim() : '')).filter(Boolean);
    return { assignedTaskEmails: Array.from(new Set(emails)), assignedTaskUserIds: Array.from(new Set(userIds)) };
  }, [tasks]);

  const { data: assignedTaskProfiles = [] } = useQuery({
    queryKey: ['taskAssignees', movementId, assignedTaskUserIds.join('|'), assignedTaskEmails.join('|')],
    queryFn: () => lookupUsers({ userIds: assignedTaskUserIds, emails: assignedTaskEmails }, { accessToken }),
    enabled: !!accessToken && (assignedTaskUserIds.length > 0 || assignedTaskEmails.length > 0),
    staleTime: 1000 * 60 * 10,
  });

  const assignedTaskLookup = useMemo(() => {
    const map = new Map();
    for (const p of Array.isArray(assignedTaskProfiles) ? assignedTaskProfiles : []) {
      const email = p?.user_email ? String(p.user_email).trim().toLowerCase() : (p?.email ? String(p.email).trim().toLowerCase() : '');
      const userId = p?.user_id ? String(p.user_id).trim() : '';
      const record = {
        display_name: p?.display_name ?? null,
        username: p?.username ?? null,
      };
      if (userId) map.set(userId, record);
      if (email) map.set(email, record);
    }
    return map;
  }, [assignedTaskProfiles]);

  const updateTaskMutation = useMutation({
    mutationFn: async ({ taskId, patch }) => {
      if (!accessToken) throw new Error('Please log in');
      return updateTask(taskId, patch, { accessToken });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['movementTasks', movementId] });
    },
  });

  if (earlyView) return earlyView;

  return (
    <div className="max-w-4xl mx-auto px-3 sm:px-4 py-6 sm:py-10 space-y-6 sm:space-y-8">
      <BackButton />
      {showOfflineLabel && offlineMovement ? (
        <div className="p-3 rounded-xl border border-amber-200 bg-amber-50 text-amber-900 text-sm font-bold">
          Showing last saved version — reconnecting. Data may be outdated.
        </div>
      ) : null}

      <div className="p-4 sm:p-6 rounded-2xl border border-slate-200 bg-white shadow-sm space-y-3">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-black text-slate-900">{title}</h1>
            {(() => {
              const v = String(movement?.visibility || '').trim().toLowerCase();
              if (!v || v === 'public') return null;
              const label = v === 'private' ? 'Private draft' : 'Community';
              const cls =
                v === 'private'
                  ? 'border-amber-200 bg-amber-50 text-amber-900'
                  : 'border-slate-200 bg-slate-50 text-slate-700';
              return (
                <span
                  className={`ml-2 px-2 py-1 rounded-full border text-xs font-black ${cls}`}
                  title={v === 'private' ? 'Visible only to you' : 'Visible to followers'}
                >
                  {label}
                </span>
              );
            })()}
            {isTitleLocked && (
              <span className="ml-2 px-2 py-1 rounded bg-yellow-100 text-yellow-800 text-xs font-bold" title="Locked by owner">Locked</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-slate-200 bg-slate-50 font-bold text-slate-700">
              <UserIcon className="w-4 h-4" />
              {ownerProfilePath ? (
                <Link to={ownerProfilePath} className="hover:text-[#3A3DFF]" title={ownerLabel}>
                  {ownerLabel}
                </Link>
              ) : (
                <span>{ownerLabel}</span>
              )}
              {ownerIsAdmin ? (
                <span className="inline-flex px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[10px] font-black uppercase">
                  Admin
                </span>
              ) : null}
            </div>

            {createdAt ? (
              <div className="px-3 py-1 rounded-full border border-slate-200 bg-slate-50 font-bold text-slate-600">
                Created {formatDate(createdAt)}
              </div>
            ) : null}
          </div>
        </div>

        {tags.length > 0 ? (
          <div className="flex flex-wrap gap-2 pt-2">
            {tags.slice(0, 12).map((t) => (
              <span
                key={String(t)}
                className="px-3 py-1 rounded-full bg-slate-100 border border-slate-200 text-xs font-black text-slate-700"
              >
                {String(t)}
              </span>
            ))}
          </div>
        ) : null}

        <div className="pt-2 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50">
            <div className="text-xs font-black text-slate-600">Participants</div>
            <div className="mt-1 text-sm font-black text-slate-900 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1">
                <BadgeCheck className="w-4 h-4 text-[#3A3DFF]" />
                {verifiedParticipants != null ? verifiedParticipants : 0} verified
              </span>
              {typeof unverifiedParticipants === 'number' && unverifiedParticipants > 0 ? (
                <span className="text-xs text-slate-600 font-semibold">
                  Unverified interest: {unverifiedParticipants}
                </span>
              ) : null}
            </div>
            <div className="mt-1 text-xs text-slate-500 font-semibold">
              Participants are counted from author-approved evidence only.
            </div>
          </div>

          <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50">
            <div className="text-xs font-black text-slate-600">Supporters</div>
            <div className="mt-1 text-sm font-black text-slate-900">{supporters != null ? supporters : '—'}</div>
          </div>

          <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50">
            <div className="text-xs font-black text-slate-600">Following</div>
            <div className="mt-1 flex items-center justify-between gap-2">
              <div className="text-sm font-black text-slate-900">{displayedFollowersCount}</div>
              <button
                type="button"
                disabled={!accessToken || followMutation.isPending}
                onClick={() => followMutation.mutate(!following)}
                className={`px-3 py-2 rounded-xl border text-xs font-black ${
                  following
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50'
                } ${!accessToken ? 'opacity-60 cursor-not-allowed' : ''}`}
                title={!accessToken ? 'Log in to follow' : following ? 'Unfollow' : 'Follow'}
              >
                {following ? 'Following' : 'Follow'}
              </button>
            </div>
          </div>
        </div>

        <div className="pt-2">
          <div className="text-xs font-black text-slate-600">Location</div>
          <div className="mt-1 inline-flex items-center gap-2 text-sm font-bold text-slate-800">
            <MapPin className="w-4 h-4 text-slate-600" />
            {locationCity ? (
              <span>{locationCity} (city-level)</span>
            ) : (
              <span className="text-slate-500">Not specified</span>
            )}
          </div>
          <div className="mt-1 text-xs text-slate-500 font-semibold">
            Locations are shown at city-level for privacy.
          </div>
        </div>

        <div className="pt-2">
          <div className="flex items-center gap-2">
            <div className="text-xs font-black text-slate-600">Description</div>
            {isDescriptionLocked && (
              <span className="ml-2 px-2 py-1 rounded bg-yellow-100 text-yellow-800 text-xs font-bold" title="Locked by owner">Locked</span>
            )}
          </div>
          {description ? (
            shouldRenderHtml ? (
              <div
                className="prose prose-slate max-w-none font-semibold text-slate-800"
                dangerouslySetInnerHTML={{ __html: safeHtml }}
              />
            ) : (
              <p className="text-slate-700 font-semibold leading-relaxed whitespace-pre-wrap">{description}</p>
            )
          ) : (
            <p className="text-slate-500 font-semibold">No description yet.</p>
          )}
        </div>

        <div className="pt-4 flex flex-wrap items-center gap-2">
          {isTeamMember ? (
            <>
              <div className="text-xs font-black text-slate-600 uppercase tracking-wide mr-1">Organizer shortcuts</div>
              <a
                href="#events"
                className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-800 text-xs font-black hover:bg-slate-50"
              >
                Events
              </a>
              {petitionsEnabled ? (
                <a
                  href="#petitions"
                  className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-800 text-xs font-black hover:bg-slate-50"
                >
                  Petitions
                </a>
              ) : null}
              <button
                type="button"
                onClick={() => setInviteOpen(true)}
                disabled={!currentUserForCollab}
                className={`px-3 py-2 rounded-xl border text-xs font-black ${
                  currentUserForCollab
                    ? 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50'
                    : 'border-slate-200 bg-slate-100 text-slate-500 cursor-not-allowed'
                }`}
                title={currentUserForCollab ? 'Invite collaborators' : 'Log in to invite'}
              >
                Invite collaborators
              </button>
              {(isOwner || isAdmin) ? (
                <button
                  type="button"
                  onClick={() => setEditMovementOpen(true)}
                  className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-800 text-xs font-black hover:bg-slate-50"
                >
                  Edit details
                </button>
              ) : null}
            </>
          ) : (
            <>
              <div className="text-xs font-black text-slate-600 uppercase tracking-wide mr-1">Jump to</div>
              <a
                href="#events"
                className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-800 text-xs font-black hover:bg-slate-50"
              >
                Events
              </a>
              {petitionsEnabled ? (
                <a
                  href="#petitions"
                  className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-800 text-xs font-black hover:bg-slate-50"
                >
                  Petition
                </a>
              ) : null}
              <a
                href="#verified-activity"
                className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-800 text-xs font-black hover:bg-slate-50"
              >
                Verified activity
              </a>
              <a
                href="#comments"
                className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-800 text-xs font-black hover:bg-slate-50"
              >
                Comments
              </a>
            </>
          )}

          <a
            href="#share"
            className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-800 text-xs font-black hover:bg-slate-50"
          >
            Share
          </a>
        </div>

        <div id="share" className="pt-4 flex flex-wrap gap-3 items-center">
          <BoostButtons movementId={movementId} movement={movement} />
          <ShareButton movementId={movementId} movement={movement} />
          <ReportButton contentType="movement" contentId={movementId} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6">
        <div id="engagement">
          <SectionCard title="Engagement">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="p-4 rounded-xl border border-slate-200 bg-white">
                <div className="inline-flex items-center gap-2 text-xs font-black text-slate-600">
                  <Heart className="w-4 h-4" /> Boosts
                </div>
                <div className="mt-1 text-2xl font-black text-slate-900">{boostsCount}</div>
              </div>

              <div className="p-4 rounded-xl border border-slate-200 bg-white">
                <div className="inline-flex items-center gap-2 text-xs font-black text-slate-600">
                  <MessageSquare className="w-4 h-4" /> Comments
                </div>
                <div className="mt-1 text-2xl font-black text-slate-900">
                  {typeof commentsCount === 'number' ? commentsCount : 0}
                </div>
              </div>

              <div className="p-4 rounded-xl border border-slate-200 bg-white">
                <div className="inline-flex items-center gap-2 text-xs font-black text-slate-600">
                  <Users className="w-4 h-4" /> Followers
                </div>
                <div className="mt-1 text-2xl font-black text-slate-900">{displayedFollowersCount}</div>
              </div>
            </div>

            {(isOwner || isAdmin) ? (
              <div className="mt-5">
                <div className="text-sm font-black text-slate-900">Recent activity</div>
                <div className="mt-2 space-y-2">
                  {recentActivity.length === 0 ? (
                    <div className="text-sm text-slate-600 font-semibold">No recent activity yet.</div>
                  ) : (
                    recentActivity.map((n) => {
                      const type = String(n?.type || '');
                      const actorLabel =
                        (n?.actor_name ? String(n.actor_name).trim() : '') ||
                        (n?.actor_email ? maskEmail(n.actor_email) : '') ||
                        'Someone';

                      const Icon =
                        type === 'movement_boost'
                          ? Heart
                          : (type === 'comment' ? MessageSquare : UserPlus);

                      const actionLabel =
                        type === 'movement_boost'
                          ? 'boosted'
                          : (type === 'comment' ? 'commented' : 'followed');

                      return (
                        <div
                          key={String(n?.id || `${type}-${n?.created_date || ''}-${n?.actor_email || ''}`)}
                          className="p-3 rounded-xl border border-slate-200 bg-slate-50 flex items-start justify-between gap-3"
                        >
                          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                            <Icon className="w-4 h-4 text-slate-600" />
                            <span className="font-black">{actorLabel}</span>
                            <span className="text-slate-700">{actionLabel}</span>
                          </div>
                          <div className="text-xs font-bold text-slate-500 whitespace-nowrap">
                            {formatShortWhen(n?.created_date)}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            ) : null}
          </SectionCard>
        </div>

        <div id="events">
        <SectionCard title="Events">
          <div className="space-y-3">
            {eventsLoading ? (
              <EmptyState>Loading events…</EmptyState>
            ) : eventsError ? (
              <EmptyState>
                <div className="space-y-3">
                  <div>We couldn’t load events. Please try again.</div>
                  <button
                    type="button"
                    onClick={() => refetchEvents()}
                    className="inline-flex items-center justify-center px-4 py-2 rounded-xl bg-[#3A3DFF] text-white font-black hover:opacity-90"
                  >
                    Retry
                  </button>
                </div>
              </EmptyState>
            ) : events.length === 0 ? (
              <EmptyState>No events yet.</EmptyState>
            ) : (
              <div className="space-y-2">
                {events.map((ev) => (
                  <div key={String(ev?.id)} className="p-4 rounded-xl border border-slate-200 bg-slate-50">
                    <div className="font-black text-slate-900">{String(ev?.title || '')}</div>
                    <div className="mt-1 text-xs text-slate-600 font-bold">
                      {ev?.starts_at ? `Starts: ${String(ev.starts_at)}` : 'Start time not specified'}
                      {ev?.location ? ` • Location: ${String(ev.location)}` : ''}
                    </div>
                    {typeof ev?.max_attendees === 'number' ? (
                      <div className="mt-1 text-xs text-slate-600 font-bold">
                        Capacity: {String(ev.max_attendees)}
                      </div>
                    ) : null}
                    {ev?.url ? (
                      <a
                        className="mt-2 block text-sm font-bold text-[#3A3DFF] break-all"
                        href={String(ev.url)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {String(ev.url)}
                      </a>
                    ) : null}
                    {ev?.virtual_link ? (
                      <a
                        className="mt-2 block text-sm font-bold text-[#3A3DFF] break-all"
                        href={String(ev.virtual_link)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {String(ev.virtual_link)}
                      </a>
                    ) : null}
                    {ev?.description ? (
                      <div className="mt-2 text-sm text-slate-700 font-semibold whitespace-pre-wrap">{String(ev.description)}</div>
                    ) : null}

                    <EventRsvpControls
                      event={ev}
                      movementId={movementId}
                      accessToken={accessToken}
                      myEmail={myEmail}
                      backendStatus={backendStatus}
                    />
                  </div>
                ))}

                {hasNextEventsPage ? (
                  <div className="pt-2 flex justify-center">
                    <button
                      type="button"
                      onClick={() => fetchNextEventsPage()}
                      disabled={isFetchingNextEventsPage}
                      className="inline-flex items-center justify-center px-4 py-2 rounded-xl bg-white border-2 border-slate-200 text-slate-900 font-black hover:bg-slate-50"
                    >
                      {isFetchingNextEventsPage ? 'Loading…' : 'Load more'}
                    </button>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </SectionCard>
        </div>

        {petitionsEnabled ? (
          <div id="petitions">
            <SectionCard title="Petitions">
              <div className="space-y-3">
                {petitionsLoading ? (
                  <EmptyState>Loading petitions…</EmptyState>
                ) : petitionsError ? (
                  <EmptyState>
                    <div className="space-y-3">
                      <div>We couldn’t load petitions. Please try again.</div>
                      <button
                        type="button"
                        onClick={() => refetchPetitions()}
                        className="inline-flex items-center justify-center px-4 py-2 rounded-xl bg-[#3A3DFF] text-white font-black hover:opacity-90"
                      >
                        Retry
                      </button>
                    </div>
                  </EmptyState>
                ) : petitions.length === 0 ? (
                  <EmptyState>No petitions yet.</EmptyState>
                ) : (
                  <div className="space-y-2">
                    {petitions.map((p) => (
                      <div key={String(p?.id)} className="p-4 rounded-xl border border-slate-200 bg-slate-50">
                        <div className="font-black text-slate-900">{String(p?.title || '')}</div>
                        <div className="mt-1 text-xs text-slate-600 font-bold">
                          {p?.goal_signatures ? `Goal: ${String(p.goal_signatures)} signatures` : 'No goal set'}
                        </div>
                        {p?.url ? (
                          <a
                            className="mt-2 block text-sm font-bold text-[#3A3DFF] break-all"
                            href={String(p.url)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {String(p.url)}
                          </a>
                        ) : null}

                        <PetitionSignControls
                          petition={p}
                          accessToken={accessToken}
                          myEmail={myEmail}
                          backendStatus={backendStatus}
                        />
                      </div>
                    ))}

                    {hasNextPetitionsPage ? (
                      <div className="pt-2 flex justify-center">
                        <button
                          type="button"
                          onClick={() => fetchNextPetitionsPage()}
                          disabled={isFetchingNextPetitionsPage}
                          className="inline-flex items-center justify-center px-4 py-2 rounded-xl bg-white border-2 border-slate-200 text-slate-900 font-black hover:bg-slate-50"
                        >
                          {isFetchingNextPetitionsPage ? 'Loading…' : 'Load more'}
                        </button>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            </SectionCard>
          </div>
        ) : null}

        <SectionCard title="Resources">
          <div className="space-y-3">
            {resourcesLoading ? (
              <EmptyState>Loading resources…</EmptyState>
            ) : resourcesError ? (
              <EmptyState>
                <div className="space-y-3">
                  <div>We couldn’t load resources. Please try again.</div>
                  <button
                    type="button"
                    onClick={() => refetchResources()}
                    className="inline-flex items-center justify-center px-4 py-2 rounded-xl bg-[#3A3DFF] text-white font-black hover:opacity-90"
                  >
                    Retry
                  </button>
                </div>
              </EmptyState>
            ) : resources.length === 0 ? (
              <EmptyState>No resources yet.</EmptyState>
            ) : (
              <div className="space-y-2">
                {resources.map((r) => (
                  <div key={String(r?.id)} className="p-4 rounded-xl border border-slate-200 bg-slate-50">
                    <div className="flex items-start justify-between gap-3">
                      <div className="font-black text-slate-900">{String(r?.title || '')}</div>
                      {(() => {
                        const canDeleteResource =
                          isTeamMember &&
                          !!accessToken &&
                          !!myEmail &&
                          (isAdmin ||
                            String(r?.created_by_email || '').trim().toLowerCase() === String(myEmail).toLowerCase());
                        return canDeleteResource ? (
                          <button
                            type="button"
                            onClick={() => {
                              if (!r?.id) return;
                              setResourceToDelete({ id: String(r.id), title: String(r?.title || 'this resource') });
                            }}
                            disabled={deleteResourceMutation.isPending}
                            className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-800 text-xs font-black hover:bg-slate-50 disabled:opacity-60"
                          >
                            Delete
                          </button>
                        ) : null;
                      })()}
                    </div>

                    {r?.category ? (
                      <div className="mt-1 text-xs text-slate-600 font-bold">Category: {String(r.category)}</div>
                    ) : null}

                    {r?.url ? (
                      <a
                        className="text-sm font-bold text-[#3A3DFF] break-all"
                        href={String(r.url)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {String(r.url)}
                      </a>
                    ) : null}

                    {r?.file_name ? (
                      <div className="mt-1 text-xs text-slate-600 font-bold">File: {String(r.file_name)}</div>
                    ) : null}

                    {(() => {
                      const previewType = guessPreviewType(r);
                      const src = absolutizeMaybe(r?.file_url || null);
                      if (!src) return null;
                      if (previewType === 'image') {
                        return (
                          <img
                            src={src}
                            alt={String(r?.title || 'Resource')}
                            className="mt-3 w-full max-h-72 object-contain rounded-xl border border-slate-200 bg-white"
                          />
                        );
                      }
                      if (previewType === 'pdf') {
                        return (
                          <iframe
                            title={String(r?.title || 'PDF preview')}
                            src={src}
                            className="mt-3 w-full h-72 rounded-xl border border-slate-200 bg-white"
                          />
                        );
                      }
                      return null;
                    })()}

                    {r?.description ? (
                      <div className="mt-1 text-sm text-slate-700 font-semibold whitespace-pre-wrap">{String(r.description)}</div>
                    ) : null}

                    <div className="mt-3 flex items-center justify-between gap-3">
                      <div className="text-xs text-slate-600 font-bold">
                        Downloads: {String(typeof r?.download_count === 'number' ? r.download_count : 0)}
                      </div>
                      {(() => {
                        const link = absolutizeMaybe(r?.file_url || r?.url || null);
                        if (!link) return null;
                        return (
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                if (r?.id) await downloadResourceMutation.mutateAsync(String(r.id));
                              } finally {
                                window.open(link, '_blank', 'noopener,noreferrer');
                              }
                            }}
                            disabled={downloadResourceMutation.isPending}
                            className="px-3 py-2 rounded-xl bg-slate-900 text-white text-xs font-black hover:opacity-90 disabled:opacity-60"
                          >
                            Download
                          </button>
                        );
                      })()}
                    </div>
                  </div>
                ))}

                {hasNextResourcesPage ? (
                  <div className="pt-2 flex justify-center">
                    <button
                      type="button"
                      onClick={() => fetchNextResourcesPage()}
                      disabled={isFetchingNextResourcesPage}
                      className="inline-flex items-center justify-center px-4 py-2 rounded-xl bg-white border-2 border-slate-200 text-slate-900 font-black hover:bg-slate-50"
                    >
                      {isFetchingNextResourcesPage ? 'Loading…' : 'Load more'}
                    </button>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </SectionCard>

        <div id="verified-activity">
        <SectionCard title="Verified Activity">
          <div className="space-y-4">
            <div className="text-xs text-slate-600 font-semibold">
              Evidence is user-submitted and only appears after the movement organizer verifies it. People Power does not verify authenticity.
            </div>
            {isOwner ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="space-y-1">
                  <div className="text-sm font-black text-slate-900">Verified participants group chat</div>
                  <div className="text-xs text-slate-600 font-semibold">
                    Create an end-to-end encrypted group chat with verified participants (up to 10 people total).
                  </div>
                  <div className="text-[11px] text-slate-500 font-semibold">
                    Participants are added by the movement author only. The chat appears under Messages → Groups.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const dmDisabled = true;
                    if (dmDisabled) {
                      toast.message(
                        'Direct Messages are temporarily disabled while we upgrade messaging. Please use movement comments or profile links in the meantime.'
                      );
                      return;
                    }
                    // TODO: Re-enable movement group chats by removing this gate.
                    setGroupChatOpen(true);
                  }}
                  disabled={groupEvidenceLoading || verifiedParticipantEmails.length === 0}
                  className="inline-flex items-center justify-center px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-black hover:opacity-90 disabled:opacity-60"
                >
                  {groupEvidenceLoading ? 'Loading…' : (verifiedParticipantEmails.length ? 'Start group chat' : 'No verified participants')}
                </button>
              </div>
            ) : null}

            {evidenceLoading ? (
              <EmptyState>Loading verified evidence…</EmptyState>
            ) : evidenceError ? (
              <EmptyState>
                <div className="space-y-3">
                  <div>We couldn’t load verified evidence. Please try again.</div>
                  <button
                    type="button"
                    onClick={() => refetchEvidence()}
                    className="inline-flex items-center justify-center px-4 py-2 rounded-xl bg-[#3A3DFF] text-white font-black hover:opacity-90"
                  >
                    Retry
                  </button>
                </div>
              </EmptyState>
            ) : evidence.length === 0 ? (
              <EmptyState>No verified activity shared yet. Be the first to show how you joined this movement.</EmptyState>
            ) : (
              <div className="space-y-2">
                {evidence.map((ev) => {
                  const url = absolutizeMaybe(ev?.url || '');
                  const caption = ev?.caption ? String(ev.caption) : '';
                  const text = ev?.text ? String(ev.text) : '';
                  const created = ev?.created_at ? formatDate(ev.created_at) : null;
                  const isImage = isEvidenceImage(ev);
                  const mediaType = String(ev?.media_type || '').toLowerCase();
                  return (
                    <div key={String(ev?.id || url)} className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2">
                      <div className="flex items-center gap-2 text-xs font-black text-slate-600">
                        <BadgeCheck className="w-4 h-4 text-[#3A3DFF]" />
                        Verified by organizer
                        {created ? <span className="text-slate-400">• {created}</span> : null}
                      </div>
                      {mediaType === 'text' ? (
                        <div className="text-sm text-slate-700 font-semibold whitespace-pre-wrap">
                          {text || caption}
                        </div>
                      ) : isImage && url ? (
                        <img
                          src={url}
                          alt={caption || 'Verified evidence'}
                          className="w-full max-h-80 object-contain rounded-xl border border-slate-200 bg-white"
                        />
                      ) : url ? (
                        <a
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sm font-bold text-[#3A3DFF] break-all"
                        >
                          {mediaType === 'video' ? 'Watch video evidence' : 'View evidence link'}
                        </a>
                      ) : null}
                      {caption && mediaType !== 'text' ? (
                        <div className="text-sm text-slate-700 font-semibold whitespace-pre-wrap">{caption}</div>
                      ) : null}
                    </div>
                  );
                })}

                {hasNextEvidencePage ? (
                  <div className="pt-2 flex justify-center">
                    <button
                      type="button"
                      onClick={() => fetchNextEvidencePage()}
                      disabled={isFetchingNextEvidencePage}
                      className="inline-flex items-center justify-center px-4 py-2 rounded-xl bg-white border-2 border-slate-200 text-slate-900 font-black hover:bg-slate-50"
                    >
                      {isFetchingNextEvidencePage ? 'Loading…' : 'Load more'}
                    </button>
                  </div>
                ) : null}
              </div>
            )}

            <div className="pt-3 border-t border-slate-200 space-y-3">
              <div className="text-sm font-black text-slate-900">Submit evidence</div>
              {accessToken ? (
                backendStatus === 'offline' ? (
                  <div className="text-xs text-red-500 font-bold">Offline: evidence submissions are disabled</div>
                ) : (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label>Evidence type</Label>
                        <select
                          value={evidenceType}
                          onChange={(e) => setEvidenceType(e.target.value)}
                          className="w-full rounded-xl border-2 border-slate-200 bg-white px-3 py-2 text-sm font-semibold"
                        >
                          <option value="image">Photo (upload)</option>
                          <option value="link">Link</option>
                          <option value="video">Video link</option>
                          <option value="text">Short text</option>
                        </select>
                      </div>
                      <div className="space-y-1">
                        <Label>Caption (optional)</Label>
                        <TextInput
                          value={evidenceCaption}
                          onChange={setEvidenceCaption}
                          placeholder="Brief context for this evidence"
                        />
                      </div>
                    </div>

                    {evidenceType === 'image' ? (
                      <div className="space-y-2">
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/jpg,image/webp,image/gif"
                          onChange={(e) => {
                            const file = e.target.files?.[0] ?? null;
                            e.target.value = '';
                            if (!file) return;
                            const validationError = validateFileUpload({
                              file,
                              maxBytes: MAX_UPLOAD_BYTES,
                              allowedMimeTypes: ALLOWED_IMAGE_WITH_GIF_MIME_TYPES,
                            });
                            if (validationError) {
                              toast.error(validationError);
                              return;
                            }
                            setEvidenceFile(file);
                          }}
                          className="text-sm font-semibold text-slate-700"
                        />
                        {evidenceFile ? (
                          <div className="text-xs text-slate-600 font-semibold truncate">Selected: {evidenceFile.name}</div>
                        ) : (
                          <div className="text-xs text-slate-500 font-semibold">No file selected.</div>
                        )}
                      </div>
                    ) : evidenceType === 'text' ? (
                      <div className="space-y-1">
                        <Label>Evidence note</Label>
                        <textarea
                          value={evidenceText}
                          onChange={(e) => setEvidenceText(e.target.value)}
                          rows={4}
                          placeholder="Share a short note about how you participated."
                          className="w-full rounded-xl border-2 border-slate-200 bg-white px-3 py-2 text-sm font-semibold"
                        />
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <Label>Evidence URL</Label>
                        <TextInput
                          value={evidenceUrlInput}
                          onChange={setEvidenceUrlInput}
                          placeholder="https://example.com"
                          type="url"
                        />
                        <div className="text-xs text-slate-500 font-semibold">
                          Use a direct link to a trusted source or video.
                        </div>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => submitEvidenceMutation.mutate()}
                      disabled={submitEvidenceMutation.isPending}
                      className="inline-flex items-center justify-center px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-black hover:opacity-90 disabled:opacity-60"
                    >
                      {submitEvidenceMutation.isPending ? 'Submitting…' : 'Submit evidence for verification'}
                    </button>
                  </div>
                )
              ) : (
                <div className="text-xs text-slate-500 font-semibold">Log in to submit evidence.</div>
              )}
            </div>

            {canReviewEvidence ? (
              <div className="pt-3 border-t border-slate-200 space-y-3">
                <div className="text-sm font-black text-slate-900">Pending submissions (organizer review)</div>
                {pendingEvidenceLoading ? (
                  <EmptyState>Loading pending submissions…</EmptyState>
                ) : pendingEvidenceError ? (
                  <EmptyState>
                    <div className="space-y-3">
                      <div>We couldn’t load pending submissions. Please try again.</div>
                      <button
                        type="button"
                        onClick={() => refetchPendingEvidence()}
                        className="inline-flex items-center justify-center px-4 py-2 rounded-xl bg-[#3A3DFF] text-white font-black hover:opacity-90"
                      >
                        Retry
                      </button>
                    </div>
                  </EmptyState>
                ) : pendingEvidence.length === 0 ? (
                  <EmptyState>No pending evidence yet.</EmptyState>
                ) : (
                  <div className="space-y-2">
                    {pendingEvidence.map((ev) => {
                      const url = absolutizeMaybe(ev?.url || '');
                      const caption = ev?.caption ? String(ev.caption) : '';
                      const text = ev?.text ? String(ev.text) : '';
                      const created = ev?.created_at ? formatDate(ev.created_at) : null;
                      const submitterEmail = ev?.submitter_email ? String(ev.submitter_email) : '';
                      const submitter = submitterEmail || 'Unknown';
                      const submitterIsAdmin = submitterEmail ? isAdminEmail(submitterEmail) : false;
                      const isImage = isEvidenceImage(ev);
                      const mediaType = String(ev?.media_type || '').toLowerCase();
                      return (
                        <div key={String(ev?.id || url)} className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2">
                          <div className="flex items-center gap-2 text-xs font-black text-slate-600">
                            <span>Submitted by {submitter}</span>
                            {submitterIsAdmin ? (
                              <span className="inline-flex px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[10px] font-black uppercase">
                                Admin
                              </span>
                            ) : null}
                            {created ? <span className="text-slate-400"> • {created}</span> : null}
                          </div>
                          {mediaType === 'text' ? (
                            <div className="text-sm text-slate-700 font-semibold whitespace-pre-wrap">
                              {text || caption}
                            </div>
                          ) : isImage && url ? (
                            <img
                              src={url}
                              alt={caption || 'Pending evidence'}
                              className="w-full max-h-72 object-contain rounded-xl border border-slate-200 bg-white"
                            />
                          ) : url ? (
                            <a
                              href={url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-sm font-bold text-[#3A3DFF] break-all"
                            >
                              {mediaType === 'video' ? 'Open video evidence' : 'Open evidence link'}
                            </a>
                          ) : null}
                          {caption && mediaType !== 'text' ? (
                            <div className="text-sm text-slate-700 font-semibold whitespace-pre-wrap">{caption}</div>
                          ) : null}
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => verifyEvidenceMutation.mutate({ evidenceId: String(ev?.id || ''), status: 'approved' })}
                              disabled={verifyEvidenceMutation.isPending}
                              className="px-3 py-2 rounded-xl bg-slate-900 text-white text-xs font-black hover:opacity-90 disabled:opacity-60"
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              onClick={() => verifyEvidenceMutation.mutate({ evidenceId: String(ev?.id || ''), status: 'rejected' })}
                              disabled={verifyEvidenceMutation.isPending}
                              className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-800 text-xs font-black hover:bg-slate-50 disabled:opacity-60"
                            >
                              Reject
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </SectionCard>
        </div>

        <SectionCard title="Impact Updates">
          <div className="space-y-3">
            {impactLoading ? (
              <EmptyState>Loading updates…</EmptyState>
            ) : impactError ? (
              <EmptyState>
                <div className="space-y-3">
                  <div>We couldn’t load updates. Please try again.</div>
                  <button
                    type="button"
                    onClick={() => refetchImpact()}
                    className="inline-flex items-center justify-center px-4 py-2 rounded-xl bg-[#3A3DFF] text-white font-black hover:opacity-90"
                  >
                    Retry
                  </button>
                </div>
              </EmptyState>
            ) : impactUpdates.length === 0 ? (
              <EmptyState>No impact updates yet.</EmptyState>
            ) : (
              <div className="space-y-2">
                {impactUpdates.map((u) => (
                  <div key={String(u?.id)} className="p-4 rounded-xl border border-slate-200 bg-slate-50">
                    <div className="font-black text-slate-900">{String(u?.title || 'Update')}</div>
                    <div className="mt-1 text-sm text-slate-700 font-semibold whitespace-pre-wrap">{String(u?.content || '')}</div>
                    <div className="mt-2 text-xs text-slate-500 font-bold">
                      {u?.created_at ? String(u.created_at) : ''}
                    </div>
                  </div>
                ))}

                {hasNextImpactPage ? (
                  <div className="pt-2 flex justify-center">
                    <button
                      type="button"
                      onClick={() => fetchNextImpactPage()}
                      disabled={isFetchingNextImpactPage}
                      className="inline-flex items-center justify-center px-4 py-2 rounded-xl bg-white border-2 border-slate-200 text-slate-900 font-black hover:bg-slate-50"
                    >
                      {isFetchingNextImpactPage ? 'Loading…' : 'Load more'}
                    </button>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </SectionCard>

        {donationsEnabled ? (
          <SectionCard title="Donations">
            <div className="space-y-3">
              <div className="text-sm text-slate-700 font-semibold">
                Donations (if any) happen on external platforms. People Power does not process payments, hold funds, or guarantee campaigns.
              </div>

              {donationStoredLink ? (
                <div className="flex flex-wrap items-center gap-3">
                  <a
                    href={String(donationStoredLink)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center justify-center px-4 py-2 rounded-xl bg-slate-900 text-white font-black hover:opacity-90"
                  >
                    Donate on external site
                  </a>
                  <a
                    href={String(donationStoredLink)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm font-bold text-[#3A3DFF] break-all"
                  >
                    {String(donationStoredLink)}
                  </a>
                </div>
              ) : (
                <EmptyState>No donation link has been added.</EmptyState>
              )}

              {isTeamMember ? (
                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs font-black text-slate-600">Organizer controls</div>
                    <button
                      type="button"
                      onClick={() => setShowDonationEdit((v) => !v)}
                      className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-800 text-xs font-black hover:bg-slate-50"
                    >
                      {showDonationEdit ? 'Close' : donationStoredLink ? 'Update link' : 'Add link'}
                    </button>
                  </div>

                  {showDonationEdit ? (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="md:col-span-2">
                        <Label>Donation URL</Label>
                        <TextInput value={donationLinkDraft} onChange={setDonationLinkDraft} placeholder="https://…" />
                      </div>
                      <div className="flex items-end">
                        <button
                          type="button"
                          onClick={() => {
                            const next = String(donationLinkDraft || '').trim();
                            if (!next) {
                              toast.error('Please enter a donation URL');
                              return;
                            }
                            try {
                              localStorage.setItem(donationStorageKey, next);
                            } catch {
                              // ignore
                            }
                            setDonationStoredLink(next);
                            setShowDonationEdit(false);
                          }}
                          className="w-full px-4 py-2 rounded-xl bg-slate-900 text-white font-black hover:opacity-90"
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </SectionCard>
        ) : null}

        {(isOwner || isAdmin) && (
          <SectionCard title="Recent collaborator activity">
            <button
              className="text-xs font-bold text-[#3A3DFF] mb-2"
              onClick={() => setActivityOpen((v) => !v)}
            >
              {activityOpen ? 'Hide' : 'Show'} recent activity
            </button>
            {activityOpen && (
              <div className="space-y-2">
                {activityLoading ? (
                  <div className="text-xs text-slate-500 font-semibold">Loading…</div>
                ) : activityLog.length === 0 ? (
                  <div className="text-xs text-slate-500 font-semibold">No recent collaborator actions.</div>
                ) : (
                  <ul className="space-y-1">
                    {activityLog.map((a) => (
                      <li key={a.id} className="text-xs text-slate-700">
                        <span className="font-bold">{a.actor_user_id}</span> {a.action_type.replace(/_/g, ' ')}
                        {a.target_id ? ` (target: ${a.target_id})` : ''}
                        {a.timestamp ? ` — ${new Date(a.timestamp).toLocaleString()}` : ''}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </SectionCard>
        )}
        <SectionCard title="Impact Summary">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50">
              <div className="text-xs font-black text-slate-600">Momentum</div>
              <div className="mt-1 text-2xl font-black text-slate-900">{impactSummary.momentum}</div>
            </div>
            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50">
              <div className="text-xs font-black text-slate-600">Supporters</div>
              <div className="mt-1 text-2xl font-black text-slate-900">{impactSummary.supporters}</div>
            </div>
            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50">
              <div className="text-xs font-black text-slate-600">Participants</div>
              <div className="mt-1 text-2xl font-black text-slate-900">{impactSummary.participants}</div>
            </div>
            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50">
              <div className="text-xs font-black text-slate-600">Boosts</div>
              <div className="mt-1 text-2xl font-black text-slate-900">{impactSummary.boosts}</div>
            </div>

            <div className="p-4 rounded-xl border border-slate-200 bg-white">
              <div className="text-xs font-black text-slate-600">Events</div>
              <div className="mt-1 text-2xl font-black text-slate-900">{impactSummary.events}</div>
            </div>
            <div className="p-4 rounded-xl border border-slate-200 bg-white">
              <div className="text-xs font-black text-slate-600">Petitions</div>
              <div className="mt-1 text-2xl font-black text-slate-900">{impactSummary.petitions}</div>
            </div>
            <div className="p-4 rounded-xl border border-slate-200 bg-white">
              <div className="text-xs font-black text-slate-600">Resources</div>
              <div className="mt-1 text-2xl font-black text-slate-900">{impactSummary.resources}</div>
            </div>
            <div className="p-4 rounded-xl border border-slate-200 bg-white">
              <div className="text-xs font-black text-slate-600">Resource downloads</div>
              <div className="mt-1 text-2xl font-black text-slate-900">{impactSummary.resourceDownloads}</div>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Public Impact Report">
          <Suspense fallback={<EmptyState>Loading report…</EmptyState>}>
            <PublicImpactReport movement={reportMovement} />
          </Suspense>
        </SectionCard>
        {isTeamMember ? (
          <details
            open={organizerToolsOpen}
            onToggle={(e) => setOrganizerToolsOpen(!!e?.currentTarget?.open)}
            className="p-5 rounded-2xl border border-slate-200 bg-white shadow-sm"
          >
            <summary className="list-none cursor-pointer select-none">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-lg font-black text-slate-900">Organizer tools</div>
                  <div className="text-sm text-slate-600 font-semibold">
                    Only visible to the movement team. Advanced controls are optional.
                  </div>
                </div>
                <div className="w-10 h-10 rounded-2xl bg-slate-100 border border-slate-200 flex items-center justify-center">
                  <Users className="w-5 h-5 text-slate-700" />
                </div>
              </div>
            </summary>

            <div className="mt-5 grid grid-cols-1 gap-6">
              {/* Field lock controls for owner/admin */}
              {(isOwner || isAdmin) && (
                <SectionCard title="Lock critical fields">
                  <div className="space-y-2">
                    <div className="flex items-center gap-3">
                      <Label>Title</Label>
                      <button
                        type="button"
                        className={`px-3 py-1 rounded-xl border text-xs font-bold ${isTitleLocked ? 'bg-yellow-200 border-yellow-400 text-yellow-900' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'}`}
                        disabled={locksLoading}
                        onClick={() => handleLockToggle('title', !isTitleLocked)}
                      >
                        {isTitleLocked ? 'Unlock' : 'Lock'}
                      </button>
                    </div>
                    <div className="flex items-center gap-3">
                      <Label>Description</Label>
                      <button
                        type="button"
                        className={`px-3 py-1 rounded-xl border text-xs font-bold ${isDescriptionLocked ? 'bg-yellow-200 border-yellow-400 text-yellow-900' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'}`}
                        disabled={locksLoading}
                        onClick={() => handleLockToggle('description', !isDescriptionLocked)}
                      >
                        {isDescriptionLocked ? 'Unlock' : 'Lock'}
                      </button>
                    </div>
                    <div className="flex items-center gap-3">
                      <Label>Claim classification</Label>
                      <button
                        type="button"
                        className={`px-3 py-1 rounded-xl border text-xs font-bold ${isClaimsLocked ? 'bg-yellow-200 border-yellow-400 text-yellow-900' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'}`}
                        disabled={locksLoading}
                        onClick={() => handleLockToggle('claims', !isClaimsLocked)}
                      >
                        {isClaimsLocked ? 'Unlock' : 'Lock'}
                      </button>
                    </div>
                    {locksError ? (
                      <div className="text-xs text-red-500 font-bold">
                        {getInteractionErrorMessage(locksError, 'Could not update field locks. Please try again.')}
                      </div>
                    ) : null}
                  </div>
                </SectionCard>
              )}
              {(isOwner || isAdmin) && (
                <SectionCard title="Edit movement details">
                  <div className="text-sm text-slate-600 font-semibold">
                    Keep details accurate and up to date. Edits are visible immediately.
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditMovementOpen(true)}
                    className="mt-3 inline-flex items-center justify-center px-4 py-2 rounded-xl bg-slate-900 text-white font-black hover:opacity-90"
                  >
                    Edit movement
                  </button>
                </SectionCard>
              )}
              <SectionCard title="Create event">
                <div className="space-y-3">
                  {accessToken ? (
                    <>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div className="md:col-span-2">
                          <Label>Title</Label>
                          <TextInput value={eventTitle} onChange={setEventTitle} placeholder="e.g. City hall meetup" />
                        </div>
                        <div>
                          <Label>Starts at (ISO, optional)</Label>
                          <TextInput value={eventStartsAt} onChange={setEventStartsAt} placeholder="2026-01-05T18:00:00Z" />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <Label>Location (optional)</Label>
                          <TextInput value={eventLocation} onChange={setEventLocation} placeholder="City-level / general location" />
                        </div>
                        <div>
                          <Label>URL (optional)</Label>
                          <TextInput value={eventUrl} onChange={setEventUrl} placeholder="https://…" />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <Label>Virtual link (optional)</Label>
                          <TextInput value={eventVirtualLink} onChange={setEventVirtualLink} placeholder="https://…" />
                        </div>
                        <div>
                          <Label>Capacity (optional)</Label>
                          <TextInput value={eventMaxAttendees} onChange={setEventMaxAttendees} placeholder="100" type="number" />
                        </div>
                      </div>
                      <div>
                        <Label>Description (optional)</Label>
                        <TextArea value={eventDesc} onChange={setEventDesc} placeholder="What should participants know?" />
                      </div>
                      <button
                        type="button"
                        onClick={() => addEventMutation.mutate()}
                        disabled={addEventMutation.isPending}
                        className="px-4 py-2 rounded-xl bg-slate-900 text-white font-black hover:opacity-90 disabled:opacity-60"
                      >
                        {addEventMutation.isPending ? 'Creating…' : 'Create event'}
                      </button>
                    </>
                  ) : (
                    <SignInCallout action="create events" />
                  )}
                </div>
              </SectionCard>

              {petitionsEnabled ? (
                <SectionCard title="Manage petitions">
                  <div className="space-y-3">
                    {accessToken ? (
                      <>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          <div className="md:col-span-2">
                            <Label>Title</Label>
                            <TextInput value={petitionTitle} onChange={setPetitionTitle} placeholder="e.g. Sign the pledge" />
                          </div>
                          <div>
                            <Label>Goal signatures (optional)</Label>
                            <TextInput value={petitionGoal} onChange={setPetitionGoal} placeholder="1000" type="number" />
                          </div>
                        </div>
                        <div>
                          <Label>URL</Label>
                          <TextInput value={petitionUrl} onChange={setPetitionUrl} placeholder="https://…" />
                        </div>
                        <button
                          type="button"
                          onClick={() => addPetitionMutation.mutate()}
                          disabled={addPetitionMutation.isPending}
                          className="px-4 py-2 rounded-xl bg-slate-900 text-white font-black hover:opacity-90 disabled:opacity-60"
                        >
                          {addPetitionMutation.isPending ? 'Adding…' : 'Add petition'}
                        </button>
                      </>
                    ) : (
                      <SignInCallout action="add petitions" />
                    )}
                  </div>
                </SectionCard>
              ) : null}

              <SectionCard title="Add resource">
                <div className="space-y-3">
                  {accessToken ? (
                    <>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div className="md:col-span-2">
                          <Label>Title</Label>
                          <TextInput value={resourceTitle} onChange={setResourceTitle} placeholder="e.g. Volunteer guide" />
                        </div>
                        <div>
                          <Label>URL (optional)</Label>
                          <TextInput value={resourceUrl} onChange={setResourceUrl} placeholder="https://…" />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div className="md:col-span-1">
                          <Label>Category (optional)</Label>
                          <TextInput value={resourceCategory} onChange={setResourceCategory} placeholder="image / pdf / doc / other" />
                        </div>
                        <div className="md:col-span-2">
                          <Label>Upload file (optional)</Label>
                          <input
                            type="file"
                            onChange={(e) => {
                              const file = e?.target?.files?.[0] || null;
                              e.target.value = '';
                              if (!file) {
                                setResourceFile(null);
                                return;
                              }
                              const validationError = validateFileUpload({
                                file,
                                maxBytes: MAX_UPLOAD_BYTES,
                                allowedMimeTypes: ALLOWED_UPLOAD_MIME_TYPES,
                              });
                              if (validationError) {
                                toast.error(validationError);
                                setResourceFile(null);
                                return;
                              }
                              setResourceFile(file);
                            }}
                            className="w-full h-11 px-3 rounded-xl border-2 border-slate-200 bg-white text-slate-900 font-semibold outline-none"
                            accept="image/png,image/jpeg,image/jpg,image/webp,image/gif,application/pdf"
                          />
                        </div>
                      </div>
                      <div>
                        <Label>Description (optional)</Label>
                        <TextArea value={resourceDesc} onChange={setResourceDesc} placeholder="What is this resource for?" />
                      </div>
                      <button
                        type="button"
                        onClick={() => addResourceMutation.mutate()}
                        disabled={addResourceMutation.isPending}
                        className="px-4 py-2 rounded-xl bg-slate-900 text-white font-black hover:opacity-90 disabled:opacity-60"
                      >
                        {addResourceMutation.isPending ? 'Adding…' : 'Add resource'}
                      </button>
                    </>
                  ) : (
                    <SignInCallout action="add resources" />
                  )}
                </div>
              </SectionCard>

              <SectionCard title="Post an impact update">
                <div className="space-y-3">
                  {accessToken ? (
                    <>
                      <div>
                        <Label>Title (optional)</Label>
                        <TextInput value={impactTitle} onChange={setImpactTitle} placeholder="e.g. We met with city council" />
                      </div>
                      <div>
                        <Label>Update</Label>
                        <TextArea value={impactContent} onChange={setImpactContent} placeholder="Share progress, outcomes, measurable impact…" />
                      </div>
                      <button
                        type="button"
                        onClick={() => addImpactMutation.mutate()}
                        disabled={addImpactMutation.isPending}
                        className="px-4 py-2 rounded-xl bg-slate-900 text-white font-black hover:opacity-90 disabled:opacity-60"
                      >
                        {addImpactMutation.isPending ? 'Posting…' : 'Post update'}
                      </button>
                    </>
                  ) : (
                    <SignInCallout action="post updates" />
                  )}
                </div>
              </SectionCard>

              <div id="collaborators">
              <SectionCard title="Collaboration: Team">
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm text-slate-700 font-semibold">
                      Invite collaborators and manage roles.
                    </div>
                    {currentUserForCollab ? (
                      <button
                        type="button"
                        onClick={() => setInviteOpen(true)}
                        className="px-4 py-2 rounded-xl bg-slate-900 text-white font-black hover:opacity-90"
                      >
                        Invite
                      </button>
                    ) : null}
                  </div>

                  {currentUserForCollab ? (
                    <CollaboratorsList movementId={movementId} isOwner={canModerate} currentUser={currentUserForCollab} />
                  ) : (
                    <EmptyState>Please log in to manage collaborators.</EmptyState>
                  )}

                  <div className="text-xs text-slate-500 font-semibold">
                    Invited users can accept invites at /collaboration-invites.
                  </div>
                </div>

                {currentUserForCollab ? (
                  <InviteCollaboratorModal
                    open={inviteOpen}
                    onClose={() => setInviteOpen(false)}
                    movementId={movementId}
                    currentUser={currentUserForCollab}
                    movement={movement}
                  />
                ) : null}
              </SectionCard>
              </div>

              <SectionCard title="Collaboration: Tasks">
                <div className="space-y-3">
                  {accessToken ? (
                    <>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div className="md:col-span-2">
                          <Label>Task title</Label>
                          <TextInput value={taskTitle} onChange={setTaskTitle} placeholder="e.g. Draft flyer copy" />
                        </div>
                        <div>
                          <Label>Assign to (username, optional)</Label>
                          <TextInput value={taskAssignee} onChange={setTaskAssignee} placeholder="@username" />
                        </div>
                      </div>
                      <div>
                        <Label>Description (optional)</Label>
                        <TextArea value={taskDesc} onChange={setTaskDesc} placeholder="What needs doing?" />
                      </div>
                      <button
                        type="button"
                        onClick={() => createTaskMutation.mutate()}
                        disabled={createTaskMutation.isPending}
                        className="px-4 py-2 rounded-xl bg-slate-900 text-white font-black hover:opacity-90 disabled:opacity-60"
                      >
                        {createTaskMutation.isPending ? 'Creating…' : 'Create task'}
                      </button>
                    </>
                  ) : (
                    <SignInCallout action="create tasks" />
                  )}

                  {tasksLoading ? (
                    <EmptyState>Loading tasks…</EmptyState>
                  ) : tasks.length === 0 ? (
                    <EmptyState>No tasks yet.</EmptyState>
                  ) : (
                    <div className="space-y-2">
                      {tasks.map((t) => (
                        <div key={String(t?.id)} className="p-4 rounded-xl border border-slate-200 bg-slate-50">
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="font-black text-slate-900 truncate">{String(t?.title || '')}</div>
                              <div className="text-xs text-slate-600 font-bold">
                                Status: {String(t?.status || 'todo')}
                                {t?.assigned_to_email || t?.assigned_to_user_id
                                  ? (() => {
                                      const userId = t?.assigned_to_user_id ? String(t.assigned_to_user_id).trim() : '';
                                      const email = String(t.assigned_to_email || '').trim().toLowerCase();
                                      const prof = (userId ? assignedTaskLookup.get(userId) : null) || (email ? assignedTaskLookup.get(email) : null);
                                      const display = String(prof?.display_name || '').trim();
                                      if (display) return ` • Assigned: ${display}`;
                                      const uname = String(prof?.username || '').trim();
                                      if (uname) return ` • Assigned: @${uname}`;
                                      return ' • Assigned';
                                    })()
                                  : ''}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              {['todo', 'in_progress', 'completed'].map((status) => (
                                <button
                                  key={status}
                                  type="button"
                                  disabled={!accessToken || updateTaskMutation.isPending}
                                  title={
                                    !accessToken
                                      ? 'Log in to update task status'
                                      : status === 'todo'
                                        ? 'Mark as To do'
                                        : status === 'in_progress'
                                          ? 'Mark as In progress'
                                          : 'Mark as Done'
                                  }
                                  onClick={() => updateTaskMutation.mutate({ taskId: String(t?.id), patch: { status } })}
                                  className={`px-3 py-2 rounded-xl border text-xs font-black ${
                                    String(t?.status || 'todo') === status
                                      ? 'border-slate-900 bg-slate-900 text-white'
                                      : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-100'
                                  } ${!accessToken ? 'opacity-60 cursor-not-allowed' : ''}`}
                                >
                                  {status === 'todo' ? 'To do' : status === 'in_progress' ? 'In progress' : 'Done'}
                                </button>
                              ))}
                            </div>
                          </div>
                          {t?.description ? (
                            <div className="mt-2 text-sm text-slate-700 font-semibold whitespace-pre-wrap">{String(t.description)}</div>
                          ) : null}
                        </div>
                      ))}

                      {hasNextTasksPage ? (
                        <div className="pt-2 flex justify-center">
                          <button
                            type="button"
                            onClick={() => fetchNextTasksPage()}
                            disabled={isFetchingNextTasksPage}
                            className="inline-flex items-center justify-center px-4 py-2 rounded-xl bg-white border-2 border-slate-200 text-slate-900 font-black hover:bg-slate-50"
                          >
                            {isFetchingNextTasksPage ? 'Loading…' : 'Load more'}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              </SectionCard>

              <SectionCard title="Collaboration: Discussion">
                <div className="space-y-3">
                  {accessToken ? (
                    <>
                      <div>
                        <Label>Post a message</Label>
                        <TextArea value={discussionDraft} onChange={setDiscussionDraft} placeholder="Coordinate action, share updates, ask for help…" />
                      </div>
                      <button
                        type="button"
                        onClick={() => postDiscussionMutation.mutate()}
                        disabled={postDiscussionMutation.isPending}
                        className="px-4 py-2 rounded-xl bg-slate-900 text-white font-black hover:opacity-90 disabled:opacity-60"
                      >
                        {postDiscussionMutation.isPending ? 'Posting…' : 'Post'}
                      </button>
                    </>
                  ) : (
                    <SignInCallout action="post messages" />
                  )}

                  {discussionsLoading ? (
                    <EmptyState>Loading discussion…</EmptyState>
                  ) : discussions.length === 0 ? (
                    <EmptyState>No discussion yet.</EmptyState>
                  ) : (
                    <div className="space-y-2">
                      {discussions.map((m) => {
                        const authorUserId = m?.author_user_id ? String(m.author_user_id).trim() : '';
                        const emailKey = String(m?.author_email || '').trim().toLowerCase();
                        const authorProfile =
                          (authorUserId && discussionAuthors?.byUserId ? discussionAuthors.byUserId[authorUserId] : null) ||
                          (emailKey && discussionAuthors?.byEmail ? discussionAuthors.byEmail[emailKey] : null);
                        const authorLabel =
                          authorProfile?.display_name ||
                          (authorProfile?.username ? `@${authorProfile.username}` : 'Member');
                        const isAdminAuthor = emailKey ? isAdminEmail(emailKey) : false;

                        return (
                          <div key={String(m?.id)} className="p-4 rounded-xl border border-slate-200 bg-slate-50">
                            <div className="flex items-center gap-2 text-xs text-slate-600 font-bold">
                              <span>{authorLabel}</span>
                              {isAdminAuthor ? (
                                <span className="inline-flex px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[10px] font-black uppercase">
                                  Admin
                                </span>
                              ) : null}
                            </div>
                            <div className="mt-1 text-sm text-slate-800 font-semibold whitespace-pre-wrap">{String(m?.message || '')}</div>
                            <div className="mt-2 text-xs text-slate-500 font-bold">{m?.created_at ? String(m.created_at) : ''}</div>
                          </div>
                        );
                      })}

                      {hasNextDiscussionsPage ? (
                        <div className="pt-2 flex justify-center">
                          <button
                            type="button"
                            onClick={() => fetchNextDiscussionsPage()}
                            disabled={isFetchingNextDiscussionsPage}
                            className="inline-flex items-center justify-center px-4 py-2 rounded-xl bg-white border-2 border-slate-200 text-slate-900 font-black hover:bg-slate-50"
                          >
                            {isFetchingNextDiscussionsPage ? 'Loading…' : 'Load more'}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              </SectionCard>

              <SectionCard title="Collaboration: Polls">
                {currentUserForCollab ? (
                  <PollManager
                    movementId={movementId}
                    currentUser={currentUserForCollab}
                    canCreatePolls={canModerate || isOwner}
                  />
                ) : (
                  <EmptyState>Please log in to participate in polls.</EmptyState>
                )}
              </SectionCard>

              {aiOptIn && creatorAnalyticsEnabled ? (
                <SectionCard title="Creator Dashboard (AI analytics — advanced)">
                  <div className="text-xs text-slate-600 font-bold">
                    AI-generated insights — experimental, may be inaccurate.
                  </div>
                  <div className="mt-3">
                    <ErrorBoundary>
                      <Suspense fallback={<EmptyState>Loading dashboard…</EmptyState>}>
                        <CreatorDashboard movement={movement} isOwner={isOwner} userProfile={userProfile} />
                      </Suspense>
                    </ErrorBoundary>
                  </div>
                </SectionCard>
              ) : null}

              {canDelete ? (
                <SectionCard title="Danger zone">
                  <p className="text-sm text-slate-600 font-semibold">
                    Deleting a movement is permanent and should be a last resort.
                  </p>
                  <button
                    type="button"
                    onClick={() => setDeleteMovementOpen(true)}
                    className="inline-flex items-center justify-center px-4 py-2 rounded-xl border border-rose-200 bg-rose-50 text-rose-800 font-black hover:bg-rose-100"
                  >
                    Delete movement
                  </button>
                </SectionCard>
              ) : null}
            </div>
          </details>
        ) : null}
      </div>

      {/* Confirm: delete resource */}
      <AlertDialog
        open={!!resourceToDelete}
        onOpenChange={(open) => {
          if (!open) setResourceToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete resource?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete {resourceToDelete?.title ? `“${resourceToDelete.title}”` : 'this resource'}.
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                const id = resourceToDelete?.id;
                if (!id) return;
                deleteResourceMutation.mutate(String(id));
                setResourceToDelete(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit movement details */}
      <Dialog open={editMovementOpen} onOpenChange={setEditMovementOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit movement</DialogTitle>
            <DialogDescription>
              Update your movement details. Changes are immediate and visible to participants.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label>Title</Label>
              <TextInput
                value={editForm.title}
                onChange={(value) => setEditForm((prev) => ({ ...prev, title: value }))}
                placeholder="Movement title"
              />
            </div>
            <div>
              <Label>Summary (optional)</Label>
              <TextArea
                value={editForm.summary}
                onChange={(value) => setEditForm((prev) => ({ ...prev, summary: value }))}
                placeholder="Short summary for quick previews"
              />
            </div>
            <div>
              <Label>Description</Label>
              <TextArea
                value={editForm.description}
                onChange={(value) => setEditForm((prev) => ({ ...prev, description: value }))}
                placeholder="Describe the movement and what participants should do"
              />
            </div>
            <div>
              <Label>Tags (comma separated)</Label>
              <TextInput
                value={editForm.tags}
                onChange={(value) => setEditForm((prev) => ({ ...prev, tags: value }))}
                placeholder="e.g. community, environment, advocacy"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>City / region</Label>
                <TextInput
                  value={editForm.location_city}
                  onChange={(value) => setEditForm((prev) => ({ ...prev, location_city: value }))}
                  placeholder="City or region"
                />
              </div>
              <div>
                <Label>Country</Label>
                <TextInput
                  value={editForm.location_country}
                  onChange={(value) => setEditForm((prev) => ({ ...prev, location_country: value }))}
                  placeholder="Country"
                />
              </div>
            </div>
            <div>
              <Label>Media links (one per line)</Label>
              <TextArea
                value={editForm.media_urls}
                onChange={(value) => setEditForm((prev) => ({ ...prev, media_urls: value }))}
                placeholder="https://..."
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <button
              type="button"
              className="inline-flex items-center justify-center px-4 py-2 rounded-xl border border-slate-200 bg-white text-slate-900 font-black"
              onClick={() => setEditMovementOpen(false)}
              disabled={editMovementSaving}
            >
              Cancel
            </button>
            <button
              type="button"
              className="inline-flex items-center justify-center px-4 py-2 rounded-xl bg-slate-900 text-white font-black hover:opacity-90"
              onClick={handleMovementUpdate}
              disabled={editMovementSaving}
            >
              {editMovementSaving ? 'Saving…' : 'Save changes'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm: delete movement */}
      <AlertDialog open={deleteMovementOpen} onOpenChange={setDeleteMovementOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete movement?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes it from the platform and cannot be undone. Verified participants will be notified.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingMovement}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deletingMovement}
              onClick={async (e) => {
                e.preventDefault();
                try {
                  setDeletingMovement(true);
                  const token = session?.access_token ?? null;
                  if (!token) throw new Error('Missing access token. Please log in again.');
                  await deleteMovement(movementId, { accessToken: token });
                  queryClient.invalidateQueries({ queryKey: ['movements'] });
                  queryClient.invalidateQueries({ queryKey: queryKeys.movements.detail(movementId) });
                  setDeleteMovementOpen(false);
                  navigate('/');
                } catch (err) {
                  toast.error(getInteractionErrorMessage(err, 'Failed to delete'));
                } finally {
                  setDeletingMovement(false);
                }
              }}
            >
              {deletingMovement ? 'Deleting…' : 'Delete movement'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={groupChatOpen}
        onOpenChange={(open) => {
          setGroupChatOpen(open);
          if (!open) setGroupSelectedEmails([]);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Verified participants group chat</DialogTitle>
            <DialogDescription>
              Select up to {maxSelectableParticipants} verified participants. You’ll be included automatically.
              Everyone must have opened Messages at least once to publish an encryption key.
            </DialogDescription>
          </DialogHeader>

          {groupEvidenceLoading ? (
            <div className="text-sm text-slate-600 font-semibold">Loading verified participants…</div>
          ) : verifiedParticipantEmails.length === 0 ? (
            <div className="text-sm text-slate-600 font-semibold">
              No verified participants yet. Approve evidence first to unlock the group chat.
            </div>
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {verifiedParticipantEmails.map((email) => {
                const profile = verifiedProfileMap.get(email);
                const displayName =
                  String(profile?.display_name || '').trim() ||
                  (profile?.username ? `@${profile.username}` : maskEmail(email));
                const secondary = profile?.username ? `@${profile.username}` : maskEmail(email);
                const selected = groupSelectedEmails.includes(email);
                const atLimit = !selected && groupSelectedEmails.length >= maxSelectableParticipants;
                return (
                  <label
                    key={email}
                    className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2"
                  >
                    <Checkbox
                      checked={selected}
                      onCheckedChange={() => toggleGroupEmail(email)}
                      disabled={atLimit}
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900 truncate">{displayName}</div>
                      <div className="text-xs text-slate-500 font-semibold truncate">{secondary}</div>
                    </div>
                    {atLimit ? (
                      <span className="ml-auto text-[10px] font-black text-slate-400">Limit reached</span>
                    ) : null}
                  </label>
                );
              })}
            </div>
          )}

          <DialogFooter className="mt-2">
            <button
              type="button"
              className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-slate-800 font-black hover:bg-slate-50"
              onClick={() => setGroupChatOpen(false)}
              disabled={createGroupChatMutation.isPending}
            >
              Cancel
            </button>
            <button
              type="button"
              className="px-4 py-2 rounded-xl bg-slate-900 text-white font-black hover:opacity-90 disabled:opacity-60"
              onClick={() => {
                const dmDisabled = true;
                if (dmDisabled) {
                  toast.message(
                    'Direct Messages are temporarily disabled while we upgrade messaging. Please use movement comments or profile links in the meantime.'
                  );
                  setGroupChatOpen(false);
                  return;
                }
                // TODO: Re-enable movement group chats by removing this gate.
                createGroupChatMutation.mutate();
              }}
              disabled={
                createGroupChatMutation.isPending ||
                groupEvidenceLoading ||
                verifiedParticipantEmails.length === 0 ||
                groupSelectedEmails.length === 0
              }
            >
              {createGroupChatMutation.isPending
                ? 'Creating…'
                : `Create chat (${groupSelectedEmails.length + 1}/${maxGroupParticipants})`}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div id="comments">
        <CommentSection movementId={movementId} movement={movement} canModerate={canModerate} />
      </div>
    </div>
  );
}
