import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, CheckCheck, Image as ImageIcon, Loader2, MessageCircle, Plus, Search, Send, SmilePlus } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import ComposeModal from '@/components/messages/ComposeModal';
import { cn } from '@/lib/utils';
import {
  actOnConversationRequest,
  fetchConversationsPage,
  fetchMessagesPage,
  markConversationRead,
  sendMessage,
  toggleMessageReaction,
  updateGroupParticipants,
  updateGroupSettings,
} from '@/api/messagesClient';
import { lookupUsers } from '@/api/usersClient';
import { fetchPublicProfileByUsername } from '@/api/userProfileClient';
import { fetchMyBlocks } from '@/api/blocksClient';
import { fetchMyFollowingUsers } from '@/api/userFollowsClient';
import { acceptCollaborationInvite, listMyCollaborationInvites, removeCollaborator } from '@/api/collaboratorsClient';
import { fetchMovementById } from '@/api/movementsClient';
import { fetchPublicKey, upsertMyPublicKey } from '@/api/keysClient';
import {
  deriveSharedSecretKey,
  decryptText,
  encryptText,
  getOrCreateIdentityKeypair,
} from '@/lib/e2eeCrypto';
import { isEncryptedBody, packEncryptedPayload, unpackEncryptedPayload } from '@/lib/e2eeFormat';
import { toast } from 'sonner';
import { getInteractionErrorMessage } from '@/utils/interactionErrors';
import { uploadFile } from '@/api/uploadsClient';
import { checkActionAllowed, formatWaitMs } from '@/utils/antiBrigading';
import { logError } from '@/utils/logError';
import { fetchMovementEvidencePage } from '@/api/movementExtrasClient';
import { connectMessagesRealtime } from '@/utils/messagesRealtime';
import {
  ALLOWED_IMAGE_MIME_TYPES,
  ALLOWED_IMAGE_WITH_GIF_MIME_TYPES,
  MAX_UPLOAD_BYTES,
  validateFileUpload,
} from '@/utils/uploadLimits';
import MessagesComingSoon from '@/pages/MessagesComingSoon';
import { queryKeys } from '@/lib/queryKeys';

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isProbablySensitiveUrl(url) {
  const s = String(url || '').toLowerCase();
  if (!s) return false;
  const bad = ['nsfw', 'nude', 'nudity', 'porn', 'xxx', 'gore', 'beheading', 'blood', 'suicide', 'self-harm'];
  return bad.some((k) => s.includes(k));
}

function revealKey(messageId) {
  return `peoplepower_sensitive_reveal_${String(messageId || '')}`;
}

function looksLikeConnectivityError(error) {
  const msg = String(error?.message || '').toLowerCase();
  if (!msg) return false;
  return msg.includes('failed to fetch') || msg.includes('network') || msg.includes('load failed') || msg.includes('econnrefused');
}

function MediaMessage({ payload, messageId }) {
  const url = String(payload?.url || '');
  const caption = payload?.caption ? String(payload.caption) : '';
  const sensitive = !!payload?.sensitive || isProbablySensitiveUrl(url);
  const descId = `sensitive_media_desc_${String(messageId || '')}`;
  const [revealed, setRevealed] = useState(() => {
    if (!sensitive) return true;
    try {
      return localStorage.getItem(revealKey(messageId)) === 'true';
    } catch {
      return false;
    }
  });

  const handleReveal = () => {
    setRevealed(true);
    try {
      localStorage.setItem(revealKey(messageId), 'true');
    } catch {
      // ignore
    }
  };

  return (
    <div className="space-y-2">
      {url ? (
        <div className="rounded-xl overflow-hidden border border-slate-200 bg-white">
          {sensitive && !revealed ? (
            <button
              type="button"
              onClick={handleReveal}
              className="w-full h-44 flex flex-col items-center justify-center bg-slate-100 text-slate-700 font-black"
              aria-describedby={descId}
              aria-label="Reveal sensitive media"
            >
              <div>Sensitive content — tap to reveal</div>
              <div id={descId} className="text-xs font-bold text-slate-500 mt-1">Hidden until you acknowledge.</div>
            </button>
          ) : (
            <img alt={caption ? caption : 'Shared media'} src={url} className="w-full h-44 object-cover" />
          )}
        </div>
      ) : null}
      {caption ? <div className="whitespace-pre-wrap">{caption}</div> : null}
    </div>
  );
}

function MovementShareMessage({ payload }) {
  const title = String(payload?.title || 'Movement');
  const url = String(payload?.url || '');
  return (
    <div className="space-y-2">
      <div className="font-black">{title}</div>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" className="underline font-bold break-all">
          {url}
        </a>
      ) : null}
    </div>
  );
}

function MessageBody({ plaintext, messageId }) {
  const parsed = safeJsonParse(plaintext);
  if (parsed && typeof parsed === 'object') {
    const type = String(parsed?.type || 'text');
    if (type === 'media') return <MediaMessage payload={parsed} messageId={messageId} />;
    if (type === 'movement_share') return <MovementShareMessage payload={parsed} />;
    if (type === 'text') return <span>{String(parsed?.text || '')}</span>;
  }
  return <span>{plaintext}</span>;
}

function getOtherParticipant(participants, myEmail) {
  const me = normalizeEmail(myEmail);
  const list = Array.isArray(participants) ? participants : [];
  return list.find((e) => normalizeEmail(e) !== me) || list[0] || '';
}

function getConversationLabel(conversation, myEmail, profileLookup) {
  if (conversation?.is_group) {
    return String(conversation?.group_name || 'Verified participants group');
  }
  const other = getOtherParticipant(conversation?.participant_emails, myEmail);
  const normalized = normalizeEmail(other);
  const profile = normalized ? profileLookup?.get(normalized) : null;
  const display = String(profile?.display_name || '').trim();
  if (display) return display;
  const username = String(profile?.username || '').trim();
  if (username) return `@${username}`;
  return other ? 'Member' : 'Conversation';
}

function getGroupAdmins(conversation) {
  const list = Array.isArray(conversation?.group_admin_emails) ? conversation.group_admin_emails : [];
  const owner = normalizeEmail(conversation?.created_by_email);
  const normalized = Array.from(new Set(list.map(normalizeEmail).filter(Boolean)));
  if (owner && !normalized.includes(owner)) normalized.unshift(owner);
  return normalized;
}

function isGroupAdmin(conversation, myEmail) {
  const me = normalizeEmail(myEmail);
  if (!me || !conversation?.is_group) return false;
  return getGroupAdmins(conversation).includes(me);
}

function canPostToGroup(conversation, myEmail) {
  if (!conversation?.is_group) return true;
  const me = normalizeEmail(myEmail);
  if (!me) return false;
  const mode = String(conversation?.group_post_mode || 'owner_only');
  const admins = getGroupAdmins(conversation);
  const owner = normalizeEmail(conversation?.created_by_email);
  if (mode === 'all') return true;
  if (mode === 'admins') return admins.includes(me);
  if (mode === 'owner_only') return owner ? owner === me : admins.includes(me);
  const posters = Array.isArray(conversation?.group_posters)
    ? conversation.group_posters.map(normalizeEmail).filter(Boolean)
    : [];
  return admins.includes(me) || posters.includes(me);
}

function formatTime(value) {
  if (!value) return '';
  try {
    const d = new Date(value);
    return d.toLocaleString([], { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

function EncryptedMessage({ myEmail, senderPublicKey, encryptedPayload, messageId }) {
  const [text, setText] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        if (!senderPublicKey) throw new Error('Missing sender key');
        const recipientKey = normalizeEmail(myEmail);
        const payload =
          encryptedPayload && typeof encryptedPayload === 'object' && encryptedPayload.recipients
            ? encryptedPayload.recipients[recipientKey]
            : encryptedPayload;
        if (!payload) throw new Error('Missing recipient payload');
        const { privateKey } = await getOrCreateIdentityKeypair(myEmail);
        const key = await deriveSharedSecretKey(privateKey, senderPublicKey);
        const plaintext = await decryptText(payload, key);
        if (!cancelled) setText(plaintext);
      } catch {
        if (!cancelled) setFailed(true);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [myEmail, senderPublicKey, encryptedPayload]);

  if (failed) {
    return <span className="opacity-80">[Unable to decrypt on this device]</span>;
  }

  if (text == null) {
    return <span className="opacity-80">Decrypting...</span>;
  }

  return <MessageBody plaintext={text} messageId={messageId} />;
}

function MessagesInner() {
  const { user, session, loading } = useAuth();
  const queryClient = useQueryClient();
  const accessToken = session?.access_token || null;
  const [searchParams, setSearchParams] = useSearchParams();

  const myEmail = user?.email || '';
  const myEmailNormalized = useMemo(() => normalizeEmail(myEmail), [myEmail]);

  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState('');
  const [composeOpen, setComposeOpen] = useState(false);
  const [box, setBox] = useState('messages');
  const [search, setSearch] = useState('');
  const [pendingMessages, setPendingMessages] = useState([]);

  const realtimeRef = useRef(null);
  const [realtimeStatus, setRealtimeStatus] = useState('disconnected');
  const realtimeConnected = realtimeStatus === 'connected';

  const selectedIdRef = useRef(null);
  const myEmailNormalizedRef = useRef('');
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);
  useEffect(() => {
    myEmailNormalizedRef.current = myEmailNormalized;
  }, [myEmailNormalized]);

  const [pendingMediaFile, setPendingMediaFile] = useState(null);
  const [pendingMediaSensitive, setPendingMediaSensitive] = useState(false);
  const [sendingMedia, setSendingMedia] = useState(false);
  const [reactionPickerForId, setReactionPickerForId] = useState(null);
  const [customReactionDrafts, setCustomReactionDrafts] = useState({});

  const [groupSettingsOpen, setGroupSettingsOpen] = useState(false);
  const [groupNameDraft, setGroupNameDraft] = useState('');
  const [groupAvatarFile, setGroupAvatarFile] = useState(null);
  const [groupAvatarPreview, setGroupAvatarPreview] = useState('');
  const [groupPostMode, setGroupPostMode] = useState('owner_only');
  const [groupPosterSelection, setGroupPosterSelection] = useState([]);
  const [groupAdminSelection, setGroupAdminSelection] = useState([]);
  const [groupAddUsername, setGroupAddUsername] = useState('');
  const [movementAddSelection, setMovementAddSelection] = useState([]);

  const mediaInputRef = useRef(null);

  useEffect(() => {
    return () => {
      if (groupAvatarPreview && groupAvatarPreview.startsWith('blob:')) {
        URL.revokeObjectURL(groupAvatarPreview);
      }
    };
  }, [groupAvatarPreview]);

  const { data: myBlocks } = useQuery({
    queryKey: queryKeys.blocks.mine(myEmailNormalized),
    queryFn: () => fetchMyBlocks({ accessToken }),
    enabled: !!accessToken,
  });

  const blockedEmails = useMemo(() => {
    const list = Array.isArray(myBlocks?.blocked) ? myBlocks.blocked : [];
    return new Set(list.map((b) => normalizeEmail(b?.email)).filter(Boolean));
  }, [myBlocks]);

  const {
    data: following = [],
    isFetched: followingFetched,
  } = useQuery({
    queryKey: ['following', myEmailNormalized],
    queryFn: async () => {
      if (!accessToken) return [];
      return fetchMyFollowingUsers({ accessToken });
    },
    enabled: !!accessToken && !!myEmailNormalized,
    staleTime: 1000 * 60 * 5,
  });

  const followingEmails = useMemo(() => {
    return Array.isArray(following)
      ? following.map((u) => normalizeEmail(u?.email)).filter(Boolean)
      : [];
  }, [following]);

  const followingSet = useMemo(() => new Set(followingEmails), [followingEmails]);

  const {
    data: collabInvites = [],
  } = useQuery({
    queryKey: ['collaborationInvites', myEmailNormalized],
    enabled: !!accessToken && !!myEmailNormalized,
    queryFn: async () => {
      const pending = await listMyCollaborationInvites({ accessToken });
      const titles = await Promise.all(
        pending.map(async (c) => {
          try {
            const mv = await fetchMovementById(String(c?.movement_id || ''), { accessToken });
            return String(mv?.title || mv?.name || c?.movement_id || '');
          } catch {
            return String(c?.movement_id || '');
          }
        })
      );
      return pending.map((c, idx) => ({ ...c, movement_title: titles[idx] }));
    },
    staleTime: 1000 * 60,
  });

  const CONVERSATIONS_PAGE_SIZE = 20;
  const CONVERSATION_LIST_FIELDS = useMemo(
    () =>
      [
        'participant_emails',
        'request_status',
        'requester_email',
        'blocked_by_email',
        'is_group',
        'group_name',
        'group_avatar_url',
        'group_type',
        'movement_id',
        'created_by_email',
        'group_admin_emails',
        'group_post_mode',
        'group_posters',
        'updated_at',
        'created_at',
        'last_message_body',
        'last_message_at',
        'unread_count',
      ].join(','),
    []
  );

  const MESSAGES_PAGE_SIZE = 50;
  const MESSAGE_LIST_FIELDS = useMemo(
    () => ['sender_email', 'body', 'created_at', 'read_by', 'delivered_to', 'reactions'].join(','),
    []
  );

  const upsertMessageIntoCache = useCallback(
    (created, conversationIdOverride) => {
      const cid =
        conversationIdOverride != null
          ? String(conversationIdOverride)
          : (selectedId ? String(selectedId) : '');
      if (!created || !cid) return;
      const messagesKey = ['messages', cid, myEmailNormalized];
      queryClient.setQueryData(messagesKey, (old) => {
        if (!old || typeof old !== 'object') return old;
        const pages = Array.isArray(old.pages) ? old.pages : null;
        const pageParams = Array.isArray(old.pageParams) ? old.pageParams : null;
        if (!pages || !pageParams) return old;

        const createdId = String(created?.id || '');
        const first = Array.isArray(pages[0]) ? pages[0] : [];
        const withoutDup = createdId ? first.filter((m) => String(m?.id || '') !== createdId) : first;
        const nextFirst = [created, ...withoutDup];
        const nextPages = [nextFirst, ...pages.slice(1)];
        return { ...old, pages: nextPages };
      });
    },
    [myEmailNormalized, queryClient, selectedId]
  );

  const bumpConversationInCache = useCallback(
    (conversationId, patch) => {
      const cid = conversationId ? String(conversationId) : '';
      if (!cid) return;
      const conversationsKey = ['conversations', myEmailNormalized];
      queryClient.setQueryData(conversationsKey, (old) => {
        if (!old || typeof old !== 'object') return old;
        const pages = Array.isArray(old.pages) ? old.pages : null;
        const pageParams = Array.isArray(old.pageParams) ? old.pageParams : null;
        if (!pages || !pageParams) return old;

        const flattened = pages.flatMap((p) => (Array.isArray(p) ? p : []));
        const hit = flattened.find((c) => String(c?.id || '') === cid) || null;
        if (!hit) return old;

        const computedPatch = typeof patch === 'function' ? patch(hit) : patch;
        const updated = { ...hit, ...(computedPatch && typeof computedPatch === 'object' ? computedPatch : {}) };
        const nextFlat = [updated, ...flattened.filter((c) => String(c?.id || '') !== cid)];

        const nextPages = [];
        let cursor = 0;
        for (let i = 0; i < pages.length; i += 1) {
          const size = Array.isArray(pages[i]) ? pages[i].length : 0;
          nextPages.push(nextFlat.slice(cursor, cursor + size));
          cursor += size;
        }

        // If we haven't filled all pages (e.g., first page was empty), just keep a single page.
        const any = nextPages.some((p) => Array.isArray(p) && p.length);
        return any ? { ...old, pages: nextPages } : { ...old, pages: [nextFlat] };
      });
    },
    [queryClient, myEmailNormalized]
  );

  const upsertConversationIntoCache = useCallback(
    (conversation, patch) => {
      const cid = String(conversation?.id || '');
      if (!cid) return;
      const conversationsKey = ['conversations', myEmailNormalized];
      queryClient.setQueryData(conversationsKey, (old) => {
        if (!old || typeof old !== 'object') return old;
        const pages = Array.isArray(old.pages) ? old.pages : null;
        const pageParams = Array.isArray(old.pageParams) ? old.pageParams : null;
        if (!pages || !pageParams) return old;

        const flattened = pages.flatMap((p) => (Array.isArray(p) ? p : []));
        const hit = flattened.find((c) => String(c?.id || '') === cid) || null;
        const computedPatch = typeof patch === 'function' ? patch(hit || conversation) : patch;
        const base = hit ? { ...hit, ...conversation } : { ...conversation };
        const updated = { ...base, ...(computedPatch && typeof computedPatch === 'object' ? computedPatch : {}) };
        const nextFlat = [updated, ...flattened.filter((c) => String(c?.id || '') !== cid)];

        const nextPages = [];
        let cursor = 0;
        for (let i = 0; i < pages.length; i += 1) {
          const size = Array.isArray(pages[i]) ? pages[i].length : 0;
          nextPages.push(nextFlat.slice(cursor, cursor + size));
          cursor += size;
        }
        const any = nextPages.some((p) => Array.isArray(p) && p.length);
        return any ? { ...old, pages: nextPages } : { ...old, pages: [nextFlat] };
      });
    },
    [queryClient, myEmailNormalized]
  );

  useEffect(() => {
    if (!accessToken || !myEmailNormalized) return;
    if (realtimeRef.current) return;

    const client = connectMessagesRealtime({
      accessToken,
      onStatus: (s) => setRealtimeStatus(String(s || 'disconnected')),
      onEvent: (evt) => {
        const type = String(evt?.type || '');
        if (!type) return;

        if (type === 'message:new') {
          const conversationId = evt?.conversationId ? String(evt.conversationId) : '';
          const message = evt?.message && typeof evt.message === 'object' ? evt.message : null;
          const conversation = evt?.conversation && typeof evt.conversation === 'object' ? evt.conversation : null;
          if (!conversationId || !message) return;

          const me = myEmailNormalizedRef.current;
          const sender = normalizeEmail(message?.sender_email);
          const mine = !!me && sender === me;
          const isActive = String(selectedIdRef.current || '') === conversationId;
          const visible = typeof document !== 'undefined' ? document.visibilityState === 'visible' : true;

          // Ensure the inbox contains this conversation, then update preview + unread counts.
          if (conversation) {
            upsertConversationIntoCache(conversation, (cur) => {
              const nextUnread = mine
                ? Number(cur?.unread_count || 0)
                : (isActive && visible)
                  ? 0
                  : Number(cur?.unread_count || 0) + 1;
              return {
                last_message_body: message?.body ?? cur?.last_message_body ?? null,
                last_message_at: message?.created_at ?? cur?.last_message_at ?? null,
                updated_at: message?.created_at ?? cur?.updated_at ?? null,
                unread_count: nextUnread,
              };
            });
          } else {
            bumpConversationInCache(conversationId, (cur) => {
              const nextUnread = mine
                ? Number(cur?.unread_count || 0)
                : (isActive && visible)
                  ? 0
                  : Number(cur?.unread_count || 0) + 1;
              return {
                last_message_body: message?.body ?? cur?.last_message_body ?? null,
                last_message_at: message?.created_at ?? cur?.last_message_at ?? null,
                updated_at: message?.created_at ?? cur?.updated_at ?? null,
                unread_count: nextUnread,
              };
            });
          }

          if (isActive) {
            upsertMessageIntoCache(message, conversationId);
          }

          // Acknowledge delivery/read to enable receipts for the sender.
          if (!mine && message?.id) {
            client?.send({ type: 'message:delivered', messageId: String(message.id) });
            if (isActive && visible) {
              client?.send({ type: 'conversation:read', conversationId });
            }
          }

          // Lightweight in-app notification for background conversations.
          if (!mine && (!isActive || !visible)) {
            try {
              toast.message('New message', { description: 'Open Messages to reply.' });
            } catch {
              // ignore
            }
          }

          return;
        }

        if (type === 'message:delivered') {
          const conversationId = evt?.conversationId ? String(evt.conversationId) : '';
          const messageId = evt?.messageId ? String(evt.messageId) : '';
          const by = normalizeEmail(evt?.by);
          if (!conversationId || !messageId || !by) return;
          const me = myEmailNormalizedRef.current;
          const isActive = String(selectedIdRef.current || '') === conversationId;
          if (!isActive) return;

          const messagesKey = ['messages', conversationId, me];
          queryClient.setQueryData(messagesKey, (old) => {
            if (!old || typeof old !== 'object') return old;
            const pages = Array.isArray(old.pages) ? old.pages : null;
            const pageParams = Array.isArray(old.pageParams) ? old.pageParams : null;
            if (!pages || !pageParams) return old;

            const nextPages = pages.map((p) => {
              if (!Array.isArray(p)) return p;
              return p.map((m) => {
                if (String(m?.id || '') !== messageId) return m;
                const prev = Array.isArray(m?.delivered_to) ? m.delivered_to.map(normalizeEmail).filter(Boolean) : [];
                if (prev.includes(by)) return m;
                return { ...m, delivered_to: [...prev, by] };
              });
            });
            return { ...old, pages: nextPages };
          });
          return;
        }

        if (type === 'conversation:updated') {
          const conversationId = evt?.conversationId ? String(evt.conversationId) : '';
          const conversation = evt?.conversation && typeof evt.conversation === 'object' ? evt.conversation : null;
          if (!conversationId || !conversation) return;
          upsertConversationIntoCache(conversation);
          return;
        }

        if (type === 'conversation:read') {
          const conversationId = evt?.conversationId ? String(evt.conversationId) : '';
          if (!conversationId) return;
          // Keep it simple: refetch the conversation/messages so read receipts are accurate.
          queryClient.invalidateQueries({ queryKey: ['conversations', myEmailNormalizedRef.current] });
          queryClient.invalidateQueries({ queryKey: ['messages', conversationId, myEmailNormalizedRef.current] });
        }
      },
    });

    realtimeRef.current = client;
    return () => {
      try {
        realtimeRef.current?.close?.();
      } catch {
        // ignore
      }
      realtimeRef.current = null;
      setRealtimeStatus('disconnected');
    };
  }, [accessToken, myEmailNormalized, queryClient, bumpConversationInCache, upsertConversationIntoCache, upsertMessageIntoCache]);

  // Ensure an identity keypair exists locally and publish the public key to the server.
  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!accessToken || !myEmail) return;
      try {
        const kp = await getOrCreateIdentityKeypair(myEmail);
        if (cancelled) return;
        await upsertMyPublicKey(kp.publicKey, { accessToken });
      } catch (e) {
        if (!cancelled) {
          toast.error(getInteractionErrorMessage(e, 'Failed to initialize encrypted messaging'));
        }
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [accessToken, myEmail]);

  const {
    data: conversationsData,
    isLoading: conversationsLoading,
    isError: conversationsError,
    error: conversationsErrorObj,
    refetch: refetchConversations,
    fetchNextPage: fetchNextConversations,
    hasNextPage: hasMoreConversations,
    isFetchingNextPage: isFetchingMoreConversations,
  } = useInfiniteQuery({
    queryKey: ['conversations', myEmailNormalized],
    queryFn: ({ pageParam = 0 }) =>
      fetchConversationsPage({
        accessToken,
        myEmail,
        limit: CONVERSATIONS_PAGE_SIZE,
        offset: pageParam,
        fields: CONVERSATION_LIST_FIELDS,
      }),
    enabled: !!myEmail && !!accessToken,
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      if (!Array.isArray(lastPage)) return undefined;
      if (lastPage.length < CONVERSATIONS_PAGE_SIZE) return undefined;
      return allPages.length * CONVERSATIONS_PAGE_SIZE;
    },
    refetchInterval: realtimeConnected ? false : 2500,
    refetchOnWindowFocus: true,
    throwOnError: false,
  });

  const conversations = useMemo(() => {
    const pages = conversationsData?.pages;
    if (!Array.isArray(pages)) return [];
    return pages.flatMap((p) => (Array.isArray(p) ? p : []));
  }, [conversationsData]);

  const participantEmails = useMemo(() => {
    const emails = new Set();
    const list = Array.isArray(conversations) ? conversations : [];
    for (const convo of list) {
      const participants = Array.isArray(convo?.participant_emails) ? convo.participant_emails : [];
      for (const email of participants) {
        const normalized = normalizeEmail(email);
        if (normalized) emails.add(normalized);
      }
    }
    if (myEmailNormalized) emails.add(myEmailNormalized);
    return Array.from(emails);
  }, [conversations, myEmailNormalized]);

  const { data: participantProfiles = [] } = useQuery({
    queryKey: ['messageParticipants', participantEmails.join('|')],
    queryFn: () => lookupUsers({ emails: participantEmails }, { accessToken }),
    enabled: !!accessToken && participantEmails.length > 0,
    staleTime: 1000 * 60 * 5,
  });

  const profileLookup = useMemo(() => {
    const lookup = new Map();
    for (const profile of Array.isArray(participantProfiles) ? participantProfiles : []) {
      const email = normalizeEmail(profile?.email || profile?.user_email);
      if (!email) continue;
      lookup.set(email, {
        display_name: profile?.display_name ?? null,
        username: profile?.username ?? null,
        profile_photo_url: profile?.profile_photo_url ?? null,
      });
    }
    return lookup;
  }, [participantProfiles]);

  const labelForEmail = useCallback(
    (email, { fallback = 'Member', includeYou = false } = {}) => {
      const normalized = normalizeEmail(email);
      if (!normalized) return fallback;
      if (includeYou && normalized === myEmailNormalized) return 'You';
      const profile = profileLookup.get(normalized);
      const display = String(profile?.display_name || '').trim();
      if (display) return display;
      const username = String(profile?.username || '').trim().replace(/^@+/, '');
      if (username) return `@${username}`;
      return fallback;
    },
    [profileLookup, myEmailNormalized]
  );

  const normalizeHandle = (value) => String(value || '').trim().replace(/^@+/, '');

  const signedInLabel = useMemo(() => {
    const profile = myEmailNormalized ? profileLookup.get(myEmailNormalized) : null;
    const display = String(profile?.display_name || '').trim();
    if (display) return display;
    const username = String(profile?.username || '').trim();
    if (username) return `@${username}`;
    const emailLocal = myEmailNormalized ? myEmailNormalized.split('@')[0] : '';
    return emailLocal || 'Account';
  }, [profileLookup, myEmailNormalized]);

  useEffect(() => {
    const idFromUrl = searchParams.get('conversationId');
    if (idFromUrl) setSelectedId(String(idFromUrl));
  }, [searchParams]);

  useEffect(() => {
    if (conversationsError && conversationsErrorObj) {
      logError(conversationsErrorObj, 'Messages conversations load failed');
    }
  }, [conversationsError, conversationsErrorObj]);

  const selectedConversation = useMemo(
    () => conversations.find((c) => String(c?.id) === String(selectedId)) || null,
    [conversations, selectedId]
  );

  const isGroupConversation = !!selectedConversation?.is_group;
  const isMovementGroup = isGroupConversation && String(selectedConversation?.group_type || '') === 'movement_verified';
  const isGroupAdminUser = isGroupConversation ? isGroupAdmin(selectedConversation, myEmail) : false;
  const canPostGroup = isGroupConversation ? canPostToGroup(selectedConversation, myEmail) : true;
  const isGroupOwner = isGroupConversation && myEmailNormalized && normalizeEmail(selectedConversation?.created_by_email) === myEmailNormalized;

  useEffect(() => {
    if (!groupSettingsOpen || !selectedConversation) return;
    setGroupNameDraft(String(selectedConversation?.group_name || ''));
    const mode = String(selectedConversation?.group_post_mode || 'owner_only');
    setGroupPostMode(['owner_only', 'admins', 'selected', 'all'].includes(mode) ? mode : 'owner_only');
    setGroupPosterSelection(
      Array.isArray(selectedConversation?.group_posters)
        ? selectedConversation.group_posters.map(normalizeEmail).filter(Boolean)
        : []
    );
    setGroupAdminSelection(getGroupAdmins(selectedConversation));
    setGroupAvatarFile(null);
    setGroupAvatarPreview(String(selectedConversation?.group_avatar_url || ''));
    setGroupAddUsername('');
    setMovementAddSelection([]);
  }, [groupSettingsOpen, selectedConversation]);

  useEffect(() => {
    if (groupSettingsOpen && !isGroupAdminUser) {
      setGroupSettingsOpen(false);
    }
  }, [groupSettingsOpen, isGroupAdminUser]);

  const { data: verifiedEvidence = [], isLoading: verifiedEvidenceLoading } = useQuery({
    queryKey: ['verifiedEvidence', selectedConversation?.movement_id],
    queryFn: () =>
      fetchMovementEvidencePage(selectedConversation?.movement_id, {
        status: 'approved',
        fields: ['submitter_email', 'submitter_user_id'],
        limit: 200,
        offset: 0,
        accessToken,
      }),
    enabled: groupSettingsOpen && isMovementGroup && !!accessToken && !!selectedConversation?.movement_id,
  });

  const { verifiedParticipantEmails, verifiedParticipantUserIds } = useMemo(() => {
    if (!isMovementGroup) return { verifiedParticipantEmails: [], verifiedParticipantUserIds: [] };
    const list = Array.isArray(verifiedEvidence) ? verifiedEvidence : [];
    const emails = list.map((e) => normalizeEmail(e?.submitter_email)).filter(Boolean);
    const userIds = list.map((e) => (e?.submitter_user_id ? String(e.submitter_user_id).trim() : '')).filter(Boolean);
    return {
      verifiedParticipantEmails: Array.from(new Set(emails)),
      verifiedParticipantUserIds: Array.from(new Set(userIds)),
    };
  }, [verifiedEvidence, isMovementGroup]);

  const {
    data: verifiedParticipantProfiles = [],
    isLoading: verifiedParticipantProfilesLoading,
  } = useQuery({
    queryKey: [
      'verifiedParticipantProfiles',
      selectedConversation?.movement_id,
      verifiedParticipantUserIds.join('|'),
      verifiedParticipantEmails.join('|'),
    ],
    queryFn: () =>
      lookupUsers(
        {
          userIds: verifiedParticipantUserIds.slice(0, 50),
          emails: verifiedParticipantEmails.slice(0, 50),
        },
        { accessToken }
      ),
    enabled:
      groupSettingsOpen &&
      isMovementGroup &&
      !!accessToken &&
      (verifiedParticipantUserIds.length > 0 || verifiedParticipantEmails.length > 0),
    staleTime: 1000 * 60 * 5,
  });

  const verifiedProfilesLookup = useMemo(() => {
    const lookup = new Map();
    const list = Array.isArray(verifiedParticipantProfiles) ? verifiedParticipantProfiles : [];
    for (const p of list) {
      const email = normalizeEmail(p?.email || p?.user_email);
      if (!email) continue;
      lookup.set(email, {
        display_name: p?.display_name ?? null,
        username: p?.username ?? null,
        movement_group_opt_out: !!p?.movement_group_opt_out,
      });
    }
    return lookup;
  }, [verifiedParticipantProfiles]);

  const groupParticipants = useMemo(() => {
    if (!isGroupConversation) return [];
    const list = Array.isArray(selectedConversation?.participant_emails)
      ? selectedConversation.participant_emails
      : [];
    return Array.from(new Set(list.map(normalizeEmail).filter(Boolean)));
  }, [isGroupConversation, selectedConversation]);

  const blockedParticipants = useMemo(() => {
    if (!selectedConversation) return [];
    const participants = Array.isArray(selectedConversation?.participant_emails)
      ? selectedConversation.participant_emails
      : [];
    return participants
      .map(normalizeEmail)
      .filter((email) => email && email !== myEmailNormalized && blockedEmails.has(email));
  }, [selectedConversation, blockedEmails, myEmailNormalized]);

  const hasBlockedParticipant = blockedParticipants.length > 0;

  const selectedTitle = useMemo(
    () => (selectedConversation ? getConversationLabel(selectedConversation, myEmail, profileLookup) : ''),
    [selectedConversation, myEmail, profileLookup]
  );

  useEffect(() => {
    if (conversationsLoading) return;
    const list = Array.isArray(conversations) ? conversations : [];
    if (selectedId && !list.some((c) => String(c?.id) === String(selectedId))) {
      setSelectedId(null);
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('conversationId');
        return next;
      });
    }
  }, [conversations, conversationsLoading, selectedId, setSearchParams]);

  useEffect(() => {
    if (!selectedConversation?.is_group) return;
    const isMovement = String(selectedConversation?.group_type || '') === 'movement_verified';
    setBox(isMovement ? 'movements' : 'messages');
  }, [selectedConversation]);

  const cannotReply = useMemo(() => {
    const status = String(selectedConversation?.request_status || '').toLowerCase();
    const requester = String(selectedConversation?.requester_email || '').toLowerCase();
    return status === 'pending' && requester && requester !== myEmailNormalized;
  }, [selectedConversation, myEmailNormalized]);

  const groupReadOnly = useMemo(() => {
    if (!isGroupConversation) return false;
    return !canPostGroup;
  }, [isGroupConversation, canPostGroup]);

  const isMovementConversation = (c) => !!c?.is_group && String(c?.group_type || '') === 'movement_verified';
  const queryLower = useMemo(() => String(search || '').trim().toLowerCase(), [search]);
  const matchesSearch = useCallback(
    (c) => {
      if (!queryLower) return true;
      const label = String(getConversationLabel(c, myEmail, profileLookup) || '').toLowerCase();
      const last = String(c?.last_message_body || '').toLowerCase();
      return label.includes(queryLower) || last.includes(queryLower);
    },
    [queryLower, myEmail, profileLookup]
  );

  const isIncomingRequest = useCallback(
    (c) => {
      const status = String(c?.request_status || '').toLowerCase();
      const requester = normalizeEmail(c?.requester_email);
      return status === 'pending' && requester && requester !== myEmailNormalized;
    },
    [myEmailNormalized]
  );

  const isRequestFromNonFollower = useCallback(
    (c) => {
      if (!isIncomingRequest(c)) return false;
      if (!followingFetched) return true;
      const requester = normalizeEmail(c?.requester_email);
      return requester ? !followingSet.has(requester) : true;
    },
    [followingFetched, followingSet, isIncomingRequest]
  );

  const messageConversations = useMemo(() => {
    const list = Array.isArray(conversations) ? conversations : [];
    return list
      .filter((c) => {
        if (isMovementConversation(c)) return false;
        if (c?.is_group) return true;
        const incoming = isIncomingRequest(c);
        if (!incoming) return true;
        return !isRequestFromNonFollower(c);
      })
      .filter(matchesSearch);
  }, [conversations, matchesSearch, isIncomingRequest, isRequestFromNonFollower]);

  const requestConversations = useMemo(() => {
    const list = Array.isArray(conversations) ? conversations : [];
    return list
      .filter((c) => !isMovementConversation(c))
      .filter((c) => !c?.is_group)
      .filter((c) => isIncomingRequest(c))
      .filter((c) => isRequestFromNonFollower(c))
      .filter(matchesSearch);
  }, [conversations, matchesSearch, isIncomingRequest, isRequestFromNonFollower]);

  const movementConversations = useMemo(() => {
    const list = Array.isArray(conversations) ? conversations : [];
    return list.filter((c) => isMovementConversation(c)).filter(matchesSearch);
  }, [conversations, matchesSearch]);

  const messagesUnreadCount = useMemo(
    () => messageConversations.reduce((sum, c) => sum + Number(c?.unread_count || 0), 0),
    [messageConversations]
  );
  const requestsCount = useMemo(() => requestConversations.length, [requestConversations]);
  const movementUnreadCount = useMemo(
    () => movementConversations.reduce((sum, c) => sum + Number(c?.unread_count || 0), 0),
    [movementConversations]
  );
  const collabInviteCount = Array.isArray(collabInvites) ? collabInvites.length : 0;
  const movementsTotalCount = movementUnreadCount + collabInviteCount;

  const visibleConversations = useMemo(() => {
    if (box === 'requests') return requestConversations;
    if (box === 'movements') return movementConversations;
    return messageConversations;
  }, [box, requestConversations, movementConversations, messageConversations]);

  const notificationTracker = useRef({ ready: false, messages: 0, invites: 0 });

  useEffect(() => {
    if (!accessToken) return;
    const prev = notificationTracker.current;
    if (prev.ready) {
      if (messagesUnreadCount > prev.messages) {
        const delta = messagesUnreadCount - prev.messages;
        toast(`New message${delta > 1 ? 's' : ''} received`);
      }
      if (collabInviteCount > prev.invites) {
        toast('New collaboration invite');
      }
    }
    notificationTracker.current = {
      ready: true,
      messages: messagesUnreadCount,
      invites: collabInviteCount,
    };
  }, [accessToken, messagesUnreadCount, collabInviteCount]);

  const otherEmail = useMemo(() => {
    if (!selectedConversation || isGroupConversation) return '';
    return getOtherParticipant(selectedConversation?.participant_emails, myEmail);
  }, [selectedConversation, myEmail, isGroupConversation]);

  const otherEmailNormalized = useMemo(() => normalizeEmail(otherEmail), [otherEmail]);

  const selectedOtherProfile = useMemo(() => {
    if (!selectedConversation || isGroupConversation) return null;
    const normalized = normalizeEmail(otherEmail);
    return normalized ? profileLookup.get(normalized) : null;
  }, [selectedConversation, isGroupConversation, otherEmail, profileLookup]);

  const {
    data: otherPublicKey,
    isLoading: otherKeyLoading,
    isError: otherKeyError,
    error: otherKeyErrorObj,
  } = useQuery({
    queryKey: ['publicKey', otherEmail],
    queryFn: () => fetchPublicKey(otherEmail, { accessToken }),
    enabled: !!accessToken && !!otherEmail && !isGroupConversation,
    staleTime: 1000 * 60 * 10,
  });

  useEffect(() => {
    if (otherKeyError && otherKeyErrorObj) {
      logError(otherKeyErrorObj, 'Messages recipient public key load failed', { recipient: otherEmailNormalized });
      toast.error('Recipient has no encryption key yet');
    }
  }, [otherKeyError, otherKeyErrorObj, otherEmailNormalized]);

  const {
    data: groupKeyBundle,
    isLoading: groupKeysLoading,
  } = useQuery({
    queryKey: ['groupPublicKeys', selectedId, groupParticipants.join('|')],
    queryFn: async () => {
      const keys = {};
      const missing = [];
      if (myEmailNormalized) {
        const kp = await getOrCreateIdentityKeypair(myEmail);
        keys[myEmailNormalized] = kp.publicKey;
      }
      await Promise.all(
        groupParticipants.map(async (email) => {
          if (!email || email === myEmailNormalized) return;
          try {
            keys[email] = await fetchPublicKey(email, { accessToken });
          } catch {
            missing.push(email);
          }
        })
      );
      return { keys, missing };
    },
    enabled: isGroupConversation && !!accessToken && groupParticipants.length > 0,
    staleTime: 1000 * 60 * 5,
  });

  const groupPublicKeys = groupKeyBundle?.keys || {};
  const groupKeyMissing = Array.isArray(groupKeyBundle?.missing) ? groupKeyBundle.missing : [];

  const {
    data: messagesData,
    isLoading: messagesLoading,
    isError: messagesError,
    error: messagesErrorObj,
    refetch: refetchMessages,
    fetchNextPage: fetchNextMessages,
    hasNextPage: hasMoreMessages,
    isFetchingNextPage: isFetchingMoreMessages,
  } = useInfiniteQuery({
    queryKey: ['messages', selectedId, myEmailNormalized],
    queryFn: ({ pageParam = 0 }) =>
      fetchMessagesPage(selectedId, {
        accessToken,
        myEmail,
        limit: MESSAGES_PAGE_SIZE,
        offset: pageParam,
        fields: MESSAGE_LIST_FIELDS,
      }),
    enabled: !!myEmail && !!accessToken && !!selectedConversation,
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      if (!Array.isArray(lastPage)) return undefined;
      if (lastPage.length < MESSAGES_PAGE_SIZE) return undefined;
      return allPages.length * MESSAGES_PAGE_SIZE;
    },
    refetchInterval: realtimeConnected ? false : (selectedId ? 1500 : false),
    refetchOnWindowFocus: true,
    throwOnError: false,
  });

  const messages = useMemo(() => {
    const pages = messagesData?.pages;
    if (!Array.isArray(pages)) return [];

    // Server returns newest-first pages; render oldest->newest.
    const list = pages
      .slice()
      .reverse()
      .flatMap((p) => (Array.isArray(p) ? p.slice().reverse() : []));
    if (!blockedEmails.size) return list;
    return list.filter((m) => !blockedEmails.has(normalizeEmail(m?.sender_email)));
  }, [messagesData, blockedEmails]);

  const mergedMessages = useMemo(() => {
    if (!pendingMessages.length) return messages;
    const existing = new Set(messages.map((m) => String(m?.id || '')));
    const pending = pendingMessages.filter((m) => !existing.has(String(m?.id || '')));
    if (!pending.length) return messages;
    const combined = [...messages, ...pending];
    return combined.sort((a, b) => {
      const ta = a?.created_at ? new Date(a.created_at).getTime() : 0;
      const tb = b?.created_at ? new Date(b.created_at).getTime() : 0;
      return ta - tb;
    });
  }, [messages, pendingMessages]);

  const markReadMutation = useMutation({
    mutationFn: async (conversationId) => markConversationRead(conversationId, { accessToken, myEmail }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations', myEmailNormalized] });
    },
    onError: (e, conversationId) => {
      logError(e, 'Messages mark read failed', { conversationId: String(conversationId || '') });
    },
    retry: false,
  });

  useEffect(() => {
    if (!selectedConversation?.id || !myEmailNormalized) return;
    if (Number(selectedConversation?.unread_count || 0) > 0) {
      markReadMutation.mutate(String(selectedConversation.id));
    }
  }, [selectedConversation?.id, selectedConversation?.unread_count, myEmailNormalized, markReadMutation]);

  useEffect(() => {
    if (messagesError && messagesErrorObj) {
      logError(messagesErrorObj, 'Messages load failed', { conversationId: selectedId });
    }
  }, [messagesError, messagesErrorObj, selectedId]);

  const conversationsConnectivityError =
    conversationsError && looksLikeConnectivityError(conversationsErrorObj);

  const messagesConnectivityError =
    messagesError && looksLikeConnectivityError(messagesErrorObj);

  const buildPendingId = () => {
    try {
      if (typeof crypto !== 'undefined' && crypto?.randomUUID) {
        return `pending_${crypto.randomUUID()}`;
      }
    } catch {
      // ignore
    }
    return `pending_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  };

  const sendMutation = useMutation({
    mutationFn: async ({ text }) => {
      const nextText = String(text || '').trim();
      if (!nextText) throw new Error('Message cannot be empty');
      if (!selectedId) throw new Error('Select a conversation');
      if (!isGroupConversation) {
        if (!otherEmail) throw new Error('Missing recipient');
        if (!otherPublicKey) throw new Error('Recipient has no encryption key yet');
      } else if (groupReadOnly) {
        throw new Error('Only approved posters can send messages in this group');
      }

      const rateCheck = await checkActionAllowed({
        email: myEmail,
        action: 'message_send',
        contextId: selectedId,
        accessToken,
      });
      if (!rateCheck?.ok) {
        const wait = rateCheck?.retryAfterMs ? ` Try again in ${formatWaitMs(rateCheck.retryAfterMs)}.` : '';
        throw new Error(String(rateCheck?.reason || 'Please slow down.') + wait);
      }

      const { privateKey } = await getOrCreateIdentityKeypair(myEmail);
      const payload = JSON.stringify({ type: 'text', text: nextText });
      if (isGroupConversation) {
        if (!groupParticipants.length) throw new Error('Missing group participants');
        if (!groupPublicKeys || !Object.keys(groupPublicKeys).length) {
          throw new Error('Encryption keys are still loading');
        }
        if (groupKeyMissing.length) {
          throw new Error('Some participants have not published encryption keys yet');
        }
        const recipients = {};
        for (const email of groupParticipants) {
          const publicKey = groupPublicKeys[email];
          if (!publicKey) {
            throw new Error(`Missing encryption key for ${email}`);
          }
          const key = await deriveSharedSecretKey(privateKey, publicKey);
          recipients[email] = await encryptText(payload, key);
        }
        const packed = packEncryptedPayload({ v: 2, mode: 'group', recipients });
        return sendMessage(selectedId, packed, { accessToken, myEmail });
      }

      const key = await deriveSharedSecretKey(privateKey, otherPublicKey);
      const encrypted = await encryptText(payload, key);
      const packed = packEncryptedPayload(encrypted);
      return sendMessage(selectedId, packed, { accessToken, myEmail });
    },
    onMutate: ({ text, clientId }) => {
      const nowIso = new Date().toISOString();
      const pending = {
        id: clientId,
        body: String(text || ''),
        pending_text: String(text || ''),
        pending: true,
        created_at: nowIso,
        sender_email: myEmail,
        read_by: [myEmail],
        delivered_to: [],
      };
      setPendingMessages((prev) => [...prev, pending]);
      return { clientId };
    },
    onSuccess: async (created, _vars, context) => {
      setDraft('');
      if (context?.clientId) {
        setPendingMessages((prev) => prev.filter((m) => String(m?.id || '') !== String(context.clientId)));
      }
      upsertMessageIntoCache(created);
      bumpConversationInCache(selectedId, {
        last_message_body: created?.body ?? null,
        last_message_at: created?.created_at ?? null,
        updated_at: new Date().toISOString(),
      });
    },
    onError: (e, _vars, context) => {
      if (context?.clientId) {
        setPendingMessages((prev) => prev.filter((m) => String(m?.id || '') !== String(context.clientId)));
      }
      logError(e, 'Failed to send message', { conversationId: selectedId });
      toast.error(getInteractionErrorMessage(e, 'Failed to send'));
    },
  });

  const handleSend = () => {
    const text = String(draft || '').trim();
    if (!text) return;
    sendMutation.mutate({ text, clientId: buildPendingId() });
  };

  const reactionMutation = useMutation({
    mutationFn: async ({ messageId, emoji }) => {
      return toggleMessageReaction(messageId, emoji, { accessToken, myEmail });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['messages', selectedId, myEmailNormalized] });
    },
    onError: (e) => toast.error(getInteractionErrorMessage(e, 'Failed to react')),
  });

  const updateCustomReaction = (messageId, value) => {
    const id = String(messageId || '');
    setCustomReactionDrafts((prev) => ({ ...prev, [id]: value }));
  };

  const submitCustomReaction = (messageId) => {
    const id = String(messageId || '');
    const raw = customReactionDrafts[id] ? String(customReactionDrafts[id]).trim() : '';
    if (!raw) {
      toast.error('Enter an emoji to react');
      return;
    }
    reactionMutation.mutate({ messageId: id, emoji: raw });
    setCustomReactionDrafts((prev) => ({ ...prev, [id]: '' }));
    setReactionPickerForId(null);
  };

  const sendMedia = async () => {
    if (!pendingMediaFile) return;
    if (!accessToken) {
      toast.error('Please log in to send media');
      return;
    }
    if (!selectedId) {
      toast.error('Select a conversation');
      return;
    }
    if (groupReadOnly) {
      toast.error('Only approved posters can send media in this group');
      return;
    }
    if (!isGroupConversation && (!otherEmail || !otherPublicKey)) {
      toast.error('Recipient key unavailable');
      return;
    }
    if (isGroupConversation && groupKeyMissing.length) {
      toast.error('Some participants have not published encryption keys yet');
      return;
    }

    setSendingMedia(true);
    try {
      const uploaded = await uploadFile(pendingMediaFile, {
        accessToken,
        maxBytes: MAX_UPLOAD_BYTES,
        allowedMimeTypes: ALLOWED_IMAGE_WITH_GIF_MIME_TYPES,
      });
      const url = uploaded?.url ? String(uploaded.url) : null;
      if (!url) throw new Error('Upload failed');

      const { privateKey } = await getOrCreateIdentityKeypair(myEmail);
      const payload = JSON.stringify({ type: 'media', url, caption: '', sensitive: !!pendingMediaSensitive });
      let packed = null;
      if (isGroupConversation) {
        if (!groupParticipants.length) throw new Error('Missing group participants');
        if (!groupPublicKeys || !Object.keys(groupPublicKeys).length) {
          throw new Error('Encryption keys are still loading');
        }
        const recipients = {};
        for (const email of groupParticipants) {
          const publicKey = groupPublicKeys[email];
          if (!publicKey) {
            throw new Error(`Missing encryption key for ${email}`);
          }
          const key = await deriveSharedSecretKey(privateKey, publicKey);
          recipients[email] = await encryptText(payload, key);
        }
        packed = packEncryptedPayload({ v: 2, mode: 'group', recipients });
      } else {
        const key = await deriveSharedSecretKey(privateKey, otherPublicKey);
        const encrypted = await encryptText(payload, key);
        packed = packEncryptedPayload(encrypted);
      }

      const created = await sendMessage(selectedId, packed, { accessToken, myEmail });

      setPendingMediaFile(null);
      setPendingMediaSensitive(false);
      upsertMessageIntoCache(created);
      bumpConversationInCache(selectedId, {
        last_message_body: created?.body ?? null,
        last_message_at: created?.created_at ?? null,
        updated_at: new Date().toISOString(),
      });
    } catch (e) {
      logError(e, 'Failed to send media message', { conversationId: selectedId });
      toast.error(getInteractionErrorMessage(e, 'Failed to send media'));
    } finally {
      setSendingMedia(false);
    }
  };

  const requestActionMutation = useMutation({
    mutationFn: async ({ conversationId, action }) => {
      if (!conversationId) throw new Error('Conversation is required');
      return actOnConversationRequest(conversationId, action, { accessToken, myEmail });
    },
    onSuccess: async (updated) => {
      await queryClient.invalidateQueries({ queryKey: ['conversations', myEmailNormalized] });
      if (updated?.id) {
        setSelectedId(String(updated.id));
      }
    },
    onError: (e) => {
      toast.error(getInteractionErrorMessage(e, 'Failed to update request'));
    },
  });

  const acceptInviteMutation = useMutation({
    mutationFn: async (collabId) => {
      if (!accessToken) throw new Error('Authentication required');
      return acceptCollaborationInvite(collabId, { accessToken });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['collaborationInvites', myEmailNormalized] });
      toast.success('Collaboration invite accepted');
    },
    onError: (e) => {
      toast.error(getInteractionErrorMessage(e, 'Failed to accept invite'));
    },
  });

  const declineInviteMutation = useMutation({
    mutationFn: async (collabId) => {
      if (!accessToken) throw new Error('Authentication required');
      return removeCollaborator(collabId, { accessToken });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['collaborationInvites', myEmailNormalized] });
      toast.success('Collaboration invite declined');
    },
    onError: (e) => {
      toast.error(getInteractionErrorMessage(e, 'Failed to decline invite'));
    },
  });

  const updateGroupSettingsMutation = useMutation({
    mutationFn: async () => {
      if (!accessToken) throw new Error('Authentication required');
      if (!selectedConversation?.id) throw new Error('Select a group chat');
      const name = String(groupNameDraft || '').trim();
      if (!name) throw new Error('Group name is required');

      let avatarUrl = groupAvatarPreview || null;
      if (groupAvatarFile) {
        const uploaded = await uploadFile(groupAvatarFile, {
          accessToken,
          maxBytes: MAX_UPLOAD_BYTES,
          allowedMimeTypes: ALLOWED_IMAGE_MIME_TYPES,
          kind: 'group_avatar',
        });
        avatarUrl = uploaded?.url ? String(uploaded.url) : null;
      }

      const payload = {
        group_name: name,
        group_avatar_url: avatarUrl,
      };
      if (!isMovementGroup || isGroupOwner) {
        payload.group_post_mode = groupPostMode;
        payload.group_posters = groupPosterSelection;
      }
      if (isGroupOwner) {
        payload.group_admin_emails = groupAdminSelection;
      }

      return updateGroupSettings(selectedConversation.id, payload, { accessToken });
    },
    onSuccess: async (updated) => {
      await queryClient.invalidateQueries({ queryKey: ['conversations', myEmailNormalized] });
      setGroupSettingsOpen(false);
      setGroupAvatarFile(null);
      setGroupAvatarPreview(String(updated?.group_avatar_url || ''));
      toast.success('Group settings updated');
    },
    onError: (e) => {
      toast.error(getInteractionErrorMessage(e, 'Failed to update group'));
    },
  });

  const updateGroupParticipantsMutation = useMutation({
    mutationFn: async ({ add = [], remove = [] }) => {
      if (!accessToken) throw new Error('Authentication required');
      if (!selectedConversation?.id) throw new Error('Select a group chat');
      return updateGroupParticipants(selectedConversation.id, { add_emails: add, remove_emails: remove }, { accessToken });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['conversations', myEmailNormalized] });
      setGroupAddUsername('');
      setMovementAddSelection([]);
      toast.success('Group participants updated');
    },
    onError: (e) => {
      toast.error(getInteractionErrorMessage(e, 'Failed to update participants'));
    },
  });

  const handleGroupAvatarChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const validationError = validateFileUpload({
      file,
      maxBytes: MAX_UPLOAD_BYTES,
      allowedMimeTypes: ALLOWED_IMAGE_MIME_TYPES,
    });
    if (validationError) {
      toast.error(validationError);
      return;
    }
    if (groupAvatarPreview && groupAvatarPreview.startsWith('blob:')) {
      URL.revokeObjectURL(groupAvatarPreview);
    }
    setGroupAvatarFile(file);
    setGroupAvatarPreview(URL.createObjectURL(file));
  };

  const toggleGroupPoster = (email) => {
    const normalized = normalizeEmail(email);
    if (!normalized) return;
    setGroupPosterSelection((prev) => {
      const exists = prev.includes(normalized);
      return exists ? prev.filter((e) => e !== normalized) : [...prev, normalized];
    });
  };

  const toggleGroupAdmin = (email) => {
    const normalized = normalizeEmail(email);
    if (!normalized || normalized === normalizeEmail(selectedConversation?.created_by_email)) return;
    setGroupAdminSelection((prev) => {
      const exists = prev.includes(normalized);
      return exists ? prev.filter((e) => e !== normalized) : [...prev, normalized];
    });
  };

  const toggleMovementAdd = (email) => {
    const normalized = normalizeEmail(email);
    if (!normalized) return;
    setMovementAddSelection((prev) => {
      const exists = prev.includes(normalized);
      return exists ? prev.filter((e) => e !== normalized) : [...prev, normalized];
    });
  };

  const handleConversationStarted = (convo) => {
    if (!convo?.id) return;
    setSelectedId(String(convo.id));
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('conversationId', String(convo.id));
      return next;
    });
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-32">
        <Loader2 className="w-12 h-12 text-[#3A3DFF] animate-spin mb-4" />
        <p className="text-slate-500 font-bold">Loading...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="max-w-4xl mx-auto px-3 sm:px-4 py-10 sm:py-12">
        <div className="p-8 rounded-2xl border border-slate-200 bg-white shadow-sm text-center space-y-3">
          <h1 className="text-3xl font-black text-slate-900">Messages</h1>
          <p className="text-slate-600 font-semibold">Sign in to use messaging.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-3 sm:px-4 py-6 sm:py-8">
      <div className="bg-white rounded-3xl shadow-2xl border-3 border-slate-200 overflow-hidden">
        <div className="grid grid-cols-1 md:grid-cols-3 min-h-[70vh]">
          {/* Left: conversations */}
          <div className="border-b md:border-b-0 md:border-r border-slate-200">
            <div className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MessageCircle className="w-5 h-5 text-slate-700" />
                <h1 className="text-lg font-black text-slate-900">Messages</h1>
              </div>
              <Button
                onClick={() => setComposeOpen(true)}
                className="h-10 rounded-xl font-bold bg-[#3A3DFF] hover:bg-[#2A2DDD]"
              >
                <Plus className="w-4 h-4 mr-2" />
                New
              </Button>
            </div>

            <div className="px-4 pb-4">
              <div className="text-xs font-bold text-slate-500">Signed in as {signedInLabel}</div>
            </div>

            <div className="px-4 pb-4">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={
                    "Search users or conversations"
                  }
                  className="h-11 pl-9 rounded-xl border-2"
                />
              </div>
            </div>

            <div className="px-4 pb-4 flex gap-2">
              <Button
                variant={box === 'messages' ? 'default' : 'outline'}
                className={cn('h-10 rounded-xl font-bold', box === 'messages' && 'bg-[#3A3DFF] hover:bg-[#2A2DDD]')}
                onClick={() => setBox('messages')}
              >
                <span className="inline-flex items-center gap-2">
                  Messages
                  {messagesUnreadCount > 0 ? (
                    <span className="min-w-5 h-5 px-1.5 rounded-full bg-red-600 text-white text-[11px] font-black inline-flex items-center justify-center">
                      {messagesUnreadCount}
                    </span>
                  ) : null}
                </span>
              </Button>
              <Button
                variant={box === 'requests' ? 'default' : 'outline'}
                className={cn('h-10 rounded-xl font-bold', box === 'requests' && 'bg-[#3A3DFF] hover:bg-[#2A2DDD]')}
                onClick={() => setBox('requests')}
              >
                <span className="inline-flex items-center gap-2">
                  Requests
                  {requestsCount > 0 ? (
                    <span className="min-w-5 h-5 px-1.5 rounded-full bg-red-600 text-white text-[11px] font-black inline-flex items-center justify-center">
                      {requestsCount}
                    </span>
                  ) : null}
                </span>
              </Button>
              <Button
                variant={box === 'movements' ? 'default' : 'outline'}
                className={cn('h-10 rounded-xl font-bold', box === 'movements' && 'bg-[#3A3DFF] hover:bg-[#2A2DDD]')}
                onClick={() => setBox('movements')}
              >
                <span className="inline-flex items-center gap-2">
                  Movements
                  {movementsTotalCount > 0 ? (
                    <span className="min-w-5 h-5 px-1.5 rounded-full bg-red-600 text-white text-[11px] font-black inline-flex items-center justify-center">
                      {movementsTotalCount}
                    </span>
                  ) : null}
                </span>
              </Button>
            </div>
            {box === 'movements' ? (
              <div className="px-4 pb-2 text-xs font-bold text-slate-500">
                Movement group chats and collaboration invites live here.
              </div>
            ) : null}

            {conversationsLoading ? (
              <div className="p-6 text-slate-600 font-semibold flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading conversations...
              </div>
            ) : conversationsConnectivityError ? (
              <div className="p-6 text-slate-600 font-semibold space-y-3">
                <div>Couldn’t load conversations. Please try again.</div>
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 rounded-xl font-bold"
                  onClick={() => refetchConversations()}
                >
                  Retry
                </Button>
              </div>
            ) : visibleConversations.length === 0 && !(box === 'movements' && Array.isArray(collabInvites) && collabInvites.length > 0) ? (
              <div className="p-6 text-slate-600 font-semibold">
                {box === 'movements'
                  ? 'No movement chats or collaboration invites yet.'
                  : box === 'requests'
                    ? 'No message requests right now.'
                    : 'No active messages yet. Start a conversation from a profile or movement.'}
              </div>
            ) : (
              <>
                <div className="divide-y divide-slate-100">
                  {box === 'movements' && Array.isArray(collabInvites) && collabInvites.length > 0 ? (
                    <div className="px-4 py-4 bg-slate-50">
                      <div className="text-xs font-black text-slate-500">Collaboration invites</div>
                      <div className="mt-3 space-y-2">
                        {collabInvites.slice(0, 20).map((invite) => {
                          const inviteId = String(invite?.id || invite?._id || '');
                          const title = String(invite?.movement_title || invite?.movement_id || 'Movement');
                          const role = String(invite?.role || 'collaborator');
                          return (
                            <div
                              key={inviteId}
                              className="p-3 rounded-2xl border border-slate-200 bg-white flex items-start justify-between gap-3"
                            >
                              <div className="min-w-0">
                                <div className="font-black text-slate-900 truncate">{title}</div>
                                <div className="text-xs font-bold text-slate-500 mt-1">Invite to collaborate • {role}</div>
                              </div>
                              <div className="flex items-center gap-2">
                                <Button
                                  type="button"
                                  className="h-9 rounded-xl font-bold bg-[#3A3DFF] hover:bg-[#2A2DDD]"
                                  disabled={acceptInviteMutation.isPending || declineInviteMutation.isPending || !inviteId}
                                  onClick={() => acceptInviteMutation.mutate(inviteId)}
                                >
                                  Accept
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  className="h-9 rounded-xl font-bold"
                                  disabled={acceptInviteMutation.isPending || declineInviteMutation.isPending || !inviteId}
                                  onClick={() => declineInviteMutation.mutate(inviteId)}
                                >
                                  Decline
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}

                  {visibleConversations.map((c) => {
                    const id = String(c?.id || '');
                    const isGroup = !!c?.is_group;
                    const other = getConversationLabel(c, myEmail, profileLookup);
                    const otherEmail = isGroup ? null : getOtherParticipant(c?.participant_emails, myEmail);
                    const otherNormalized = normalizeEmail(otherEmail);
                    const otherProfile = otherNormalized ? profileLookup.get(otherNormalized) : null;
                    const unread = Number(c?.unread_count || 0);
                    const isSelected = id && selectedId && id === String(selectedId);
                    const status = String(c?.request_status || 'accepted').toLowerCase();
                    const lastBody = c?.last_message_body
                      ? (isEncryptedBody(c.last_message_body) ? 'Encrypted message' : String(c.last_message_body))
                      : 'No messages yet';
                    const participantCount = Array.isArray(c?.participant_emails) ? c.participant_emails.length : 0;
                    const groupLabel = String(c?.group_type || '') === 'movement_verified' ? 'Verified group' : 'Group chat';
                    return (
                      <button
                        key={id}
                        onClick={() => {
                          setSelectedId(id);
                          setSearchParams((prev) => {
                            const next = new URLSearchParams(prev);
                            next.set('conversationId', id);
                            return next;
                          });
                        }}
                        className={cn(
                          'w-full text-left px-4 py-4 hover:bg-slate-50 transition',
                          isSelected && 'bg-indigo-50'
                        )}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <Avatar className="h-10 w-10">
                              <AvatarImage
                                src={isGroup ? c?.group_avatar_url || undefined : otherProfile?.profile_photo_url || undefined}
                                alt={other || 'Conversation'}
                              />
                              <AvatarFallback className="bg-slate-200 text-slate-700 font-black">
                                {(other || 'C')[0]?.toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <div className="font-black text-slate-900 truncate">{other || 'Conversation'}</div>
                              <div className="text-sm text-slate-600 truncate">
                                {lastBody}
                              </div>
                              {isGroup ? (
                                <div className="text-xs font-black text-slate-500 mt-1">
                                  {groupLabel} • {participantCount} participants
                                </div>
                              ) : null}
                              {status === 'pending' && (
                                <div className="text-xs font-black text-slate-500 mt-1">Request pending</div>
                              )}
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-2">
                            <div className="text-xs text-slate-400 font-bold">{formatTime(c?.last_message_at || c?.updated_at)}</div>
                            {unread > 0 && (
                              <div className="min-w-6 h-6 px-2 rounded-full bg-[#3A3DFF] text-white text-xs font-black flex items-center justify-center">
                                {unread}
                              </div>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
                {hasMoreConversations ? (
                  <div className="p-4 flex justify-center">
                    <Button
                      type="button"
                      variant="outline"
                      className="h-10 rounded-xl font-bold"
                      onClick={() => fetchNextConversations()}
                      disabled={isFetchingMoreConversations}
                    >
                      {isFetchingMoreConversations ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Loading...
                        </>
                      ) : (
                        'Load more'
                      )}
                    </Button>
                  </div>
                ) : null}
              </>
            )}
          </div>

          {/* Right: chat */}
          <div className="md:col-span-2 flex flex-col">
            {!selectedConversation ? (
              <div className="flex-1 flex items-center justify-center p-8 text-center">
                <div className="space-y-3">
                  <div className="text-2xl font-black text-slate-900">Select a conversation</div>
                  <div className="text-slate-600 font-semibold">Or start a new one.</div>
                </div>
              </div>
            ) : (
              <>
                <div className="p-4 border-b border-slate-200">
                  <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                      <Avatar className="h-10 w-10">
                        <AvatarImage
                          src={
                            isGroupConversation
                              ? selectedConversation?.group_avatar_url || undefined
                              : selectedOtherProfile?.profile_photo_url || undefined
                          }
                          alt={selectedTitle || 'Conversation'}
                        />
                        <AvatarFallback className="bg-slate-200 text-slate-700 font-black">
                          {(selectedTitle || 'C')[0]?.toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <div className="font-black text-slate-900">{selectedTitle || 'Conversation'}</div>
                        <div className="text-xs text-slate-500 font-bold mt-1">
                          End-to-end encrypted
                          {isGroupConversation
                            ? ` • ${groupParticipants.length} participants`
                            : ''}
                          {!isGroupConversation && otherKeyLoading ? ' (loading key...)' : ''}
                          {!isGroupConversation && otherKeyError ? ' (key unavailable)' : ''}
                          {isGroupConversation && groupKeysLoading ? ' (loading keys...)' : ''}
                          {isGroupConversation && groupKeyMissing.length ? ' (missing keys)' : ''}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap justify-end">
                      {isGroupConversation && isGroupAdminUser ? (
                        <Button
                          type="button"
                          variant="outline"
                          className="h-10 rounded-xl font-bold"
                          onClick={() => setGroupSettingsOpen(true)}
                        >
                          Group settings
                        </Button>
                      ) : null}

                      {String(selectedConversation?.request_status || '').toLowerCase() === 'pending' &&
                        String(selectedConversation?.requester_email || '').toLowerCase() !==
                          String(myEmail || '').toLowerCase() && (
                          <div className="flex items-center gap-2">
                            <Button
                              className="h-10 rounded-xl font-bold bg-[#3A3DFF] hover:bg-[#2A2DDD]"
                              disabled={requestActionMutation.isPending}
                              onClick={() =>
                                requestActionMutation.mutate({
                                  conversationId: String(selectedConversation?.id),
                                  action: 'accept',
                                })
                              }
                            >
                              Accept
                            </Button>
                            <Button
                              variant="outline"
                              className="h-10 rounded-xl font-bold"
                              disabled={requestActionMutation.isPending}
                              onClick={() =>
                                requestActionMutation.mutate({
                                  conversationId: String(selectedConversation?.id),
                                  action: 'decline',
                                })
                              }
                            >
                              Decline
                            </Button>
                            <Button
                              variant="outline"
                              className="h-10 rounded-xl font-bold"
                              disabled={requestActionMutation.isPending}
                              onClick={() =>
                                requestActionMutation.mutate({
                                  conversationId: String(selectedConversation?.id),
                                  action: 'block',
                                })
                              }
                            >
                              Block
                            </Button>
                          </div>
                        )}
                    </div>
                  </div>

                  {hasBlockedParticipant && (
                    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
                      Someone in this chat is blocked. Their messages are hidden from you.
                    </div>
                  )}
                </div>

                <div className="flex-1 p-4 overflow-y-auto bg-slate-50">
                  {messagesLoading ? (
                    <div className="text-slate-600 font-semibold flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Loading messages...
                    </div>
                  ) : messagesConnectivityError ? (
                    <div className="text-slate-600 font-semibold space-y-3">
                      <div>Couldn’t load messages. Please try again.</div>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-10 rounded-xl font-bold"
                        onClick={() => refetchMessages()}
                      >
                        Retry
                      </Button>
                    </div>
                  ) : mergedMessages.length === 0 ? (
                    <div className="text-slate-600 font-semibold">
                      No active messages yet. Start a conversation from a profile or movement.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {hasMoreMessages ? (
                        <div className="flex justify-center pb-1">
                          <Button
                            type="button"
                            variant="outline"
                            className="h-10 rounded-xl font-bold"
                            onClick={() => fetchNextMessages()}
                            disabled={isFetchingMoreMessages}
                          >
                            {isFetchingMoreMessages ? (
                              <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                Loading...
                              </>
                            ) : (
                              'Load earlier'
                            )}
                          </Button>
                        </div>
                      ) : null}
                      {mergedMessages.map((m) => {
                        const mine = String(m?.sender_email || '').toLowerCase() === String(myEmail).toLowerCase();
                        let displayBody = String(m?.body || '');
                        let encryptedPayload = null;
                        if (isEncryptedBody(displayBody)) {
                          try {
                            encryptedPayload = unpackEncryptedPayload(displayBody);
                          } catch {
                            encryptedPayload = null;
                          }
                        }
                        const isPending = !!m?.pending;
                        const readBy = Array.isArray(m?.read_by) ? m.read_by.map((x) => String(x).toLowerCase()) : [];
                        const readByOthers = mine ? readBy.filter((e) => e && e !== myEmailNormalized) : [];
                        const otherHasRead = mine
                          ? (isGroupConversation ? readByOthers.length > 0 : (otherEmailNormalized && readBy.includes(otherEmailNormalized)))
                          : false;
                        const deliveredTo = Array.isArray(m?.delivered_to)
                          ? m.delivered_to.map((x) => String(x).toLowerCase())
                          : [];
                        const deliveredToOthers = mine ? deliveredTo.filter((e) => e && e !== myEmailNormalized) : [];
                        const otherHasDelivered = mine
                          ? (isGroupConversation ? deliveredToOthers.length > 0 : (otherEmailNormalized && deliveredTo.includes(otherEmailNormalized)))
                          : false;
                        const senderEmail = normalizeEmail(m?.sender_email);
                        const senderPublicKey = isGroupConversation
                          ? (senderEmail ? groupPublicKeys[senderEmail] : null)
                          : otherPublicKey;
                        const senderProfile = senderEmail ? profileLookup.get(senderEmail) : null;
                        const senderDisplay =
                          String(senderProfile?.display_name || '').trim() ||
                          (senderProfile?.username ? `@${String(senderProfile.username).trim()}` : '') ||
                          (mine ? 'You' : 'Member');
                        const statusLabel = mine
                          ? (isPending
                              ? 'Sending…'
                            : (otherHasRead
                              ? (isGroupConversation ? `Read by ${readByOthers.length}` : 'Read')
                              : (otherHasDelivered ? 'Delivered' : 'Sent')))
                          : null;
                        return (
                          <div key={String(m?.id)} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
                            <div
                              className={cn(
                                'max-w-[85%] rounded-2xl px-4 py-3 border-2',
                                mine
                                  ? 'bg-[#3A3DFF] text-white border-[#3A3DFF]'
                                  : 'bg-white text-slate-900 border-slate-200'
                              )}
                            >
                              {isGroupConversation && !mine ? (
                                <div className="text-xs font-black text-slate-500 mb-1">{senderDisplay}</div>
                              ) : null}
                              <div className="text-sm font-semibold whitespace-pre-wrap">
                                {encryptedPayload ? (
                                  senderPublicKey ? (
                                    <EncryptedMessage
                                      myEmail={myEmail}
                                      senderPublicKey={senderPublicKey}
                                      encryptedPayload={encryptedPayload}
                                      messageId={String(m?.id || '')}
                                    />
                                  ) : (
                                    <span className="opacity-80">[Encrypted message]</span>
                                  )
                                ) : (
                                  displayBody
                                )}
                              </div>

                              <div className={cn('mt-2 flex items-center justify-between gap-2', mine ? 'text-white/80' : 'text-slate-500')}>
                                <div className="flex items-center gap-2">
                                  {m?.reactions && typeof m.reactions === 'object'
                                    ? Object.entries(m.reactions).slice(0, 4).map(([emoji, emails]) => (
                                        <button
                                          key={emoji}
                                          type="button"
                                          className={cn(
                                            'px-2 py-1 rounded-full border text-xs font-black',
                                            mine ? 'border-white/30 bg-white/10' : 'border-slate-200 bg-slate-50'
                                          )}
                                          onClick={() =>
                                            reactionMutation.mutate({ messageId: String(m?.id || ''), emoji: String(emoji) })
                                          }
                                          disabled={reactionMutation.isPending}
                                          title="Toggle reaction"
                                        >
                                          {String(emoji)} {Array.isArray(emails) ? emails.length : 0}
                                        </button>
                                      ))
                                    : null}

                                  <button
                                    type="button"
                                    onClick={() => {
                                      const id = String(m?.id || '');
                                      setReactionPickerForId((cur) => (String(cur || '') === id ? null : id));
                                    }}
                                    disabled={reactionMutation.isPending}
                                    className={cn(
                                      'px-2 py-1 rounded-full border text-xs font-black inline-flex items-center gap-1',
                                      mine ? 'border-white/30 bg-white/10' : 'border-slate-200 bg-slate-50'
                                    )}
                                    title="React"
                                  >
                                    <SmilePlus className="w-4 h-4" />
                                  </button>
                                </div>

                                <div className={cn('text-[11px] font-bold inline-flex items-center gap-1', mine ? 'text-white/80' : 'text-slate-400')}>
                                  {formatTime(m?.created_at)}
                                  {mine ? (
                                    otherHasRead || otherHasDelivered ? (
                                      <CheckCheck className="w-3.5 h-3.5" />
                                    ) : (
                                      <Check className="w-3.5 h-3.5" />
                                    )
                                  ) : null}
                                  {statusLabel ? <span className="ml-1">{statusLabel}</span> : null}
                                </div>
                              </div>

                              {String(reactionPickerForId || '') === String(m?.id || '') ? (
                                <div className={cn('mt-2 flex flex-wrap items-center gap-2', mine ? 'text-white' : 'text-slate-900')}>
                                  {['👍', '❤️', '😂', '😮', '😢', '🔥'].map((emoji) => (
                                    <button
                                      key={emoji}
                                      type="button"
                                      className={cn(
                                        'px-2 py-1 rounded-xl border text-sm font-black',
                                        mine ? 'border-white/30 bg-white/10' : 'border-slate-200 bg-white'
                                      )}
                                      onClick={() => {
                                        reactionMutation.mutate({ messageId: String(m?.id || ''), emoji });
                                        setReactionPickerForId(null);
                                      }}
                                      disabled={reactionMutation.isPending}
                                      title="Add reaction"
                                    >
                                      {emoji}
                                    </button>
                                  ))}
                                  <div className="flex items-center gap-2">
                                    <Input
                                      value={customReactionDrafts[String(m?.id || '')] || ''}
                                      onChange={(e) => updateCustomReaction(m?.id, e.target.value)}
                                      placeholder="Custom emoji"
                                      className={cn(
                                        'h-8 w-24 text-xs font-bold rounded-lg border-2',
                                        mine ? 'border-white/30 bg-white/10 text-white placeholder:text-white/60' : ''
                                      )}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                          e.preventDefault();
                                          submitCustomReaction(m?.id);
                                        }
                                      }}
                                    />
                                    <Button
                                      type="button"
                                      variant="outline"
                                      className={cn('h-8 px-2 rounded-lg text-xs font-black', mine && 'border-white/30 bg-white/10 text-white')}
                                      onClick={() => submitCustomReaction(m?.id)}
                                      disabled={reactionMutation.isPending}
                                    >
                                      Add
                                    </Button>
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="p-4 border-t border-slate-200 bg-white">
                  {String(selectedConversation?.request_status || '').toLowerCase() === 'pending' &&
                    String(selectedConversation?.requester_email || '').toLowerCase() !==
                      String(myEmail || '').toLowerCase() && (
                      <div className="mb-3 text-sm font-bold text-slate-600">
                        This is a message request. Accept to reply.
                      </div>
                    )}
                  {groupReadOnly ? (
                    <div className="mb-3 text-sm font-bold text-slate-600">
                      Only approved posters can send messages in this group. You can still react.
                    </div>
                  ) : null}

                  {pendingMediaFile ? (
                    <div className="mb-3 rounded-xl border-2 border-slate-200 p-3 bg-slate-50">
                      <div className="text-sm font-black text-slate-900">Ready to send media</div>
                      <div className="text-sm font-bold text-slate-600 truncate">{pendingMediaFile?.name}</div>
                      <div className="mt-2 flex items-center justify-between gap-2 flex-wrap">
                        <button
                          type="button"
                          className={cn(
                            'px-3 py-2 rounded-xl border-2 text-sm font-black',
                            pendingMediaSensitive ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-slate-200 bg-white text-slate-800'
                          )}
                          onClick={() => setPendingMediaSensitive((v) => !v)}
                          disabled={sendingMedia}
                          title="Mark as sensitive to blur by default"
                          aria-pressed={pendingMediaSensitive}
                          aria-label={pendingMediaSensitive ? 'Marked sensitive' : 'Mark as sensitive'}
                        >
                          Sensitive: {pendingMediaSensitive ? 'Yes' : 'No'}
                        </button>

                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            className="h-10 rounded-xl font-bold"
                            onClick={() => {
                              setPendingMediaFile(null);
                              setPendingMediaSensitive(false);
                            }}
                            disabled={sendingMedia}
                          >
                            Cancel
                          </Button>
                          <Button
                            className="h-10 rounded-xl font-bold bg-[#3A3DFF] hover:bg-[#2A2DDD]"
                            onClick={() => sendMedia()}
                            disabled={sendingMedia || cannotReply || groupReadOnly}
                          >
                            {sendingMedia ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Send media'}
                          </Button>
                        </div>
                      </div>
                      <div className="mt-2 text-xs font-bold text-slate-500">
                        If marked sensitive, it will be blurred until tapped.
                      </div>
                    </div>
                  ) : null}

                  <div className="flex gap-2">
                    <input
                      ref={mediaInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0] || null;
                        e.target.value = '';
                        if (!file) return;
                        const validationError = validateFileUpload({
                          file,
                          maxBytes: MAX_UPLOAD_BYTES,
                          allowedMimeTypes: ALLOWED_IMAGE_WITH_GIF_MIME_TYPES,
                        });
                        if (validationError) {
                          toast.error(validationError);
                          return;
                        }
                        setPendingMediaFile(file);
                        setPendingMediaSensitive(false);
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className="h-12 w-12 rounded-xl border-2 px-0"
                      onClick={() => mediaInputRef.current?.click()}
                      disabled={cannotReply || groupReadOnly || sendingMedia}
                      title="Send an image/GIF"
                      aria-label="Attach an image"
                    >
                      <ImageIcon className="w-5 h-5" />
                    </Button>
                    <Input
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder="Write a message..."
                      className="h-12 rounded-xl border-2"
                      disabled={cannotReply || groupReadOnly}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSend();
                        }
                      }}
                    />
                    <Button
                      onClick={handleSend}
                      disabled={
                        sendMutation.isPending ||
                        cannotReply ||
                        groupReadOnly
                      }
                      className="h-12 rounded-xl font-bold bg-[#3A3DFF] hover:bg-[#2A2DDD]"
                    >
                      {sendMutation.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <>
                          <Send className="w-4 h-4 mr-2" />
                          Send
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <ComposeModal
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        currentUser={user}
        onConversationStarted={handleConversationStarted}
      />

      <Dialog open={groupSettingsOpen} onOpenChange={setGroupSettingsOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-xl font-black">Group settings</DialogTitle>
          </DialogHeader>

          {!selectedConversation ? (
            <div className="text-sm text-slate-600 font-semibold">Select a group chat to manage it.</div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-black text-slate-500">Group name</label>
                <Input
                  value={groupNameDraft}
                  onChange={(e) => setGroupNameDraft(e.target.value)}
                  className="rounded-xl border-2"
                />
              </div>

              <div className="flex items-center gap-3">
                <Avatar className="h-12 w-12">
                  <AvatarImage src={groupAvatarPreview || undefined} alt="Group avatar" />
                  <AvatarFallback className="bg-slate-200 text-slate-700 font-black">
                    {(groupNameDraft || selectedTitle || 'G')[0]?.toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="space-y-1">
                  <label className="text-xs font-black text-slate-500" htmlFor="group-avatar-file">
                    Group photo
                  </label>
                  <input
                    id="group-avatar-file"
                    type="file"
                    accept={ALLOWED_IMAGE_MIME_TYPES.join(',')}
                    onChange={handleGroupAvatarChange}
                    className="text-xs"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-xs font-black text-slate-500">Posting permissions</div>
                <div className="grid gap-2 text-sm font-semibold text-slate-700">
                  {(isMovementGroup
                    ? [
                        { value: 'owner_only', label: 'Owner-only (noticeboard mode)' },
                        { value: 'selected', label: 'Selected participants' },
                        { value: 'all', label: 'All participants' },
                      ]
                    : [
                        { value: 'all', label: 'All participants' },
                        { value: 'admins', label: 'Admins only' },
                        { value: 'selected', label: 'Selected participants' },
                      ]).map((option) => (
                    <label key={option.value} className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="group-post-mode"
                        value={option.value}
                        checked={groupPostMode === option.value}
                        onChange={() => setGroupPostMode(option.value)}
                        disabled={isMovementGroup && !isGroupOwner}
                      />
                      <span>{option.label}</span>
                    </label>
                  ))}
                  {isMovementGroup && !isGroupOwner ? (
                    <div className="text-xs text-slate-500">
                      Only the movement owner can change posting permissions.
                    </div>
                  ) : null}
                </div>
                {groupPostMode === 'selected' ? (
                  <div className="mt-2 space-y-2">
                    <div className="text-xs font-black text-slate-500">Allowed posters</div>
                    <div className="flex flex-wrap gap-2">
                      {groupParticipants.map((email) => (
                        <label key={email} className="flex items-center gap-2 text-xs font-bold text-slate-700">
                          <Checkbox
                            checked={groupPosterSelection.includes(email)}
                            onCheckedChange={() => toggleGroupPoster(email)}
                          />
                          {labelForEmail(email, { includeYou: true })}
                        </label>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="space-y-2">
                <div className="text-xs font-black text-slate-500">Group admins</div>
                <div className="flex flex-wrap gap-2">
                  {groupParticipants.map((email) => {
                    const isOwner = normalizeEmail(email) === normalizeEmail(selectedConversation?.created_by_email);
                    return (
                      <label key={email} className="flex items-center gap-2 text-xs font-bold text-slate-700">
                        <Checkbox
                          checked={groupAdminSelection.includes(email)}
                          onCheckedChange={() => toggleGroupAdmin(email)}
                          disabled={!isGroupOwner || isOwner}
                        />
                        {labelForEmail(email, { includeYou: true })} {isOwner ? '(owner)' : ''}
                      </label>
                    );
                  })}
                </div>
                {!isGroupOwner ? (
                  <div className="text-xs text-slate-500">Only the group owner can change admin roles.</div>
                ) : null}
              </div>

              <div className="space-y-2">
                <div className="text-xs font-black text-slate-500">Participants</div>
                <div className="text-xs text-slate-500">Group chats are limited to 10 participants total.</div>
                <div className="space-y-2">
                  {groupParticipants.map((email) => {
                    const isOwner = normalizeEmail(email) === normalizeEmail(selectedConversation?.created_by_email);
                    return (
                      <div key={email} className="flex items-center justify-between text-sm font-semibold text-slate-700">
                        <div>{labelForEmail(email, { includeYou: true })} {isOwner ? '(owner)' : ''}</div>
                        {(isMovementGroup ? isGroupOwner : isGroupAdminUser) && !isOwner ? (
                          <Button
                            type="button"
                            variant="outline"
                            className="h-8 rounded-lg text-xs font-black"
                            onClick={() => updateGroupParticipantsMutation.mutate({ remove: [email] })}
                            disabled={updateGroupParticipantsMutation.isPending}
                          >
                            Remove
                          </Button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>

                {(isMovementGroup ? isGroupOwner : isGroupAdminUser) ? (
                  isMovementGroup ? (
                    <div className="space-y-2 pt-2">
                      <div className="text-xs font-black text-slate-500">Add verified participants</div>
                      {verifiedEvidenceLoading || verifiedParticipantProfilesLoading ? (
                        <div className="text-xs text-slate-500">Loading verified participants…</div>
                      ) : verifiedParticipantEmails.length === 0 ? (
                        <div className="text-xs text-slate-500">No verified participants available.</div>
                      ) : (
                        <>
                          <div className="flex flex-wrap gap-2">
                            {verifiedParticipantEmails
                              .filter((email) => !groupParticipants.includes(email))
                              .filter((email) => {
                                const profile = verifiedProfilesLookup.get(normalizeEmail(email));
                                return profile && !profile.movement_group_opt_out;
                              })
                              .map((email) => (
                                <label key={email} className="flex items-center gap-2 text-xs font-bold text-slate-700">
                                  <Checkbox
                                    checked={movementAddSelection.includes(email)}
                                    onCheckedChange={() => toggleMovementAdd(email)}
                                  />
                                  {(() => {
                                    const profile = verifiedProfilesLookup.get(normalizeEmail(email));
                                    const display = String(profile?.display_name || '').trim();
                                    if (display) return display;
                                    const uname = String(profile?.username || '').trim();
                                    if (uname) return `@${uname}`;
                                    return 'Verified participant';
                                  })()}
                                </label>
                              ))}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              type="button"
                              className="h-9 rounded-xl font-bold bg-[#3A3DFF] hover:bg-[#2A2DDD]"
                              onClick={() => {
                                const openSlots = Math.max(0, 10 - groupParticipants.length);
                                const eligible = verifiedParticipantEmails
                                  .filter((email) => !groupParticipants.includes(email))
                                  .filter((email) => {
                                    const profile = verifiedProfilesLookup.get(normalizeEmail(email));
                                    return profile && !profile.movement_group_opt_out;
                                  })
                                  .slice(0, openSlots);
                                if (!eligible.length) {
                                  toast.error('No eligible verified participants to add');
                                  return;
                                }
                                updateGroupParticipantsMutation.mutate({ add: eligible });
                              }}
                              disabled={updateGroupParticipantsMutation.isPending}
                            >
                              Add all
                            </Button>
                            <Button
                              type="button"
                              className="h-9 rounded-xl font-bold bg-[#3A3DFF] hover:bg-[#2A2DDD]"
                              onClick={() => {
                                const openSlots = Math.max(0, 10 - groupParticipants.length);
                                const eligible = movementAddSelection
                                  .filter((email) => !groupParticipants.includes(email))
                                  .filter((email) => {
                                    const profile = verifiedProfilesLookup.get(normalizeEmail(email));
                                    return profile && !profile.movement_group_opt_out;
                                  })
                                  .slice(0, openSlots);
                                if (!eligible.length) {
                                  toast.error('Select at least one eligible participant');
                                  return;
                                }
                                updateGroupParticipantsMutation.mutate({ add: eligible });
                              }}
                              disabled={!movementAddSelection.length || updateGroupParticipantsMutation.isPending}
                            >
                              Add selected
                            </Button>
                          </div>
                        </>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-2 pt-2">
                      <div className="text-xs font-black text-slate-500">Add by username</div>
                      <div className="flex gap-2">
                        <Input
                          value={groupAddUsername}
                          onChange={(e) => setGroupAddUsername(e.target.value)}
                          placeholder={
                            "@username"
                          }
                          className="rounded-xl border-2"
                        />
                        <Button
                          type="button"
                          className="h-10 rounded-xl font-bold bg-[#3A3DFF] hover:bg-[#2A2DDD]"
                          onClick={async () => {
                            if (!accessToken) return;
                            const handles = groupAddUsername
                              .split(',')
                              .map((h) => normalizeHandle(h))
                              .filter(Boolean)
                              .slice(0, 10);

                            if (!handles.length) return;

                            try {
                              const results = await Promise.all(
                                handles.map(async (h) => {
                                  const prof = await fetchPublicProfileByUsername(h, { accessToken });
                                  const email = normalizeEmail(prof?.user_email);
                                  return email;
                                })
                              );
                              const emails = results.filter(Boolean);
                              updateGroupParticipantsMutation.mutate({ add: emails });
                            } catch (e) {
                              toast.error(getInteractionErrorMessage(e, 'Failed to resolve username'));
                            }
                          }}
                          disabled={!groupAddUsername.trim() || updateGroupParticipantsMutation.isPending}
                        >
                          Add
                        </Button>
                      </div>
                    </div>
                  )
                ) : (
                  <div className="text-xs text-slate-500">Only group admins can manage participants.</div>
                )}
              </div>

              <div className="flex items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 rounded-xl font-bold"
                  onClick={() => setGroupSettingsOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  className="h-10 rounded-xl font-bold bg-[#3A3DFF] hover:bg-[#2A2DDD]"
                  onClick={() => updateGroupSettingsMutation.mutate()}
                  disabled={updateGroupSettingsMutation.isPending}
                >
                  {updateGroupSettingsMutation.isPending ? 'Saving…' : 'Save settings'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function Messages() {
  // Hard-disable messaging runtime in production builds.
  if (import.meta?.env?.PROD) return <MessagesComingSoon />;
  return <MessagesInner />;
}
