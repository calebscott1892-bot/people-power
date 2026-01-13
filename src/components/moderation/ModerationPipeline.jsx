import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Scale, Shield } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { entities } from '@/api/appClient';
import { useAuth } from '@/auth/AuthProvider';
import { upsertNotification } from '@/api/notificationsClient';

const ruleCategories = {
  violence_physical_harm: 'Violence / Physical Harm',
  harassment_intimidation: 'Harassment / Intimidation',
  hate_speech_discrimination: 'Hate Speech / Discrimination',
  illegal_activity: 'Illegal Activity',
  misinformation_crisis: 'Misinformation / Crisis',
  privacy_doxxing: 'Privacy Violation / Doxxing',
  fraud_scams: 'Fraud / Scams',
  spam: 'Spam'
};

export default function ModerationPipeline({ report, moderatorProfile }) {
  const [reviewForm, setReviewForm] = useState({
    action_type: '',
    rule_category: '',
    reason: '',
    requires_second_approval: false
  });
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const accessToken = session?.access_token || null;

  const takeModerationActionMutation = useMutation({
    mutationFn: async (actionData) => {
      // Create moderation action
      const action = await entities.ModerationAction.create({
        content_type: report.content_type,
        content_id: report.content_id,
        action_type: actionData.action_type,
        stage: 'human_review',
        rule_violated: report.reason,
        rule_category: actionData.rule_category,
        moderator_email: moderatorProfile.user_email,
        moderator_tier: moderatorProfile.tier,
        requires_second_approval: actionData.requires_second_approval,
        reason: actionData.reason,
        evidence: [report.id],
        affected_user_email: report.reported_user_email,
        affected_user_notified: false
      });

      // Log action
      await entities.ModeratorAuditLog.create({
        moderator_email: moderatorProfile.user_email,
        action_type: 'took_moderation_action',
        target_content_type: report.content_type,
        target_content_id: report.content_id,
        details: { action_id: action.id, report_id: report.id }
      });

      // Update report status
      await entities.Report.update(report.id, {
        status: 'resolved',
        reviewed_by: moderatorProfile.user_email,
        resolution: `Action taken: ${actionData.action_type}`
      });

      // Notify affected user
      if (report.reported_user_email) {
        try {
          if (accessToken) {
            await upsertNotification(
              {
                recipient_email: report.reported_user_email,
                type: 'moderation_action',
                content: `A moderation action has been taken on your content. Rule: ${ruleCategories[actionData.rule_category]}`,
                metadata: { action_id: action.id, can_appeal: true },
              },
              { accessToken }
            );
          }
        } catch {
          // ignore
        }
      }

      return action;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      toast.success('Moderation action taken');
    }
  });

  const canTakeAction = (actionType) => {
    const perms = moderatorProfile.permissions;
    switch (actionType) {
      case 'warning':
      case 'content_hidden':
        return perms.can_hide_content;
      case 'content_removed':
        return perms.can_remove_content;
      case 'user_suspended':
        return perms.can_suspend_users;
      case 'user_banned':
        return perms.can_ban_users;
      default:
        return false;
    }
  };

  const requiresSecondApproval = (actionType) => {
    return ['content_removed', 'user_suspended', 'user_banned'].includes(actionType);
  };

  return (
    <div className="space-y-4">
      <div className="p-4 bg-blue-50 border-2 border-blue-200 rounded-xl">
        <div className="flex items-center gap-2 mb-2">
          <Scale className="w-5 h-5 text-blue-600" />
          <p className="font-bold text-blue-900 text-sm">Three-Stage Moderation Process</p>
        </div>
        <ol className="text-xs text-slate-600 space-y-1 ml-5 list-decimal">
          <li>Automated flagging (already done)</li>
          <li className="font-bold text-blue-900">Human review (current stage)</li>
          <li>User appeal mechanism (if action taken)</li>
        </ol>
      </div>

      <div className="space-y-3">
        <Select
          value={reviewForm.action_type}
          onValueChange={(value) => setReviewForm({
            ...reviewForm,
            action_type: value,
            requires_second_approval: requiresSecondApproval(value)
          })}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select action..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="warning" disabled={!canTakeAction('warning')}>
              Warning (notify user)
            </SelectItem>
            <SelectItem value="content_hidden" disabled={!canTakeAction('content_hidden')}>
              Hide Content (reversible)
            </SelectItem>
            <SelectItem value="content_removed" disabled={!canTakeAction('content_removed')}>
              Remove Content {requiresSecondApproval('content_removed') && '(requires 2nd approval)'}
            </SelectItem>
            <SelectItem value="user_suspended" disabled={!canTakeAction('user_suspended')}>
              Suspend User {requiresSecondApproval('user_suspended') && '(requires 2nd approval)'}
            </SelectItem>
            <SelectItem value="user_banned" disabled={!canTakeAction('user_banned')}>
              Ban User {requiresSecondApproval('user_banned') && '(requires 2nd approval)'}
            </SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={reviewForm.rule_category}
          onValueChange={(value) => setReviewForm({ ...reviewForm, rule_category: value })}
        >
          <SelectTrigger>
            <SelectValue placeholder="Rule violated..." />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(ruleCategories).map(([key, label]) => (
              <SelectItem key={key} value={key}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Textarea
          placeholder={
            "Detailed reason for action (will be shown to user)..."
          }
          value={reviewForm.reason}
          onChange={(e) => setReviewForm({ ...reviewForm, reason: e.target.value })}
          className="min-h-[100px]"
        />

        {reviewForm.requires_second_approval && (
          <div className="p-3 bg-orange-50 border-2 border-orange-200 rounded-xl flex items-start gap-2">
            <Shield className="w-4 h-4 text-orange-600 mt-0.5" />
            <p className="text-xs text-slate-700">
              This action requires approval from a second moderator (senior or admin tier)
            </p>
          </div>
        )}

        <Button
          onClick={() => takeModerationActionMutation.mutate(reviewForm)}
          disabled={!reviewForm.action_type || !reviewForm.rule_category || !reviewForm.reason || takeModerationActionMutation.isPending}
          className="w-full bg-[#3A3DFF] hover:bg-[#2A2DDD] rounded-xl font-bold"
        >
          Take Action
        </Button>
      </div>
    </div>
  );
}