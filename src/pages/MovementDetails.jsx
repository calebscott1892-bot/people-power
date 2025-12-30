import { fetchMovementLocks, setMovementLock } from '@/api/movementLocksClient';
import { fetchCollaboratorActions } from '@/api/collaboratorActionsClient';
import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { getCurrentBackendStatus, subscribeBackendStatus } from '../utils/backendStatus';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { BadgeCheck, Check, MapPin, User as UserIcon, Users, X } from 'lucide-react';

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

import { fetchMovementById, deleteMovement } from '@/api/movementsClient';
import { useAuth } from '@/auth/AuthProvider';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { fetchMyMovementFollow, setMyMovementFollow } from '@/api/movementFollowsClient';
import { listMovementCollaborators } from '@/api/collaboratorsClient';

import CommentSection from '@/components/details/CommentSection';
import BoostButtons from '@/components/shared/BoostButtons';
import ShareButton from '@/components/shared/ShareButton';
import ReportButton from '@/components/safety/ReportButton';
import ErrorBoundary from '@/components/shared/ErrorBoundary';
const PublicImpactReport = React.lazy(() => import('@/components/impact/PublicImpactReport'));
const CreatorDashboard = React.lazy(() => import('@/components/analytics/CreatorDashboard'));
import CollaboratorsList from '@/components/collaboration/CollaboratorsList';
import InviteCollaboratorModal from '@/components/collaboration/InviteCollaboratorModal';
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
import { entities } from '@/api/appClient';
import { fetchPetitionSignatureSummary, signPetition, withdrawPetitionSignature } from '@/api/petitionSignaturesClient';
import { uploadFile } from '@/api/uploadsClient';
import { checkActionAllowed, formatWaitMs } from '@/utils/antiBrigading';
import { logError } from '@/utils/logError';
import { toast } from 'sonner';

function absolutizeMaybe(url) {
  const s = url ? String(url).trim() : '';
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith('/')) {
    const base =
      (import.meta?.env?.VITE_SERVER_URL && String(import.meta.env.VITE_SERVER_URL)) ||
      (import.meta?.env?.VITE_API_BASE_URL && String(import.meta.env.VITE_API_BASE_URL)) ||
      'http://localhost:3001';
    return `${String(base).replace(/\/$/, '')}${s}`;
  }
  return s;
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

function parseAdminEmails(raw) {
  return String(raw || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function EventRsvpControls({ event, movementId, accessToken, myEmail }) {
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ['eventRsvps', String(event?.id || ''), myEmail],
    enabled: !!event?.id,
    retry: 1,
    queryFn: async () => fetchEventRsvpSummary(event.id, { accessToken: accessToken || undefined }),
  });

  const summary = data?.summary || { going_count: 0, interested_count: 0, attended_count: 0 };
  const myRsvp = data?.my_rsvp || null;

  const { backendStatus = 'healthy' } = window || {};
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
          const existing = await filterNotifications({
            recipient_email: myEmail,
            type: 'event_reminder',
            content_ref: String(event.id),
          });
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
            });
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
      window.alert(String(e?.message || 'Failed to sign petition'));
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
      window.alert(String(e?.message || 'Failed to withdraw signature'));
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
  const { user, session } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { id } = useParams();
  const movementId = useMemo(() => normalizeId(id), [id]);
  const accessToken = session?.access_token ? String(session.access_token) : null;

  const [backendStatus, setBackendStatus] = useState(getCurrentBackendStatus());
  const [offlineMovement, setOfflineMovement] = useState(null);
  const [showOfflineLabel, setShowOfflineLabel] = useState(false);

  // Listen for backend status changes
  useEffect(() => {
    const unsub = subscribeBackendStatus(setBackendStatus);
    return () => unsub();
  }, []);

  const [organizerToolsOpen, setOrganizerToolsOpen] = useState(false);
  const [deleteMovementOpen, setDeleteMovementOpen] = useState(false);
  const [deletingMovement, setDeletingMovement] = useState(false);
  const [resourceToDelete, setResourceToDelete] = useState(null);

  const adminEmails = useMemo(() => parseAdminEmails(import.meta?.env?.VITE_ADMIN_EMAILS), []);
  const myEmail = String(user?.email || '').trim().toLowerCase();

  const {
    data: movement,
    isLoading: isMovementLoading,
    isError: isMovementError,
    error: movementError,
    refetch,
  } = useQuery({
    queryKey: ['movement', movementId],
    enabled: !!movementId,
    retry: 1,
    queryFn: async () => {
      if (!movementId) return null;
      const m = await fetchMovementById(movementId);
      // Cache compact movement details on success
      if (m && backendStatus === 'healthy') {
        try {
          const compact = { id: m.id, title: m.title, summary: m.summary, description: m.description, tags: m.tags, author_email: m.author_email, city: m.city, country: m.country, momentum_score: m.momentum_score, upvotes: m.upvotes, downvotes: m.downvotes, score: m.score, created_at: m.created_at, updated_at: m.updated_at };
          localStorage.setItem(`peoplepower_movement_${m.id}_cache`, JSON.stringify({ ts: Date.now(), data: compact }));
        } catch {}
      }
      return m;
    },
  });

  // Load from cache if offline or fetch error
  useEffect(() => {
    if ((backendStatus === 'offline' || isMovementError) && movementId) {
      try {
        const raw = localStorage.getItem(`peoplepower_movement_${movementId}_cache`);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.data) {
            setOfflineMovement(parsed.data);
            setShowOfflineLabel(true);
          }
        }
      } catch {}
    } else {
      setOfflineMovement(null);
      setShowOfflineLabel(false);
    }
  }, [backendStatus, isMovementError, movementId]);

  // Note: avoid early returns before hooks; render an early view at the end instead.
  const earlyView = !movementId ? (
    <div className="max-w-4xl mx-auto px-4 py-12 space-y-6">
      <Link to="/" className="text-[#3A3DFF] font-bold">&larr; Back to home</Link>
      <div className="p-6 rounded-2xl border border-slate-200 bg-white shadow-sm space-y-2">
        <h1 className="text-2xl font-black text-slate-900">Movement not found</h1>
        <p className="text-slate-600 font-semibold">
          This movement could not be found or is temporarily unavailable.
        </p>
      </div>
    </div>
  ) : isMovementLoading ? (
    <div className="max-w-4xl mx-auto px-4 py-12 space-y-6">
      <Link to="/" className="text-[#3A3DFF] font-bold">&larr; Back to home</Link>
      <div className="p-6 rounded-2xl border border-slate-200 bg-slate-50 text-slate-700">
        <div className="font-black text-slate-900">Loading movement…</div>
        <div className="text-sm text-slate-600 font-semibold mt-1">Please wait.</div>
      </div>
    </div>
  ) : isMovementError ? (
    <div className="max-w-4xl mx-auto px-4 py-12 space-y-6">
      <Link to="/" className="text-[#3A3DFF] font-bold">&larr; Back to home</Link>
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
    <div className="max-w-4xl mx-auto px-4 py-12 space-y-6">
      <Link to="/" className="text-[#3A3DFF] font-bold">&larr; Back to home</Link>
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
  const canDelete = !!(user?.email && ownerEmail && String(user.email) === ownerEmail);
  const isAdmin = !!(myEmail && adminEmails.includes(myEmail));
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
    onSuccess: (next) => {
      queryClient.setQueryData(['movementFollow', movementId], next);
    },
    onError: (e) => {
      window.alert(String(e?.message || 'Failed to update follow'));
    },
  });

  const following = !!followState?.following;
  const followersCount = typeof followState?.followers_count === 'number' ? followState.followers_count : null;

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
    return {
      email: String(user.email),
      full_name: user?.user_metadata?.full_name || user?.user_metadata?.name || user?.user_metadata?.username || null,
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
      try {
        return await listMovementCollaborators(movementId, { accessToken });
      } catch {
        return [];
      }
    },
    retry: 1,
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
    enabled: !!movementId,
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
  }, [resourcesError, resourcesErrorObj]);

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
  }, [eventsError, eventsErrorObj]);

  useEffect(() => {
    if (petitionsError && petitionsErrorObj) logError(petitionsErrorObj, 'Movement petitions load failed', { movementId });
  }, [petitionsError, petitionsErrorObj]);

  useEffect(() => {
    if (impactError && impactErrorObj) logError(impactErrorObj, 'Movement impact updates load failed', { movementId });
  }, [impactError, impactErrorObj]);
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
          'created_by_email',
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
        fields: ['id', 'movement_id', 'author_email', 'message', 'created_at'],
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

  const { data: collaborators = [] } = useQuery({
    queryKey: ['collaborators', movementId],
    enabled: !!movementId,
    retry: 1,
    queryFn: async () => {
      const collabs = await entities.Collaborator.filter({ movement_id: movementId });
      return Array.isArray(collabs) ? collabs.filter((c) => c?.status === 'accepted') : [];
    },
  });

  const isLoggedIn = !!accessToken;
  const isCollaborator = useMemo(() => {
    if (!myEmail) return false;
    if (!Array.isArray(collaborators)) return false;
    return collaborators.some((c) => String(c?.user_email || '').trim().toLowerCase() === myEmail);
  }, [collaborators, myEmail]);

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
    queryKey: ['userProfile', myEmail],
    enabled: !!myEmail,
    retry: 1,
    queryFn: async () => {
      const profiles = await entities.UserProfile.filter({ user_email: myEmail });
      return Array.isArray(profiles) && profiles.length > 0 ? profiles[0] : null;
    },
  });

  const aiOptIn = useMemo(() => {
    if (!myEmail) return false;
    if (userProfile && typeof userProfile === 'object' && 'ai_features_enabled' in userProfile) {
      return !!userProfile.ai_features_enabled;
    }
    try {
      return localStorage.getItem('peoplepower_ai_opt_in') === 'true';
    } catch {
      return false;
    }
  }, [myEmail, userProfile]);

  const impactSummary = useMemo(() => {
    const totalParticipants =
      (typeof movement?.verified_participants === 'number' ? movement.verified_participants : 0) +
      (typeof movement?.unverified_participants === 'number' ? movement.unverified_participants : 0);
    const totalResourceDownloads = Array.isArray(resources)
      ? resources.reduce((sum, r) => sum + (typeof r?.download_count === 'number' ? r.download_count : 0), 0)
      : 0;

    return {
      momentum: typeof movement?.momentum_score === 'number' ? movement.momentum_score : 0,
      boosts: typeof movement?.boosts === 'number' ? movement.boosts : 0,
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
  const RESOURCE_MAX_MB = 5;
  const RESOURCE_ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'application/pdf'];
  const addResourceMutation = useMutation({
    mutationFn: async () => {
      if (!accessToken) throw new Error('Please log in to add resources');

      const file = resourceFile;
      let uploadedUrl = null;
      let uploadedName = null;
      let uploadedMime = null;
      let uploadedSize = null;

      if (file) {
        if (file.size > RESOURCE_MAX_MB * 1024 * 1024) {
          throw new Error(`File too large. Max size is ${RESOURCE_MAX_MB}MB.`);
        }
        if (file.type && !RESOURCE_ALLOWED_TYPES.includes(file.type)) {
          throw new Error('That file type isn’t supported. Please upload an image (JPG/PNG/GIF) or PDF.');
        }
        const uploaded = await uploadFile(file, { accessToken });
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

  const MAX_EVIDENCE_MB = 5;
  const ALLOWED_EVIDENCE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif'];
  const [evidenceType, setEvidenceType] = useState('image');
  const [evidenceUrlInput, setEvidenceUrlInput] = useState('');
  const [evidenceCaption, setEvidenceCaption] = useState('');
  const [evidenceFile, setEvidenceFile] = useState(null);
  const [evidenceText, setEvidenceText] = useState('');

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
        if (file.size > MAX_EVIDENCE_MB * 1024 * 1024) {
          throw new Error(`File too large. Max size is ${MAX_EVIDENCE_MB}MB.`);
        }
        if (!ALLOWED_EVIDENCE_MIME_TYPES.includes(file.type)) {
          throw new Error('That file type isn’t supported. Please upload a JPG, PNG, or GIF.');
        }

        const uploaded = await uploadFile(file, { accessToken });
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
    },
    onError: (e) => {
      toast.error(String(e?.message || 'Failed to submit evidence'));
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
    },
    onError: (e) => {
      toast.error(String(e?.message || 'Failed to verify evidence'));
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
      window.alert(String(e?.message || 'Failed to create event'));
    },
  });

  const [petitionTitle, setPetitionTitle] = useState('');
  const [petitionUrl, setPetitionUrl] = useState('');
  const [petitionGoal, setPetitionGoal] = useState('');
  const addPetitionMutation = useMutation({
    mutationFn: async () => {
      if (!accessToken) throw new Error('Please log in to add petitions');

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
      window.alert(String(e?.message || 'Failed to add petition'));
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
  const createTaskMutation = useMutation({
    mutationFn: async () => {
      if (!accessToken) throw new Error('Please log in to add tasks');
      return createMovementTask(
        movementId,
        {
          title: String(taskTitle).trim(),
          description: String(taskDesc).trim() || undefined,
          assigned_to_email: String(taskAssignee).trim() || undefined,
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
      <Link to="/" className="text-[#3A3DFF] font-bold">&larr; Back to home</Link>

      <div className="p-4 sm:p-6 rounded-2xl border border-slate-200 bg-white shadow-sm space-y-3">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-black text-slate-900">{title}</h1>
            {isTitleLocked && (
              <span className="ml-2 px-2 py-1 rounded bg-yellow-100 text-yellow-800 text-xs font-bold" title="Locked by owner">Locked</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-slate-200 bg-slate-50 font-bold text-slate-700">
              <UserIcon className="w-4 h-4" />
              {ownerEmail ? (
                <Link
                  to={`/user/${encodeURIComponent(ownerEmail)}?email=${encodeURIComponent(ownerEmail)}`}
                  className="hover:text-[#3A3DFF]"
                  title={ownerEmail}
                >
                  {ownerEmail}
                </Link>
              ) : (
                <span>Unknown author</span>
              )}
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
              {verifiedParticipants != null ? (
                <span className="inline-flex items-center gap-1">
                  <BadgeCheck className="w-4 h-4 text-[#3A3DFF]" /> {verifiedParticipants} verified
                </span>
              ) : (
                <span className="text-slate-500">—</span>
              )}
              <span className="text-slate-300">•</span>
              {unverifiedParticipants != null ? (
                <span>{unverifiedParticipants} unverified</span>
              ) : (
                <span className="text-slate-500">—</span>
              )}
            </div>
          </div>

          <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50">
            <div className="text-xs font-black text-slate-600">Supporters</div>
            <div className="mt-1 text-sm font-black text-slate-900">{supporters != null ? supporters : '—'}</div>
          </div>

          <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50">
            <div className="text-xs font-black text-slate-600">Following</div>
            <div className="mt-1 flex items-center justify-between gap-2">
              <div className="text-sm font-black text-slate-900">{followersCount != null ? followersCount : '—'}</div>
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
              <a
                href="#petitions"
                className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-800 text-xs font-black hover:bg-slate-50"
              >
                Petitions
              </a>
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
              <a
                href="#petitions"
                className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-800 text-xs font-black hover:bg-slate-50"
              >
                Petition
              </a>
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

                    <EventRsvpControls event={ev} movementId={movementId} accessToken={accessToken} myEmail={myEmail} />
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
                          (adminEmails.includes(String(myEmail).toLowerCase()) ||
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
                          accept="image/png,image/jpeg,image/jpg,image/gif"
                          onChange={(e) => {
                            const file = e.target.files?.[0] ?? null;
                            e.target.value = '';
                            if (!file) return;
                            if (file.size > MAX_EVIDENCE_MB * 1024 * 1024) {
                              toast.error(`File too large. Max size is ${MAX_EVIDENCE_MB}MB.`);
                              return;
                            }
                            if (!ALLOWED_EVIDENCE_MIME_TYPES.includes(file.type)) {
                              toast.error('That file type isn’t supported. Please upload a JPG, PNG, or GIF.');
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
                      const submitter = ev?.submitter_email ? String(ev.submitter_email) : 'Unknown';
                      const isImage = isEvidenceImage(ev);
                      const mediaType = String(ev?.media_type || '').toLowerCase();
                      return (
                        <div key={String(ev?.id || url)} className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2">
                          <div className="text-xs font-black text-slate-600">
                            Submitted by {submitter}
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
                            alert('Please enter a donation URL');
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
                    {locksError && <div className="text-xs text-red-500 font-bold">{String(locksError.message || locksError)}</div>}
                  </div>
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
                              if (file.size > RESOURCE_MAX_MB * 1024 * 1024) {
                                toast.error(`File too large. Max size is ${RESOURCE_MAX_MB}MB.`);
                                setResourceFile(null);
                                return;
                              }
                              if (file.type && !RESOURCE_ALLOWED_TYPES.includes(file.type)) {
                                toast.error('That file type isn’t supported. Please upload an image (JPG/PNG/GIF) or PDF.');
                                setResourceFile(null);
                                return;
                              }
                              setResourceFile(file);
                            }}
                            className="w-full h-11 px-3 rounded-xl border-2 border-slate-200 bg-white text-slate-900 font-semibold outline-none"
                            accept="image/png,image/jpeg,image/jpg,image/gif,application/pdf"
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
                          <Label>Assign to (email, optional)</Label>
                          <TextInput value={taskAssignee} onChange={setTaskAssignee} placeholder="name@example.com" />
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
                                {t?.assigned_to_email ? ` • Assigned: ${String(t.assigned_to_email)}` : ''}
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
                      {discussions.map((m) => (
                        <div key={String(m?.id)} className="p-4 rounded-xl border border-slate-200 bg-slate-50">
                          <div className="text-xs text-slate-600 font-bold">{String(m?.author_email || '')}</div>
                          <div className="mt-1 text-sm text-slate-800 font-semibold whitespace-pre-wrap">{String(m?.message || '')}</div>
                          <div className="mt-2 text-xs text-slate-500 font-bold">{m?.created_at ? String(m.created_at) : ''}</div>
                        </div>
                      ))}

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

              {aiOptIn ? (
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

      {/* Confirm: delete movement */}
      <AlertDialog open={deleteMovementOpen} onOpenChange={setDeleteMovementOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete movement?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes it from the platform and cannot be undone.
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
                  queryClient.invalidateQueries({ queryKey: ['movement', movementId] });
                  setDeleteMovementOpen(false);
                  navigate('/');
                } catch (err) {
                  alert(String(err?.message || err || 'Failed to delete'));
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

      <div id="comments">
        <CommentSection movementId={movementId} movement={movement} canModerate={canModerate} />
      </div>
    </div>
  );
}
