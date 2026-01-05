import React, { useEffect, useMemo, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, Loader2, Check, Heart, UserPlus, MessageSquare } from 'lucide-react';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import { Button } from "@/components/ui/button";
import {
  listNotificationsForUserPage,
  markNotificationRead,
  markNotificationsRead,
} from '@/api/notificationsClient';
import { useAuth } from '@/auth/AuthProvider';
import { logError } from '@/utils/logError';

const ALLOWED_PUBLIC_TYPES = new Set(['follow', 'movement_boost', 'comment']);

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
    enabled: !!userEmail && !!accessToken,
    initialPageParam: 0,
    queryFn: async ({ pageParam = 0 }) => {
      if (!userEmail) return [];
      return listNotificationsForUserPage(userEmail, {
        limit: 20,
        offset: pageParam,
        // Server returns safe full objects; no field projection needed.
      }, { accessToken });
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

  const publicNotifications = useMemo(() => {
    return (Array.isArray(notifications) ? notifications : []).filter((n) => ALLOWED_PUBLIC_TYPES.has(String(n?.type || '')));
  }, [notifications]);

  const autoMarkedIdsRef = useRef(new Set());
  const autoMarkInFlightRef = useRef(false);

  useEffect(() => {
    if (!userEmail) return;
    if (isLoading || notificationsError) return;
    if (!publicNotifications.length) return;
    if (autoMarkInFlightRef.current) return;

    const unreadIds = publicNotifications
      .filter((n) => n && !n.is_read)
      .map((n) => String(n.id || '').trim())
      .filter(Boolean)
      .filter((id) => !autoMarkedIdsRef.current.has(id));

    if (unreadIds.length === 0) return;

    unreadIds.forEach((id) => autoMarkedIdsRef.current.add(id));
    autoMarkInFlightRef.current = true;

    markNotificationsRead(unreadIds, { accessToken })
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ['notifications', userEmail] });
      })
      .catch(() => {
        // best-effort
      })
      .finally(() => {
        autoMarkInFlightRef.current = false;
      });
  }, [publicNotifications, isLoading, notificationsError, userEmail, queryClient, accessToken]);

  useEffect(() => {
    if (notificationsError && notificationsErrorObj) {
      logError(notificationsErrorObj, 'Notifications load failed');
    }
  }, [notificationsError, notificationsErrorObj]);

  const markAsReadMutation = useMutation({
    mutationFn: async (notificationId) => {
      if (!accessToken) return;
      await markNotificationRead(notificationId, { accessToken });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications', userEmail] });
    }
  });

  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      const unread = publicNotifications.filter((n) => !n.is_read);
      if (!accessToken) return;
      await markNotificationsRead(unread.map((n) => n?.id), { accessToken });
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

  const unreadCount = publicNotifications.filter((n) => !n.is_read).length;

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
          ) : publicNotifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
              <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4">
                <Bell className="w-8 h-8 text-slate-400" />
              </div>
              <h3 className="font-black text-lg text-slate-900 mb-2">No activity yet</h3>
              <p className="text-slate-500 text-sm">You&apos;ll see follows, boosts, and comments here</p>
            </div>
          ) : (
            <>
              {publicNotifications.map((notification) => (
                <NotificationItem
                  key={notification.id}
                  notification={notification}
                  onMarkRead={() => markAsReadMutation.mutate(notification.id)}
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
    </div>
  );
}

function NotificationItem({ notification, onMarkRead }) {
  const safeActorName = useMemo(() => {
    const raw = String(notification?.actor_name || '').trim();
    if (raw && !raw.includes('@')) return raw;
    return 'Member';
  }, [notification]);

  const getIcon = () => {
    switch (notification.type) {
      case 'follow': return <UserPlus className="w-5 h-5 text-blue-500" />;
      case 'movement_boost': return <Heart className="w-5 h-5 text-red-500" />;
      case 'comment': return <MessageSquare className="w-5 h-5 text-purple-500" />;
      default: return <Bell className="w-5 h-5 text-slate-500" />;
    }
  };

  const getMessage = () => {
    switch (notification.type) {
      case 'follow':
        return `${safeActorName} started following you`;
      case 'movement_boost':
        return `${safeActorName} boosted "${notification.content_title}"`;
      case 'comment':
        return `${safeActorName} commented on "${notification.content_title}"`;
      default:
        return notification.content_title || 'New notification';
    }
  };

  const getLink = () => {
    switch (notification.type) {
      case 'follow':
        return createPageUrl(`UserProfile?email=${notification.actor_email}`);
      case 'movement_boost':
      case 'comment':
        return notification.content_id ? `/movement/${encodeURIComponent(String(notification.content_id))}` : null;
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
    </motion.div>
  );

  return link ? <Link to={link}>{content}</Link> : content;
}
