import React, { useEffect, useMemo, useState } from 'react';
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

import { tutorialSteps } from '@/config/tutorial';
import { upsertMyProfile } from '@/api/userProfileClient';
import { trackTutorialComplete, trackTutorialStart, trackTutorialStep } from '@/utils/analytics';

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
          'w-[100vw] h-[100vh] max-w-none rounded-none left-0 top-0 translate-x-0 translate-y-0 ' +
          'sm:w-[95vw] sm:h-auto sm:max-w-xl sm:rounded-lg sm:left-[50%] sm:top-[50%] sm:translate-x-[-50%] sm:translate-y-[-50%]'
        }
      >
        <DialogHeader>
          <div className="flex items-center justify-between gap-3">
            {step?.section ? (
              <div className="inline-flex items-center px-2 py-1 rounded-full bg-slate-100 text-slate-700 text-xs font-black uppercase tracking-wider">
                {step.section}
              </div>
            ) : (
              <div />
            )}
            <div className="text-xs text-slate-500 font-bold">
              {index + 1}/{stepCount}
            </div>
          </div>
          <DialogTitle className="text-2xl font-black mt-2">{step?.title || 'Tutorial'}</DialogTitle>
          <DialogDescription>Step-by-step onboarding walkthrough.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {(Array.isArray(step?.body) ? step.body : [String(step?.body || '')]).filter(Boolean).map((p) => (
            <p key={p} className="text-base text-slate-800 font-semibold leading-7">
              {p}
            </p>
          ))}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={close}>
            Skip for now
          </Button>
          <Button type="button" variant="outline" onClick={back} disabled={isFirst}>
            Back
          </Button>
          {isLast ? (
            <Button type="button" onClick={finish} disabled={saving}>
              {saving ? 'Saving…' : 'Finish'}
            </Button>
          ) : (
            <Button type="button" onClick={next}>
              Next
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
