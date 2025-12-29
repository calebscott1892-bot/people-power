import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Pin, Send, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import { toast } from "sonner";
import { entities } from "@/api/appClient";

export default function DiscussionForum({ movementId, currentUser }) {
  const [message, setMessage] = useState('');
  const [replyingTo, setReplyingTo] = useState(null);
  const queryClient = useQueryClient();

  const { data: messages = [] } = useQuery({
    queryKey: ['discussions', movementId],
    queryFn: async () => {
      return entities.MovementDiscussion.filter({ movement_id: movementId }, '-created_date', {
        limit: 200,
        fields: ['id', 'movement_id', 'user_email', 'user_name', 'message', 'created_date', 'parent_id', 'is_pinned'],
      });
    }
  });

  const postMutation = useMutation({
    mutationFn: async () => {
      await entities.MovementDiscussion.create({
        movement_id: movementId,
        user_email: currentUser.email,
        user_name: currentUser.full_name || currentUser.email,
        message,
        parent_id: replyingTo || null
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['discussions'] });
      setMessage('');
      setReplyingTo(null);
      toast.success('Message posted!');
    }
  });

  const pinMutation = useMutation({
    mutationFn: async ({ msgId, pinned }) => {
      await entities.MovementDiscussion.update(msgId, { is_pinned: !pinned });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['discussions'] });
    }
  });

  const pinnedMessages = messages.filter(m => m.is_pinned && !m.parent_id);
  const regularMessages = messages.filter(m => !m.is_pinned && !m.parent_id);

  return (
    <div className="space-y-4">
      {/* Post Form */}
      <div className="bg-slate-50 rounded-xl p-4 border-2 border-slate-200">
        {replyingTo && (
          <div className="mb-3 text-sm text-slate-600 flex items-center justify-between">
            <span>Replying to message...</span>
            <button onClick={() => setReplyingTo(null)} className="text-blue-600 font-bold">Cancel</button>
          </div>
        )}
        <Textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Share updates, ask questions, coordinate action..."
          className="mb-3 rounded-lg border-2 resize-none"
          rows={3}
        />
        <Button
          onClick={() => postMutation.mutate()}
          disabled={!message.trim() || postMutation.isPending}
          className="bg-[#3A3DFF] hover:bg-[#2A2DDD] rounded-xl font-bold"
        >
          {postMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Send className="w-4 h-4 mr-2" />Post</>}
        </Button>
      </div>

      {/* Pinned Messages */}
      {pinnedMessages.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-bold text-slate-500 uppercase">Pinned</h4>
          {pinnedMessages.map(msg => (
            <MessageItem
              key={msg.id}
              message={msg}
              replies={messages.filter(m => m.parent_id === msg.id)}
              onReply={setReplyingTo}
              onPin={pinMutation.mutate}
            />
          ))}
        </div>
      )}

      {/* Regular Messages */}
      <div className="space-y-2">
        {regularMessages.length === 0 ? (
          <p className="text-center text-slate-500 py-8">No discussions yet. Start the conversation!</p>
        ) : (
          regularMessages.map(msg => (
            <MessageItem
              key={msg.id}
              message={msg}
              replies={messages.filter(m => m.parent_id === msg.id)}
              onReply={setReplyingTo}
              onPin={pinMutation.mutate}
            />
          ))
        )}
      </div>
    </div>
  );
}

function MessageItem({ message, replies, onReply, onPin }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-xl p-4 border-2 border-slate-200"
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-gradient-to-br from-[#3A3DFF] to-[#5B5EFF] rounded-lg flex items-center justify-center text-white font-bold text-xs">
            {message.user_name[0]?.toUpperCase()}
          </div>
          <div>
            <p className="font-bold text-slate-900 text-sm">{message.user_name}</p>
            <p className="text-xs text-slate-500">{format(new Date(message.created_date), 'MMM d, h:mm a')}</p>
          </div>
        </div>
        {message.is_pinned && <Pin className="w-4 h-4 text-amber-500" />}
      </div>
      
      <p className="text-slate-700 mb-3 whitespace-pre-wrap">{message.message}</p>
      
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onReply(message.id)}
          className="text-xs font-bold"
        >
          Reply
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onPin({ msgId: message.id, pinned: message.is_pinned })}
          className="text-xs font-bold"
        >
          {message.is_pinned ? 'Unpin' : 'Pin'}
        </Button>
      </div>

      {replies.length > 0 && (
        <div className="mt-4 pl-6 border-l-2 border-slate-200 space-y-2">
          {replies.map(reply => (
            <div key={reply.id} className="bg-slate-50 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-6 h-6 bg-slate-400 rounded-lg flex items-center justify-center text-white font-bold text-xs">
                  {reply.user_name[0]?.toUpperCase()}
                </div>
                <span className="font-bold text-slate-900 text-sm">{reply.user_name}</span>
                <span className="text-xs text-slate-500">{format(new Date(reply.created_date), 'MMM d, h:mm a')}</span>
              </div>
              <p className="text-sm text-slate-700">{reply.message}</p>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}