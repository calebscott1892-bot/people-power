import React from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';

import { useAuth } from '@/auth/AuthProvider';
import { fetchMovementById } from '@/api/movementsClient';
import { acceptCollaborationInvite, listMyCollaborationInvites, removeCollaborator } from '@/api/collaboratorsClient';

export default function CollaborationInvites() {
  const { user, session } = useAuth();
  const queryClient = useQueryClient();
  const myEmail = String(user?.email || '').trim();
  const accessToken = session?.access_token || null;

  const { data: invites = [], isLoading } = useQuery({
    queryKey: ['collaborationInvites', myEmail],
    enabled: !!myEmail && !!accessToken,
    retry: 1,
    queryFn: async () => {
      const pending = await listMyCollaborationInvites({ accessToken });

      const titles = await Promise.all(
        pending.map(async (c) => {
          try {
            const mv = await fetchMovementById(String(c?.movement_id || ''));
            return String(mv?.title || mv?.name || c?.movement_id || '');
          } catch {
            return String(c?.movement_id || '');
          }
        })
      );

      return pending.map((c, idx) => ({ ...c, movement_title: titles[idx] }));
    },
  });

  const acceptMutation = useMutation({
    mutationFn: async (collabId) => {
      await acceptCollaborationInvite(collabId, { accessToken });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['collaborationInvites', myEmail] });
    },
  });

  const declineMutation = useMutation({
    mutationFn: async (collabId) => {
      await removeCollaborator(collabId, { accessToken });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['collaborationInvites', myEmail] });
    },
  });

  return (
    <div className="max-w-4xl mx-auto px-4 py-12 space-y-6">
      <Link to="/" className="text-[#3A3DFF] font-bold">
        &larr; Back to home
      </Link>

      <div className="p-6 rounded-2xl border border-slate-200 bg-white shadow-sm space-y-4">
        <div>
          <h1 className="text-3xl font-black text-slate-900">Collaboration invites</h1>
          <p className="text-slate-600 font-semibold">Accept or decline invites to help organize movements.</p>
        </div>

        {!myEmail ? (
          <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 text-slate-700 font-semibold">
            Please log in to view invites.
          </div>
        ) : isLoading ? (
          <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 text-slate-700 font-semibold">
            Loading invites…
          </div>
        ) : invites.length === 0 ? (
          <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 text-slate-700 font-semibold">
            No pending invites.
          </div>
        ) : (
          <div className="space-y-3">
            {invites.map((inv) => (
              <div key={String(inv?.id)} className="p-4 rounded-xl border border-slate-200 bg-slate-50">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-black text-slate-900 truncate">
                      {String(inv?.movement_title || inv?.movement_id || 'Movement')}
                    </div>
                    <div className="mt-1 text-xs text-slate-600 font-bold">
                      Invited by: {String(inv?.invited_by || 'Unknown')} • Role: {String(inv?.role || 'viewer')}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => acceptMutation.mutate(String(inv.id))}
                      disabled={acceptMutation.isPending || declineMutation.isPending}
                      className="px-3 py-2 rounded-xl bg-slate-900 text-white text-xs font-black hover:opacity-90 disabled:opacity-60"
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      onClick={() => declineMutation.mutate(String(inv.id))}
                      disabled={acceptMutation.isPending || declineMutation.isPending}
                      className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-800 text-xs font-black hover:bg-slate-50 disabled:opacity-60"
                    >
                      Decline
                    </button>
                  </div>
                </div>

                <div className="mt-3">
                  <Link
                    to={`/movements/${encodeURIComponent(String(inv?.movement_id || ''))}`}
                    className="text-sm font-bold text-[#3A3DFF]"
                  >
                    View movement
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}