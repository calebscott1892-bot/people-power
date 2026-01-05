import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { toastFriendlyError } from '@/utils/toastErrors';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { entities } from "@/api/appClient";
import { updateReport } from '@/api/reportsClient';
import { getStaffRole, isAdmin as isAdminEmail } from '@/utils/staff';
import { useAuth } from '@/auth/AuthProvider';
import { upsertNotification } from '@/api/notificationsClient';

function nowIso() {
  return new Date().toISOString();
}

function normalizeEmail(value) {
  const s = value == null ? '' : String(value).trim().toLowerCase();
  return s || null;
}

function looksLikeEmail(value) {
  const s = value == null ? '' : String(value);
  return s.includes('@') && s.includes('.');
}

function requiresSecondApproval(action) {
  return action === 'content_removed_permanent' || action === 'user_banned_permanent';
}

function genericReasonSummary(category) {
  const c = String(category || '').trim();
  if (!c) return 'Policy violation';
  return c.replace(/_/g, ' ');
}

export default function ReportActions({ report, onClose, onActionComplete, moderatorEmail, accessToken }) {
  const { user } = useAuth();
  const [notes, setNotes] = useState(report.moderator_notes || '');
  const [selectedAction, setSelectedAction] = useState(report.action_taken || 'none');
  const [newStatus, setNewStatus] = useState(report.status);
  const [ruleViolated, setRuleViolated] = useState(report.rule_violated || '');

  const authedEmail = normalizeEmail(user?.email);
  const me = authedEmail || normalizeEmail(moderatorEmail);
  const role = getStaffRole(me);
  const isAdmin = role === 'admin' || isAdminEmail(me);
  const isStaff = role === 'admin' || role === 'moderator';
  const canSetActionTaken = isAdmin;
  const pendingBy = normalizeEmail(report?.second_approval_requested_by);
  const isAwaitingSecondApproval = String(report?.status || '') === 'pending_second_approval';
  const canApproveSecond =
    isAwaitingSecondApproval && isAdmin && !!me && !!pendingBy && me !== pendingBy;

  const canDenySecond = canApproveSecond;
  const canCancelSecond = isAwaitingSecondApproval && isAdmin && !!me && !!pendingBy && me === pendingBy;

  const reversibleActions = new Set([
    'content_hidden',
    'user_suspended_7d',
    // Admin-only reversal paths (e.g., after appeal)
    'content_removed_permanent',
    'user_banned_permanent',
  ]);
  const currentAction = String(report?.action_taken || selectedAction || 'none');
  const isResolved = String(report?.status || '') === 'resolved';
  const isAdminOnlyReversal = currentAction === 'content_removed_permanent' || currentAction === 'user_banned_permanent';
  const canReverse =
    isResolved && reversibleActions.has(currentAction) && !!me && (!isAdminOnlyReversal || isAdmin);

  const getAffectedUserEmail = async () => {
    try {
      if (report.reported_content_type === 'user') {
        return normalizeEmail(report.reported_content_id);
      }

      if (report.reported_content_type === 'profile' && looksLikeEmail(report.reported_content_id)) {
        return normalizeEmail(report.reported_content_id);
      }

      const type = String(report.reported_content_type || '');
      const id = String(report.reported_content_id || '');
      if (!type || !id) return null;

      // Best-effort lookups for common entities.
      const entityNameByType = {
        movement: 'Movement',
        comment: 'Comment',
        profile: 'UserProfile',
      };
      const entityName = entityNameByType[type] || null;
      if (!entityName) return null;

      const found = await entities[entityName].filter({ id });
      const record = Array.isArray(found) && found.length ? found[0] : null;
      const authorEmail =
        record?.author_email || record?.user_email || record?.email || record?.creator_email;
      return normalizeEmail(authorEmail);
    } catch {
      return null;
    }
  };

  const applyLocalTargetEffects = async (action) => {
    const type = String(report.reported_content_type || '');
    const id = String(report.reported_content_id || '');

    if (!type || !id) return;

    // Only minimal reversible flags; avoids deleting local content.
    if (action === 'content_hidden') {
      const entityName =
        type === 'movement' ? 'Movement' : type === 'comment' ? 'Comment' : type === 'profile' ? 'UserProfile' : null;
      if (entityName) {
        await entities[entityName].update(id, {
          moderation_hidden: true,
          moderation_hidden_at: nowIso(),
          moderation_hidden_by: me,
        });
      }
    }

    if (action === 'content_removed_permanent') {
      const entityName =
        type === 'movement' ? 'Movement' : type === 'comment' ? 'Comment' : type === 'profile' ? 'UserProfile' : null;
      if (entityName) {
        await entities[entityName].update(id, {
          moderation_removed: true,
          moderation_removed_at: nowIso(),
          moderation_removed_by: me,
        });
      }
    }

    if (action === 'user_suspended_7d') {
      const email = await getAffectedUserEmail();
      if (!email) return;
      const stats = await entities.UserReportStats.filter({ user_email: email });
      const record = Array.isArray(stats) && stats.length ? stats[0] : null;
      const until = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      if (record?.id) {
        await entities.UserReportStats.update(record.id, {
          suspended_until: until,
          updated_at: nowIso(),
        });
      } else {
        await entities.UserReportStats.create({
          user_email: email,
          suspended_until: until,
          created_at: nowIso(),
          updated_at: nowIso(),
        });
      }
    }

    if (action === 'user_banned_permanent') {
      const email = await getAffectedUserEmail();
      if (!email) return;
      const stats = await entities.UserReportStats.filter({ user_email: email });
      const record = Array.isArray(stats) && stats.length ? stats[0] : null;
      if (record?.id) {
        await entities.UserReportStats.update(record.id, {
          banned: true,
          banned_at: nowIso(),
          updated_at: nowIso(),
        });
      } else {
        await entities.UserReportStats.create({
          user_email: email,
          banned: true,
          banned_at: nowIso(),
          created_at: nowIso(),
          updated_at: nowIso(),
        });
      }
    }

    if (action === 'disable_reporter_7d') {
      const reporterEmail = normalizeEmail(report.reporter_email);
      if (!reporterEmail) return;
      const stats = await entities.UserReportStats.filter({ user_email: reporterEmail });
      const record = Array.isArray(stats) && stats.length ? stats[0] : null;
      const until = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      if (record?.id) {
        await entities.UserReportStats.update(record.id, {
          reporting_disabled_until: until,
          updated_at: nowIso(),
        });
      } else {
        await entities.UserReportStats.create({
          user_email: reporterEmail,
          reporting_disabled_until: until,
          created_at: nowIso(),
          updated_at: nowIso(),
        });
      }
    }
  };

  const reverseLocalTargetEffects = async (action) => {
    const type = String(report.reported_content_type || '');
    const id = String(report.reported_content_id || '');

    if (action === 'content_hidden') {
      const entityName =
        type === 'movement' ? 'Movement' : type === 'comment' ? 'Comment' : type === 'profile' ? 'UserProfile' : null;
      if (entityName && id) {
        await entities[entityName].update(id, {
          moderation_hidden: false,
          moderation_hidden_at: null,
          moderation_hidden_by: null,
        });
      }
    }

    if (action === 'content_removed_permanent') {
      const entityName =
        type === 'movement' ? 'Movement' : type === 'comment' ? 'Comment' : type === 'profile' ? 'UserProfile' : null;
      if (entityName && id) {
        await entities[entityName].update(id, {
          moderation_removed: false,
          moderation_removed_at: null,
          moderation_removed_by: null,
          updated_at: nowIso(),
        });
      }
    }

    if (action === 'user_suspended_7d') {
      const email = await getAffectedUserEmail();
      if (!email) return;
      const stats = await entities.UserReportStats.filter({ user_email: email });
      const record = Array.isArray(stats) && stats.length ? stats[0] : null;
      if (record?.id) {
        await entities.UserReportStats.update(record.id, {
          suspended_until: null,
          updated_at: nowIso(),
        });
      }
    }

    if (action === 'user_banned_permanent') {
      const email = await getAffectedUserEmail();
      if (!email) return;
      const stats = await entities.UserReportStats.filter({ user_email: email });
      const record = Array.isArray(stats) && stats.length ? stats[0] : null;
      if (record?.id) {
        await entities.UserReportStats.update(record.id, {
          banned: false,
          banned_at: null,
          updated_at: nowIso(),
        });
      }
    }
  };

  const writeAuditLog = async (actionType, details) => {
    try {
      await entities.ModeratorAuditLog.create({
        moderator_email: me,
        action_type: actionType,
        target_content_type: String(report.reported_content_type || ''),
        target_content_id: String(report.reported_content_id || ''),
        created_date: nowIso(),
        details: {
          report_id: report.id,
          ...details,
        },
      });
    } catch {
      // ignore
    }
  };

  const notifyUserIfNeeded = async (action, statusValue) => {
    try {
      const affectedEmail = await getAffectedUserEmail();
      if (!affectedEmail) return;

      // Only notify the reported user if an action was actually taken.
      if (statusValue !== 'resolved') return;
      if (!action || action === 'none' || action === 'request_more_info') return;

      if (!accessToken) return;
      await upsertNotification(
        {
          recipient_email: affectedEmail,
          type: 'moderation_notice',
          content: `A moderation action was taken for: ${genericReasonSummary(report.report_category)}.`,
          created_at: nowIso(),
          metadata: {
            report_id: report.id,
            action_taken: action,
            reason_category: String(report.report_category || ''),
          },
        },
        { accessToken }
      );
    } catch {
      // ignore
    }
  };

  const notifyReporterIfNeeded = async (statusValue) => {
    try {
      const reporterEmail = normalizeEmail(report.reporter_email);
      if (!reporterEmail) return;

      if (statusValue === 'needs_info') {
        if (!accessToken) return;
        await upsertNotification(
          {
            recipient_email: reporterEmail,
            type: 'moderation_request_more_info',
            content:
              'A moderator requested more information about your report. Please reply with any helpful context or evidence.',
            created_at: nowIso(),
            metadata: { report_id: report.id },
          },
          { accessToken }
        );
      }
    } catch {
      // ignore
    }
  };

  const updateReportMutation = useMutation({
    mutationFn: async () => {
      if (!accessToken) throw new Error('Authentication required');

      if (!isStaff) throw new Error('Staff access required');

      const effectiveAction = canSetActionTaken ? String(selectedAction) : 'none';

      const actionNeedsSecond = requiresSecondApproval(effectiveAction);
      const nextStatus = actionNeedsSecond ? 'pending_second_approval' : newStatus;

      if (actionNeedsSecond) {
        await writeAuditLog('requested_second_approval', {
          requested_action: effectiveAction,
          rule_violated: ruleViolated || null,
        });

        const payload = {
          status: 'pending_second_approval',
          ...(canSetActionTaken ? { action_taken: effectiveAction } : {}),
          rule_violated: ruleViolated || null,
          moderator_email: me,
          moderator_notes: notes,
          second_approval_requested_by: me,
          second_approval_requested_at: nowIso(),
          action_timestamp: nowIso(),
        };

        await updateReport(report.id, payload, { accessToken });

        return;
      }

      const updatePayload = {
        status: nextStatus,
        ...(canSetActionTaken ? { action_taken: effectiveAction } : {}),
        rule_violated: ruleViolated || null,
        moderator_email: me,
        moderator_notes: notes,
        action_timestamp: nowIso(),
      };

      await updateReport(report.id, updatePayload, { accessToken });

      await writeAuditLog('reviewed_report', {
        new_status: nextStatus,
        action_taken: canSetActionTaken ? effectiveAction : null,
        rule_violated: ruleViolated || null,
      });

      if (canSetActionTaken && effectiveAction === 'request_more_info') {
        await notifyReporterIfNeeded('needs_info');
      }

      if (canSetActionTaken && nextStatus === 'resolved' && effectiveAction && effectiveAction !== 'none') {
        try {
          await entities.ModerationAction.create({
            report_id: report.id,
            content_type: String(report.reported_content_type || ''),
            content_id: String(report.reported_content_id || ''),
            action_type: effectiveAction,
            moderator_email: me,
            created_at: nowIso(),
            rule_violated: ruleViolated || null,
            notes: notes || null,
            reversible: effectiveAction === 'content_hidden' || effectiveAction === 'user_suspended_7d',
          });
        } catch {
          // ignore
        }

        await applyLocalTargetEffects(effectiveAction);
        await notifyUserIfNeeded(effectiveAction, nextStatus);
      }

      // Update reporter stats
      const reporterStats = await entities.UserReportStats.filter({ 
        user_email: report.reporter_email 
      });
      
      if (reporterStats.length > 0) {
        const stats = reporterStats[0];
        if (canSetActionTaken && nextStatus === 'resolved' && effectiveAction !== 'none' && effectiveAction !== 'request_more_info') {
          await entities.UserReportStats.update(stats.id, {
            accurate_reports: (stats.accurate_reports || 0) + 1
          });
        } else if (nextStatus === 'dismissed') {
          await entities.UserReportStats.update(stats.id, {
            false_reports: (stats.false_reports || 0) + 1
          });
        }
      }

      // If action is taken on reported user, update their stats
      if (canSetActionTaken && report.reported_content_type === 'user' && effectiveAction !== 'none') {
        const reportedEmail = report.reported_content_id;
        const userStats = await entities.UserReportStats.filter({ 
          user_email: reportedEmail 
        });

        if (userStats.length > 0) {
          const stats = userStats[0];
          const updates = {
            times_reported: (stats.times_reported || 0) + 1
          };

          if (effectiveAction === 'warning') {
            updates.warnings_received = (stats.warnings_received || 0) + 1;
          } else if (effectiveAction === 'user_suspended_7d' || effectiveAction === 'user_banned_permanent') {
            updates.suspensions = (stats.suspensions || 0) + 1;
          }

          await entities.UserReportStats.update(stats.id, updates);
        } else {
          await entities.UserReportStats.create({
            user_email: reportedEmail,
            times_reported: 1,
            warnings_received: effectiveAction === 'warning' ? 1 : 0,
            suspensions: (effectiveAction === 'user_suspended_7d' || effectiveAction === 'user_banned_permanent') ? 1 : 0
          });
        }
      }
    },
    onSuccess: () => {
      toast.success('Report updated successfully');
      onActionComplete();
    },
    onError: (e) => {
      toastFriendlyError(e, 'Failed to update report');
    }
  });

  const reverseActionMutation = useMutation({
    mutationFn: async () => {
      if (!accessToken) throw new Error('Authentication required');
      if (!canReverse) throw new Error('Nothing to reverse');

      const action = currentAction;
      await reverseLocalTargetEffects(action);

      await writeAuditLog('reversed_action', {
        reversed_action: action,
        report_id: report.id,
      });

      await updateReport(
        report.id,
        {
          action_reversed_by: me,
          action_reversed_at: nowIso(),
          updated_at: nowIso(),
        },
        { accessToken }
      );

      try {
        const affectedEmail = await getAffectedUserEmail();
        if (affectedEmail) {
          if (accessToken) {
            await upsertNotification(
              {
                recipient_email: affectedEmail,
                type: 'moderation_notice',
                content: 'A previous moderation action was reversed after review.',
                created_at: nowIso(),
                metadata: { report_id: report.id, reversed_action: action },
              },
              { accessToken }
            );
          }
        }
      } catch {
        // ignore
      }
    },
    onSuccess: () => {
      toast.success('Action reversed');
      onActionComplete();
    },
    onError: (e) => {
      toastFriendlyError(e, 'Failed to reverse action');
    },
  });

  const approveSecondMutation = useMutation({
    mutationFn: async () => {
      if (!accessToken) throw new Error('Authentication required');
      if (!canApproveSecond) throw new Error('Second approval not available');

      const action = String(report?.action_taken || 'none');
      if (!requiresSecondApproval(action)) throw new Error('This action does not require second approval');

      await updateReport(
        report.id,
        {
          status: 'resolved',
          second_approval_granted_by: me,
          second_approval_granted_at: nowIso(),
          action_timestamp: nowIso(),
        },
        { accessToken }
      );

      await writeAuditLog('approved_action', {
        approved_action: action,
        requested_by: report?.second_approval_requested_by || null,
        rule_violated: report?.rule_violated || null,
      });

      await applyLocalTargetEffects(action);
      await notifyUserIfNeeded(action, 'resolved');
    },
    onSuccess: () => {
      toast.success('Second approval recorded');
      onActionComplete();
    },
    onError: (e) => {
      toastFriendlyError(e, 'Failed to approve');
    },
  });

  const denySecondMutation = useMutation({
    mutationFn: async () => {
      if (!accessToken) throw new Error('Authentication required');
      if (!canDenySecond) throw new Error('Second approval not available');

      const action = String(report?.action_taken || 'none');
      if (!requiresSecondApproval(action)) throw new Error('This action does not require second approval');

      await updateReport(
        report.id,
        {
          status: 'in_review',
          action_taken: 'none',
          second_approval_denied_by: me,
          second_approval_denied_at: nowIso(),
          updated_at: nowIso(),
        },
        { accessToken }
      );

      await writeAuditLog('denied_action', {
        denied_action: action,
        requested_by: report?.second_approval_requested_by || null,
        rule_violated: report?.rule_violated || null,
        note: notes || null,
      });
    },
    onSuccess: () => {
      toast.success('Second approval denied');
      onActionComplete();
    },
    onError: (e) => {
      toastFriendlyError(e, 'Failed to deny');
    },
  });

  const cancelSecondMutation = useMutation({
    mutationFn: async () => {
      if (!accessToken) throw new Error('Authentication required');
      if (!canCancelSecond) throw new Error('Cannot cancel');

      const action = String(report?.action_taken || 'none');

      await updateReport(
        report.id,
        {
          status: 'in_review',
          action_taken: 'none',
          second_approval_requested_by: null,
          second_approval_requested_at: null,
          updated_at: nowIso(),
        },
        { accessToken }
      );

      await writeAuditLog('cancelled_second_approval', {
        cancelled_action: action,
        note: notes || null,
      });
    },
    onSuccess: () => {
      toast.success('Second approval request cancelled');
      onActionComplete();
    },
    onError: (e) => {
      toastFriendlyError(e, 'Failed to cancel');
    },
  });

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl font-black">Review Report</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 mt-4">
          {/* Report Details */}
          <div className="p-4 bg-slate-50 rounded-xl border-2 border-slate-200">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="font-bold text-slate-500">Category:</span>
                <p className="font-black text-slate-900">{report.report_category.replace(/_/g, ' ')}</p>
              </div>
              <div>
                <span className="font-bold text-slate-500">Content Type:</span>
                <p className="font-black text-slate-900">{report.reported_content_type}</p>
              </div>
              <div>
                <span className="font-bold text-slate-500">Priority:</span>
                <p className="font-black text-slate-900 uppercase">{report.priority}</p>
              </div>
              <div>
                <span className="font-bold text-slate-500">Repeat Report:</span>
                <p className="font-black text-slate-900">{report.is_repeat_report ? 'Yes' : 'No'}</p>
              </div>
            </div>
            
            <div className="mt-4">
              <span className="font-bold text-slate-500">Details:</span>
              <p className="text-slate-700 mt-1">{report.report_details}</p>
            </div>

            {report.evidence_file_url && (
              <div className="mt-4">
                <span className="font-bold text-slate-500">Evidence:</span>
                <a 
                  href={report.evidence_file_url} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="block mt-2 text-[#3A3DFF] hover:underline font-bold"
                >
                  View Evidence File
                </a>
              </div>
            )}
          </div>

          {/* Status */}
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">Report Status</label>
            <Select value={newStatus} onValueChange={setNewStatus}>
              <SelectTrigger className="rounded-xl border-2">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="in_review">In Review</SelectItem>
                <SelectItem value="needs_info">Needs Info</SelectItem>
                <SelectItem value="pending_second_approval">Pending 2nd Approval</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
                <SelectItem value="dismissed">Dismissed</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Action to Take */}
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">Action Taken</label>
            <Select value={selectedAction} onValueChange={setSelectedAction}>
              <SelectTrigger className="rounded-xl border-2">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No Action</SelectItem>
                <SelectItem value="warning">Issue Warning</SelectItem>
                <SelectItem value="content_hidden">Hide Content (reversible)</SelectItem>
                <SelectItem value="content_removed_permanent" disabled={!isAdmin}>
                  Remove Content (permanent, 2nd approval)
                </SelectItem>
                <SelectItem value="user_suspended_7d">Suspend User (7 days)</SelectItem>
                <SelectItem value="user_banned_permanent" disabled={!isAdmin}>
                  Ban User (permanent, 2nd approval)
                </SelectItem>
                <SelectItem value="request_more_info">Request more info from reporter</SelectItem>
                <SelectItem value="disable_reporter_7d" disabled={!isAdmin}>
                  Disable reporter’s reporting (7 days)
                </SelectItem>
              </SelectContent>
            </Select>
            {!isAdmin ? (
              <div className="text-xs text-slate-500 font-semibold mt-1">
                Moderator access: permanent actions require an admin.
              </div>
            ) : null}
          </div>

          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">Rule violated (optional)</label>
            <input
              value={ruleViolated}
              onChange={(e) => setRuleViolated(e.target.value)}
              placeholder="e.g., Privacy / Doxxing"
              className="w-full rounded-xl border-2 border-slate-200 bg-white px-3 py-2 text-sm font-semibold"
            />
            <div className="text-xs text-slate-500 font-semibold mt-1">
              Used for audit logs and user notices (no reporter identity).
            </div>
          </div>

          {/* Moderator Notes */}
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">Moderator Notes</label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add your notes about this report..."
              className="rounded-xl border-2 min-h-[100px]"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3">
            <Button
              onClick={onClose}
              variant="outline"
              className="flex-1 rounded-xl font-bold border-2"
            >
              Cancel
            </Button>

            {canReverse ? (
              <Button
                onClick={() => reverseActionMutation.mutate()}
                disabled={reverseActionMutation.isPending}
                variant="outline"
                className="flex-1 rounded-xl font-bold border-2"
              >
                {reverseActionMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  'Reverse Action'
                )}
              </Button>
            ) : null}

            {canApproveSecond ? (
              <Button
                onClick={() => approveSecondMutation.mutate()}
                disabled={approveSecondMutation.isPending}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 rounded-xl font-bold"
              >
                {approveSecondMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  'Approve (2nd)'
                )}
              </Button>
            ) : null}

            {canDenySecond ? (
              <Button
                onClick={() => denySecondMutation.mutate()}
                disabled={denySecondMutation.isPending}
                variant="outline"
                className="flex-1 rounded-xl font-bold border-2"
              >
                {denySecondMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  'Deny (2nd)'
                )}
              </Button>
            ) : null}

            {canCancelSecond ? (
              <Button
                onClick={() => cancelSecondMutation.mutate()}
                disabled={cancelSecondMutation.isPending}
                variant="outline"
                className="flex-1 rounded-xl font-bold border-2"
              >
                {cancelSecondMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  'Cancel request'
                )}
              </Button>
            ) : null}

            <Button
              onClick={() => updateReportMutation.mutate()}
              disabled={updateReportMutation.isPending}
              className="flex-1 bg-[#3A3DFF] hover:bg-[#2A2DDD] rounded-xl font-bold"
            >
              {updateReportMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                'Update Report'
              )}
            </Button>
          </div>

          {isAwaitingSecondApproval ? (
            <div className="p-3 rounded-xl border-2 border-orange-200 bg-orange-50 text-orange-900 text-xs font-semibold">
              Second approval required. Requested by {String(report?.second_approval_requested_by || 'unknown')}.
              {canApproveSecond ? ' You can approve as a second moderator.' : ''}
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}