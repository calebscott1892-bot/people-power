import React, { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { useAuth } from '@/auth/AuthProvider';
import { fetchMovementVotes, voteMovement } from '@/api/movementsClient';
import { checkActionAllowed, formatWaitMs } from '@/utils/antiBrigading';

export default function BoostButtons({ movementId, movement, className = '' }) {
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
    queryKey: ['movementVotes', id],
    enabled: !!id && !!accessToken,
    queryFn: async () => fetchMovementVotes(id, { accessToken }),
    staleTime: 5_000,
  });

  const upvotes = typeof votes?.upvotes === 'number' ? votes.upvotes : (typeof movement?.upvotes === 'number' ? movement.upvotes : 0);
  const downvotes = typeof votes?.downvotes === 'number' ? votes.downvotes : (typeof movement?.downvotes === 'number' ? movement.downvotes : 0);
  const myVote = typeof votes?.myVote === 'number' ? votes.myVote : 0;
  const momentum = typeof movement?.momentum_score === 'number' ? movement.momentum_score : 0;

  const mutation = useMutation({
    mutationFn: async (nextValue) => {
      if (!accessToken) throw new Error('Authentication required');
      return voteMovement(id, nextValue, { accessToken });
    },
    onSuccess: (next) => {
      queryClient.setQueryData(['movementVotes', id], next);
      queryClient.invalidateQueries({ queryKey: ['movements'] });
      queryClient.invalidateQueries({ queryKey: ['movement', id] });
    },
    onError: (e) => toast.error(String(e?.message || 'Could not boost right now')),
  });

  const isBusy = mutation.isPending;

  const handleVote = async (value) => {
    if (!id) return;
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
        disabled={!id || isBusy || !accessToken}
        className={`px-3 py-2 rounded-xl border font-black text-xs ${
          !id
            ? 'border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed'
            : boostActive
              ? 'border-[#3A3DFF] bg-[#3A3DFF] text-white'
              : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50'
        }`}
        title={!accessToken ? 'Log in to boost' : 'Boost'}
      >
        ⚡ Boost ({upvotes})
      </motion.button>

      <motion.button
        type="button"
        whileTap={{ scale: 0.98 }}
        onClick={() => handleVote(-1)}
        disabled={!id || isBusy || !accessToken}
        className={`px-3 py-2 rounded-xl border font-black text-xs ${
          !id
            ? 'border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed'
            : downActive
              ? 'border-slate-900 bg-slate-900 text-white'
              : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50'
        }`}
        title={!accessToken ? 'Log in to downvote' : 'Downvote'}
      >
        ▼ Downvote ({downvotes})
      </motion.button>

      <div className="text-xs font-black text-slate-700 px-3 py-2 rounded-xl border border-slate-200 bg-slate-50">
        Momentum: {Math.round(momentum)}
      </div>

      {isError ? <span className="text-xs text-slate-500 font-semibold">Votes unavailable.</span> : null}
    </div>
  );
}