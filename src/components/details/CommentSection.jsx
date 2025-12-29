import React, { useMemo, useState, useEffect } from 'react';
import { getCurrentBackendStatus, subscribeBackendStatus } from '../../utils/backendStatus';
import { Link } from 'react-router-dom';
import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { User, Loader2, Lock, TimerReset } from 'lucide-react';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import { useAuth } from '@/auth/AuthProvider';
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
  createMovementComment,
  fetchMovementCommentsPage,
  fetchMovementCommentSettings,
  updateMovementCommentSettings,
} from '@/api/commentsClient';
import ReportButton from '@/components/safety/ReportButton';
import { checkActionAllowed, formatWaitMs } from '@/utils/antiBrigading';
import { createIncident } from '@/api/incidentsClient';

function looksHighIntensity(text) {
  const t = String(text || '');
  const upper = (t.match(/[A-Z]/g) || []).length;
  const letters = (t.match(/[A-Za-z]/g) || []).length;
  const ratio = letters ? upper / letters : 0;
  const exclaims = (t.match(/!/g) || []).length;
  return ratio > 0.55 || exclaims >= 6;
}

function looksLikeCrisis(text) {
  const t = String(text || '').toLowerCase();
  const flags = [
    'kill',
    'shoot',
    'bomb',
    'suicide',
    'attack',
    'murder',
    'weapon',
    'stab',
    'explode',
  ];
  return flags.some((w) => t.includes(w));
}

export default function CommentSection({ movementId, movement, canModerate = false, className = '' }) {
  const [backendStatus, setBackendStatus] = useState(getCurrentBackendStatus());
  useEffect(() => {
    const unsub = subscribeBackendStatus(setBackendStatus);
    return () => unsub();
  }, []);
  const isOffline = backendStatus === 'offline';
  const { user, session } = useAuth();
  const queryClient = useQueryClient();

  const safeMovementId = useMemo(
    () => String(movementId ?? movement?.id ?? movement?._id ?? '').trim(),
    [movementId, movement]
  );

  const [draft, setDraft] = useState('');
  const [postConfirmOpen, setPostConfirmOpen] = useState(false);
  const [postConfirmKind, setPostConfirmKind] = useState(null);
  const [pendingPostText, setPendingPostText] = useState('');

  const accessToken = session?.access_token ? String(session.access_token) : null;

  const { data: commentSettings, isLoading: settingsLoading } = useQuery({
    queryKey: ['commentSettings', safeMovementId],
    enabled: !!safeMovementId,
    queryFn: async () => {
      if (!safeMovementId) return { locked: false, slow_mode_seconds: 0 };
      return fetchMovementCommentSettings(safeMovementId);
    },
    retry: 1,
  });

  const locked = !!commentSettings?.locked;
  const slowModeSeconds = typeof commentSettings?.slow_mode_seconds === 'number' ? commentSettings.slow_mode_seconds : 0;

  const updateSettingsMutation = useMutation({
    mutationFn: async (patch) => {
      if (!safeMovementId) throw new Error('Missing movement');
      if (!accessToken) throw new Error('Please log in');
      return updateMovementCommentSettings(safeMovementId, patch, { accessToken });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['commentSettings', safeMovementId] });
      toast.success('Comment settings updated');
    },
    onError: (e) => toast.error(String(e?.message || 'Failed to update settings')),
  });

  const {
    data: commentPages,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['comments', safeMovementId],
    enabled: !!safeMovementId,
    initialPageParam: 0,
    queryFn: async ({ pageParam = 0 }) => {
      if (!safeMovementId) return [];
      return fetchMovementCommentsPage(safeMovementId, {
        limit: 20,
        offset: pageParam,
        fields: ['id', 'movement_id', 'author_email', 'content', 'created_at'],
      });
    },
    getNextPageParam: (lastPage, pages) => {
      const list = Array.isArray(lastPage) ? lastPage : [];
      if (list.length < 20) return undefined;
      return pages.length * 20;
    },
    retry: 1,
  });

  const comments = useMemo(() => {
    const pages = Array.isArray(commentPages?.pages) ? commentPages.pages : [];
    return pages.flatMap((p) => (Array.isArray(p) ? p : []));
  }, [commentPages]);

  const postMutation = useMutation({
    mutationFn: async ({ text }) => {
      if (!safeMovementId) throw new Error('Missing movement');
      if (!accessToken) throw new Error('Please log in to comment');
      if (locked) throw new Error('Comments are locked for this movement');
      const cleanText = String(text || '').trim();
      if (!cleanText) throw new Error('Please write a comment');

      const rateCheck = await checkActionAllowed({
        email: user?.email ?? null,
        action: 'comment_post',
        contextId: safeMovementId,
        accessToken,
      });
      if (!rateCheck?.ok) {
        const wait = rateCheck?.retryAfterMs ? ` Try again in ${formatWaitMs(rateCheck.retryAfterMs)}.` : '';
        throw new Error(String(rateCheck?.reason || 'Please slow down.') + wait);
      }

      return createMovementComment(safeMovementId, cleanText, { accessToken });
    },
    onSuccess: async () => {
      setDraft('');
      await queryClient.invalidateQueries({ queryKey: ['comments', safeMovementId] });
      toast.success('Comment posted');
    },
    onError: (e) => {
      toast.error(String(e?.message || "Couldn't post comment"));
    },
  });

  const attemptPost = () => {
    if (locked || postMutation.isPending || isOffline) return;
    const text = String(draft || '').trim();
    if (!text) {
      toast.error('Please write a comment');
      return;
    }

    if (looksLikeCrisis(text)) {
      try {
        if (accessToken && safeMovementId) {
          createIncident(
            {
              event_type: 'comment_prompt_crisis',
              movement_id: String(safeMovementId),
              trigger_system: 'client_prompt',
              human_reviewed: false,
              related_entity_type: 'movement',
              related_entity_id: String(safeMovementId),
              context: { action: 'comment_post', context_id: String(safeMovementId) },
            },
            { accessToken }
          ).catch(() => {});
        }
      } catch {
        // ignore
      }
      setPendingPostText(text);
      setPostConfirmKind('crisis');
      setPostConfirmOpen(true);
      return;
    }
    if (looksHighIntensity(text)) {
      try {
        if (accessToken && safeMovementId) {
          createIncident(
            {
              event_type: 'comment_prompt_high_intensity',
              movement_id: String(safeMovementId),
              trigger_system: 'client_prompt',
              human_reviewed: false,
              related_entity_type: 'movement',
              related_entity_id: String(safeMovementId),
              context: { action: 'comment_post', context_id: String(safeMovementId) },
            },
            { accessToken }
          ).catch(() => {});
        }
      } catch {
        // ignore
      }
      setPendingPostText(text);
      setPostConfirmKind('high');
      setPostConfirmOpen(true);
      return;
    }

    postMutation.mutate({ text });
  };

  const confirmTitle = postConfirmKind === 'crisis' ? 'Confirm posting' : 'Confirm posting';
  const confirmDescription =
    postConfirmKind === 'crisis'
      ? 'This message may contain crisis or violent language. Please confirm it does not encourage harm and is necessary for the discussion.'
      : postConfirmKind === 'high'
        ? 'This comment looks high-intensity (lots of caps or exclamation marks). Consider rephrasing for clarity and safety.'
        : '';

  if (!safeMovementId) {
    return (
      <div className={`p-4 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-600 ${className}`}>
        <div className="font-black text-slate-800">Comments</div>
        <div className="mt-1 font-semibold">Comments are not available yet.</div>
      </div>
    );
  }

  return (
    <div className={`p-4 rounded-xl border border-slate-200 bg-white ${className}`}>
      <div className="flex items-center justify-between">
        <div className="font-black text-slate-900">Comments</div>
        <div className="text-xs text-slate-500 font-semibold">Movement: {safeMovementId}</div>
      </div>

      <div className="mt-2 flex flex-wrap gap-2 items-center">
        {settingsLoading ? (
          <div className="text-xs text-slate-500 font-semibold inline-flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading settings…
          </div>
        ) : locked ? (
          <div className="text-xs font-black text-rose-800 bg-rose-50 border border-rose-200 rounded-full px-3 py-1 inline-flex items-center gap-2">
            <Lock className="w-4 h-4" /> Comments locked
          </div>
        ) : slowModeSeconds > 0 ? (
          <div className="text-xs font-black text-amber-900 bg-amber-50 border border-amber-200 rounded-full px-3 py-1 inline-flex items-center gap-2">
            <TimerReset className="w-4 h-4" /> Slow mode: {slowModeSeconds}s
          </div>
        ) : null}

        {canModerate ? (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <select
              value={String(slowModeSeconds)}
              onChange={(e) => {
                const next = Number(e.target.value);
                if (!Number.isFinite(next)) return;
                updateSettingsMutation.mutate({ slow_mode_seconds: next });
              }}
              disabled={updateSettingsMutation.isPending || isOffline}
              className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700"
            >
              <option value="0">Slow mode: off</option>
              <option value="15">Slow mode: 15s</option>
              <option value="30">Slow mode: 30s</option>
              <option value="60">Slow mode: 60s</option>
              <option value="120">Slow mode: 120s</option>
            </select>
            <button
              type="button"
              onClick={() => updateSettingsMutation.mutate({ locked: !locked })}
              disabled={updateSettingsMutation.isPending || isOffline}
              className={`h-9 px-3 rounded-xl border text-xs font-bold ${
                locked
                  ? 'bg-rose-50 border-rose-200 text-rose-800'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              {locked ? 'Unlock comments' : 'Lock comments'}
            </button>
            {isOffline && (
              <div className="text-[11px] font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-2 py-1">
                Offline: settings disabled
              </div>
            )}
          </div>
        ) : null}
      </div>

      <div className="mt-3 space-y-2">
        {!user ? (
          <div className="p-3 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-700 font-semibold">
            Sign in to comment.
            <Link to="/login" className="ml-2 text-[#3A3DFF] font-black">
              Go to login
            </Link>
          </div>
        ) : (
          <>
            <AlertDialog open={postConfirmOpen} onOpenChange={setPostConfirmOpen}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{confirmTitle}</AlertDialogTitle>
                  <AlertDialogDescription>{confirmDescription}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel
                    type="button"
                    onClick={() => {
                      setPostConfirmOpen(false);
                      setPostConfirmKind(null);
                      setPendingPostText('');
                    }}
                  >
                    Cancel
                  </AlertDialogCancel>
                  <AlertDialogAction
                    type="button"
                    onClick={() => {
                      const text = String(pendingPostText || '').trim();
                      setPostConfirmOpen(false);
                      setPostConfirmKind(null);
                      setPendingPostText('');
                      if (text) postMutation.mutate({ text });
                    }}
                  >
                    Post anyway
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={
                locked
                  ? 'Comments are locked'
                  : slowModeSeconds > 0
                    ? `Slow mode enabled (${slowModeSeconds}s between comments)`
                    : 'Write a comment…'
              }
              className="w-full min-h-20 p-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 font-semibold outline-none"
              disabled={locked || postMutation.isPending}
            />
            <button
              onClick={attemptPost}
              disabled={locked || postMutation.isPending}
              className="px-4 py-2 rounded-xl bg-slate-900 text-white font-black hover:opacity-90 disabled:opacity-60"
            >
              {postMutation.isPending ? 'Posting…' : 'Post'}
            </button>
          </>
        )}
      </div>

      <div className="mt-4">
        {isLoading ? (
          <div className="text-sm text-slate-600 font-semibold">Loading comments…</div>
        ) : comments.length === 0 ? (
          <div className="text-sm text-slate-600 font-semibold">No comments yet.</div>
        ) : (
          <div className="space-y-3">
            {comments.map((c, idx) => (
              <motion.div
                key={String(c?.id ?? idx)}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-4 rounded-2xl border border-slate-200 bg-white"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 bg-gradient-to-br from-[#3A3DFF] to-[#5B5EFF] rounded-full flex items-center justify-center flex-shrink-0">
                      <User className="w-4 h-4 text-white" />
                    </div>
                    <div>
                      <div className="text-sm font-black text-slate-900">{String(c?.author_email || 'Unknown')}</div>
                      <div className="text-xs text-slate-500 font-semibold">
                        {c?.created_at ? format(new Date(c.created_at), 'MMM d, h:mm a') : ''}
                      </div>
                    </div>
                  </div>
                  <ReportButton contentType="comment" contentId={String(c?.id ?? '')} />
                </div>

                <div className="mt-3 text-slate-800 font-semibold whitespace-pre-wrap">{String(c?.content || '')}</div>
              </motion.div>
            ))}

            {hasNextPage ? (
              <div className="pt-2 flex justify-center">
                <button
                  type="button"
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                  className="inline-flex items-center justify-center px-4 py-2 rounded-xl bg-white border-2 border-slate-200 text-slate-900 font-black hover:bg-slate-50"
                >
                  {isFetchingNextPage ? 'Loading…' : 'Load more'}
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
