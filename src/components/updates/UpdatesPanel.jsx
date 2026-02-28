import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { toastFriendlyError } from '@/utils/toastErrors';
import { motion, AnimatePresence } from 'framer-motion';

import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

import { updates, getLatestUpdateVersion } from '@/config/updates';
import { upsertMyProfile } from '@/api/userProfileClient';
import { Sparkles, ChevronDown, ChevronUp, Archive, CheckCircle2, Rocket } from 'lucide-react';

export default function UpdatesPanel({ open, onOpenChange, profileEmail, accessToken, onMarkedSeen }) {
  const [saving, setSaving] = useState(false);
  const [vaultOpen, setVaultOpen] = useState(false);

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
      <DialogContent className="w-[100vw] h-[100vh] max-w-none rounded-none left-0 top-0 translate-x-0 translate-y-0 p-0 overflow-hidden sm:w-[95vw] sm:h-auto sm:max-w-2xl sm:max-h-[85vh] sm:rounded-2xl sm:left-[50%] sm:top-[50%] sm:translate-x-[-50%] sm:translate-y-[-50%] sm:shadow-2xl sm:border sm:border-slate-200">

        {/* Gradient Header */}
        <div className="bg-gradient-to-r from-violet-600 to-indigo-600 text-white px-6 py-5 sm:px-8 sm:py-6">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-white/20 rounded-xl">
                <Rocket className="w-6 h-6 sm:w-7 sm:h-7" />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-widest opacity-80">What&apos;s New</p>
                <h2 className="text-xl sm:text-2xl font-black leading-tight mt-0.5">
                  {latest?.title || 'Latest Updates'}
                </h2>
                <p className="text-sm font-semibold opacity-80 mt-1">
                  {latest?.date || ''}{profileEmail ? ` \u00b7 ${profileEmail}` : ''}
                </p>
              </div>
            </div>
            {latest?.badge && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/20 text-xs font-black uppercase tracking-wider">
                <Sparkles className="w-3 h-3" />
                {latest.badge}
              </span>
            )}
          </div>
        </div>

        {/* Scrollable Body */}
        <div className="overflow-y-auto max-h-[calc(100vh-180px)] sm:max-h-[calc(85vh-180px)]">
          {!latest ? (
            <div className="px-6 py-10 text-center text-sm text-slate-500 font-semibold">No updates yet.</div>
          ) : (
            <div className="p-6 sm:p-8 space-y-6">
              {/* Highlights */}
              <section className="space-y-3">
                <h3 className="text-xs font-black text-violet-600 uppercase tracking-widest flex items-center gap-2">
                  <Sparkles className="w-4 h-4" />
                  Highlights
                </h3>
                <ul className="space-y-2.5">
                  {(Array.isArray(latest.highlights) ? latest.highlights : []).map((h, i) => (
                    <li key={i} className="flex items-start gap-3 text-sm text-slate-800 font-semibold leading-6">
                      <span className="shrink-0 mt-1 w-1.5 h-1.5 rounded-full bg-violet-400" />
                      <span>{h}</span>
                    </li>
                  ))}
                </ul>
              </section>

              {/* Details */}
              {Array.isArray(latest.details) && latest.details.length > 0 && (
                <section className="space-y-3 pt-2 border-t border-slate-100">
                  <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest">Under the Hood</h3>
                  <div className="space-y-2">
                    {latest.details.map((p, i) => (
                      <p key={i} className="text-sm text-slate-600 font-semibold leading-6">{p}</p>
                    ))}
                  </div>
                </section>
              )}

              {/* History Vault */}
              {older.length > 0 && (
                <section className="pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setVaultOpen(!vaultOpen)}
                    className="w-full flex items-center justify-between gap-3 py-3 group"
                  >
                    <div className="flex items-center gap-2 text-sm font-black text-slate-700 group-hover:text-slate-900 transition-colors">
                      <Archive className="w-4 h-4 text-slate-500" />
                      Update History Vault
                      <span className="text-xs font-bold text-slate-400">({older.length} {older.length === 1 ? 'entry' : 'entries'})</span>
                    </div>
                    {vaultOpen
                      ? <ChevronUp className="w-4 h-4 text-slate-500" />
                      : <ChevronDown className="w-4 h-4 text-slate-500" />
                    }
                  </button>

                  <AnimatePresence>
                    {vaultOpen && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.25 }}
                        className="overflow-hidden"
                      >
                        <div className="space-y-3 pb-2">
                          {older.map((u) => (
                            <div
                              key={u.version}
                              className="rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-4 space-y-2"
                            >
                              <div className="flex items-center justify-between gap-3">
                                <div>
                                  <div className="text-sm font-black text-slate-900">{u.title}</div>
                                  <div className="text-xs text-slate-500 font-semibold">{u.date}</div>
                                </div>
                                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider shrink-0">v{u.version}</span>
                              </div>

                              {Array.isArray(u.highlights) && u.highlights.length > 0 && (
                                <ul className="space-y-1.5 mt-2">
                                  {u.highlights.map((h, i) => (
                                    <li key={i} className="flex items-start gap-2 text-xs text-slate-600 font-semibold leading-5">
                                      <span className="shrink-0 mt-1.5 w-1 h-1 rounded-full bg-slate-300" />
                                      <span>{h}</span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </section>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-100 px-6 py-4 sm:px-8 flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange?.(false)}
            className="text-slate-500 hover:text-slate-700 text-sm font-bold"
          >
            Close
          </Button>
          <Button
            type="button"
            onClick={markSeen}
            disabled={!latestVersion || saving || !accessToken}
            className="rounded-full px-5 bg-violet-600 hover:bg-violet-700 text-white font-bold gap-2"
          >
            <CheckCircle2 className="w-4 h-4" />
            {saving ? 'Saving\u2026' : 'Got it!'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
