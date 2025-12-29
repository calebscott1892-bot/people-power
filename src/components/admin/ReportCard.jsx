import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { User, Clock } from 'lucide-react';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { entities } from "@/api/appClient";

const categoryIcons = {
  harassment_or_bullying: '😡',
  hate_speech_or_discrimination: '🚫',
  incitement_of_violence_or_harm: '⚔️',
  illegal_activity_or_dangerous_conduct: '⚖️',
  misinformation_or_deceptive_activity: '📰',
  spam_or_scams: '📧',
  privacy_violation_or_doxxing: '🔒',
  underage_safety_concern: '👶',
  impersonation_or_identity_fraud: '🎭',
  inappropriate_content: '🔞',
  other: '❓',
  // Back-compat for older category names
  harassment: '😡',
  hate_speech: '🚫',
  violence: '⚔️',
  illegal_activity: '⚖️',
  misinformation: '📰',
  spam: '📧',
  privacy_violation: '🔒',
  underage_safety: '👶',
  impersonation: '🎭',
};

const priorityColors = {
  normal: 'border-slate-300 bg-slate-50',
  high: 'border-orange-300 bg-orange-50',
  urgent: 'border-red-300 bg-red-50'
};

const statusColors = {
  pending: 'text-yellow-600 bg-yellow-100',
  in_review: 'text-blue-600 bg-blue-100',
  needs_info: 'text-purple-700 bg-purple-100',
  pending_second_approval: 'text-orange-700 bg-orange-100',
  resolved: 'text-green-600 bg-green-100',
  dismissed: 'text-slate-600 bg-slate-100'
};

export default function ReportCard({ report, onSelect }) {
  const { data: reporter } = useQuery({
    queryKey: ['user', report.reporter_email],
    queryFn: async () => {
      const users = await entities.User.filter({ email: report.reporter_email });
      return users[0] || null;
    }
  });

  const createdAt = report?.created_at || report?.created_date || report?.createdAt || report?.created;
  const status = String(report?.status || 'pending');
  const category = String(report?.report_category || report?.category || 'other');
  const contentType = String(report?.reported_content_type || report?.content_type || 'content');
  const contentId = String(report?.reported_content_id || report?.content_id || '');
  const details = report?.report_details || report?.details || '';
  const isReversed = !!(report?.action_reversed_at || report?.action_reversed_by);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "bg-white rounded-2xl p-6 border-3 shadow-lg hover:shadow-xl transition-all cursor-pointer",
        priorityColors[String(report?.priority || 'normal')] || priorityColors.normal
      )}
      onClick={onSelect}
    >
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex items-start gap-3 flex-1">
          <div className="text-3xl">{categoryIcons[category] || '❓'}</div>
          <div className="flex-1 min-w-0">
            <h3 className="font-black text-lg text-slate-900 mb-1">
              {category.replace(/_/g, ' ').toUpperCase()}
            </h3>
            <p className="text-sm text-slate-600 font-semibold">
              {contentType} • ID: {contentId ? `${contentId.substring(0, 8)}...` : '—'}
            </p>
          </div>
        </div>

        <div className="flex flex-col items-end gap-2">
          <span className={cn(
            "px-3 py-1 rounded-lg text-xs font-black uppercase",
            statusColors[status] || statusColors.pending
          )}>
            {status.replace(/_/g, ' ')}
          </span>
          {isReversed ? (
            <span className="px-2 py-1 rounded text-xs font-black uppercase bg-slate-900 text-white">
              REVERSED
            </span>
          ) : null}
          {String(report?.priority || 'normal') !== 'normal' && (
            <span className={cn(
              "px-2 py-1 rounded text-xs font-black uppercase",
              String(report?.priority) === 'urgent' ? 'bg-red-500 text-white' : 'bg-orange-500 text-white'
            )}>
              {String(report?.priority)}
            </span>
          )}
        </div>
      </div>

      <div className="space-y-2 mb-4">
        <p className="text-slate-700 line-clamp-2">{String(details || '')}</p>
        
        <div className="flex items-center gap-4 text-xs text-slate-500">
          <span className="flex items-center gap-1">
            <User className="w-3 h-3" />
            {reporter?.full_name || reporter?.email || 'Unknown'}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {createdAt ? format(new Date(createdAt), 'MMM d, yyyy HH:mm') : '—'}
          </span>
          {report.is_repeat_report && (
            <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded font-bold">
              REPEAT
            </span>
          )}
        </div>
      </div>

      <Button 
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
        className="w-full bg-[#3A3DFF] hover:bg-[#2A2DDD] rounded-xl font-bold"
      >
        Review Report
      </Button>
    </motion.div>
  );
}