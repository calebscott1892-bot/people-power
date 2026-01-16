import React, { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { useAuth } from '@/auth/AuthProvider';
import { fetchMovementVotes, voteMovement } from '@/api/movementsClient';
import { checkActionAllowed, formatWaitMs } from '@/utils/antiBrigading';
import { getInteractionErrorMessage } from '@/utils/interactionErrors';
import { upsertNotification } from '@/api/notificationsClient';
import { queryKeys } from '@/lib/queryKeys';

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

      // Refetch as a safety net (also covers other screens).
      queryClient.invalidateQueries({ queryKey: ['movements'] });
      queryClient.invalidateQueries({ queryKey: ['myMovements'] });
      queryClient.invalidateQueries({ queryKey: ['followedMovements'] });
      queryClient.invalidateQueries({ queryKey: ['searchMovements'] });
      queryClient.invalidateQueries({ queryKey: ['userMovements'] });
      queryClient.invalidateQueries({ queryKey: ['participatedMovements'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.movements.detail(id) });
    },
    onError: (e) => toast.error(getInteractionErrorMessage(e, 'Could not boost right now')),
  });

  const isBusy = mutation.isPending;

  const readLocked = requireRead && !isReadEligible;
  const effectiveDisabled = disabled || readLocked;
  const effectiveDisabledReason =
    disabledReason || (readLocked ? 'Read a bit first (unlocks in ~3s or near bottom)' : undefined);

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

    mutation.mutate(nextValue);
  };

  const boostActive = myVote === 1;
  const downActive = myVote === -1;

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <motion.button
        type="button"
        whileTap={{ scale: 0.98 }}
        onClick={() => handleVote(1)}
        disabled={effectiveDisabled || !id || isBusy || !accessToken}
        className={`px-3 py-2 rounded-xl border font-black text-xs ${
          (effectiveDisabled || !id)
            ? 'border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed'
            : boostActive
              ? 'border-[#3A3DFF] bg-[#3A3DFF] text-white'
              : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50'
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
        whileTap={{ scale: 0.98 }}
        onClick={() => handleVote(-1)}
        disabled={effectiveDisabled || !id || isBusy || !accessToken}
        className={`px-3 py-2 rounded-xl border font-black text-xs ${
          (effectiveDisabled || !id)
            ? 'border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed'
            : downActive
              ? 'border-slate-900 bg-slate-900 text-white'
              : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50'
        }`}
        title={
          effectiveDisabled
            ? (effectiveDisabledReason ? String(effectiveDisabledReason) : 'Please read before voting')
            : (!accessToken ? 'Log in to downvote' : 'Downvote')
        }
      >
        Downvote ({downvotes})
      </motion.button>

      <div className="text-xs font-black text-slate-700 px-3 py-2 rounded-xl border border-slate-200 bg-slate-50">
        Momentum: {Math.round(momentum)}
      </div>

      {isError ? <span className="text-xs text-slate-500 font-semibold">Votes unavailable.</span> : null}
    </div>
  );
}