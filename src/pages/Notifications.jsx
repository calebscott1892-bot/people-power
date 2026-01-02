import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, Loader2, Check, Heart, MessageCircle, Zap, UserPlus, MessageSquare, Calendar } from 'lucide-react';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import { Button } from "@/components/ui/button";
import {
  listNotificationsForUserPage,
  markNotificationRead,
  markNotificationsRead,
} from '@/api/notificationsClient';
import { useAuth } from '@/auth/AuthProvider';
import { updateReport } from '@/api/reportsClient';
import { uploadFile } from '@/api/uploadsClient';
import { toast } from 'sonner';
import { logError } from '@/utils/logError';
import { ALLOWED_UPLOAD_MIME_TYPES, MAX_UPLOAD_BYTES, validateFileUpload } from '@/utils/uploadLimits';


function nowIso() {
  return new Date().toISOString();
}

export default function Notifications() {
  const { session, user: supaUser, loading } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const userEmail = useMemo(() => {
    const email = supaUser?.email ? String(supaUser.email).trim().toLowerCase() : null;
    return email || null;
  }, [supaUser]);

  const accessToken = useMemo(() => {
    return session?.access_token ? String(session.access_token) : null;
  }, [session]);

  const [followupOpen, setFollowupOpen] = useState(false);
  const [followupNotification, setFollowupNotification] = useState(null);
  const [followupText, setFollowupText] = useState('');
  const [followupEvidence, setFollowupEvidence] = useState(null);
  const [sendingFollowup, setSendingFollowup] = useState(false);

  const {
    data: notificationsPages,
    isLoading,
    isError: notificationsError,
    error: notificationsErrorObj,
    refetch: refetchNotifications,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['notifications', userEmail],
    enabled: !!userEmail,
    initialPageParam: 0,
    queryFn: async ({ pageParam = 0 }) => {
      if (!userEmail) return [];
      return listNotificationsForUserPage(userEmail, {
        limit: 20,
        offset: pageParam,
        fields: [
          'id',
          'recipient_email',
          'type',
          'actor_name',
          'actor_email',
          'content_id',
          'content_ref',
          'content_title',
          'created_date',
          'is_read',
          'metadata',
        ],
      });
    },
    getNextPageParam: (lastPage, pages) => {
      const list = Array.isArray(lastPage) ? lastPage : [];
      if (list.length < 20) return undefined;
      return pages.length * 20;
    },
  });

  const notifications = useMemo(() => {
    const pages = Array.isArray(notificationsPages?.pages) ? notificationsPages.pages : [];
    return pages.flatMap((p) => (Array.isArray(p) ? p : []));
  }, [notificationsPages]);

  useEffect(() => {
    if (notificationsError && notificationsErrorObj) {
      logError(notificationsErrorObj, 'Notifications load failed');
    }
  }, [notificationsError, notificationsErrorObj]);

  const markAsReadMutation = useMutation({
    mutationFn: async (notificationId) => {
      await markNotificationRead(notificationId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications', userEmail] });
    }
  });

  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      const unread = notifications.filter(n => !n.is_read);
      await markNotificationsRead(unread.map((n) => n?.id));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications', userEmail] });
    }
  });

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-32">
        <Loader2 className="w-12 h-12 text-[#3A3DFF] animate-spin mb-4" />
        <p className="text-slate-500 font-bold">Loading...</p>
      </div>
    );
  }

  if (!userEmail) {
    return (
      <div className="max-w-xl mx-auto py-20 px-6 text-center space-y-4">
        <div className="w-16 h-16 mx-auto rounded-full bg-slate-100 flex items-center justify-center">
          <Bell className="w-8 h-8 text-slate-400" />
        </div>
        <h2 className="text-2xl font-black text-slate-900">Sign in to see notifications</h2>
        <p className="text-slate-500 font-semibold">
          Create an account or sign in to view your notifications.
        </p>
        <button
          onClick={() => navigate('/login')}
          className="inline-flex items-center justify-center px-6 py-3 rounded-2xl bg-[#3A3DFF] text-white font-bold shadow-md hover:opacity-90 transition"
        >
          Go to login
        </button>
      </div>
    );
  }

  const unreadCount = notifications.filter(n => !n.is_read).length;

  const openFollowup = (notification) => {
    setFollowupNotification(notification);
    setFollowupText('');
    setFollowupEvidence(null);
    setFollowupOpen(true);
  };

  const submitFollowup = async () => {
    if (!followupNotification) return;
    if (!accessToken) {
      toast.error('Log in to send follow-up');
      return;
    }
    const reportId = followupNotification?.metadata?.report_id;
    if (!reportId) {
      toast.error('Missing report reference');
      return;
    }
    if (!String(followupText || '').trim() && !followupEvidence) {
      toast.error('Add a message or evidence');
      return;
    }

    setSendingFollowup(true);
    try {
      let evidenceUrl = null;
      if (followupEvidence) {
        const res = await uploadFile(followupEvidence, {
          accessToken,
          maxBytes: MAX_UPLOAD_BYTES,
          allowedMimeTypes: ALLOWED_UPLOAD_MIME_TYPES,
        });
        evidenceUrl = res?.url ? String(res.url) : null;
      }

      await updateReport(
        String(reportId),
        {
          status: 'pending',
          reporter_followup_details: String(followupText || '').trim() || null,
          reporter_followup_evidence_url: evidenceUrl || null,
          reporter_followup_at: nowIso(),
          updated_at: nowIso(),
        },
        { accessToken }
      );

      await markNotificationRead(followupNotification.id);
      queryClient.invalidateQueries({ queryKey: ['notifications', userEmail] });
      toast.success('Follow-up sent');
      setFollowupOpen(false);
    } catch (e) {
      logError(e, 'Notification follow-up failed', { reportId: String(reportId) });
      toast.error('Failed to send follow-up');
    } finally {
      setSendingFollowup(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-3xl shadow-2xl border-3 border-slate-200 overflow-hidden"
      >
        {/* Header */}
        <div className="p-6 border-b-3 border-slate-200 bg-gradient-to-r from-slate-50 to-white">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-gradient-to-br from-[#3A3DFF] to-[#5B5EFF] rounded-2xl flex items-center justify-center">
                <Bell className="w-6 h-6 text-white" strokeWidth={2.5} />
              </div>
              <div>
                <h1 className="text-2xl font-black text-slate-900">Notifications</h1>
                {unreadCount > 0 && (
                  <p className="text-sm text-slate-500 font-bold">{unreadCount} unread</p>
                )}
              </div>
            </div>
            {unreadCount > 0 && (
              <Button
                onClick={() => markAllReadMutation.mutate()}
                disabled={markAllReadMutation.isPending}
                variant="outline"
                className="border-2 rounded-xl font-bold"
              >
                <Check className="w-4 h-4 mr-2" />
                Mark all read
              </Button>
            )}
          </div>
        </div>

        {/* Notifications List */}
        <div className="divide-y-2 divide-slate-100">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 text-[#3A3DFF] animate-spin" />
            </div>
          ) : notificationsError ? (
            <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
              <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4">
                <Bell className="w-8 h-8 text-slate-400" />
              </div>
              <h3 className="font-black text-lg text-slate-900 mb-2">Couldn’t load notifications</h3>
              <p className="text-slate-500 text-sm font-semibold">Please try again.</p>
              <button
                type="button"
                onClick={() => refetchNotifications()}
                className="mt-5 inline-flex items-center justify-center px-6 py-3 rounded-2xl bg-[#3A3DFF] text-white font-bold shadow-md hover:opacity-90 transition"
              >
                Retry
              </button>
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
              <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4">
                <Bell className="w-8 h-8 text-slate-400" />
              </div>
              <h3 className="font-black text-lg text-slate-900 mb-2">No notifications yet</h3>
              <p className="text-slate-500 text-sm">You&apos;ll see updates here when people interact with you</p>
            </div>
          ) : (
            <>
              {notifications.map((notification) => (
                <NotificationItem
                  key={notification.id}
                  notification={notification}
                  onMarkRead={() => markAsReadMutation.mutate(notification.id)}
                  onProvideMoreInfo={() => openFollowup(notification)}
                />
              ))}
              {hasNextPage ? (
                <div className="p-6 flex justify-center">
                  <button
                    type="button"
                    onClick={() => fetchNextPage()}
                    disabled={isFetchingNextPage}
                    className="inline-flex items-center justify-center px-6 py-3 rounded-2xl bg-white border-2 border-slate-200 text-slate-900 font-black shadow-sm hover:shadow-md transition"
                  >
                    {isFetchingNextPage ? 'Loading…' : 'Load more'}
                  </button>
                </div>
              ) : null}
            </>
          )}
        </div>
      </motion.div>

      {followupOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setFollowupOpen(false)} />
          <div className="relative w-full max-w-md rounded-3xl bg-white border border-slate-200 shadow-lg overflow-hidden">
            <div className="bg-gradient-to-r from-[#FFC947] to-[#FFD666] px-5 py-4 text-slate-900">
              <div className="font-black text-lg">Provide more info</div>
              <div className="text-xs font-semibold text-slate-800 mt-1">
                This goes to the moderation team reviewing your report.
              </div>
            </div>

            <div className="p-5 space-y-3">
              <label className="text-sm font-black text-slate-700">Message</label>
              <textarea
                value={followupText}
                onChange={(e) => setFollowupText(e.target.value)}
                className="w-full min-h-24 p-3 rounded-xl border border-slate-200 bg-slate-50 font-semibold"
                placeholder="Add any context, links, or clarifications…"
              />

              <div className="pt-1 space-y-2">
                <label className="text-sm font-black text-slate-700">Evidence file (optional)</label>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/jpg,image/webp,image/gif,application/pdf"
                  onChange={(e) => {
                    const file = (e.target.files && e.target.files[0]) || null;
                    e.target.value = '';
                    if (!file) {
                      setFollowupEvidence(null);
                      return;
                    }
                    const validationError = validateFileUpload({
                      file,
                      maxBytes: MAX_UPLOAD_BYTES,
                      allowedMimeTypes: ALLOWED_UPLOAD_MIME_TYPES,
                    });
                    if (validationError) {
                      toast.error(validationError);
                      setFollowupEvidence(null);
                      return;
                    }
                    setFollowupEvidence(file);
                  }}
                  className="block w-full text-sm"
                />
              </div>

              <div className="flex gap-2 justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setFollowupOpen(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-slate-800 font-black hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={submitFollowup}
                  disabled={sendingFollowup}
                  className="px-4 py-2 rounded-xl bg-slate-900 text-white font-black hover:opacity-90 disabled:opacity-60"
                >
                  {sendingFollowup ? 'Sending…' : 'Send'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function NotificationItem({ notification, onMarkRead, onProvideMoreInfo }) {
  const safeActorName = useMemo(() => {
    const raw = String(notification?.actor_name || '').trim();
    if (raw && !raw.includes('@')) return raw;
    return 'Member';
  }, [notification]);

  const getIcon = () => {
    switch (notification.type) {
      case 'follow': return <UserPlus className="w-5 h-5 text-blue-500" />;
      case 'message': return <MessageCircle className="w-5 h-5 text-green-500" />;
      case 'movement_boost': return <Heart className="w-5 h-5 text-red-500" />;
      case 'comment': return <MessageSquare className="w-5 h-5 text-purple-500" />;
      case 'challenge_complete': return <Zap className="w-5 h-5 text-yellow-500" />;
      case 'event_reminder': return <Calendar className="w-5 h-5 text-indigo-500" />;
      case 'moderation_request_more_info': return <MessageSquare className="w-5 h-5 text-slate-700" />;
      default: return <Bell className="w-5 h-5 text-slate-500" />;
    }
  };

  const getMessage = () => {
    switch (notification.type) {
      case 'follow':
        return `${safeActorName} started following you`;
      case 'message':
        return `${safeActorName} sent you a message`;
      case 'movement_boost':
        return `${safeActorName} boosted "${notification.content_title}"`;
      case 'comment':
        return `${safeActorName} commented on "${notification.content_title}"`;
      case 'challenge_complete':
        return `${safeActorName} completed a challenge`;
      case 'event_reminder':
        return notification.content_title || 'Upcoming event reminder';
      case 'moderation_request_more_info':
        return 'A moderator requested more information about your report';
      default:
        return notification.content_title || 'New notification';
    }
  };

  const getLink = () => {
    switch (notification.type) {
      case 'follow':
        return createPageUrl(`UserProfile?email=${notification.actor_email}`);
      case 'message':
        return createPageUrl('Messages');
      case 'movement_boost':
      case 'comment':
        return notification.content_id ? `/movement/${encodeURIComponent(String(notification.content_id))}` : null;
      case 'event_reminder':
        return notification.content_id ? `/movement/${encodeURIComponent(String(notification.content_id))}` : null;
      case 'moderation_request_more_info':
        return null;
      default:
        return null;
    }
  };

  const created = (() => {
    try {
      return format(new Date(notification?.created_date || Date.now()), 'MMM d, h:mm a');
    } catch {
      return '';
    }
  })();

  const link = getLink();
  const content = (
    <motion.div
      whileHover={{ backgroundColor: 'rgb(248 250 252)' }}
      className={`p-4 transition-colors ${!notification.is_read ? 'bg-indigo-50' : ''}`}
      onClick={() => !notification.is_read && onMarkRead()}
    >
      <div className="flex gap-3">
        <div className="flex-shrink-0 mt-1">
          <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center border-2 border-slate-200">
            {getIcon()}
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-sm ${!notification.is_read ? 'font-bold text-slate-900' : 'text-slate-700'}`}>
            {getMessage()}
          </p>
          <p className="text-xs text-slate-400 mt-1">
            {created}
          </p>
        </div>
        {!notification.is_read && (
          <div className="w-2 h-2 bg-[#3A3DFF] rounded-full flex-shrink-0 mt-2" />
        )}
      </div>

      {notification.type === 'moderation_request_more_info' ? (
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onProvideMoreInfo?.();
            }}
            className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-800 text-xs font-black hover:bg-slate-50"
          >
            Provide more info
          </button>
        </div>
      ) : null}
    </motion.div>
  );

  return link ? <Link to={link}>{content}</Link> : content;
}
