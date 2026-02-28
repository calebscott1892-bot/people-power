import React, { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '@/auth/AuthProvider';
import { fetchMovementVotes, voteMovement } from '@/api/movementsClient';
import { getInteractionErrorMessage } from '@/utils/interactionErrors';
import { queryKeys } from '@/lib/queryKeys';
import { usePendingGuard } from '@/hooks/usePendingGuard';
import { showPendingTimeoutToast } from '@/utils/pendingTimeoutToast';

export default function VoteButtons({ movementId, movement, className = '' }) {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const pendingGuard = usePendingGuard('vote');
  const [voteBusy, setVoteBusy] = React.useState(false);

  const id = useMemo(
    () => String(movementId ?? movement?.id ?? movement?._id ?? '').trim(),
    [movementId, movement]
  );

  const disabled = !id;
  const accessToken = session?.access_token ? String(session.access_token) : null;

  const {
    data: votes,
    isLoading,
    isError,
  } = useQuery({
    queryKey: queryKeys.movements.votes(id),
    enabled: !!id && !!accessToken,
    queryFn: async () => {
      return fetchMovementVotes(id, { accessToken });
    },
    staleTime: 5_000,
  });

  const upvotes = typeof votes?.upvotes === 'number' ? votes.upvotes : 0;
  const downvotes = typeof votes?.downvotes === 'number' ? votes.downvotes : 0;
  const myVote = typeof votes?.myVote === 'number' ? votes.myVote : 0;

  const mutation = useMutation({
    mutationFn: async (nextValue) => {
      if (!accessToken) throw new Error('Authentication required');
      return voteMovement(id, nextValue, { accessToken });
    },
    // Optimistic update: update UI instantly, rollback on server failure.
    onMutate: async (nextValue) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.movements.votes(id) });

      const previousVotes = queryClient.getQueryData(queryKeys.movements.votes(id));
      const prev = previousVotes || { upvotes, downvotes, score: 0, myVote };

      const optimistic = { ...prev, myVote: nextValue };
      const wasUp = prev.myVote === 1;
      const wasDown = prev.myVote === -1;

      if (nextValue === 1) {
        optimistic.upvotes = (prev.upvotes || 0) + 1;
        if (wasDown) optimistic.downvotes = Math.max(0, (prev.downvotes || 0) - 1);
      } else if (nextValue === -1) {
        optimistic.downvotes = (prev.downvotes || 0) + 1;
        if (wasUp) optimistic.upvotes = Math.max(0, (prev.upvotes || 0) - 1);
      } else {
        if (wasUp) optimistic.upvotes = Math.max(0, (prev.upvotes || 0) - 1);
        if (wasDown) optimistic.downvotes = Math.max(0, (prev.downvotes || 0) - 1);
      }
      optimistic.score = (optimistic.upvotes || 0) - (optimistic.downvotes || 0);

      queryClient.setQueryData(queryKeys.movements.votes(id), optimistic);
      return { previousVotes };
    },
    onError: (_err, _nextValue, context) => {
      if (context?.previousVotes) {
        queryClient.setQueryData(queryKeys.movements.votes(id), context.previousVotes);
      }
    },
    onSuccess: (next) => {
      queryClient.setQueryData(queryKeys.movements.votes(id), next);

      // Best-effort cache sync for movement detail + list (if they carry counts).
      queryClient.setQueryData(queryKeys.movements.detail(id), (old) => {
        if (!old || typeof old !== 'object') return old;
        return {
          ...old,
          upvotes: next?.upvotes,
          downvotes: next?.downvotes,
          score: next?.score,
          myVote: next?.myVote,
        };
      });

      queryClient.setQueryData(['movements'], (old) => {
        if (!Array.isArray(old)) return old;
        return old.map((m) => {
          const mid = String(m?.id ?? m?._id ?? '').trim();
          if (!mid || mid !== id) return m;
          return {
            ...m,
            upvotes: next?.upvotes,
            downvotes: next?.downvotes,
            score: next?.score,
          };
        });
      });
    },
  });

  const isBusy = voteBusy;

  const runVote = React.useCallback(
    async (nextValue) => {
      setVoteBusy(true);
      pendingGuard.start({
        retry: () => runVote(nextValue),
        onTimeout: ({ retry }) => {
          setVoteBusy(false);
          showPendingTimeoutToast({ retry });
        },
      });

      try {
        await mutation.mutateAsync(nextValue);
      } catch (e) {
        toast.error(getInteractionErrorMessage(e, 'Could not vote right now'));
      } finally {
        setVoteBusy(false);
        pendingGuard.stop();
      }
    },
    [mutation, pendingGuard]
  );

  const handleVote = async (value) => {
    if (!id) return;
    if (!accessToken) {
      toast.error('Please log in to vote');
      return;
    }

    // Clicking the same vote toggles it off.
    const nextValue = myVote === value ? 0 : value;
    runVote(nextValue);
  };

  const upActive = myVote === 1;
  const downActive = myVote === -1;

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <button
        type="button"
        onClick={() => handleVote(1)}
        disabled={disabled || isBusy || !accessToken}
        className={`px-3 py-2 rounded-xl border font-black text-xs ${
          disabled
            ? 'border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed'
            : upActive
              ? 'border-slate-900 bg-slate-900 text-white'
              : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50'
        }`}
        title={disabled ? 'Voting not available' : !accessToken ? 'Log in to vote' : 'Upvote'}
      >
        ▲ Upvote {isLoading ? '' : `(${upvotes})`}
      </button>
      <button
        type="button"
        onClick={() => handleVote(-1)}
        disabled={disabled || isBusy || !accessToken}
        className={`px-3 py-2 rounded-xl border font-black text-xs ${
          disabled
            ? 'border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed'
            : downActive
              ? 'border-slate-900 bg-slate-900 text-white'
              : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50'
        }`}
        title={disabled ? 'Voting not available' : !accessToken ? 'Log in to vote' : 'Downvote'}
      >
        ▼ Downvote {isLoading ? '' : `(${downvotes})`}
      </button>

      {isError ? (
        <span className="text-xs text-slate-500 font-semibold">Votes unavailable.</span>
      ) : null}
    </div>
  );
}