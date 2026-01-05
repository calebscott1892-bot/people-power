import React, { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useAuth } from '@/auth/AuthProvider';
import { fetchMyBlocks, unblockUser } from '@/api/blocksClient';
import { getInteractionErrorMessage } from '@/utils/interactionErrors';
import { queryKeys } from '@/lib/queryKeys';

export default function Settings() {
  const { user, session, isEmailVerified } = useAuth();
  const accessToken = session?.access_token || null;
  const queryClient = useQueryClient();

  const { data: myBlocks, isLoading } = useQuery({
    queryKey: queryKeys.blocks.mine(user?.email),
    queryFn: async () => fetchMyBlocks({ accessToken }),
    enabled: !!user?.email && !!accessToken,
  });

  const blocked = useMemo(() => {
    const list = myBlocks?.blocked;
    return Array.isArray(list) ? list : [];
  }, [myBlocks]);

  const unblockMutation = useMutation({
    mutationFn: async (email) => {
      const normalized = String(email || '').trim();
      if (!normalized) throw new Error('Missing user');
      return unblockUser(normalized, { accessToken });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.blocks.mine(user?.email) });
      toast.success('User unblocked');
    },
    onError: (e) => toast.error(getInteractionErrorMessage(e, 'Failed to unblock user')),
  });

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-0 py-6 space-y-6">
      <div className="bg-white rounded-3xl shadow-2xl border-3 border-slate-200 overflow-hidden">
        <div className="p-6 border-b-2 border-slate-200 bg-gradient-to-r from-slate-50 to-white">
          <h1 className="text-2xl font-black text-slate-900 uppercase tracking-tight">Settings</h1>
          <p className="text-sm text-slate-600 font-semibold mt-1">Manage your account preferences.</p>
        </div>

        <div className="p-6">
          <div className="rounded-2xl border-2 border-slate-200 bg-white p-4 mb-4">
            <div className="text-sm font-black text-slate-900 uppercase tracking-wider mb-2">Account</div>
            <div className="text-sm text-slate-800 font-semibold">
              <span className="font-black">Email:</span> {user?.email || '—'}
            </div>
            <div className="text-xs text-slate-600 font-semibold mt-1">
              {isEmailVerified ? 'Email verified' : 'Email not verified yet'}
            </div>
          </div>

          <div className="rounded-2xl border-2 border-slate-200 bg-slate-50 p-4">
            <div className="text-sm font-black text-slate-900 uppercase tracking-wider mb-2">Blocked users</div>
            <p className="text-xs text-slate-600 font-semibold mb-3">
              Blocking hides your profile, movements, and messages from each other. They won’t be notified.
            </p>

            {isLoading ? (
              <div className="flex items-center gap-2 text-sm text-slate-600 font-semibold">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading blocked users…
              </div>
            ) : blocked.length > 0 ? (
              <div className="space-y-2">
                {blocked.map((entry) => {
                  const email = String(entry?.email || '').trim();
                  const displayName = String(entry?.display_name || '').trim();
                  const username = String(entry?.username || '').trim().replace(/^@/, '');
                  const photoUrl = String(entry?.profile_photo_url || entry?.avatar_url || '').trim();
                  const label = displayName || (username ? `@${username}` : 'Blocked user');
                  const initial = (displayName?.[0] || username?.[0] || '?').toUpperCase();

                  return (
                    <div
                      key={email || `${username}-${label}`}
                      className="flex items-center justify-between gap-3 rounded-xl bg-white px-3 py-2"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <Avatar className="h-9 w-9">
                          {photoUrl ? <AvatarImage src={photoUrl} alt="" /> : null}
                          <AvatarFallback className="text-xs font-black text-slate-700">{initial}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <div className="text-sm font-bold text-slate-800 truncate">{label}</div>
                          {displayName && username ? (
                            <div className="text-xs text-slate-500 font-semibold truncate">@{username}</div>
                          ) : null}
                        </div>
                      </div>

                      <Button
                        type="button"
                        variant="outline"
                        className="h-9 rounded-lg border-slate-200 text-xs font-bold"
                        disabled={unblockMutation.isPending}
                        onClick={() => unblockMutation.mutate(email)}
                      >
                        Unblock
                      </Button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-xs text-slate-500 font-semibold">You haven’t blocked anyone yet.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
