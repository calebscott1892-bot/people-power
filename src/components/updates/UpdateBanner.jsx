import React, { useMemo, useState } from 'react';
import { X, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { hasUnseenUpdate, getLatestUpdateVersion } from '@/config/updates';
import UpdatesPanel from '@/components/updates/UpdatesPanel';

export default function UpdateBanner({ profile, profileEmail, accessToken, onMarkedSeen }) {
  const [dismissed, setDismissed] = useState(false);
  const [open, setOpen] = useState(false);

  const latestVersion = getLatestUpdateVersion();
  const lastSeen = profile?.last_seen_update_version ?? null;

  const shouldShow = useMemo(() => {
    if (!profileEmail || !accessToken) return false;
    if (!latestVersion) return false;
    if (dismissed) return false;
    return hasUnseenUpdate(lastSeen);
  }, [accessToken, dismissed, lastSeen, latestVersion, profileEmail]);

  if (!shouldShow) return null;

  return (
    <div className="w-full border-b border-violet-200 bg-gradient-to-r from-violet-50 to-indigo-50 px-4 sm:px-6 py-3">
      <div className="max-w-7xl mx-auto flex items-start justify-between gap-3">
        <div className="min-w-0 flex items-start gap-2">
          <Sparkles className="w-5 h-5 text-violet-500 shrink-0 mt-0.5" />
          <div>
            <div className="text-sm sm:text-base font-black text-slate-900">We&apos;ve shipped some exciting updates!</div>
            <div className="text-xs sm:text-sm text-slate-600 font-semibold">
              March 2026 &middot; DMs, Daily Challenges &amp; more
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button type="button" size="sm" onClick={() => setOpen(true)} className="bg-violet-600 hover:bg-violet-700 text-white rounded-full px-4 font-bold">
            See what&apos;s new
          </Button>
          <button
            type="button"
            aria-label="Dismiss update banner"
            className="inline-flex items-center justify-center h-9 w-9 rounded-full border border-slate-200 bg-white text-slate-500 hover:text-slate-900 transition-colors"
            onClick={() => setDismissed(true)}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <UpdatesPanel
        open={open}
        onOpenChange={setOpen}
        profileEmail={profileEmail}
        accessToken={accessToken}
        onMarkedSeen={onMarkedSeen}
      />
    </div>
  );
}
