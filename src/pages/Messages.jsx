import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, CheckCheck, Image as ImageIcon, Loader2, MessageCircle, Plus, Search, Send, SmilePlus } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  actOnConversationRequest,
  createConversation,
  fetchConversationsPage,
  fetchMessagesPage,
  markConversationRead,
  sendMessage,
  toggleMessageReaction,
} from '@/api/messagesClient';
import { fetchPublicKey, upsertMyPublicKey } from '@/api/keysClient';
import {
  deriveSharedSecretKey,
  decryptText,
  encryptText,
  getOrCreateIdentityKeypair,
} from '@/lib/e2eeCrypto';
import { packEncryptedPayload, unpackEncryptedPayload } from '@/lib/e2eeFormat';
import { toast } from 'sonner';
import { uploadFile } from '@/api/uploadsClient';
import { checkActionAllowed, formatWaitMs } from '@/utils/antiBrigading';
import { logError } from '@/utils/logError';

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
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
  const me = String(myEmail || '').toLowerCase();
  const list = Array.isArray(participants) ? participants : [];
  return list.find((e) => String(e || '').toLowerCase() !== me) || list[0] || '';
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

function EncryptedMessage({ myEmail, otherPublicKey, encryptedPayload, messageId }) {
  const [text, setText] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        const { privateKey } = await getOrCreateIdentityKeypair(myEmail);
        const key = await deriveSharedSecretKey(privateKey, otherPublicKey);
        const plaintext = await decryptText(encryptedPayload, key);
        if (!cancelled) setText(plaintext);
      } catch {
        if (!cancelled) setFailed(true);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [myEmail, otherPublicKey, encryptedPayload]);

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
  const [recipientEmail, setRecipientEmail] = useState('');
  const [box, setBox] = useState('inbox');
  const [search, setSearch] = useState('');

  const [pendingMediaFile, setPendingMediaFile] = useState(null);
  const [pendingMediaSensitive, setPendingMediaSensitive] = useState(false);
  const [sendingMedia, setSendingMedia] = useState(false);
  const [reactionPickerForId, setReactionPickerForId] = useState(null);

  const mediaInputRef = useRef(null);

  const myEmail = user?.email || '';
  const myEmailNormalized = useMemo(() => String(myEmail || '').toLowerCase(), [myEmail]);

  const CONVERSATIONS_PAGE_SIZE = 20;
  const CONVERSATION_LIST_FIELDS = useMemo(
    () =>
      [
        'participant_emails',
        'request_status',
        'requester_email',
        'blocked_by_email',
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

  const cannotReply = useMemo(() => {
    const status = String(selectedConversation?.request_status || '').toLowerCase();
    const requester = String(selectedConversation?.requester_email || '').toLowerCase();
    return status === 'pending' && requester && requester !== myEmailNormalized;
  }, [selectedConversation, myEmailNormalized]);

  const filteredConversations = useMemo(() => {
    const list = Array.isArray(conversations) ? conversations : [];
    const q = String(search || '').trim().toLowerCase();
    if (box === 'requests') {
      return list
        .filter((c) => String(c?.request_status || '').toLowerCase() === 'pending')
        .filter((c) => {
          if (!q) return true;
          const other = String(getOtherParticipant(c?.participant_emails, myEmail) || '').toLowerCase();
          const last = String(c?.last_message_body || '').toLowerCase();
          return other.includes(q) || last.includes(q);
        });
    }
    return list
      .filter((c) => {
        const status = String(c?.request_status || 'accepted').toLowerCase();
        return status !== 'pending' && status !== 'declined';
      })
      .filter((c) => {
        if (!q) return true;
        const other = String(getOtherParticipant(c?.participant_emails, myEmail) || '').toLowerCase();
        const last = String(c?.last_message_body || '').toLowerCase();
        return other.includes(q) || last.includes(q);
      });
  }, [conversations, box, search, myEmail]);

  const otherEmail = useMemo(() => {
    if (!selectedConversation) return '';
    return getOtherParticipant(selectedConversation?.participant_emails, myEmail);
  }, [selectedConversation, myEmail]);

  const otherEmailNormalized = useMemo(() => String(otherEmail || '').toLowerCase(), [otherEmail]);

  const {
    data: otherPublicKey,
    isLoading: otherKeyLoading,
    isError: otherKeyError,
    error: otherKeyErrorObj,
  } = useQuery({
    queryKey: ['publicKey', otherEmail],
    queryFn: () => fetchPublicKey(otherEmail, { accessToken }),
    enabled: !!accessToken && !!otherEmail,
    staleTime: 1000 * 60 * 10,
  });

  useEffect(() => {
    if (otherKeyError && otherKeyErrorObj) {
      logError(otherKeyErrorObj, 'Messages recipient public key load failed', { recipient: otherEmailNormalized });
      toast.error('Recipient has no encryption key yet');
    }
  }, [otherKeyError, otherKeyErrorObj]);

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
    return pages
      .slice()
      .reverse()
      .flatMap((p) => (Array.isArray(p) ? p.slice().reverse() : []));
  }, [messagesData]);

  useEffect(() => {
    if (messagesError && messagesErrorObj) {
      logError(messagesErrorObj, 'Messages load failed', { conversationId: selectedId });
    }
  }, [messagesError, messagesErrorObj]);

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
      if (!otherEmail) throw new Error('Missing recipient');
      if (!otherPublicKey) throw new Error('Recipient has no encryption key yet');

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
      const key = await deriveSharedSecretKey(privateKey, otherPublicKey);
      const payload = JSON.stringify({ type: 'text', text });
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
    if (!otherEmail || !otherPublicKey) {
      toast.error('Recipient key unavailable');
      return;
    }

    setSendingMedia(true);
    try {
      const uploaded = await uploadFile(pendingMediaFile, { accessToken });
      const url = uploaded?.url ? String(uploaded.url) : null;
      if (!url) throw new Error('Upload failed');

      const { privateKey } = await getOrCreateIdentityKeypair(myEmail);
      const key = await deriveSharedSecretKey(privateKey, otherPublicKey);
      const payload = JSON.stringify({ type: 'media', url, caption: '', sensitive: !!pendingMediaSensitive });
      const encrypted = await encryptText(payload, key);
      const packed = packEncryptedPayload(encrypted);
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

  const createConversationMutation = useMutation({
    mutationFn: async () => {
      const email = String(recipientEmail || '').trim();
      if (!email) throw new Error('Recipient email is required');

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
    onSuccess: async (convo) => {
      setComposeOpen(false);
      setRecipientEmail('');
      await queryClient.invalidateQueries({ queryKey: ['conversations', myEmailNormalized] });
      if (convo?.id) {
        setSelectedId(String(convo.id));
        setSearchParams((prev) => {
          const next = new URLSearchParams(prev);
          next.set('conversationId', String(convo.id));
          return next;
        });
        markReadMutation.mutate(String(convo.id));
      }
    },
    onError: (e) => {
      toast.error(e?.message || 'Failed to start conversation');
    },
  });

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
      <div className="max-w-4xl mx-auto px-4 py-12">
        <div className="p-8 rounded-2xl border border-slate-200 bg-white shadow-sm text-center space-y-3">
          <h1 className="text-3xl font-black text-slate-900">Messages</h1>
          <p className="text-slate-600 font-semibold">Sign in to use messaging.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
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
            </div>

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
                No active messages yet. Start a conversation from a profile or movement.
              </div>
            ) : (
              <>
                <div className="divide-y divide-slate-100">
                  {filteredConversations.map((c) => {
                    const id = String(c?.id || '');
                    const other = getOtherParticipant(c?.participant_emails, myEmail);
                    const unread = Number(c?.unread_count || 0);
                    const isSelected = id && selectedId && id === String(selectedId);
                    const status = String(c?.request_status || 'accepted').toLowerCase();
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
                          <div className="min-w-0">
                            <div className="font-black text-slate-900 truncate">{other || 'Conversation'}</div>
                            <div className="text-sm text-slate-600 truncate">
                              {c?.last_message_body ? String(c.last_message_body) : 'No messages yet'}
                            </div>
                            {status === 'pending' && (
                              <div className="text-xs font-black text-slate-500 mt-1">Request pending</div>
                            )}
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
                    <div>
                      <div className="font-black text-slate-900">{otherEmail}</div>
                      <div className="text-xs text-slate-500 font-bold mt-1">
                        End-to-end encrypted
                        {otherKeyLoading ? ' (loading key...)' : ''}
                        {otherKeyError ? ' (key unavailable)' : ''}
                      </div>
                    </div>

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
                                {encryptedPayload && otherPublicKey ? (
                                  <EncryptedMessage
                                    myEmail={myEmail}
                                    otherPublicKey={otherPublicKey}
                                    encryptedPayload={encryptedPayload}
                                    messageId={String(m?.id || '')}
                                  />
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
                                <div className={cn('mt-2 flex flex-wrap gap-2', mine ? 'text-white' : 'text-slate-900')}>
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
                            disabled={sendingMedia || cannotReply}
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
                        const MAX_UPLOAD_MB = 5;
                        const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif'];
                        if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
                          toast.error(`File too large. Max size is ${MAX_UPLOAD_MB}MB.`);
                          return;
                        }
                        if (!ALLOWED_MIME_TYPES.includes(file.type)) {
                          toast.error('That file type isn’t supported. Please upload an image (JPG/PNG/GIF).');
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
                      disabled={cannotReply || sendingMedia}
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
                      disabled={cannotReply}
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
                        cannotReply
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

      <Dialog open={composeOpen} onOpenChange={setComposeOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-xl font-black">New message</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-sm font-bold text-slate-700">Recipient email</div>
            <Input
              value={recipientEmail}
              onChange={(e) => setRecipientEmail(e.target.value)}
              placeholder="name@example.com"
              className="h-12 rounded-xl border-2"
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" className="h-11 rounded-xl font-bold" onClick={() => setComposeOpen(false)}>
                Cancel
              </Button>
              <Button
                className="h-11 rounded-xl font-bold bg-[#3A3DFF] hover:bg-[#2A2DDD]"
                onClick={() => createConversationMutation.mutate()}
                disabled={createConversationMutation.isPending}
              >
                {createConversationMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  'Start'
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
