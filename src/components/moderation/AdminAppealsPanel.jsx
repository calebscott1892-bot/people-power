import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Loader2, Scale, ShieldCheck, X } from 'lucide-react';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { toastFriendlyError } from '@/utils/toastErrors';
import { entities } from '@/api/appClient';
import { useAuth } from '@/auth/AuthProvider';
import { isStaff } from '@/utils/staff';
import ErrorState from '@/components/shared/ErrorState';
import { upsertNotification } from '@/api/notificationsClient';

function nowIso() {
  return new Date().toISOString();
}

function normalizeEmail(value) {
  const s = value == null ? '' : String(value).trim().toLowerCase();
  return s || null;
}

function getAppealCreatedAt(appeal) {
  return (
    appeal?.created_at ||
    appeal?.created_date ||
    appeal?.createdAt ||
    appeal?.created ||
    null
  );
}

async function writeAuditLog({ moderatorEmail, actionType, appeal, details }) {
  const moderator = normalizeEmail(moderatorEmail);
  if (!moderator) return;

  try {
    await entities.ModeratorAuditLog.create({
      moderator_email: moderator,
      action_type: actionType,
      target_content_type: 'moderation_appeal',
      target_content_id: String(appeal?.id || ''),
      created_date: nowIso(),
      details: {
        appeal_id: appeal?.id,
        moderation_action_id: appeal?.moderation_action_id,
        appellant_email: appeal?.appellant_email,
        ...details,
      },
    });
  } catch {
    // ignore
  }
}

async function notifyAppellant({ appeal, decision, reviewerNotes, accessToken }) {
  const to = normalizeEmail(appeal?.appellant_email);
  if (!to) return;

  try {
    if (!accessToken) return;
    await upsertNotification(
      {
        recipient_email: to,
        type: 'moderation_appeal_decision',
        content:
          decision === 'approved'
            ? 'Your appeal was approved and the action will be reviewed/reversed where possible.'
            : 'Your appeal was denied after review.',
        created_at: nowIso(),
        metadata: {
          appeal_id: appeal?.id,
          moderation_action_id: appeal?.moderation_action_id,
          decision,
          reviewer_notes: reviewerNotes || null,
        },
      },
      { accessToken }
    );
  } catch {
    // ignore
  }
}

async function reverseModerationActionIfPossible({ appeal, moderatorEmail }) {
  const actionId = String(appeal?.moderation_action_id || '');
  if (!actionId) return;

  let action;
  try {
    action = await entities.ModerationAction.get(actionId);
  } catch {
    action = null;
  }

  if (!action) return;

  const actionType = String(action?.action_type || '');
  const contentType = String(action?.content_type || '');
  const contentId = String(action?.content_id || '');

  // Mark action as reversed (best-effort)
  try {
    await entities.ModerationAction.update(actionId, {
      reversed: true,
      reversed_at: nowIso(),
      reversed_by: normalizeEmail(moderatorEmail),
      updated_at: nowIso(),
    });
  } catch {
    // ignore
  }

  // Best-effort reversals for common local entities.
  if (actionType === 'content_hidden') {
    const entityName =
      contentType === 'movement'
        ? 'Movement'
        : contentType === 'comment'
          ? 'Comment'
          : contentType === 'profile'
            ? 'UserProfile'
            : null;
    if (entityName && contentId) {
      try {
        await entities[entityName].update(contentId, {
          moderation_hidden: false,
          moderation_hidden_at: null,
          moderation_hidden_by: null,
          updated_at: nowIso(),
        });
      } catch {
        // ignore
      }
    }
  }

  if (actionType === 'content_removed_permanent') {
    const entityName =
      contentType === 'movement'
        ? 'Movement'
        : contentType === 'comment'
          ? 'Comment'
          : contentType === 'profile'
            ? 'UserProfile'
            : null;
    if (entityName && contentId) {
      try {
        await entities[entityName].update(contentId, {
          moderation_removed: false,
          moderation_removed_at: null,
          moderation_removed_by: null,
          updated_at: nowIso(),
        });
      } catch {
        // ignore
      }
    }
  }

  if (actionType === 'user_suspended_7d') {
    const email = normalizeEmail(action?.affected_user_email);
    if (email) {
      try {
        const stats = await entities.UserReportStats.filter({ user_email: email });
        const record = Array.isArray(stats) && stats.length ? stats[0] : null;
        if (record?.id) {
          await entities.UserReportStats.update(record.id, {
            suspended_until: null,
            updated_at: nowIso(),
          });
        }
      } catch {
        // ignore
      }
    }
  }

  if (actionType === 'user_banned_permanent') {
    const email = normalizeEmail(action?.affected_user_email);
    if (email) {
      try {
        const stats = await entities.UserReportStats.filter({ user_email: email });
        const record = Array.isArray(stats) && stats.length ? stats[0] : null;
        if (record?.id) {
          await entities.UserReportStats.update(record.id, {
            banned: false,
            updated_at: nowIso(),
          });
        }
      } catch {
        // ignore
      }
    }
  }
}

export default function AdminAppealsPanel({ moderatorEmail }) {
  const queryClient = useQueryClient();
  const { user, session } = useAuth();
  const accessToken = session?.access_token || null;
  const authedEmail = user?.email ? String(user.email) : '';
  const canReview = isStaff(authedEmail);
  const effectiveModeratorEmail = authedEmail || (moderatorEmail ? String(moderatorEmail) : '');
  const [statusFilter, setStatusFilter] = useState('pending');
  const [selectedAppeal, setSelectedAppeal] = useState(null);
  const [reviewerNotes, setReviewerNotes] = useState('');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['adminAppeals', statusFilter],
    enabled: canReview,
    queryFn: async () => {
      if (statusFilter === 'all') {
        return entities.ModerationAppeal.list('-created_at', 100);
      }
      return entities.ModerationAppeal.filter(
        { status: statusFilter },
        '-created_at',
        100
      );
    },
    retry: 1,
  });

  const appeals = useMemo(() => {
    return Array.isArray(data) ? data : [];
  }, [data]);

  const reviewAppealMutation = useMutation({
    mutationFn: async ({ appeal, decision }) => {
      if (!canReview) throw new Error('Staff access required');

      const reviewer = normalizeEmail(effectiveModeratorEmail);
      if (!reviewer) throw new Error('Your session has expired. Please sign in again.');

      const updated = {
        status: decision,
        reviewer_email: reviewer,
        reviewer_notes: reviewerNotes || null,
        reviewed_at: nowIso(),
        updated_at: nowIso(),
      };

      await entities.ModerationAppeal.update(appeal.id, updated);

      await writeAuditLog({
        moderatorEmail: reviewer,
        actionType: 'reviewed_appeal',
        appeal,
        details: {
          decision,
          reviewer_notes: reviewerNotes || null,
        },
      });

      if (decision === 'approved') {
        await reverseModerationActionIfPossible({ appeal, moderatorEmail: reviewer });

        await writeAuditLog({
          moderatorEmail: reviewer,
          actionType: 'reversed_action',
          appeal,
          details: {
            reason: 'Appeal approved',
          },
        });
      }

      await notifyAppellant({ appeal, decision, reviewerNotes, accessToken });

      return true;
    },
    onSuccess: () => {
      toast.success('Appeal reviewed');
      setSelectedAppeal(null);
      setReviewerNotes('');
      queryClient.invalidateQueries({ queryKey: ['adminAppeals'] });
    },
    onError: (e) => {
      toastFriendlyError(e, 'Failed to review appeal');
    },
  });

  if (!canReview) {
    return <div className="text-center py-8 text-slate-600 font-semibold">Staff access required.</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Scale className="w-6 h-6 text-slate-700" />
          <h3 className="text-xl font-black text-slate-900">Appeals</h3>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="p-2 rounded-xl border border-slate-200 bg-slate-50 font-semibold text-sm"
          >
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="denied">Denied</option>
            <option value="all">All</option>
          </select>

          <button
            type="button"
            onClick={() => refetch()}
            className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-slate-800 font-black text-sm hover:bg-slate-50"
          >
            Refresh
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="text-slate-600 font-semibold">Loading appeals…</div>
      ) : isError ? (
        <ErrorState
          compact
          error={error}
          onRetry={() => refetch()}
          onReload={() => window.location.reload()}
          className="border-slate-200"
        />
      ) : appeals.length === 0 ? (
        <div className="text-slate-600 font-semibold">No appeals in this status.</div>
      ) : (
        <div className="space-y-2">
          {appeals.map((a) => {
            const createdAt = getAppealCreatedAt(a);
            return (
              <button
                key={String(a?.id)}
                type="button"
                onClick={() => {
                  setSelectedAppeal(a);
                  setReviewerNotes(String(a?.reviewer_notes || ''));
                }}
                className="w-full text-left p-4 bg-white rounded-xl border-2 border-slate-200 hover:bg-slate-50"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-black text-slate-900 truncate">
                      {String(a?.appellant_email || 'Unknown user')}
                    </div>
                    <div className="text-xs text-slate-500 font-semibold mt-1">
                      Action: {String(a?.moderation_action_id || 'unknown')}
                      {createdAt ? ` • ${format(new Date(createdAt), 'MMM d, yyyy HH:mm')}` : ''}
                    </div>
                    <div className="text-sm text-slate-700 font-semibold mt-2 line-clamp-2">
                      {String(a?.appeal_reason || '')}
                    </div>
                  </div>

                  <div className="shrink-0">
                    <span className="px-2 py-1 rounded text-xs font-black bg-slate-100 text-slate-700">
                      {String(a?.status || 'pending').replace(/_/g, ' ').toUpperCase()}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {selectedAppeal ? (
        <Dialog open={true} onOpenChange={() => setSelectedAppeal(null)}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-2xl font-black">Review Appeal</DialogTitle>
            </DialogHeader>

            <div className="space-y-4">
              <div className="p-4 rounded-xl border-2 border-slate-200 bg-slate-50">
                <div className="flex items-center gap-2">
                  <FileText className="w-5 h-5 text-slate-600" />
                  <div className="text-sm font-black text-slate-900">Appeal Details</div>
                </div>
                <div className="text-xs text-slate-600 font-semibold mt-2 space-y-1">
                  <div>Appellant: {String(selectedAppeal?.appellant_email || 'unknown')}</div>
                  <div>Moderation action: {String(selectedAppeal?.moderation_action_id || 'unknown')}</div>
                  <div>Status: {String(selectedAppeal?.status || 'pending')}</div>
                </div>
              </div>

              <div>
                <div className="text-sm font-bold text-slate-700 mb-2">Appeal reason</div>
                <div className="p-4 rounded-xl border-2 border-slate-200 bg-white text-sm text-slate-800 font-semibold whitespace-pre-wrap">
                  {String(selectedAppeal?.appeal_reason || '')}
                </div>
              </div>

              {Array.isArray(selectedAppeal?.additional_evidence) && selectedAppeal.additional_evidence.length ? (
                <div>
                  <div className="text-sm font-bold text-slate-700 mb-2">Evidence</div>
                  <div className="space-y-2">
                    {selectedAppeal.additional_evidence.map((url, idx) => (
                      <a
                        key={String(url) + idx}
                        href={String(url)}
                        target="_blank"
                        rel="noreferrer"
                        className="block text-sm font-bold text-[#3A3DFF] underline"
                      >
                        Evidence {idx + 1}
                      </a>
                    ))}
                  </div>
                </div>
              ) : null}

              <div>
                <div className="text-sm font-bold text-slate-700 mb-2">Reviewer notes (optional)</div>
                <Textarea
                  value={reviewerNotes}
                  onChange={(e) => setReviewerNotes(e.target.value)}
                  placeholder={
                    "Notes for audit log and user notice…"
                  }
                  className="min-h-[120px]"
                />
              </div>

              <div className="flex gap-3">
                <Button
                  variant="outline"
                  onClick={() => setSelectedAppeal(null)}
                  className="rounded-xl font-bold border-2"
                >
                  <X className="w-4 h-4 mr-2" />
                  Close
                </Button>

                <Button
                  onClick={() => reviewAppealMutation.mutate({ appeal: selectedAppeal, decision: 'denied' })}
                  disabled={reviewAppealMutation.isPending}
                  className="flex-1 bg-slate-900 hover:bg-slate-800 rounded-xl font-bold"
                >
                  {reviewAppealMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    'Deny'
                  )}
                </Button>

                <Button
                  onClick={() => reviewAppealMutation.mutate({ appeal: selectedAppeal, decision: 'approved' })}
                  disabled={reviewAppealMutation.isPending}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 rounded-xl font-bold"
                >
                  {reviewAppealMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <span className="inline-flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4" /> Approve
                    </span>
                  )}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
