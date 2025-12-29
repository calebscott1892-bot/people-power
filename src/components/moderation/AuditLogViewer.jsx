import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, Calendar, User } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from "@/lib/utils";
import { entities } from "@/api/appClient";
import { useAuth } from '@/auth/AuthProvider';
import { getStaffRole, isStaff } from '@/utils/staff';

export default function AuditLogViewer({ moderatorEmail, staffRole }) {
  const { user } = useAuth();
  const authedEmail = user?.email ? String(user.email) : '';
  const role = staffRole || getStaffRole(authedEmail);
  const canView = isStaff(authedEmail) || role === 'admin' || role === 'moderator';

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['auditLogs', moderatorEmail],
    enabled: canView,
    queryFn: async () => {
      const filterEmail = authedEmail || moderatorEmail;
      if (filterEmail) {
        return entities.ModeratorAuditLog.filter({ moderator_email: filterEmail }, '-created_date', 100);
      }
      return entities.ModeratorAuditLog.list('-created_date', 100);
    }
  });

  const actionColors = {
    reviewed_report: 'bg-blue-100 text-blue-700',
    took_moderation_action: 'bg-orange-100 text-orange-700',
    approved_action: 'bg-green-100 text-green-700',
    reversed_action: 'bg-red-100 text-red-700',
    reviewed_appeal: 'bg-purple-100 text-purple-700',
    updated_permissions: 'bg-yellow-100 text-yellow-700',
    accessed_content: 'bg-slate-100 text-slate-700'
  };

  if (!canView) {
    return <div className="text-center py-8 text-slate-600 font-semibold">Staff access required.</div>;
  }

  if (isLoading) {
    return <div className="text-center py-8">Loading audit logs...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-4">
        <FileText className="w-6 h-6 text-slate-600" />
        <h3 className="text-xl font-black text-slate-900">
          Audit Log {moderatorEmail && `- ${moderatorEmail}`}
        </h3>
      </div>

      {logs.length === 0 ? (
        <div className="text-center py-12 text-slate-500">No audit logs found</div>
      ) : (
        <div className="space-y-2">
          {logs.map((log) => (
            <div key={log.id} className="p-4 bg-white rounded-xl border-2 border-slate-200">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={cn(
                      "px-2 py-1 rounded text-xs font-bold",
                      actionColors[log.action_type] || 'bg-slate-100 text-slate-700'
                    )}>
                      {log.action_type.replace(/_/g, ' ').toUpperCase()}
                    </span>
                    {log.target_content_type && (
                      <span className="text-xs text-slate-500">
                        on {log.target_content_type}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-4 text-xs text-slate-500">
                    <div className="flex items-center gap-1">
                      <User className="w-3 h-3" />
                      {log.moderator_email}
                    </div>
                    <div className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {format(new Date(log.created_date), 'MMM d, yyyy HH:mm')}
                    </div>
                    {log.ip_address && (
                      <span>IP: {log.ip_address}</span>
                    )}
                  </div>
                  {log.details && (
                    <pre className="mt-2 text-xs bg-slate-50 p-2 rounded overflow-auto">
                      {JSON.stringify(log.details, null, 2)}
                    </pre>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}