import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

function getUserInitials(user) {
  const display = String(user?.display_name || '').trim();
  const username = String(user?.username || '').trim().replace(/^@/, '');
  const seed = display || username || String(user?.email || '').trim();
  if (!seed) return '?';
  return seed
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('') || '?';
}

function getProfileHref(user) {
  const username = String(user?.username || '').trim().replace(/^@/, '');
  if (username) return `/u/${encodeURIComponent(username)}`;
  const email = String(user?.email || '').trim();
  if (email) return `/user-profile?email=${encodeURIComponent(email)}`;
  return null;
}

export default function FollowListDialog({ open, onOpenChange, title, users, loading, blockedMessage }) {
  const rows = useMemo(() => (Array.isArray(users) ? users : []), [users]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-black">{title}</DialogTitle>
        </DialogHeader>

        {blockedMessage ? (
          <div className="text-slate-600 font-semibold py-6">
            {blockedMessage}
          </div>
        ) : loading ? (
          <div className="text-slate-600 font-semibold py-6">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="text-slate-600 font-semibold py-6">No users yet.</div>
        ) : (
          <div className="divide-y divide-slate-200">
            {rows.map((u) => {
              const href = getProfileHref(u);
              const display = String(u?.display_name || '').trim();
              const username = String(u?.username || '').trim().replace(/^@/, '');
              const label = display || (username ? `@${username}` : 'Member');

              const content = (
                <div className="flex items-center gap-3 py-3">
                  <Avatar className="h-10 w-10">
                    <AvatarImage src={u?.profile_photo_url || undefined} alt={label} />
                    <AvatarFallback className="bg-slate-200 text-slate-700 font-black">
                      {getUserInitials(u)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <div className="font-black text-slate-900 truncate">{display || 'Member'}</div>
                    <div className="text-sm text-slate-600 font-semibold truncate">
                      {username ? `@${username}` : ''}
                    </div>
                  </div>
                </div>
              );

              if (!href) {
                return (
                  <div key={u?.email || u?.user_id || Math.random()}>
                    {content}
                  </div>
                );
              }

              return (
                <Link key={u?.email || u?.user_id || href} to={href} className="block hover:bg-slate-50 rounded-xl px-2">
                  {content}
                </Link>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
