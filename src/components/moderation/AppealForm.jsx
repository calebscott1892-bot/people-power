import React, { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Scale, Upload, X } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { entities } from '@/api/appClient';
import { useAuth } from '@/auth/AuthProvider';
import { createIncident } from '@/api/incidentsClient';
import { focusFirstInteractive, trapFocusKeyDown } from '@/components/utils/focusTrap';
import { uploadFile } from '@/api/uploadsClient';
import { ALLOWED_UPLOAD_MIME_TYPES, MAX_UPLOAD_BYTES, validateFileUpload } from '@/utils/uploadLimits';

function nowIso() {
  return new Date().toISOString();
}

export default function AppealForm({ moderationAction, onClose }) {
  const [appealReason, setAppealReason] = useState('');
  const [evidence, setEvidence] = useState([]);
  const [uploading, setUploading] = useState(false);
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const accessToken = session?.access_token ? String(session.access_token) : null;
  const userEmail = session?.user?.email ? String(session.user.email).trim().toLowerCase() : null;
  const dialogRef = useRef(null);

  useEffect(() => {
    const root = dialogRef.current;
    if (!root) return;
    focusFirstInteractive(root);
  }, []);

  const submitAppealMutation = useMutation({
    mutationFn: async () => {
      if (!userEmail) {
        throw new Error('You must be signed in to submit an appeal');
      }

      return entities.ModerationAppeal.create({
        moderation_action_id: moderationAction.id,
        appellant_email: userEmail,
        appeal_reason: appealReason,
        additional_evidence: evidence,
        status: 'pending',
        created_at: nowIso(),
        updated_at: nowIso(),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['moderationActions'] });
      toast.success('Appeal submitted for review');

      try {
        if (accessToken && moderationAction?.id) {
          createIncident(
            {
              event_type: 'appeal_submitted',
              trigger_system: 'client_appeal',
              human_reviewed: false,
              related_entity_type: 'moderation_action',
              related_entity_id: String(moderationAction.id),
              context: { action: 'appeal_submit' },
            },
            { accessToken }
          ).catch(() => {});
        }
      } catch {
        // ignore
      }

      onClose();
    },
    onError: (e) => {
      toast.error(String(e?.message || 'Failed to submit appeal'));
    },
  });

  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files);
    e.target.value = '';
    if (files.length === 0) return;

    // Client-side validation
    for (const file of files) {
      const validationError = validateFileUpload({
        file,
        maxBytes: MAX_UPLOAD_BYTES,
        allowedMimeTypes: ALLOWED_UPLOAD_MIME_TYPES,
      });
      if (validationError) {
        toast.error(validationError);
        return;
      }
    }

    if (!accessToken) {
      toast.error('Please sign in to upload evidence');
      return;
    }

    setUploading(true);
    try {
      const uploadPromises = files.map((file) =>
        uploadFile(file, {
          accessToken,
          maxBytes: MAX_UPLOAD_BYTES,
          allowedMimeTypes: ALLOWED_UPLOAD_MIME_TYPES,
        })
      );
      const results = await Promise.all(uploadPromises);
      const newUrls = results.map((r) => r?.url).filter(Boolean);
      if (newUrls.length === 0) throw new Error('Upload failed');
      setEvidence([...evidence, ...newUrls]);
      toast.success('Evidence uploaded');
    } catch {
      toast.error('Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      role="presentation"
      onKeyDown={(e) => {
        trapFocusKeyDown(e, dialogRef.current);
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose?.();
        }
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="appeal_modal_title"
        tabIndex={-1}
        className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full border-4 border-slate-300 overflow-hidden"
      >
        <div className="p-6 bg-gradient-to-r from-blue-500 to-cyan-500 text-white">
          <div className="flex items-center gap-3">
            <Scale className="w-8 h-8" />
            <div>
              <h2 id="appeal_modal_title" className="text-2xl font-black">Appeal Moderation Action</h2>
              <p className="text-white/90 font-semibold text-sm">Your appeal will be reviewed by senior moderators</p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-4">
          <div className="p-4 bg-slate-50 rounded-xl border-2 border-slate-200">
            <p className="font-bold text-slate-900 text-sm mb-2">Action Details:</p>
            <p className="text-xs text-slate-600">Type: {moderationAction.action_type}</p>
            <p className="text-xs text-slate-600">Rule: {moderationAction.rule_violated}</p>
            <p className="text-xs text-slate-600">Reason: {moderationAction.reason}</p>
          </div>

          <Textarea
            placeholder="Why do you believe this action was incorrect? Provide detailed explanation..."
            value={appealReason}
            onChange={(e) => setAppealReason(e.target.value)}
            className="min-h-[150px]"
          />

          <div>
            <input
              type="file"
              id="appeal-evidence"
              multiple
              onChange={handleFileUpload}
              className="hidden"
              disabled={uploading}
            />
            <label htmlFor="appeal-evidence">
              <Button
                type="button"
                variant="outline"
                className="w-full rounded-xl"
                disabled={uploading}
                onClick={() => document.getElementById('appeal-evidence').click()}
              >
                <Upload className="w-4 h-4 mr-2" />
                Add Supporting Evidence (Optional)
              </Button>
            </label>
          </div>

          {evidence.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-bold text-slate-700">Attached Evidence:</p>
              {evidence.map((url, idx) => (
                <div key={idx} className="flex items-center justify-between p-2 bg-slate-50 rounded-lg">
                  <span className="text-xs truncate">Evidence {idx + 1}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setEvidence(evidence.filter((_, i) => i !== idx))}
                    aria-label={`Remove evidence ${idx + 1}`}
                    title="Remove evidence"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-3">
            <Button
              onClick={() => submitAppealMutation.mutate()}
              disabled={!appealReason.trim() || submitAppealMutation.isPending}
              className="flex-1 bg-[#3A3DFF] hover:bg-[#2A2DDD] rounded-xl font-bold"
            >
              Submit Appeal
            </Button>
            <Button
              onClick={onClose}
              variant="outline"
              className="rounded-xl font-bold"
            >
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
