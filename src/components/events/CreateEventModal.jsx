import React, { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { toastFriendlyError } from '@/utils/toastErrors';
import { useAuth } from '@/auth/AuthProvider';
import { entities } from '@/api/appClient';
import { acceptPlatformAcknowledgment, fetchMyPlatformAcknowledgment } from '@/api/platformAckClient';
import { checkLeadershipCap, registerLeadershipRole } from '@/components/governance/PowerConcentrationLimiter';
import { focusFirstInteractive, trapFocusKeyDown } from '@/components/utils/focusTrap';
import { logError } from '@/utils/logError';

export default function CreateEventModal({ open, onOpenChange, movementId, onCreated }) {
  const { session, user } = useAuth();
  const [title, setTitle] = useState('');
  const [when, setWhen] = useState('');
  const [location, setLocation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [ackAccepted, setAckAccepted] = useState(false);
  const [ackLoading, setAckLoading] = useState(false);

  const accessToken = session?.access_token ? String(session.access_token) : null;
  const myEmail = useMemo(() => (user?.email ? String(user.email) : null), [user]);
  const dialogRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    async function loadAck() {
      if (!open) return;
      if (!myEmail) {
        setAckAccepted(false);
        return;
      }
      setAckLoading(true);
      try {
        const res = await fetchMyPlatformAcknowledgment({ accessToken, userEmail: myEmail });
        if (!cancelled) setAckAccepted(!!res?.accepted);
      } catch {
        if (!cancelled) setAckAccepted(false);
      } finally {
        if (!cancelled) setAckLoading(false);
      }
    }
    loadAck();
    return () => {
      cancelled = true;
    };
  }, [open, accessToken, myEmail]);

  const close = () => onOpenChange?.(false);

  useEffect(() => {
    if (!open) return;
    const root = dialogRef.current;
    if (!root) return;
    focusFirstInteractive(root);
  }, [open]);

  const handleCreate = async () => {
    const safeMovementId = String(movementId ?? '').trim();
    if (!safeMovementId) {
      toast.message('Events are not available yet.');
      return;
    }
    if (!String(title).trim()) {
      toast.error('Please add a title');
      return;
    }

    if (!myEmail) {
      toast.error('You need to be logged in to create an event');
      return;
    }

    if (!ackAccepted) {
      toast.error('Please acknowledge the Platform Role Declaration to create an event');
      return;
    }

    // Anti-mob governance: cap event organizer roles.
    try {
      const cap = await checkLeadershipCap(myEmail, 'event_organizer', { accessToken });
      if (cap && cap.can_create === false) {
        toast.error(cap.message || 'You have reached the event organizer cap.');
        return;
      }
    } catch {
      // ignore cap check failures
    }

    setSubmitting(true);
    try {
      try {
        const created = await entities.Event.create({
          movement_id: safeMovementId,
          title: String(title).trim(),
          start_time: String(when || '').trim() || null,
          location: String(location || '').trim() || null,
          author_email: myEmail,
          created_date: new Date().toISOString(),
        });

        try {
          // Best-effort tracking; associate to movement context.
          await registerLeadershipRole(myEmail, 'event_organizer', safeMovementId, { accessToken });
        } catch {
          // ignore
        }

        onCreated?.(created || null);
      } catch (e) {
        logError(e, 'Create event failed', { movementId: safeMovementId });
        toast.error("Couldn't create event right now");
        return;
      }

      toast.success('Event created');
      setTitle('');
      setWhen('');
      setLocation('');
      close();
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="presentation"
      onKeyDown={(e) => {
        trapFocusKeyDown(e, dialogRef.current);
        if (e.key === 'Escape') close();
      }}
    >
      <div className="absolute inset-0 bg-black/40" onClick={close} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create_event_title"
        tabIndex={-1}
        className="relative w-full max-w-md rounded-2xl bg-white border border-slate-200 shadow-lg p-5 space-y-3"
      >
        <div id="create_event_title" className="font-black text-slate-900 text-lg">Create event</div>

        {myEmail ? (
          <div className="p-3 rounded-2xl border border-slate-200 bg-slate-50">
            <div className="text-sm font-black text-slate-900">Platform Role Declaration</div>
            <p className="mt-2 text-sm text-slate-700 font-semibold">
              People Power is a neutral facilitation platform. We don’t organise, endorse, verify, or take responsibility for user-led events.
            </p>
            <label className="mt-3 flex items-start gap-3 text-sm font-semibold text-slate-800">
              <input
                type="checkbox"
                checked={ackAccepted}
                disabled={ackLoading}
                onChange={async (e) => {
                  const next = !!e.target.checked;
                  setAckAccepted(next);
                  if (next) {
                    try {
                      await acceptPlatformAcknowledgment({ accessToken, userEmail: myEmail });
                    } catch (err) {
                      setAckAccepted(false);
                      toastFriendlyError(err, 'Failed to record acknowledgment');
                    }
                  }
                }}
                className="mt-1"
              />
              <span>I acknowledge and agree to the Platform Role Declaration.</span>
            </label>
          </div>
        ) : (
          <div className="p-3 rounded-2xl border border-slate-200 bg-slate-50 text-slate-700 font-semibold text-sm">
            Log in to create an event.
          </div>
        )}

        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full p-3 rounded-xl border border-slate-200 bg-slate-50 font-semibold"
          placeholder="Title"
        />
        <input
          value={when}
          onChange={(e) => setWhen(e.target.value)}
          className="w-full p-3 rounded-xl border border-slate-200 bg-slate-50 font-semibold"
          placeholder="When (optional)"
        />
        <input
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          className="w-full p-3 rounded-xl border border-slate-200 bg-slate-50 font-semibold"
          placeholder="Location (optional)"
        />

        <div className="flex gap-2 justify-end pt-2">
          <button
            type="button"
            onClick={close}
            className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-slate-800 font-black hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={submitting}
            className="px-4 py-2 rounded-xl bg-slate-900 text-white font-black hover:opacity-90 disabled:opacity-60"
          >
            {submitting ? 'Saving…' : 'Save'}
          </button>
        </div>

        <div className="text-xs text-slate-500 font-semibold">Saved locally.</div>
      </div>
    </div>
  );
}
