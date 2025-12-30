import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { entities } from '@/api/appClient';
import UploadResourceModal from './UploadResourceModal';
import ResourceCard from './ResourceCard';
import { logError } from '@/utils/logError';

export default function ResourceManager({ movementId, movement, className = '' }) {
  const safeMovementId = useMemo(
    () => String(movementId ?? movement?.id ?? movement?._id ?? '').trim(),
    [movementId, movement]
  );

  const [open, setOpen] = useState(false);

  const {
    data: resources = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['stubResources', safeMovementId],
    enabled: !!safeMovementId,
    queryFn: async () => {
      if (!safeMovementId) return [];
      const list = await entities.Resource.filter({ movement_id: safeMovementId }, '-created_date', {
        limit: 20,
        fields: ['id', 'title', 'name', 'url', 'link', 'description', 'created_date'],
      });
      return Array.isArray(list) ? list : [];
    },
    retry: 1,
  });

  if (isError && error) {
    logError(error, 'Resource manager load failed', { movementId: safeMovementId });
  }

  return (
    <div className={`p-4 rounded-xl border border-slate-200 bg-white ${className}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="font-black text-slate-900">Resources</div>
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
          Add (stub)
        </button>
      </div>

      {!safeMovementId ? (
        <div className="mt-2 text-sm text-slate-600 font-semibold">
          Resources are not available yet.
        </div>
      ) : isLoading ? (
        <div className="mt-2 text-sm text-slate-600 font-semibold">Loading resources…</div>
      ) : isError ? (
        <div className="mt-2 space-y-3">
          <div className="text-sm text-slate-600 font-semibold">We couldn’t load resources. Please try again.</div>
          <button
            type="button"
            onClick={() => refetch()}
            className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-800 text-xs font-black hover:bg-slate-50"
          >
            Retry
          </button>
        </div>
      ) : resources.length === 0 ? (
        <div className="mt-2 text-sm text-slate-600 font-semibold">No resources yet.</div>
      ) : (
        <div className="mt-3 grid gap-3">
          {resources.slice(0, 20).map((r, idx) => (
            <ResourceCard key={String(r?.id ?? idx)} resource={r} />
          ))}
        </div>
      )}

      <UploadResourceModal
        open={open}
        onOpenChange={setOpen}
        movementId={safeMovementId}
        onCreated={() => {
          // no-op; react-query refetch wiring can come later
        }}
      />
    </div>
  );
}
