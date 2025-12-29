import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Input } from "@/components/ui/input";
import { Loader2, Search } from 'lucide-react';
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { entities } from "@/api/appClient";
import { useAuth } from '@/auth/AuthProvider';
import { fetchMyFollowingUsers } from '@/api/userFollowsClient';
import { createConversation } from '@/api/messagesClient';

export default function ComposeModal({ open, onClose, currentUser }) {
  const [searchTerm, setSearchTerm] = useState('');
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const accessToken = session?.access_token || null;

  const { data: following = [], isLoading } = useQuery({
    queryKey: ['following', currentUser?.email],
    queryFn: async () => {
      if (!currentUser || !accessToken) return [];
      return fetchMyFollowingUsers({ accessToken });
    },
    enabled: open && !!currentUser && !!accessToken
  });

  const startConversationMutation = useMutation({
    mutationFn: async (recipientEmail) => {
      if (!accessToken) throw new Error('Sign in to message');
      const email = String(recipientEmail || '').trim();
      if (!email) throw new Error('Recipient is required');
      return createConversation(email, { accessToken });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      toast.success('Conversation started!');
      onClose();
    }
  });

  const filteredFollowing = following.filter(f => 
    !searchTerm || String(f?.email || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-black">New Message</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search people you follow..."
              className="pl-10 rounded-xl border-2"
            />
          </div>

          <div className="max-h-64 overflow-y-auto space-y-2">
            {isLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-6 h-6 text-[#3A3DFF] animate-spin" />
              </div>
            ) : filteredFollowing.length === 0 ? (
              <div className="text-center py-8 text-slate-500 text-sm">
                {searchTerm ? 'No matches found' : 'Follow people to message them'}
              </div>
            ) : (
              filteredFollowing.map((follow) => (
                <FollowingButton
                  key={String(follow?.email || '')}
                  userEmail={follow.email}
                  onSelect={() => startConversationMutation.mutate(follow.email)}
                  disabled={startConversationMutation.isPending}
                />
              ))
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FollowingButton({ userEmail, onSelect, disabled }) {
  const { data: profile } = useQuery({
    queryKey: ['userProfile', userEmail],
    queryFn: async () => {
      const profiles = await entities.UserProfile.filter(
        { user_email: userEmail },
        '-created_date',
        {
          limit: 1,
          fields: ['id', 'user_email', 'display_name', 'username', 'profile_photo_url'],
        }
      );
      return profiles[0] || null;
    },
    enabled: !!userEmail,
  });

  return (
    <button
      onClick={onSelect}
      disabled={disabled}
      className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 border-2 border-slate-200 transition-colors disabled:opacity-50"
    >
      <div className="w-10 h-10 bg-gradient-to-br from-[#3A3DFF] to-[#5B5EFF] rounded-full flex items-center justify-center flex-shrink-0">
        <span className="text-white font-black text-sm">
          {profile?.display_name?.[0]?.toUpperCase() || '?'}
        </span>
      </div>
      <div className="flex-1 text-left">
        <p className="font-bold text-slate-900">{profile?.display_name || 'User'}</p>
        <p className="text-xs text-slate-500">@{profile?.username}</p>
      </div>
    </button>
  );
}