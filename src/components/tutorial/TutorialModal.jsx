import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { toastFriendlyError } from '@/utils/toastErrors';
import { motion, AnimatePresence } from 'framer-motion';

import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

import { tutorialSteps } from '@/config/tutorial';
import { upsertMyProfile } from '@/api/userProfileClient';
import { trackTutorialComplete, trackTutorialStart, trackTutorialStep } from '@/utils/analytics';
import {
  Megaphone, Flag, Flame, Users, MessageCircle, Zap, Search, Shield, HelpCircle, ChevronLeft, ChevronRight, CheckCircle2,
} from 'lucide-react';

const ICON_MAP = {
  Megaphone, Flag, Flame, Users, MessageCircle, Zap, Search, Shield,
};

const SECTION_COLORS = {
  Welcome: { bg: 'from-emerald-500 to-teal-500', pill: 'bg-emerald-100 text-emerald-800' },
  Movements: { bg: 'from-blue-500 to-indigo-500', pill: 'bg-blue-100 text-blue-800' },
  Boosting: { bg: 'from-orange-500 to-amber-500', pill: 'bg-orange-100 text-orange-800' },
  Following: { bg: 'from-violet-500 to-purple-500', pill: 'bg-violet-100 text-violet-800' },
  Messaging: { bg: 'from-sky-500 to-cyan-500', pill: 'bg-sky-100 text-sky-800' },
  Challenges: { bg: 'from-yellow-500 to-amber-500', pill: 'bg-yellow-100 text-yellow-800' },
  Discover: { bg: 'from-pink-500 to-rose-500', pill: 'bg-pink-100 text-pink-800' },
  Safety: { bg: 'from-red-500 to-rose-600', pill: 'bg-red-100 text-red-800' },
};

export default function TutorialModal({
  open,
  onOpenChange,
  accessToken,
  profileEmail,
  hasSeen,
  onCompleted,
}) {
  const steps = tutorialSteps;
  const stepCount = steps.length;

  const [index, setIndex] = useState(0);
  const [saving, setSaving] = useState(false);

  const step = useMemo(() => steps[index] || null, [steps, index]);
  const isFirst = index === 0;
  const isLast = index === stepCount - 1;

  useEffect(() => {
    if (!open) return;
    setIndex(0);
    trackTutorialStart({ email: profileEmail || null, stepCount });
  }, [open, profileEmail, stepCount]);

  useEffect(() => {
    if (!open) return;
    const current = steps[index];
    if (!current) return;
    trackTutorialStep({ email: profileEmail || null, stepId: current.id, index, stepCount });
  }, [index, open, profileEmail, stepCount, steps]);

  const close = () => onOpenChange?.(false);

  const next = () => {
    setIndex((i) => Math.min(stepCount - 1, i + 1));
  };

  const back = () => {
    setIndex((i) => Math.max(0, i - 1));
  };

  const finish = async () => {
    if (hasSeen) {
      trackTutorialComplete({ email: profileEmail || null, stepCount, alreadySeen: true });
      close();
      return;
    }

    if (!accessToken) {
      toast.error('Please sign in again.');
      return;
    }

    setSaving(true);
    try {
      await upsertMyProfile({ has_seen_tutorial_v2: true }, { accessToken });
      trackTutorialComplete({ email: profileEmail || null, stepCount, alreadySeen: false });
      toast.success('Tutorial complete');
      onCompleted?.();
      close();
    } catch (e) {
      toastFriendlyError(e, 'Failed to save tutorial progress');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={
          'w-[100vw] h-[100vh] max-w-none rounded-none left-0 top-0 translate-x-0 translate-y-0 p-0 overflow-hidden ' +
          'sm:w-[95vw] sm:h-auto sm:max-w-xl sm:rounded-2xl sm:left-[50%] sm:top-[50%] sm:translate-x-[-50%] sm:translate-y-[-50%] sm:shadow-2xl sm:border sm:border-slate-200'
        }
      >
        {/* Gradient Header */}
        {(() => {
          const colors = SECTION_COLORS[step?.section] || SECTION_COLORS.Welcome;
          const IconComponent = ICON_MAP[step?.icon] || HelpCircle;
          return (
            <div className={`bg-gradient-to-r ${colors.bg} text-white px-6 py-5 sm:px-8 sm:py-6`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-white/20 rounded-xl">
                    <IconComponent className="w-6 h-6 sm:w-7 sm:h-7" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold uppercase tracking-widest opacity-80">{step?.section || 'Tutorial'}</p>
                    <h2 className="text-xl sm:text-2xl font-black leading-tight mt-0.5">{step?.title || 'Tutorial'}</h2>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 bg-white/20 rounded-full px-3 py-1.5 text-xs font-black tabular-nums shrink-0">
                  {index + 1} / {stepCount}
                </div>
              </div>

              {/* Progress dots */}
              <div className="flex items-center gap-1.5 mt-4">
                {steps.map((s, i) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setIndex(i)}
                    aria-label={`Go to step ${i + 1}`}
                    className={`h-1.5 rounded-full transition-all duration-300 ${
                      i === index ? 'bg-white w-6' :
                      i < index ? 'bg-white/60 w-3' :
                      'bg-white/30 w-3'
                    }`}
                  />
                ))}
              </div>
            </div>
          );
        })()}

        {/* Body */}
        <div className="px-6 py-5 sm:px-8 sm:py-6 overflow-y-auto max-h-[50vh] sm:max-h-[40vh]">
          <AnimatePresence mode="wait">
            <motion.div
              key={step?.id || index}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
              className="space-y-3"
            >
              {(Array.isArray(step?.body) ? step.body : [String(step?.body || '')]).filter(Boolean).map((p, i) => (
                <p key={i} className="text-base text-slate-700 font-semibold leading-7">
                  {p}
                </p>
              ))}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div className="border-t border-slate-100 px-6 py-4 sm:px-8 flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={close}
            className="text-slate-500 hover:text-slate-700 text-sm font-bold"
          >
            Skip for now
          </Button>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={back}
              disabled={isFirst}
              className="rounded-full px-3"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            {isLast ? (
              <Button
                type="button"
                onClick={finish}
                disabled={saving}
                className="rounded-full px-5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold gap-2"
              >
                <CheckCircle2 className="w-4 h-4" />
                {saving ? 'Saving\u2026' : 'Finish'}
              </Button>
            ) : (
              <Button
                type="button"
                onClick={next}
                className="rounded-full px-5 bg-slate-900 hover:bg-slate-800 text-white font-bold gap-2"
              >
                Next
                <ChevronRight className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
