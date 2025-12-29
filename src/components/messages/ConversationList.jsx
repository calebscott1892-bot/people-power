import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCheck } from 'lucide-react';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import { cn } from "@/lib/utils";
import { auth, entities } from "@/api/appClient";

export default function ConversationList({
  currentUserEmail,
  conversations,
  selectedId,
  onSelectConversation,
  box = 'inbox',
  className = '',
} = {}) {
  const { data: me } = useQuery({
    queryKey: ['meEmail'],
    queryFn: async () => {
      try {
        const u = await auth.me();
        return u?.email ? String(u.email).toLowerCase() : '';
      } catch {
        return '';
      }
    },
    enabled: !currentUserEmail,
    retry: 1,
  });

  const email = String(currentUserEmail || me || '').toLowerCase();

  const { data: loaded = [] } = useQuery({
    queryKey: ['conversationsLocal', email],
    queryFn: async () => {
      if (!email) return [];
      const list = await entities.Conversation.filter({}, '-last_message_time', {
        limit: 200,
        fields: [
          'id',
          'participant_emails',
          'request_status',
          'last_message_time',
          'last_message_sender',
          'last_message',
        ],
      });
      const arr = Array.isArray(list) ? list : [];
      return arr
        .filter((c) => Array.isArray(c?.participant_emails) && c.participant_emails.map((e) => String(e).toLowerCase()).includes(email))
        .sort((a, b) => {
          const ta = a?.last_message_time ? new Date(a.last_message_time).getTime() : 0;
          const tb = b?.last_message_time ? new Date(b.last_message_time).getTime() : 0;
          return tb - ta;
        });
    },
    enabled: !conversations && !!email,
    retry: 1,
  });

  const list = Array.isArray(conversations) ? conversations : loaded;

  const filtered = useMemo(() => {
    if (box === 'requests') {
      return list.filter((c) => String(c?.request_status || '').toLowerCase() === 'pending');
    }
    return list.filter((c) => String(c?.request_status || '').toLowerCase() !== 'declined');
  }, [list, box]);

  if (!email) {
    return (
      <div className={cn('p-4 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-600', className)}>
        Sign in to view conversations.
      </div>
    );
  }

  if (filtered.length === 0) {
    return (
      <div className={cn('p-4 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-600', className)}>
        No conversations yet.
      </div>
    );
  }

  return (
    <div className={cn('rounded-xl border border-slate-200 bg-white overflow-hidden', className)}>
      {filtered.map((c) => (
        <ConversationItem
          key={String(c?.id)}
          conversation={c}
          currentUserEmail={email}
          isSelected={String(selectedId || '') === String(c?.id)}
          onSelect={() => onSelectConversation?.(c)}
          isRequest={String(c?.request_status || '').toLowerCase() === 'pending'}
        />
      ))}
    </div>
  );
}

function ConversationItem({ conversation, currentUserEmail, isSelected, onSelect, isRequest }) {
  const otherUserEmail = conversation.participant_emails?.find(email => email !== currentUserEmail);

  const { data: otherProfile } = useQuery({
    queryKey: ['userProfile', otherUserEmail],
    queryFn: async () => {
      const profiles = await entities.UserProfile.filter({ user_email: otherUserEmail }, null, {
        limit: 1,
        fields: ['id', 'user_email', 'display_name', 'profile_photo_url'],
      });
      return Array.isArray(profiles) && profiles.length ? profiles[0] : null;
    },
    enabled: !!otherUserEmail
  });

  const { data: unreadCount = 0 } = useQuery({
    queryKey: ['unreadCount', conversation.id, currentUserEmail],
    queryFn: async () => {
      const messages = await entities.Message.filter({ conversation_id: conversation.id }, '-created_date', {
        fields: ['id', 'sender_email', 'read_by', 'created_date'],
      });
      const arr = Array.isArray(messages) ? messages : [];
      return arr.filter(
        (m) =>
          m?.sender_email !== currentUserEmail &&
          (!Array.isArray(m?.read_by) || !m.read_by.includes(currentUserEmail))
      ).length;
    }
  });

  const displayName = otherProfile?.display_name || 'User';
  const hasUnread = unreadCount > 0;

  return (
    <motion.button
      whileHover={{ backgroundColor: 'rgb(248 250 252)' }}
      onClick={onSelect}
      className={cn(
        "w-full p-4 text-left transition-colors relative",
        isSelected && "bg-indigo-50"
      )}
    >
      <div className="flex gap-3">
        <div className="flex-shrink-0">
          {otherProfile?.profile_photo_url ? (
            <img 
              src={otherProfile.profile_photo_url} 
              alt="" 
              className="w-12 h-12 rounded-full object-cover"
            />
          ) : (
            <div className="w-12 h-12 bg-gradient-to-br from-[#3A3DFF] to-[#5B5EFF] rounded-full flex items-center justify-center">
              <span className="text-white font-black text-lg">
                {displayName[0]?.toUpperCase()}
              </span>
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <h3 className={cn(
              "font-bold text-slate-900 truncate",
              hasUnread && "font-black"
            )}>
              {displayName}
            </h3>
            {conversation.last_message_time && (
              <span className="text-xs text-slate-400 flex-shrink-0 ml-2">
                {format(new Date(conversation.last_message_time), 'MMM d')}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <p className={cn(
              "text-sm text-slate-500 truncate flex-1",
              hasUnread && "font-bold text-slate-700"
            )}>
              {isRequest ? (
                <span className="text-[#3A3DFF] font-bold">Message Request</span>
              ) : (
                <>
                  {conversation.last_message_sender === currentUserEmail && (
                    <CheckCheck className="w-3.5 h-3.5 inline mr-1 text-slate-400" />
                  )}
                  {conversation.last_message || 'Say hello!'}
                </>
              )}
            </p>
            {hasUnread && (
              <div className="w-5 h-5 bg-[#3A3DFF] rounded-full flex items-center justify-center flex-shrink-0">
                <span className="text-white text-xs font-black">{unreadCount}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.button>
  );
}