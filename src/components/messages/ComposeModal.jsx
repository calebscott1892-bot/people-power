import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from '@/auth/AuthProvider';
import { fetchMyFollowers, fetchMyFollowingUsers } from '@/api/userFollowsClient';
import { createConversation, createGroupConversation } from '@/api/messagesClient';
import { lookupUsersByEmail, searchUsers } from '@/api/usersClient';
import { checkActionAllowed, formatWaitMs } from '@/utils/antiBrigading';
import { isAdmin as isAdminEmail } from '@/utils/staff';
import { uploadFile } from '@/api/uploadsClient';
import { ALLOWED_IMAGE_MIME_TYPES, MAX_UPLOAD_BYTES, validateFileUpload } from '@/utils/uploadLimits';

const MAX_RESULTS = 10;
const SEARCH_DEBOUNCE_MS = 400;

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeUserRecord(record) {
  const email = String(record?.email || record?.user_email || '').trim();
  const displayName = String(record?.display_name || record?.full_name || '').trim();
  const username = String(record?.username || '').trim();
  const avatarUrl = String(record?.profile_photo_url || record?.avatar_url || '').trim();
  const location = record?.location || null;
  return {
    email,
    displayName,
    username,
    avatarUrl,
    location,
  };
}

function mergeProfilesWithEmails(emails, profiles) {
  const output = [];
  const seen = new Set();
  const normalized = Array.isArray(profiles) ? profiles.map(normalizeUserRecord) : [];
  for (const profile of normalized) {
    const emailKey = normalizeEmail(profile.email);
    if (!emailKey || seen.has(emailKey)) continue;
    seen.add(emailKey);
    output.push(profile);
  }
  const list = Array.isArray(emails) ? emails : [];
  for (const email of list) {
    const emailKey = normalizeEmail(email);
    if (!emailKey || seen.has(emailKey)) continue;
    seen.add(emailKey);
    output.push({ email: emailKey, displayName: '', username: '', avatarUrl: '', location: null });
  }
  return output;
}

function formatIdentifier(user) {
  if (!user) return 'Member';
  const username = String(user.username || '').trim();
  if (username) return `@${username}`;
  const email = String(user.email || '').trim();
  if (!email) return 'Member';
  const [name, domain] = email.split('@');
  const prefix = name ? `${name.slice(0, 2)}***` : '***';
  return domain ? `${prefix}@${domain}` : prefix;
}

function formatLocation(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  const city = value?.city ? String(value.city) : '';
  const region = value?.region ? String(value.region) : '';
  const country = value?.country ? String(value.country) : '';
  const parts = [city, region, country].filter(Boolean);
  return parts.join(', ');
}

function matchesQuery(user, term) {
  if (!term) return true;
  const q = term.toLowerCase();
  const display = String(user?.displayName || '').toLowerCase();
  const username = String(user?.username || '').toLowerCase();
  const email = String(user?.email || '').toLowerCase();
  return display.includes(q) || username.includes(q) || email.includes(q);
}

function looksLikeEmail(value) {
  const s = String(value || '').trim();
  if (!s) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export default function ComposeModal({ open, onClose, currentUser, onConversationStarted }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [mode, setMode] = useState('direct');
  const [groupName, setGroupName] = useState('');
  const [groupAvatarFile, setGroupAvatarFile] = useState(null);
  const [groupAvatarPreview, setGroupAvatarPreview] = useState('');
  const [groupSelectedEmails, setGroupSelectedEmails] = useState([]);
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const accessToken = session?.access_token || null;
  const myEmail = currentUser?.email || '';
  const myEmailNormalized = useMemo(() => normalizeEmail(myEmail), [myEmail]);
  const MAX_GROUP_SIZE = 10;
  const maxSelectable = MAX_GROUP_SIZE - 1;

  useEffect(() => {
    return () => {
      if (groupAvatarPreview) {
        URL.revokeObjectURL(groupAvatarPreview);
      }
    };
  }, [groupAvatarPreview]);

  useEffect(() => {
    if (!open) {
      setSearchTerm('');
      setDebouncedSearch('');
      setMode('direct');
      setGroupName('');
      setGroupAvatarFile(null);
      setGroupAvatarPreview('');
      setGroupSelectedEmails([]);
      return;
    }
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [open, searchTerm]);

  const { data: following = [], isLoading: followingLoading } = useQuery({
    queryKey: ['following', currentUser?.email],
    queryFn: async () => {
      if (!currentUser || !accessToken) return [];
      return fetchMyFollowingUsers({ accessToken });
    },
    enabled: open && !!currentUser && !!accessToken
  });

  const { data: followers = [], isLoading: followersLoading } = useQuery({
    queryKey: ['followers', currentUser?.email],
    queryFn: async () => {
      if (!currentUser || !accessToken) return [];
      return fetchMyFollowers({ accessToken });
    },
    enabled: open && !!currentUser && !!accessToken
  });

  const followingEmails = useMemo(() => {
    return Array.isArray(following)
      ? following.map((u) => String(u?.email || '').trim()).filter(Boolean)
      : [];
  }, [following]);

  const followerEmails = useMemo(() => {
    return Array.isArray(followers)
      ? followers.map((u) => String(u?.email || '').trim()).filter(Boolean)
      : [];
  }, [followers]);

  const { data: followingProfiles = [], isLoading: followingProfilesLoading } = useQuery({
    queryKey: ['followingProfiles', followingEmails.join('|')],
    queryFn: () => lookupUsersByEmail(followingEmails, { accessToken }),
    enabled: open && !!accessToken && followingEmails.length > 0,
    staleTime: 1000 * 60 * 5,
  });

  const { data: followerProfiles = [], isLoading: followerProfilesLoading } = useQuery({
    queryKey: ['followerProfiles', followerEmails.join('|')],
    queryFn: () => lookupUsersByEmail(followerEmails, { accessToken }),
    enabled: open && !!accessToken && followerEmails.length > 0,
    staleTime: 1000 * 60 * 5,
  });

  const trimmedQuery = useMemo(() => String(searchTerm || '').trim(), [searchTerm]);
  const debouncedQuery = useMemo(() => String(debouncedSearch || '').trim(), [debouncedSearch]);
  const groupCount = useMemo(
    () => groupSelectedEmails.length + (myEmailNormalized ? 1 : 0),
    [groupSelectedEmails, myEmailNormalized]
  );

  const toggleGroupEmail = (email) => {
    const normalized = normalizeEmail(email);
    if (!normalized || normalized === myEmailNormalized) return;
    setGroupSelectedEmails((prev) => {
      const exists = prev.includes(normalized);
      if (exists) return prev.filter((e) => e !== normalized);
      if (prev.length >= maxSelectable) {
        toast.error(`Group chats are limited to ${MAX_GROUP_SIZE} members.`);
        return prev;
      }
      return [...prev, normalized];
    });
  };

  const handleGroupAvatarChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const error = validateFileUpload({
      file,
      maxBytes: MAX_UPLOAD_BYTES,
      allowedMimeTypes: ALLOWED_IMAGE_MIME_TYPES,
    });
    if (error) {
      toast.error(error);
      return;
    }
    if (groupAvatarPreview) {
      URL.revokeObjectURL(groupAvatarPreview);
    }
    setGroupAvatarFile(file);
    setGroupAvatarPreview(URL.createObjectURL(file));
  };

  const {
    data: directoryMatches = [],
    isLoading: searchLoading,
    isError: searchError,
  } = useQuery({
    queryKey: ['userSearch', debouncedQuery],
    queryFn: () => searchUsers(debouncedQuery, { accessToken, limit: 15 }),
    enabled: open && !!accessToken && !!debouncedQuery,
  });

  const startConversationMutation = useMutation({
    mutationFn: async (recipientEmail) => {
      if (!accessToken) throw new Error('Sign in to message');
      const email = String(recipientEmail || '').trim().toLowerCase();
      if (!email) throw new Error('Recipient is required');
      if (email && email === myEmailNormalized) {
        throw new Error('You cannot message yourself');
      }

      const rateCheck = await checkActionAllowed({
        email: myEmail,
        action: 'conversation_create',
        contextId: 'global',
        accessToken,
      });
      if (!rateCheck?.ok) {
        const wait = rateCheck?.retryAfterMs ? ` Try again in ${formatWaitMs(rateCheck.retryAfterMs)}.` : '';
        throw new Error(String(rateCheck?.reason || 'Please slow down.') + wait);
      }
      return createConversation(email, { accessToken, myEmail });
    },
    onSuccess: (conversation) => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      toast.success('Conversation started');
      if (onConversationStarted) onConversationStarted(conversation);
      onClose();
    },
    onError: (e) => {
      toast.error(e?.message || 'Failed to start conversation');
    },
  });

  const createGroupMutation = useMutation({
    mutationFn: async () => {
      if (!accessToken) throw new Error('Sign in to create a group chat');
      const name = String(groupName || '').trim();
      if (!name) throw new Error('Group name is required');
      if (!groupSelectedEmails.length) throw new Error('Select at least one participant');
      if (groupSelectedEmails.length > maxSelectable) {
        throw new Error(`Group chats are limited to ${MAX_GROUP_SIZE} members.`);
      }

      const rateCheck = await checkActionAllowed({
        email: myEmail,
        action: 'conversation_create',
        contextId: 'group',
        accessToken,
      });
      if (!rateCheck?.ok) {
        const wait = rateCheck?.retryAfterMs ? ` Try again in ${formatWaitMs(rateCheck.retryAfterMs)}.` : '';
        throw new Error(String(rateCheck?.reason || 'Please slow down.') + wait);
      }

      let avatarUrl = null;
      if (groupAvatarFile) {
        const uploaded = await uploadFile(groupAvatarFile, {
          accessToken,
          maxBytes: MAX_UPLOAD_BYTES,
          allowedMimeTypes: ALLOWED_IMAGE_MIME_TYPES,
          kind: 'group_avatar',
        });
        avatarUrl = uploaded?.url ? String(uploaded.url) : null;
      }

      return createGroupConversation(
        {
          group_name: name,
          participant_emails: groupSelectedEmails,
          group_avatar_url: avatarUrl,
          group_post_mode: 'all',
        },
        { accessToken }
      );
    },
    onSuccess: (conversation) => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      toast.success('Group chat created');
      if (onConversationStarted) onConversationStarted(conversation);
      onClose();
    },
    onError: (e) => {
      toast.error(e?.message || 'Failed to create group chat');
    },
  });

  const normalizedFollowing = useMemo(
    () => mergeProfilesWithEmails(followingEmails, followingProfiles),
    [followingEmails, followingProfiles]
  );
  const normalizedFollowers = useMemo(
    () => mergeProfilesWithEmails(followerEmails, followerProfiles),
    [followerEmails, followerProfiles]
  );
  const normalizedDirectory = useMemo(
    () => (Array.isArray(directoryMatches) ? directoryMatches.map(normalizeUserRecord) : []),
    [directoryMatches]
  );

  // FIX: prioritize DM compose results by follow relationship before directory matches.
  const results = useMemo(() => {
    const term = debouncedQuery.toLowerCase();
    const seen = new Set();
    const output = [];

    function pushList(list, source) {
      for (const item of list) {
        if (!item?.email) continue;
        const emailKey = normalizeEmail(item.email);
        if (!emailKey || emailKey === myEmailNormalized || seen.has(emailKey)) continue;
        if (!matchesQuery(item, term)) continue;
        seen.add(emailKey);
        output.push({ ...item, source });
        if (output.length >= MAX_RESULTS) break;
      }
    }

    const followingMatches = term ? normalizedFollowing : normalizedFollowing;
    const followerMatches = term ? normalizedFollowers : normalizedFollowers;
    const directoryList = term ? normalizedDirectory : [];

    pushList(followingMatches, 'Following');
    pushList(followerMatches, 'Follows you');
    pushList(directoryList, 'Community');

    return output.slice(0, MAX_RESULTS);
  }, [debouncedQuery, normalizedFollowing, normalizedFollowers, normalizedDirectory, myEmailNormalized]);

  const showEmailShortcut = useMemo(() => {
    if (!looksLikeEmail(trimmedQuery)) return null;
    const candidate = normalizeEmail(trimmedQuery);
    if (!candidate || candidate === myEmailNormalized) return null;
    const exists = results.some((r) => normalizeEmail(r.email) === candidate);
    return exists ? null : candidate;
  }, [trimmedQuery, results, myEmailNormalized]);

  const isLoading =
    followingLoading ||
    followersLoading ||
    followingProfilesLoading ||
    followerProfilesLoading ||
    (debouncedQuery ? searchLoading : false);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-black">
            {mode === 'group' ? 'New Group Chat' : 'New Message'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          <div className="flex gap-2">
            <Button
              type="button"
              variant={mode === 'direct' ? 'default' : 'outline'}
              className={mode === 'direct' ? 'h-10 rounded-xl font-bold bg-[#3A3DFF] hover:bg-[#2A2DDD]' : 'h-10 rounded-xl font-bold'}
              onClick={() => setMode('direct')}
            >
              Direct
            </Button>
            <Button
              type="button"
              variant={mode === 'group' ? 'default' : 'outline'}
              className={mode === 'group' ? 'h-10 rounded-xl font-bold bg-[#3A3DFF] hover:bg-[#2A2DDD]' : 'h-10 rounded-xl font-bold'}
              onClick={() => setMode('group')}
            >
              Group
            </Button>
          </div>

          {mode === 'group' ? (
            <div className="space-y-3 rounded-2xl border-2 border-slate-200 p-3">
              <div className="space-y-2">
                <label className="text-xs font-black text-slate-500">Group name</label>
                <Input
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder="Give your group a name"
                  className="rounded-xl border-2"
                />
                <div className="text-[11px] font-semibold text-slate-500">
                  Messages are end-to-end encrypted. Group name, photo, and member list are visible to participants.
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Avatar className="h-12 w-12">
                  <AvatarImage src={groupAvatarPreview || undefined} alt="Group avatar preview" />
                  <AvatarFallback className="bg-slate-200 text-slate-700 font-black">
                    {groupName?.[0]?.toUpperCase() || 'G'}
                  </AvatarFallback>
                </Avatar>
                <div className="space-y-1">
                  <label className="text-xs font-black text-slate-500" htmlFor="group-avatar-input">
                    Group photo (optional)
                  </label>
                  <input
                    id="group-avatar-input"
                    type="file"
                    accept={ALLOWED_IMAGE_MIME_TYPES.join(',')}
                    onChange={handleGroupAvatarChange}
                    className="text-xs"
                  />
                </div>
              </div>

              <div className="text-xs font-bold text-slate-500">
                Members: {groupCount}/{MAX_GROUP_SIZE} (you’re included)
              </div>
              {groupSelectedEmails.length ? (
                <div className="flex flex-wrap gap-2">
                  {groupSelectedEmails.map((email) => (
                    <button
                      key={email}
                      type="button"
                      onClick={() => toggleGroupEmail(email)}
                      className="px-3 py-1 rounded-full bg-slate-100 text-xs font-bold text-slate-700"
                    >
                      {email}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-slate-500">Select up to {maxSelectable} people below.</div>
              )}
            </div>
          ) : null}

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={mode === 'group' ? 'Search people to add…' : 'Search by display name or @handle'}
              className="pl-10 rounded-xl border-2"
            />
          </div>

          <div className="max-h-64 overflow-y-auto space-y-2">
            {isLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-6 h-6 text-[#3A3DFF] animate-spin" />
              </div>
            ) : results.length === 0 ? (
              <div className="text-center py-8 text-slate-500 text-sm">
                {trimmedQuery
                  ? (searchError ? 'Search unavailable. Try again.' : 'No users found')
                  : 'Start typing to find people'}
              </div>
            ) : (
              results.map((user) => {
                const isAdminUser = user?.email ? isAdminEmail(user.email) : false;
                const emailKey = normalizeEmail(user.email);
                const isSelected = mode === 'group' && groupSelectedEmails.includes(emailKey);
                return (
                  <button
                    key={String(user.email)}
                    onClick={() =>
                      mode === 'group'
                        ? toggleGroupEmail(user.email)
                        : startConversationMutation.mutate(user.email)
                    }
                    disabled={startConversationMutation.isPending || createGroupMutation.isPending}
                    className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 border-2 border-slate-200 transition-colors disabled:opacity-50"
                  >
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={user.avatarUrl || undefined} alt={user.displayName || 'User'} />
                      <AvatarFallback className="bg-[#3A3DFF] text-white font-black">
                        {(user.displayName || user.username || user.email || '?')[0]?.toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 text-left min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <p className="font-bold text-slate-900 truncate">
                          {user.displayName || user.username || 'Member'}
                        </p>
                        {isAdminUser ? (
                          <span className="inline-flex px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[10px] font-black uppercase">
                            Admin
                          </span>
                        ) : null}
                      </div>
                      <p className="text-xs text-slate-500 truncate">
                        {formatIdentifier(user)}
                        {formatLocation(user.location) ? ` - ${formatLocation(user.location)}` : ''}
                      </p>
                    </div>
                    {mode === 'group' ? (
                      <div className={isSelected ? 'text-[#3A3DFF] font-black text-sm' : 'text-xs font-bold text-slate-500'}>
                        {isSelected ? 'Added' : 'Add'}
                      </div>
                    ) : (
                      <div className="text-xs font-bold text-slate-500">{user.source}</div>
                    )}
                  </button>
                );
              })
            )}

            {showEmailShortcut ? (
              <div className="pt-2">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full h-11 rounded-xl font-bold"
                  onClick={() =>
                    mode === 'group'
                      ? toggleGroupEmail(showEmailShortcut)
                      : startConversationMutation.mutate(showEmailShortcut)
                  }
                  disabled={startConversationMutation.isPending || createGroupMutation.isPending}
                >
                  {mode === 'group' ? `Add ${showEmailShortcut}` : `Message ${showEmailShortcut}`}
                </Button>
              </div>
            ) : null}
          </div>

          {mode === 'group' ? (
            <Button
              type="button"
              className="w-full h-11 rounded-xl font-bold bg-[#3A3DFF] hover:bg-[#2A2DDD]"
              onClick={() => createGroupMutation.mutate()}
              disabled={createGroupMutation.isPending}
            >
              {createGroupMutation.isPending ? 'Creating…' : 'Create group chat'}
            </Button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
