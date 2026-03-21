import React, { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { useAuth } from '@/auth/AuthProvider';
import { fetchMovementVotes, voteMovement } from '@/api/movementsClient';
import { checkActionAllowed, formatWaitMs } from '@/utils/antiBrigading';
import { getInteractionErrorMessage } from '@/utils/interactionErrors';
import { upsertNotification } from '@/api/notificationsClient';
import { queryKeys } from '@/lib/queryKeys';
import { usePendingGuard } from '@/hooks/usePendingGuard';
import { showPendingTimeoutToast } from '@/utils/pendingTimeoutToast';
import { captureRequestDebugInfo } from '@/utils/requestDebug';

function getMovementOwnerEmail(movement) {
  const candidates = [
    movement?.author_email,
    movement?.creator_email,
    movement?.created_by_email,
    movement?.owner_email,
  ];
  for (const c of candidates) {
    const s = c ? String(c).trim().toLowerCase() : '';
    if (s) return s;
  }
  return null;
}

export default function BoostButtons({
  movementId,
  movement,
  className = '',
  disabled = false,
  disabledReason,
  requireRead = false,
  isReadEligible = true,
}) {
  const { session, user } = useAuth();
  const queryClient = useQueryClient();

  const id = useMemo(
    () => String(movementId ?? movement?.id ?? movement?._id ?? '').trim(),
    [movementId, movement]
  );

  const accessToken = session?.access_token ? String(session.access_token) : null;

  const votePendingGuard = usePendingGuard('Boost/Vote');
  const [voteBusy, setVoteBusy] = useState(false);
  const pendingVoteRef = useRef(null);

  const {
    data: votes,
    isError,
  } = useQuery({
    queryKey: queryKeys.movements.votes(id),
    enabled: !!id && !!accessToken,
    queryFn: async () => fetchMovementVotes(id, { accessToken }),
    staleTime: 5_000,
  });

  const boostsCount =
    typeof votes?.upvotes === 'number'
      ? votes.upvotes
      : (typeof movement?.boosts_count === 'number'
          ? movement.boosts_count
          : (typeof movement?.upvotes === 'number'
              ? movement.upvotes
              : (typeof movement?.boosts === 'number' ? movement.boosts : 0)));

  const downvotes =
    typeof votes?.downvotes === 'number'
      ? votes.downvotes
      : (typeof movement?.downvotes === 'number' ? movement.downvotes : 0);
  const myVote = typeof votes?.myVote === 'number' ? votes.myVote : 0;
  const momentum = typeof movement?.momentum_score === 'number' ? movement.momentum_score : 0;

  const mutation = useMutation({
    mutationFn: async (nextValue) => {
      if (!accessToken) throw new Error('Authentication required');
      return voteMovement(id, nextValue, { accessToken });
    },
    // Optimistic update: make the UI react instantly, rollback if server fails.
    onMutate: async (nextValue) => {
      // Cancel any outgoing refetches so they don't overwrite our optimistic update.
      await queryClient.cancelQueries({ queryKey: queryKeys.movements.votes(id) });

      // Snapshot previous value for rollback.
      const previousVotes = queryClient.getQueryData(queryKeys.movements.votes(id));

      // Optimistically compute new vote counts.
      const prev = previousVotes || { upvotes: boostsCount, downvotes, score: 0, myVote };
      const wasUp = prev.myVote === 1;
      const wasDown = prev.myVote === -1;
      const optimistic = { ...prev, myVote: nextValue };

      if (nextValue === 1) {
        optimistic.upvotes = (prev.upvotes || 0) + 1;
        if (wasDown) optimistic.downvotes = Math.max(0, (prev.downvotes || 0) - 1);
      } else if (nextValue === -1) {
        optimistic.downvotes = (prev.downvotes || 0) + 1;
        if (wasUp) optimistic.upvotes = Math.max(0, (prev.upvotes || 0) - 1);
      } else {
        // Toggle off
        if (wasUp) optimistic.upvotes = Math.max(0, (prev.upvotes || 0) - 1);
        if (wasDown) optimistic.downvotes = Math.max(0, (prev.downvotes || 0) - 1);
      }
      optimistic.score = (optimistic.upvotes || 0) - (optimistic.downvotes || 0);

      queryClient.setQueryData(queryKeys.movements.votes(id), optimistic);

      return { previousVotes };
    },
    onSuccess: (next, nextValue) => {
      const summary =
        next && typeof next === 'object' && next.votes && typeof next.votes === 'object'
          ? next.votes
          : next;

      // Best-effort public activity notification.
      try {
        const actorEmail = user?.email ? String(user.email).trim().toLowerCase() : null;
        const recipient = getMovementOwnerEmail(movement);
        const title = String(movement?.title || movement?.name || '').trim() || null;
        const justBoosted = nextValue === 1 && myVote !== 1;
        if (justBoosted && actorEmail && recipient && actorEmail !== recipient) {
          const actorName = null;
          upsertNotification({
            recipient_email: recipient,
            type: 'movement_boost',
            actor_name: actorName,
            actor_email: actorEmail,
            content_id: id,
            content_ref: null,
            content_title: title,
            created_date: new Date().toISOString(),
            is_read: false,
            metadata: null,
          }, { accessToken }).catch(() => {});
        }
      } catch {
        // best-effort
      }

      queryClient.setQueryData(queryKeys.movements.votes(id), summary);

      // Keep movement detail view in sync immediately.
      queryClient.setQueryData(queryKeys.movements.detail(id), (old) => {
        if (!old || typeof old !== 'object') return old;
        return {
          ...old,
          upvotes: typeof summary?.upvotes === 'number' ? summary.upvotes : old.upvotes,
          downvotes: typeof summary?.downvotes === 'number' ? summary.downvotes : old.downvotes,
          score: typeof summary?.score === 'number' ? summary.score : old.score,
          boosts_count: typeof summary?.upvotes === 'number' ? summary.upvotes : old.boosts_count,
        };
      });

      // Keep list + infinite feeds in sync immediately.
      const patchMovementInAnyList = (old) => {
        const patchMovement = (m) => {
          if (!m || typeof m !== 'object') return m;
          const mid = String(m?.id ?? m?._id ?? '').trim();
          if (!mid || mid !== id) return m;
          return {
            ...m,
            upvotes: typeof summary?.upvotes === 'number' ? summary.upvotes : m.upvotes,
            downvotes: typeof summary?.downvotes === 'number' ? summary.downvotes : m.downvotes,
            score: typeof summary?.score === 'number' ? summary.score : m.score,
            boosts_count: typeof summary?.upvotes === 'number' ? summary.upvotes : m.boosts_count,
          };
        };

        // InfiniteQuery shape
        if (old && typeof old === 'object' && Array.isArray(old.pages)) {
          return {
            ...old,
            pages: old.pages.map((page) => (Array.isArray(page) ? page.map(patchMovement) : page)),
          };
        }

        // Normal list shape
        if (Array.isArray(old)) return old.map(patchMovement);
        return old;
      };

      // Home/feed + other list views.
      queryClient.setQueriesData({ queryKey: ['movements'] }, patchMovementInAnyList);
      queryClient.setQueriesData({ queryKey: ['myMovements'] }, patchMovementInAnyList);
      queryClient.setQueriesData({ queryKey: ['followedMovements'] }, patchMovementInAnyList);
      queryClient.setQueriesData({ queryKey: ['searchMovements'] }, patchMovementInAnyList);
      queryClient.setQueriesData({ queryKey: ['userMovements'] }, patchMovementInAnyList);
      queryClient.setQueriesData({ queryKey: ['participatedMovements'] }, patchMovementInAnyList);

      // Targeted refetch: only the specific movement detail and votes.
      // With optimistic updates + cache patching above, we don't need to
      // blast-invalidate every list query (which caused refetch storms).
      queryClient.invalidateQueries({ queryKey: queryKeys.movements.detail(id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.movements.votes(id) });
    },
    onError: (e, _nextValue, context) => {
      // Rollback optimistic update on failure.
      if (context?.previousVotes) {
        queryClient.setQueryData(queryKeys.movements.votes(id), context.previousVotes);
      }
      toast.error(getInteractionErrorMessage(e, 'Could not boost right now'));
    },
  });

  const isBusy = voteBusy;

  const readLocked = requireRead && !isReadEligible;
  const effectiveDisabled = disabled || readLocked;
  const effectiveDisabledReason =
    disabledReason || (readLocked ? 'Read a bit first (unlocks in ~3s or near bottom)' : undefined);

  const startVoteAttempt = (pendingValue) => {
    pendingVoteRef.current = pendingValue;
    setVoteBusy(true);

    votePendingGuard.start({
      retry: () => startVoteAttempt(pendingValue),
      onTimeout: () => {
        setVoteBusy(false);
        captureRequestDebugInfo({
          label: 'Boost/Vote',
          endpoint: id ? `/movements/${encodeURIComponent(String(id))}/vote` : '/movements/:id/vote',
          method: 'POST',
          elapsed_ms: votePendingGuard.timeoutMs,
          error_message: 'Timed out after 10s',
        });
        showPendingTimeoutToast({ retry: () => startVoteAttempt(pendingValue) });
        votePendingGuard.stop();
      },
    });

    mutation.mutate(pendingValue, {
      onSettled: () => {
        setVoteBusy(false);
        votePendingGuard.stop();
      },
    });
  };

  const handleVote = async (value) => {
    if (!id) return;
    if (effectiveDisabled) {
      toast.message(effectiveDisabledReason ? String(effectiveDisabledReason) : 'Please read a bit more before voting.');
      return;
    }
    if (!accessToken) {
      toast.error('Please log in to boost');
      return;
    }
    const nextValue = myVote === value ? 0 : value;

    // Anti-brigading: allow undo freely, but rate-limit casting votes.
    if (nextValue !== 0) {
      const check = await checkActionAllowed({
        email: user?.email ?? null,
        action: 'boost_vote',
        contextId: id,
        accessToken,
      });
      if (!check?.ok) {
        const wait = check?.retryAfterMs ? ` Try again in ${formatWaitMs(check.retryAfterMs)}.` : '';
        toast.message(String(check?.reason || 'Please slow down.') + wait);
        return;
      }
    }

    startVoteAttempt(nextValue);
  };

  const boostActive = myVote === 1;
  const downActive = myVote === -1;

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <motion.button
        type="button"
        whileTap={{ scale: 0.95 }}
        onClick={() => handleVote(1)}
        disabled={effectiveDisabled || !id || isBusy || !accessToken}
        className={`px-3 py-2 rounded-xl border font-bold text-xs transition-colors ${
          (effectiveDisabled || !id)
            ? 'border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed'
            : boostActive
              ? 'border-[#3A3DFF] bg-[#3A3DFF] text-white'
              : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-100 hover:border-slate-300'
        }`}
        title={
          effectiveDisabled
            ? (effectiveDisabledReason ? String(effectiveDisabledReason) : 'Please read before voting')
            : (!accessToken ? 'Log in to boost' : 'Boost')
        }
      >
        Boost ({boostsCount})
      </motion.button>

      <motion.button
        type="button"
        whileTap={{ scale: 0.95 }}
        onClick={() => handleVote(-1)}
        disabled={effectiveDisabled || !id || isBusy || !accessToken}
        className={`px-3 py-2 rounded-xl border font-bold text-xs transition-colors ${
          (effectiveDisabled || !id)
            ? 'border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed'
            : downActive
              ? 'border-slate-900 bg-slate-900 text-white'
              : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-100 hover:border-slate-300'
        }`}
        title={
          effectiveDisabled
            ? (effectiveDisabledReason ? String(effectiveDisabledReason) : 'Please read before voting')
            : (!accessToken ? 'Log in to downvote' : 'Downvote')
        }
      >
        Downvote ({downvotes})
      </motion.button>

      <div className="text-xs font-semibold text-slate-700 px-3 py-2 rounded-xl border border-slate-200 bg-slate-50">
        Momentum: {Math.round(momentum)}
      </div>

      {isError ? <span className="text-xs text-slate-500 font-semibold">Votes unavailable.</span> : null}
    </div>
  );
}