import React, { useEffect, useMemo, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, Loader2, Heart, UserPlus, MessageSquare } from 'lucide-react';
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
    refetchInterval: 30_000, // Poll every 30s so new notifications appear without manual refresh
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
        // Also invalidate the Home badge counter which uses a different query key.
        queryClient.invalidateQueries({ queryKey: ['notifications:server', userEmail] });
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
      queryClient.invalidateQueries({ queryKey: ['notifications:server', userEmail] });
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
      queryClient.invalidateQueries({ queryKey: ['notifications:server', userEmail] });
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
    <div className="max-w-2xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Bell className="w-5 h-5 text-slate-700" strokeWidth={2} />
              <h1 className="text-lg font-bold text-slate-900">Notifications</h1>
              {unreadCount > 0 && (
                <span className="text-xs font-semibold text-slate-500">{unreadCount} unread</span>
              )}
            </div>
            {unreadCount > 0 && (
              <Button
                onClick={() => markAllReadMutation.mutate()}
                disabled={markAllReadMutation.isPending}
                variant="ghost"
                className="text-sm font-semibold text-slate-600 hover:text-slate-900 h-8 px-3"
              >
                Mark all read
              </Button>
            )}
          </div>
        </div>

        <div className="divide-y divide-slate-100">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 text-[#3A3DFF] animate-spin" />
            </div>
          ) : notificationsError ? (
            <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
              <Bell className="w-8 h-8 text-slate-300 mb-3" />
              <h3 className="font-bold text-base text-slate-900 mb-1">Couldn’t load notifications</h3>
              <p className="text-slate-500 text-sm">Please try again.</p>
              <button
                type="button"
                onClick={() => refetchNotifications()}
                className="mt-4 inline-flex items-center justify-center px-5 py-2 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:opacity-90 transition"
              >
                Retry
              </button>
            </div>
          ) : publicNotifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
              <Bell className="w-8 h-8 text-slate-300 mb-3" />
              <h3 className="font-bold text-base text-slate-900 mb-1">No activity yet</h3>
              <p className="text-sm text-slate-500">You’ll see follows, boosts, and comments here</p>
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
                <div className="p-4 flex justify-center">
                  <button
                    type="button"
                    onClick={() => fetchNextPage()}
                    disabled={isFetchingNextPage}
                    className="text-sm font-semibold text-slate-600 hover:text-slate-900 transition"
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
    <div
      className={`px-5 py-3.5 transition-colors hover:bg-slate-50 cursor-pointer ${!notification.is_read ? 'bg-blue-50/50' : ''}`}
      onClick={() => !notification.is_read && onMarkRead()}
    >
      <div className="flex gap-3 items-start">
        <div className="flex-shrink-0 mt-0.5">
          <div className="w-8 h-8 rounded-full flex items-center justify-center bg-slate-100">
            {getIcon()}
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-sm leading-snug ${!notification.is_read ? 'font-semibold text-slate-900' : 'text-slate-600'}`}>
            {getMessage()}
          </p>
          <p className="text-xs text-slate-400 mt-0.5">
            {created}
          </p>
        </div>
        {!notification.is_read && (
          <div className="w-2 h-2 bg-[#3A3DFF] rounded-full flex-shrink-0 mt-2" />
        )}
      </div>
    </div>
  );

  return link ? <Link to={link}>{content}</Link> : content;
}
