import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Bell, MessageSquare, Plus, Share2, UserPlus, Zap } from 'lucide-react';

function toNonEmptyString(value) {
  const s = String(value ?? '').trim();
  return s ? s : null;
}

export default function NextBestActionPanel({
  userEmail,
  gateReady,
  createdMovements = [],
  unreadNotificationsCount = 0,
}) {
  const email = toNonEmptyString(userEmail)?.toLowerCase() ?? null;
  const unread = Number.isFinite(Number(unreadNotificationsCount))
    ? Number(unreadNotificationsCount)
    : 0;

  const mostRecentCreated = useMemo(() => {
    const list = Array.isArray(createdMovements) ? createdMovements : [];
    const withTime = list
      .map((m) => ({
        movement: m,
        t: m?.created_at ? new Date(m.created_at).getTime() : 0,
      }))
      .sort((a, b) => b.t - a.t);
    return withTime[0]?.movement ?? null;
  }, [createdMovements]);

  const primaryAction = useMemo(() => {
    if (!email) {
      return {
        title: 'Create an account',
        description: 'Sign in to create movements, follow updates, and message safely.',
        to: '/login',
        icon: Plus,
      };
    }

    const createdCount = Array.isArray(createdMovements) ? createdMovements.length : 0;
    if (createdCount === 0) {
      return {
        title: 'Start a movement',
        description: 'Draft a title, goals, and city-level location in minutes.',
        to: '/create-movement',
        icon: Plus,
        disabled: !gateReady,
        disabledHint: 'Accept safety & terms to continue',
      };
    }

    const id = toNonEmptyString(mostRecentCreated?.id || mostRecentCreated?._id);
    return {
      title: 'Invite collaborators',
      description: 'Bring in trusted helpers to run events, tasks, and outreach.',
      to: id ? `/movement/${encodeURIComponent(id)}#collaborators` : '/profile',
      icon: UserPlus,
    };
  }, [email, createdMovements, mostRecentCreated, gateReady]);

  const secondaryAction = useMemo(() => {
    if (!email) return null;
    const createdCount = Array.isArray(createdMovements) ? createdMovements.length : 0;
    if (unread > 0) {
      return {
        title: `View notifications${unread === 1 ? '' : ` (${unread})`}`,
        description: 'See what you missed and mark updates as read.',
        to: '/notifications',
        icon: Bell,
      };
    }
    if (createdCount > 0) {
      const id = toNonEmptyString(mostRecentCreated?.id || mostRecentCreated?._id);
      return {
        title: 'Share your most recent movement',
        description: 'Invite people in and grow momentum with one link.',
        to: id ? `/movement/${encodeURIComponent(id)}#share` : '/profile',
        icon: Share2,
      };
    }
    return {
      title: 'Check messages',
      description: 'Continue conversations and respond to requests.',
      to: '/messages',
      icon: MessageSquare,
    };
  }, [email, unread, createdMovements, mostRecentCreated]);

  const tertiaryAction = useMemo(() => {
    if (!email) return null;
    return {
      title: 'Daily challenge',
      description: 'Earn points by taking one small action today.',
      to: '/daily-challenges',
      icon: Zap,
    };
  }, [email]);

  const actions = [primaryAction, secondaryAction, tertiaryAction].filter(Boolean);

  return (
    <div className="bg-white rounded-3xl border-3 border-slate-200 shadow-lg p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs font-black text-slate-600 uppercase tracking-wide">
            Next best action
          </div>
          <div className="text-lg font-black text-slate-900">
            Keep your momentum going
          </div>
          <div className="text-sm text-slate-600 font-semibold">
            Quick suggestions based on what you’ve done so far.
          </div>
        </div>
        <div className="w-10 h-10 rounded-2xl bg-slate-100 border border-slate-200 flex items-center justify-center">
          <MessageSquare className="w-5 h-5 text-slate-700" />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        {actions.map((a) => {
          const Icon = a.icon;
          const disabled = !!a.disabled;
          const content = (
            <div
              className={`w-full h-full p-4 rounded-2xl border font-semibold text-left transition ${
                disabled
                  ? 'border-slate-200 bg-slate-100 text-slate-500 cursor-not-allowed'
                  : 'border-slate-200 bg-slate-50 hover:bg-white text-slate-800'
              }`}
              title={disabled ? a.disabledHint || 'Unavailable' : undefined}
              aria-disabled={disabled}
            >
              <div className="flex items-center gap-2">
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center border ${
                    disabled
                      ? 'bg-slate-100 border-slate-200'
                      : 'bg-white border-slate-200'
                  }`}
                >
                  <Icon className={`w-4 h-4 ${disabled ? 'text-slate-500' : 'text-slate-900'}`} />
                </div>
                <div className="font-black">{a.title}</div>
              </div>
              <div className="mt-2 text-sm text-slate-600 font-semibold">{a.description}</div>
            </div>
          );

          if (disabled) return <div key={a.title}>{content}</div>;
          return (
            <Link key={a.title} to={a.to} className="block">
              {content}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
