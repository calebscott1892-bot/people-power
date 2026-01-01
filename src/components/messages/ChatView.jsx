import React, { useMemo, useRef, useState, useEffect } from 'react';
import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Loader2, Check, CheckCheck, Image as ImageIcon, Smile, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { format } from 'date-fns';
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import GifPicker from './GifPicker';
import ReactionPicker from './ReactionPicker';
import { entities, integrations } from '@/api/appClient';
import { useAuth } from '@/auth/AuthProvider';
import { uploadFile } from '@/api/uploadsClient';
import { ALLOWED_IMAGE_WITH_GIF_MIME_TYPES, MAX_UPLOAD_BYTES, validateFileUpload } from '@/utils/uploadLimits';
import { isAdmin as isAdminEmail } from '@/utils/staff';
import {
  cacheAIResult,
  getCachedAIResult,
  hasExceededAILimit,
  incrementAICounter,
  hashPayload,
} from '@/utils/aiGuardrail';

export default function ChatView({ conversation, currentUser, isRequest, onAcceptRequest }) {
  const { session } = useAuth();
  const accessToken = session?.access_token ? String(session.access_token) : null;
  const [message, setMessage] = useState('');
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const queryClient = useQueryClient();
  const markedReadIdsRef = useRef(new Set());
  const prevLastMessageIdRef = useRef(null);

  const otherUserEmail = conversation.participant_emails?.find(email => email !== currentUser.email);

  const { data: otherProfile } = useQuery({
    queryKey: ['userProfile', otherUserEmail],
    queryFn: async () => {
      const profiles = await entities.UserProfile.filter(
        { user_email: otherUserEmail },
        '-created_date',
        {
          limit: 1,
          fields: ['id', 'user_email', 'display_name', 'username', 'profile_photo_url'],
        }
      );
      return profiles[0] || null;
    },
    enabled: !!otherUserEmail
  });
  const isAdminOther = otherProfile?.user_email ? isAdminEmail(otherProfile.user_email) : false;

  const messagePageSize = 50;
  const messageFields = [
    'id',
    'conversation_id',
    'sender_email',
    'content',
    'created_date',
    'read_by',
    'image_url',
    'gif_url',
    'reactions',
    'is_flagged',
  ];

  const messagesQuery = useInfiniteQuery({
    queryKey: ['messages', conversation.id],
    queryFn: async ({ pageParam }) => {
      const offset = Number.isFinite(pageParam) ? pageParam : 0;
      return entities.Message.filter(
        { conversation_id: conversation.id },
        '-created_date',
        {
          limit: messagePageSize,
          offset,
          fields: messageFields,
        }
      );
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) => {
      if (!Array.isArray(lastPage) || lastPage.length < messagePageSize) return undefined;
      return pages.length * messagePageSize;
    },
    enabled: !!conversation?.id && !!currentUser?.email,
    refetchInterval: 3000,
  });

  const { messages, isLoading } = useMemo(() => {
    const pages = messagesQuery.data?.pages || [];
    const messagesDesc = pages.flat();
    const messagesAsc = messagesDesc.slice().reverse();
    return {
      messages: messagesAsc,
      isLoading: messagesQuery.isLoading,
    };
  }, [messagesQuery.data, messagesQuery.isLoading]);

  const sendMessageMutation = useMutation({
    mutationFn: async (messageData) => {
      const newMessage = await entities.Message.create({
        conversation_id: conversation.id,
        sender_email: currentUser.email,
        read_by: [currentUser.email],
        ...messageData
      });
      return newMessage;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messages', conversation.id] });
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      setMessage('');
    }
  });

  const acceptRequestMutation = useMutation({
    mutationFn: async () => {
      // Legacy component: request acceptance handled in the new Messages page.
      return;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      toast.success('Request accepted!');
      onAcceptRequest();
    }
  });

  const declineRequestMutation = useMutation({
    mutationFn: async () => {
      // Legacy component: request decline handled in the new Messages page.
      return;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      toast.success('Request declined');
      onAcceptRequest();
    }
  });

  useEffect(() => {
    if (messagesQuery.isFetchingNextPage) return;
    const lastId = messages[messages.length - 1]?.id;
    if (!lastId) return;
    if (lastId === prevLastMessageIdRef.current) return;
    prevLastMessageIdRef.current = lastId;
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, messagesQuery.isFetchingNextPage]);

  useEffect(() => {
    const pages = messagesQuery.data?.pages || [];
    const messagesDesc = pages.flat();

    const unread = messagesDesc
      .filter((msg) => {
        if (!msg?.id) return false;
        if (msg.sender_email === currentUser.email) return false;
        if (markedReadIdsRef.current.has(msg.id)) return false;
        const readBy = Array.isArray(msg.read_by) ? msg.read_by : [];
        return !readBy.includes(currentUser.email);
      })
      .slice(0, 30);

    if (unread.length === 0) return;
    for (const msg of unread) {
      markedReadIdsRef.current.add(msg.id);
    }

    let cancelled = false;
    (async () => {
      const updates = unread.map((msg) => {
        const updatedReadBy = [...(msg.read_by || []), currentUser.email];
        return entities.Message.update(msg.id, { read_by: updatedReadBy });
      });
      await Promise.allSettled(updates);
      if (!cancelled) {
        queryClient.invalidateQueries({ queryKey: ['conversations'] });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [currentUser.email, messagesQuery.data, queryClient]);

  const handleSend = (e) => {
    e.preventDefault();
    if (!message.trim() || sendMessageMutation.isPending) return;
    sendMessageMutation.mutate({ content: message.trim() });
  };

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
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

    setUploadingImage(true);
    try {
      if (!accessToken) {
        toast.error('Please sign in to upload an image');
        return;
      }
      const upload = await uploadFile(file, {
        accessToken,
        maxBytes: MAX_UPLOAD_BYTES,
        allowedMimeTypes: ALLOWED_IMAGE_WITH_GIF_MIME_TYPES,
      });
      const file_url = upload?.url;
      if (!file_url) throw new Error('Upload failed');

      const prompt = `Analyze this image URL and determine if it contains: nudity, explicit content, violence, or harmful content. Respond with ONLY a JSON object.`;
      const response_json_schema = {
        type: "object",
        properties: {
          is_safe: { type: "boolean" },
          reason: { type: "string" },
        },
      };

      const payload = { prompt, file_urls: [file_url], response_json_schema };
      const payloadHash = hashPayload(payload);

      // Simple content safety check using LLM (guarded: cache + per-session cap)
      let safetyCheck = getCachedAIResult('chatImageSafety', payloadHash);
      if (!safetyCheck) {
        if (hasExceededAILimit()) {
          safetyCheck = {
            is_safe: false,
            reason: 'AI usage limit reached for this session.',
          };
          cacheAIResult('chatImageSafety', payloadHash, safetyCheck);
          toast.info('AI-generated — may be incomplete or inaccurate. Image sent as flagged for review.');
        } else {
          incrementAICounter();
          try {
            safetyCheck = await integrations.Core.InvokeLLM(payload);
          } catch {
            safetyCheck = {
              is_safe: false,
              reason: 'Safety check unavailable.',
            };
            toast.info('AI-generated — may be incomplete or inaccurate. Image sent as flagged for review.');
          }
          cacheAIResult('chatImageSafety', payloadHash, safetyCheck);
        }
      }

      const isSafe = Boolean(safetyCheck?.is_safe);
      const isFlagged = !isSafe;

      sendMessageMutation.mutate({
        content: '',
        image_url: file_url,
        is_flagged: isFlagged
      });

      if (isFlagged) {
        toast.info('Image flagged for review - recipient can choose to view');
      }
    } catch {
      toast.error('Failed to upload image');
    } finally {
      setUploadingImage(false);
    }
  };

  const handleGifSelect = (gifUrl) => {
    sendMessageMutation.mutate({
      content: '',
      gif_url: gifUrl
    });
  };

  return (
    <div className="flex-1 flex flex-col">
      {/* Header */}
      <div className="p-4 border-b-3 border-slate-200 bg-gradient-to-r from-slate-50 to-white">
        <div className="flex items-center gap-3">
          {otherProfile?.profile_photo_url ? (
            <img 
              src={otherProfile.profile_photo_url} 
              alt="" 
              className="w-10 h-10 rounded-full object-cover"
            />
          ) : (
            <div className="w-10 h-10 bg-gradient-to-br from-[#3A3DFF] to-[#5B5EFF] rounded-full flex items-center justify-center">
              <span className="text-white font-black">
                {otherProfile?.display_name?.[0]?.toUpperCase() || '?'}
              </span>
            </div>
          )}
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-black text-slate-900">{otherProfile?.display_name || 'User'}</h2>
              {isAdminOther ? (
                <span className="inline-flex px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[10px] font-black uppercase">
                  Admin
                </span>
              ) : null}
            </div>
            <p className="text-xs text-slate-500">@{otherProfile?.username}</p>
          </div>
        </div>
      </div>

      {/* Request Banner */}
      {isRequest && (
        <div className="p-4 bg-yellow-50 border-b-2 border-yellow-200">
          <div className="flex items-center gap-2 text-sm text-yellow-900 font-bold mb-3">
            <span>Message request from {otherProfile?.display_name}</span>
            {isAdminOther ? (
              <span className="inline-flex px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[10px] font-black uppercase">
                Admin
              </span>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button
              onClick={() => acceptRequestMutation.mutate()}
              disabled={acceptRequestMutation.isPending}
              className="flex-1 bg-[#3A3DFF] hover:bg-[#2A2DDD] rounded-xl font-bold"
            >
              Accept
            </Button>
            <Button
              onClick={() => declineRequestMutation.mutate()}
              disabled={declineRequestMutation.isPending}
              variant="outline"
              className="flex-1 border-2 border-slate-300 rounded-xl font-bold"
            >
              Decline
            </Button>
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messagesQuery.hasNextPage && (
          <div className="flex justify-center pb-2">
            <Button
              type="button"
              variant="outline"
              className="rounded-xl border-2"
              onClick={() => messagesQuery.fetchNextPage()}
              disabled={messagesQuery.isFetchingNextPage}
            >
              {messagesQuery.isFetchingNextPage ? 'Loading…' : 'Load earlier'}
            </Button>
          </div>
        )}
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-6 h-6 text-[#3A3DFF] animate-spin" />
          </div>
        ) : (
          <AnimatePresence>
            {messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                isOwn={msg.sender_email === currentUser.email}
                isRead={msg.read_by?.includes(otherUserEmail)}
              />
            ))}
          </AnimatePresence>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      {!isRequest && (
        <form onSubmit={handleSend} className="p-4 border-t-3 border-slate-200 bg-slate-50 relative">
          <AnimatePresence>
            {showGifPicker && (
              <GifPicker
                onSelectGif={handleGifSelect}
                onClose={() => setShowGifPicker(false)}
              />
            )}
          </AnimatePresence>

          <div className="flex gap-2 mb-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageUpload}
              className="hidden"
            />
            <Button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingImage}
              variant="outline"
              className="h-9 px-3 rounded-xl border-2"
            >
              {uploadingImage ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ImageIcon className="w-4 h-4" />
              )}
            </Button>
            <Button
              type="button"
              onClick={() => setShowGifPicker(!showGifPicker)}
              variant="outline"
              className="h-9 px-3 rounded-xl border-2"
            >
              GIF
            </Button>
          </div>

          <div className="flex gap-3">
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Type a message..."
              className="flex-1 min-h-[50px] max-h-[120px] rounded-2xl border-2 border-slate-300 focus:border-[#3A3DFF] resize-none"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend(e);
                }
              }}
            />
            <Button
              type="submit"
              disabled={!message.trim() || sendMessageMutation.isPending}
              className="h-[50px] w-[50px] bg-[#3A3DFF] hover:bg-[#2A2DDD] rounded-2xl flex-shrink-0"
            >
              {sendMessageMutation.isPending ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Send className="w-5 h-5" />
              )}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

function MessageBubble({ message, isOwn, isRead }) {
  const [showReactions, setShowReactions] = useState(false);
  const [imageRevealed, setImageRevealed] = useState(!message.is_flagged);
  const queryClient = useQueryClient();

  const addReactionMutation = useMutation({
    mutationFn: async (emoji) => {
      const reactions = message.reactions || [];
      const existingReaction = reactions.find(r => r.user_email === message.sender_email);
      
      let updatedReactions;
      if (existingReaction) {
        updatedReactions = reactions.filter(r => r.user_email !== message.sender_email);
      } else {
        updatedReactions = [...reactions, { emoji, user_email: message.sender_email }];
      }

      await entities.Message.update(message.id, {
        reactions: updatedReactions
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messages', message.conversation_id] });
    }
  });

  const reactionCounts = {};
  (message.reactions || []).forEach(r => {
    reactionCounts[r.emoji] = (reactionCounts[r.emoji] || 0) + 1;
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn("flex flex-col", isOwn ? "items-end" : "items-start")}
    >
      <div className="relative group">
        <div
          className={cn(
            "max-w-[70%] rounded-2xl overflow-hidden",
            !message.image_url && !message.gif_url && "px-4 py-2.5",
            isOwn
              ? "bg-[#3A3DFF] text-white"
              : "bg-slate-100 text-slate-900"
          )}
        >
          {message.image_url && (
            message.is_flagged && !imageRevealed ? (
              <div className="relative w-64 h-64 bg-slate-900 flex items-center justify-center">
                <div className="text-center p-6">
                  <AlertTriangle className="w-12 h-12 text-yellow-400 mx-auto mb-3" />
                  <p className="text-white font-bold mb-4">Sensitive Content</p>
                  <Button
                    onClick={() => setImageRevealed(true)}
                    size="sm"
                    className="bg-white text-slate-900 hover:bg-slate-200"
                  >
                    Tap to Reveal
                  </Button>
                </div>
              </div>
            ) : (
              <img 
                src={message.image_url} 
                alt="" 
                className="max-w-xs rounded-xl"
              />
            )
          )}

          {message.gif_url && (
            <img 
              src={message.gif_url} 
              alt="GIF" 
              className="max-w-xs rounded-xl"
            />
          )}

          {message.content && (
            <p className={cn(
              "text-sm leading-relaxed whitespace-pre-wrap break-words",
              (message.image_url || message.gif_url) && "mt-2"
            )}>
              {message.content}
            </p>
          )}

          <div className={cn(
            "flex items-center justify-end gap-1 mt-1",
            isOwn ? "text-indigo-200" : "text-slate-400"
          )}>
            <span className="text-xs">
              {format(new Date(message.created_date), 'h:mm a')}
            </span>
            {isOwn && (
              isRead ? (
                <CheckCheck className="w-3.5 h-3.5" />
              ) : (
                <Check className="w-3.5 h-3.5" />
              )
            )}
          </div>
        </div>

        <button
          onClick={() => setShowReactions(!showReactions)}
          className="absolute -bottom-2 -right-2 opacity-0 group-hover:opacity-100 w-7 h-7 bg-white rounded-full shadow-lg flex items-center justify-center border-2 border-slate-200 hover:scale-110 transition-all"
        >
          <Smile className="w-4 h-4 text-slate-600" />
        </button>

        <AnimatePresence>
          {showReactions && (
            <div className="absolute bottom-0 right-full mr-2">
              <ReactionPicker
                onSelectReaction={(emoji) => {
                  addReactionMutation.mutate(emoji);
                  setShowReactions(false);
                }}
                onClose={() => setShowReactions(false)}
              />
            </div>
          )}
        </AnimatePresence>
      </div>

      {Object.keys(reactionCounts).length > 0 && (
        <div className="flex gap-1 mt-1">
          {Object.entries(reactionCounts).map(([emoji, count]) => (
            <div
              key={emoji}
              className="bg-white border-2 border-slate-200 rounded-full px-2 py-0.5 text-xs font-bold flex items-center gap-1"
            >
              <span>{emoji}</span>
              <span className="text-slate-600">{count}</span>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
