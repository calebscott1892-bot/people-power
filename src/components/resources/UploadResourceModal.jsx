import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { auth, entities } from '@/api/appClient';
import { focusFirstInteractive, trapFocusKeyDown } from '@/components/utils/focusTrap';

export default function UploadResourceModal({ open, onOpenChange, movementId, onCreated }) {
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const dialogRef = useRef(null);

  const close = () => onOpenChange?.(false);

  useEffect(() => {
    if (!open) return;
    const root = dialogRef.current;
    if (!root) return;
    focusFirstInteractive(root);
  }, [open]);

  if (!open) return null;

  const handleCreate = async () => {
    const safeMovementId = String(movementId ?? '').trim();
    if (!safeMovementId) {
      toast.message('Resources are not available yet.');
      return;
    }
    if (!String(title).trim()) {
      toast.error('Please add a title');
      return;
    }

    setSubmitting(true);
    try {
      // Best-effort auth
      let user = null;
      try {
        const isAuth = await auth.isAuthenticated();
        user = isAuth ? await auth.me() : null;
      } catch (e) {
        console.warn('[UploadResourceModal] auth failed', e);
        user = null;
      }

      if (!user?.email) {
        toast.error('You need to be logged in to upload a resource');
        return;
      }

      try {
        const created = await entities.Resource.create({
          movement_id: safeMovementId,
          title: String(title).trim(),
          url: String(url || '').trim() || null,
          author_email: user.email,
          created_date: new Date().toISOString(),
        });
        onCreated?.(created || null);
      } catch (e) {
        console.warn('[UploadResourceModal] Resource.create failed', e);
        toast.error("Couldn't upload resource right now");
        return;
      }

      toast.success('Resource added (stub)');
      setTitle('');
      setUrl('');
      close();
    } finally {
      setSubmitting(false);
    }
  };

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
        aria-labelledby="upload_resource_title"
        tabIndex={-1}
        className="relative w-full max-w-md rounded-2xl bg-white border border-slate-200 shadow-lg p-5 space-y-3"
      >
        <div id="upload_resource_title" className="font-black text-slate-900 text-lg">Add resource</div>

        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full p-3 rounded-xl border border-slate-200 bg-slate-50 font-semibold"
          placeholder="Title"
        />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="w-full p-3 rounded-xl border border-slate-200 bg-slate-50 font-semibold"
          placeholder="Link (optional)"
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
            {submitting ? 'Saving…' : 'Save (stub)'}
          </button>
        </div>

        <div className="text-xs text-slate-500 font-semibold">Saved locally (stub).</div>
      </div>
    </div>
  );
}