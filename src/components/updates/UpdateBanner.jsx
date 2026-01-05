import React, { useMemo, useState } from 'react';
import { X } from 'lucide-react';

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
    <div className="w-full border-b border-slate-200 bg-slate-50 px-4 sm:px-6 py-3">
      <div className="max-w-7xl mx-auto flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm sm:text-base font-black text-slate-900">We’ve shipped some updates to People Power.</div>
          <div className="text-xs sm:text-sm text-slate-600 font-semibold">
            Version {latestVersion}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button type="button" size="sm" onClick={() => setOpen(true)}>
            See what’s new
          </Button>
          <button
            type="button"
            aria-label="Dismiss update banner"
            className="inline-flex items-center justify-center h-9 w-9 rounded-md border border-slate-200 bg-white text-slate-600 hover:text-slate-900"
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
