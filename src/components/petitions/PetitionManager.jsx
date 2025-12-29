import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { entities } from '@/api/appClient';
import CreatePetitionModal from './CreatePetitionModal';
import PetitionCard from './PetitionCard';

export default function PetitionManager({ movementId, movement, className = '' }) {
  const safeMovementId = useMemo(
    () => String(movementId ?? movement?.id ?? movement?._id ?? '').trim(),
    [movementId, movement]
  );

  const [open, setOpen] = useState(false);

  const {
    data: petitions = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['stubPetitions', safeMovementId],
    enabled: !!safeMovementId,
    queryFn: async () => {
      if (!safeMovementId) return [];
      const list = await entities.Petition.filter({ movement_id: safeMovementId }, '-created_date', {
        limit: 20,
        offset: 0,
        fields: [
          'id',
          'title',
          'description',
          'target_audience',
          'deadline',
          'signature_count',
          'signature_goal',
          'created_date',
        ].join(','),
      });
      return Array.isArray(list) ? list : [];
    },
    retry: 1,
  });

  if (isError && error) {
    console.warn('[PetitionManager] failed to load petitions', error);
  }

  return (
    <div className={`p-4 rounded-xl border border-slate-200 bg-white ${className}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="font-black text-slate-900">Petitions</div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={!safeMovementId}
          className={`px-3 py-2 rounded-xl border text-xs font-black ${
            safeMovementId
              ? 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50'
              : 'border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed'
          }`}
        >
          Create (stub)
        </button>
      </div>

      {!safeMovementId ? (
        <div className="mt-2 text-sm text-slate-600 font-semibold">Petitions are not available yet.</div>
      ) : isLoading ? (
        <div className="mt-2 text-sm text-slate-600 font-semibold">Loading petitions…</div>
      ) : isError ? (
        <div className="mt-2 space-y-3">
          <div className="text-sm text-slate-600 font-semibold">We couldn’t load petitions. Please try again.</div>
          <button
            type="button"
            onClick={() => refetch()}
            className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-800 text-xs font-black hover:bg-slate-50"
          >
            Retry
          </button>
        </div>
      ) : petitions.length === 0 ? (
        <div className="mt-2 text-sm text-slate-600 font-semibold">No petitions yet.</div>
      ) : (
        <div className="mt-3 grid gap-3">
          {petitions.slice(0, 20).map((p, idx) => (
            <PetitionCard key={String(p?.id ?? idx)} petition={p} />
          ))}
        </div>
      )}

      <CreatePetitionModal open={open} onOpenChange={setOpen} movementId={safeMovementId} onCreated={() => {}} />
    </div>
  );
}