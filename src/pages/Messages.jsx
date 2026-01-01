import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { fetchMyBlocks } from '@/api/blocksClient';
import { fetchPublicKey, upsertMyPublicKey } from '@/api/keysClient';
import {
  deriveSharedSecretKey,
  decryptText,
  encryptText,
  getOrCreateIdentityKeypair,
} from '@/lib/e2eeCrypto';
import { isEncryptedBody, packEncryptedPayload, unpackEncryptedPayload } from '@/lib/e2eeFormat';
import { toast } from 'sonner';
import { uploadFile } from '@/api/uploadsClient';
import { checkActionAllowed, formatWaitMs } from '@/utils/antiBrigading';
import { logError } from '@/utils/logError';
import { fetchMovementEvidencePage } from '@/api/movementExtrasClient';
import {
  ALLOWED_IMAGE_MIME_TYPES,
  ALLOWED_IMAGE_WITH_GIF_MIME_TYPES,
  MAX_UPLOAD_BYTES,
  validateFileUpload,
} from '@/utils/uploadLimits';

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

function maskEmail(value) {
  const s = String(value || '').trim();
  if (!s.includes('@')) return s;
  const [name, domain] = s.split('@');
  if (!name || !domain) return s;
  const prefix = name.slice(0, 2);
  return `${prefix}***@${domain}`;
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

function getConversationLabel(conversation, myEmail) {
  if (conversation?.is_group) {
    return String(conversation?.group_name || 'Verified participants group');
  }
  return getOtherParticipant(conversation?.participant_emails, myEmail) || 'Conversation';
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

export default function Messages() {
  const { user, session, loading } = useAuth();
  const queryClient = useQueryClient();
  const accessToken = session?.access_token || null;
  const [searchParams, setSearchParams] = useSearchParams();

  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState('');
  const [composeOpen, setComposeOpen] = useState(false);
  const [box, setBox] = useState('inbox');
  const [search, setSearch] = useState('');

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
  const [groupAddEmail, setGroupAddEmail] = useState('');
  const [movementAddSelection, setMovementAddSelection] = useState([]);

  const mediaInputRef = useRef(null);

  useEffect(() => {
    return () => {
      if (groupAvatarPreview && groupAvatarPreview.startsWith('blob:')) {
        URL.revokeObjectURL(groupAvatarPreview);
      }
    };
  }, [groupAvatarPreview]);

  const myEmail = user?.email || '';
  const myEmailNormalized = useMemo(() => normalizeEmail(myEmail), [myEmail]);

  const { data: myBlocks } = useQuery({
    queryKey: ['myBlocks', myEmailNormalized],
    queryFn: () => fetchMyBlocks({ accessToken }),
    enabled: !!accessToken,
  });

  const blockedEmails = useMemo(() => {
    const list = Array.isArray(myBlocks?.blocked) ? myBlocks.blocked : [];
    return new Set(list.map((b) => normalizeEmail(b?.email)).filter(Boolean));
  }, [myBlocks]);

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

  const MESSAGES_PAGE_SIZE = 20;
  const MESSAGE_LIST_FIELDS = useMemo(
    () => ['sender_email', 'body', 'created_at', 'read_by', 'reactions'].join(','),
    []
  );

  function upsertMessageIntoCache(created) {
    if (!created || !selectedId) return;
    const messagesKey = ['messages', selectedId, myEmailNormalized];
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
  }

  function bumpConversationInCache(conversationId, patch) {
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

      const updated = { ...hit, ...(patch && typeof patch === 'object' ? patch : {}) };
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
  }

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
          toast.error(e?.message || 'Failed to initialize encrypted messaging');
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
    enabled: !!myEmail,
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      if (!Array.isArray(lastPage)) return undefined;
      if (lastPage.length < CONVERSATIONS_PAGE_SIZE) return undefined;
      return allPages.length * CONVERSATIONS_PAGE_SIZE;
    },
  });

  const conversations = useMemo(() => {
    const pages = conversationsData?.pages;
    if (!Array.isArray(pages)) return [];
    return pages.flatMap((p) => (Array.isArray(p) ? p : []));
  }, [conversationsData]);

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
    setGroupAddEmail('');
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
        fields: ['submitter_email'],
        limit: 200,
        offset: 0,
        accessToken,
      }),
    enabled: groupSettingsOpen && isMovementGroup && !!accessToken && !!selectedConversation?.movement_id,
  });

  const verifiedParticipantEmails = useMemo(() => {
    if (!isMovementGroup) return [];
    const list = Array.isArray(verifiedEvidence) ? verifiedEvidence : [];
    const emails = list.map((e) => normalizeEmail(e?.submitter_email)).filter(Boolean);
    return Array.from(new Set(emails));
  }, [verifiedEvidence, isMovementGroup]);

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
    () => (selectedConversation ? getConversationLabel(selectedConversation, myEmail) : ''),
    [selectedConversation, myEmail]
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
    if (selectedConversation?.is_group) {
      setBox('groups');
    }
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

  const filteredConversations = useMemo(() => {
    const list = Array.isArray(conversations) ? conversations : [];
    const q = String(search || '').trim().toLowerCase();
    if (box === 'requests') {
      return list
        .filter((c) => String(c?.request_status || '').toLowerCase() === 'pending')
        .filter((c) => !c?.is_group)
        .filter((c) => {
          if (!q) return true;
          const label = String(getConversationLabel(c, myEmail) || '').toLowerCase();
          const last = String(c?.last_message_body || '').toLowerCase();
          return label.includes(q) || last.includes(q);
        });
    }
    if (box === 'groups') {
      return list
        .filter((c) => !!c?.is_group)
        .filter((c) => {
          if (!q) return true;
          const label = String(getConversationLabel(c, myEmail) || '').toLowerCase();
          const last = String(c?.last_message_body || '').toLowerCase();
          return label.includes(q) || last.includes(q);
        });
    }
    return list
      .filter((c) => {
        const status = String(c?.request_status || 'accepted').toLowerCase();
        return status !== 'pending' && status !== 'declined' && !c?.is_group;
      })
      .filter((c) => {
        if (!q) return true;
        const label = String(getConversationLabel(c, myEmail) || '').toLowerCase();
        const last = String(c?.last_message_body || '').toLowerCase();
        return label.includes(q) || last.includes(q);
      });
  }, [conversations, box, search, myEmail]);

  const otherEmail = useMemo(() => {
    if (!selectedConversation || isGroupConversation) return '';
    return getOtherParticipant(selectedConversation?.participant_emails, myEmail);
  }, [selectedConversation, myEmail, isGroupConversation]);

  const otherEmailNormalized = useMemo(() => normalizeEmail(otherEmail), [otherEmail]);

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
    enabled: !!myEmail && !!selectedConversation,
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      if (!Array.isArray(lastPage)) return undefined;
      if (lastPage.length < MESSAGES_PAGE_SIZE) return undefined;
      return allPages.length * MESSAGES_PAGE_SIZE;
    },
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

  useEffect(() => {
    if (messagesError && messagesErrorObj) {
      logError(messagesErrorObj, 'Messages load failed', { conversationId: selectedId });
    }
  }, [messagesError, messagesErrorObj, selectedId]);

  const conversationsConnectivityError =
    conversationsError && looksLikeConnectivityError(conversationsErrorObj);

  const messagesConnectivityError =
    messagesError && looksLikeConnectivityError(messagesErrorObj);

  const markReadMutation = useMutation({
    mutationFn: async (conversationId) => markConversationRead(conversationId, { accessToken, myEmail }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations', myEmailNormalized] });
    },
  });

  const sendMutation = useMutation({
    mutationFn: async () => {
      const text = String(draft || '').trim();
      if (!text) throw new Error('Message cannot be empty');
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
      const payload = JSON.stringify({ type: 'text', text });
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
    onSuccess: async (created) => {
      setDraft('');
      upsertMessageIntoCache(created);
      bumpConversationInCache(selectedId, {
        last_message_body: created?.body ?? null,
        last_message_at: created?.created_at ?? null,
        updated_at: new Date().toISOString(),
      });
    },
    onError: (e) => {
      logError(e, 'Failed to send message', { conversationId: selectedId });
      toast.error(e?.message || 'Failed to send');
    },
  });

  const reactionMutation = useMutation({
    mutationFn: async ({ messageId, emoji }) => {
      return toggleMessageReaction(messageId, emoji, { accessToken, myEmail });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['messages', selectedId, myEmailNormalized] });
    },
    onError: (e) => toast.error(e?.message || 'Failed to react'),
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
      toast.error(e?.message || 'Failed to send media');
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
        markReadMutation.mutate(String(updated.id));
      }
    },
    onError: (e) => {
      toast.error(e?.message || 'Failed to update request');
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
      toast.error(e?.message || 'Failed to update group');
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
      setGroupAddEmail('');
      setMovementAddSelection([]);
      toast.success('Group participants updated');
    },
    onError: (e) => {
      toast.error(e?.message || 'Failed to update participants');
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
    markReadMutation.mutate(String(convo.id));
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
              <div className="text-xs font-bold text-slate-500">Signed in as {myEmail}</div>
            </div>

            <div className="px-4 pb-4">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search users or conversations"
                  className="h-11 pl-9 rounded-xl border-2"
                />
              </div>
            </div>

            <div className="px-4 pb-4 flex gap-2">
              <Button
                variant={box === 'inbox' ? 'default' : 'outline'}
                className={cn('h-10 rounded-xl font-bold', box === 'inbox' && 'bg-[#3A3DFF] hover:bg-[#2A2DDD]')}
                onClick={() => setBox('inbox')}
              >
                Inbox
              </Button>
              <Button
                variant={box === 'requests' ? 'default' : 'outline'}
                className={cn('h-10 rounded-xl font-bold', box === 'requests' && 'bg-[#3A3DFF] hover:bg-[#2A2DDD]')}
                onClick={() => setBox('requests')}
              >
                Requests
              </Button>
              <Button
                variant={box === 'groups' ? 'default' : 'outline'}
                className={cn('h-10 rounded-xl font-bold', box === 'groups' && 'bg-[#3A3DFF] hover:bg-[#2A2DDD]')}
                onClick={() => setBox('groups')}
              >
                Groups
              </Button>
            </div>
            {box === 'groups' ? (
              <div className="px-4 pb-2 text-xs font-bold text-slate-500">
                Verified participants can be added to author group chats at any time. Group chats live here.
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
            ) : filteredConversations.length === 0 ? (
              <div className="p-6 text-slate-600 font-semibold">
                {box === 'groups'
                  ? 'No group chats yet. Verified participant chats will appear here.'
                  : box === 'requests'
                    ? 'No message requests right now.'
                    : 'No active messages yet. Start a conversation from a profile or movement.'}
              </div>
            ) : (
              <>
                <div className="divide-y divide-slate-100">
                  {filteredConversations.map((c) => {
                    const id = String(c?.id || '');
                    const isGroup = !!c?.is_group;
                    const other = getConversationLabel(c, myEmail);
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
                          markReadMutation.mutate(id);
                        }}
                        className={cn(
                          'w-full text-left px-4 py-4 hover:bg-slate-50 transition',
                          isSelected && 'bg-indigo-50'
                        )}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            {isGroup ? (
                              <Avatar className="h-10 w-10">
                                <AvatarImage src={c?.group_avatar_url || undefined} alt={other || 'Group'} />
                                <AvatarFallback className="bg-slate-200 text-slate-700 font-black">
                                  {(other || 'G')[0]?.toUpperCase()}
                                </AvatarFallback>
                              </Avatar>
                            ) : null}
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
                      {isGroupConversation ? (
                        <Avatar className="h-10 w-10">
                          <AvatarImage src={selectedConversation?.group_avatar_url || undefined} alt={selectedTitle || 'Group'} />
                          <AvatarFallback className="bg-slate-200 text-slate-700 font-black">
                            {(selectedTitle || 'G')[0]?.toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                      ) : null}
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
                  ) : messages.length === 0 ? (
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
                      {messages.map((m) => {
                        const mine = String(m?.sender_email || '').toLowerCase() === String(myEmail).toLowerCase();
                        let displayBody = String(m?.body || '');
                        const encryptedPayload = unpackEncryptedPayload(displayBody);
                        const readBy = Array.isArray(m?.read_by) ? m.read_by.map((x) => String(x).toLowerCase()) : [];
                        const otherHasRead = !!(mine && otherEmailNormalized && readBy.includes(otherEmailNormalized));
                        const senderEmail = normalizeEmail(m?.sender_email);
                        const senderPublicKey = isGroupConversation
                          ? (senderEmail ? groupPublicKeys[senderEmail] : null)
                          : otherPublicKey;
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
                                  {mine ? (otherHasRead ? <CheckCheck className="w-3.5 h-3.5" /> : <Check className="w-3.5 h-3.5" />) : null}
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
                          sendMutation.mutate();
                        }
                      }}
                    />
                    <Button
                      onClick={() => sendMutation.mutate()}
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
                          {maskEmail(email)}
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
                        {maskEmail(email)} {isOwner ? '(owner)' : ''}
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
                        <div>{maskEmail(email)} {isOwner ? '(owner)' : ''}</div>
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
                      {verifiedEvidenceLoading ? (
                        <div className="text-xs text-slate-500">Loading verified participants…</div>
                      ) : verifiedParticipantEmails.length === 0 ? (
                        <div className="text-xs text-slate-500">No verified participants available.</div>
                      ) : (
                        <>
                          <div className="flex flex-wrap gap-2">
                            {verifiedParticipantEmails
                              .filter((email) => !groupParticipants.includes(email))
                              .map((email) => (
                                <label key={email} className="flex items-center gap-2 text-xs font-bold text-slate-700">
                                  <Checkbox
                                    checked={movementAddSelection.includes(email)}
                                    onCheckedChange={() => toggleMovementAdd(email)}
                                  />
                                  {maskEmail(email)}
                                </label>
                              ))}
                          </div>
                          <Button
                            type="button"
                            className="h-9 rounded-xl font-bold bg-[#3A3DFF] hover:bg-[#2A2DDD]"
                            onClick={() =>
                              updateGroupParticipantsMutation.mutate({ add: movementAddSelection })
                            }
                            disabled={!movementAddSelection.length || updateGroupParticipantsMutation.isPending}
                          >
                            Add selected
                          </Button>
                        </>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-2 pt-2">
                      <div className="text-xs font-black text-slate-500">Add by email</div>
                      <div className="flex gap-2">
                        <Input
                          value={groupAddEmail}
                          onChange={(e) => setGroupAddEmail(e.target.value)}
                          placeholder="name@example.com"
                          className="rounded-xl border-2"
                        />
                        <Button
                          type="button"
                          className="h-10 rounded-xl font-bold bg-[#3A3DFF] hover:bg-[#2A2DDD]"
                          onClick={() =>
                            updateGroupParticipantsMutation.mutate({
                              add: groupAddEmail
                                .split(',')
                                .map((e) => normalizeEmail(e))
                                .filter(Boolean),
                            })
                          }
                          disabled={!groupAddEmail.trim() || updateGroupParticipantsMutation.isPending}
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
