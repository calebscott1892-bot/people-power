import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { toastFriendlyError } from '@/utils/toastErrors';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

import { updates, getLatestUpdateVersion } from '@/config/updates';
import { upsertMyProfile } from '@/api/userProfileClient';

export default function UpdatesPanel({ open, onOpenChange, profileEmail, accessToken, onMarkedSeen }) {
  const [saving, setSaving] = useState(false);

  const latestVersion = getLatestUpdateVersion();

  const latest = useMemo(() => {
    if (!updates.length) return null;
    return updates[updates.length - 1];
  }, []);

  const older = useMemo(() => {
    if (updates.length <= 1) return [];
    return updates.slice(0, -1).slice().reverse();
  }, []);

  const markSeen = async () => {
    if (!latestVersion) return;
    if (!accessToken) {
      toast.error('Please sign in again.');
      return;
    }

    setSaving(true);
    try {
      await upsertMyProfile(
        { last_seen_update_version: latestVersion },
        { accessToken }
      );
      toast.success('Thanks for checking in!');
      onMarkedSeen?.(latestVersion);
      onOpenChange?.(false);
    } catch (e) {
      toastFriendlyError(e, 'Failed to save update status');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-black">What’s new</DialogTitle>
          <DialogDescription>
            {profileEmail ? `Signed in as ${profileEmail}` : 'Recent updates to People Power'}
          </DialogDescription>
        </DialogHeader>

        {!latest ? (
          <div className="text-sm text-slate-600 font-semibold">No updates yet.</div>
        ) : (
          <div className="space-y-6">
            <section className="space-y-2">
              <div className="text-xs font-black text-slate-500 uppercase tracking-wider">Latest</div>
              <div className="text-lg font-black text-slate-900">{latest.title}</div>
              <div className="text-sm text-slate-600 font-semibold">{latest.date}</div>
              <ul className="mt-3 space-y-2 list-disc pl-5 text-sm text-slate-800 font-semibold">
                {(Array.isArray(latest.highlights) ? latest.highlights : []).map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ul>

              {Array.isArray(latest.details) && latest.details.length ? (
                <div className="pt-3 space-y-2">
                  <div className="text-xs font-black text-slate-500 uppercase tracking-wider">Details</div>
                  {(latest.details || []).map((p) => (
                    <p key={p} className="text-sm text-slate-700 font-semibold leading-6">
                      {p}
                    </p>
                  ))}
                </div>
              ) : null}
            </section>

            {older.length ? (
              <section className="space-y-3">
                <div className="text-xs font-black text-slate-500 uppercase tracking-wider">Older updates</div>
                <div className="space-y-3">
                  {older.map((u) => (
                    <div key={u.version} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="text-sm font-black text-slate-900">{u.title}</div>
                      <div className="text-xs text-slate-600 font-semibold">{u.date}</div>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange?.(false)}>
            Close
          </Button>
          <Button type="button" onClick={markSeen} disabled={!latestVersion || saving || !accessToken}>
            {saving ? 'Saving…' : 'Got it'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
