import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UserPlus, Loader2, Sparkles } from 'lucide-react';
import { toast } from "sonner";
import { useQuery } from '@tanstack/react-query';
import { entities } from "@/api/appClient";
import { checkActionAllowed, formatWaitMs } from '@/utils/antiBrigading';
import { useAuth } from '@/auth/AuthProvider';
import { inviteCollaborator } from '@/api/collaboratorsClient';

export default function InviteCollaboratorModal({ open, onClose, movementId, currentUser, movement }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('editor');
  const [suggestions, setSuggestions] = useState([]);
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const accessToken = session?.access_token || null;

  const { data: allProfiles = [] } = useQuery({
    queryKey: ['allProfiles'],
    queryFn: () => entities.UserProfile.list('-created_date', 100),
    enabled: open
  });

  // AI-powered skill matching
  React.useEffect(() => {
    if (open && movement && allProfiles.length > 0) {
      const movementTags = movement.tags || [];
      const scored = allProfiles
        .filter(p => p.user_email !== currentUser?.email && p.skills?.length > 0)
        .map(profile => {
          let score = 0;
          
          // Match skills to movement tags
          profile.skills.forEach(skill => {
            if (movementTags.some(tag => 
              skill.toLowerCase().includes(tag.toLowerCase()) || 
              tag.toLowerCase().includes(skill.toLowerCase())
            )) {
              score += 3;
            }
          });
          
          // Bonus for relevant skills
          if (movementTags.includes('Protest') || movementTags.includes('Advocacy')) {
            if (profile.skills.includes('Legal Advocacy') || profile.skills.includes('Public Speaking')) {
              score += 2;
            }
          }
          if (movementTags.includes('Fundraising')) {
            if (profile.skills.includes('Fundraising') || profile.skills.includes('Grant Writing')) {
              score += 2;
            }
          }
          
          return { profile, score };
        })
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
      
      setSuggestions(scored);
    }
  }, [open, movement, allProfiles, currentUser]);

  const inviteMutation = useMutation({
    mutationFn: async () => {
      if (!accessToken) throw new Error('Please log in to invite collaborators');

      const rateCheck = await checkActionAllowed({
        email: currentUser?.email ?? null,
        action: 'collaborator_invite',
        contextId: movementId,
        accessToken,
      });
      if (!rateCheck?.ok) {
        const wait = rateCheck?.retryAfterMs ? ` Try again in ${formatWaitMs(rateCheck.retryAfterMs)}.` : '';
        throw new Error(String(rateCheck?.reason || 'Please slow down.') + wait);
      }

      await inviteCollaborator(movementId, { user_email: email, role }, { accessToken });

      // Best-effort local notification (legacy stub). Don't block invite if this fails.
      try {
        await entities.Notification.create({
          recipient_email: email,
          type: 'movement_update',
          actor_email: currentUser.email,
          actor_name: currentUser.full_name || currentUser.email,
          content_id: movementId,
          content_title: 'invited you to collaborate'
        });
      } catch {
        // ignore
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['collaborators'] });
      toast.success('Invitation sent!');
      setEmail('');
      onClose();
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to send invitation');
    }
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-black">Invite Collaborator</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          {/* AI Suggestions */}
          {suggestions.length > 0 && (
            <div className="p-4 bg-gradient-to-br from-purple-50 to-pink-50 rounded-xl border-2 border-purple-200">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="w-4 h-4 text-purple-600" />
                <h4 className="text-sm font-black text-slate-900 uppercase">Suggested Based on Skills</h4>
              </div>
              <div className="space-y-2">
                {suggestions.map(({ profile }) => (
                  <button
                    key={profile.id}
                    type="button"
                    onClick={() => setEmail(profile.user_email)}
                    className="w-full p-3 bg-white rounded-lg border-2 border-slate-200 hover:border-purple-400 transition-colors text-left"
                  >
                    <div className="font-bold text-slate-900 mb-1">{profile.display_name}</div>
                    <div className="text-xs text-slate-500 mb-2">@{profile.username}</div>
                    <div className="flex flex-wrap gap-1">
                      {profile.skills?.slice(0, 3).map((skill, i) => (
                        <span key={i} className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded text-xs font-bold">
                          {skill}
                        </span>
                      ))}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="text-sm font-bold text-slate-700 mb-2 block">Email Address</label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="collaborator@example.com"
              className="rounded-xl border-2"
            />
          </div>

          <div>
            <label className="text-sm font-bold text-slate-700 mb-2 block">Role</label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger className="rounded-xl border-2">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">Admin - Full control</SelectItem>
                <SelectItem value="editor">Editor - Can edit & manage tasks</SelectItem>
                <SelectItem value="viewer">Viewer - Read only</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex gap-3 pt-4">
            <Button variant="outline" onClick={onClose} className="flex-1 rounded-xl font-bold">
              Cancel
            </Button>
            <Button
              onClick={() => inviteMutation.mutate()}
              disabled={!email || inviteMutation.isPending}
              className="flex-1 bg-[#3A3DFF] hover:bg-[#2A2DDD] rounded-xl font-bold"
            >
              {inviteMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <UserPlus className="w-4 h-4 mr-2" />
                  Send Invite
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function InviteDisabled() {
  return (
    <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-600">
      Invite collaborators from the movement page.
    </div>
  );
}