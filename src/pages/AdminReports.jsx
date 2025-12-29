import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/auth/AuthProvider';
import { fetchReports } from '@/api/reportsClient';
import ReportCard from '@/components/admin/ReportCard';
import ReportActions from '@/components/admin/ReportActions';
import AuditLogViewer from '@/components/moderation/AuditLogViewer';
import AdminAppealsPanel from '@/components/moderation/AdminAppealsPanel';
import { entities } from '@/api/appClient';
import { getStaffRole, isStaff } from '@/utils/staff';

export default function AdminReports() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('pending');

  const [selectedReport, setSelectedReport] = useState(null);

  const accessToken = session?.access_token ? String(session.access_token) : null;
  const moderatorEmail = session?.user?.email ? String(session.user.email) : '';
  const role = getStaffRole(moderatorEmail);

  const canView = !!accessToken && isStaff(moderatorEmail);

  const {
    data: reports = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['adminReports', status],
    enabled: canView,
    queryFn: async () => {
      return fetchReports({ status }, { accessToken });
    },
    retry: 1,
  });

  const { data: pendingAppealsCount = 0 } = useQuery({
    queryKey: ['adminAppealsCount', 'pending'],
    enabled: canView,
    queryFn: async () => {
      const appeals = await entities.ModerationAppeal.filter({ status: 'pending' });
      return Array.isArray(appeals) ? appeals.length : 0;
    },
    retry: 1,
  });

  const rows = useMemo(() => {
    return Array.isArray(reports) ? reports : [];
  }, [reports]);

  const enrichedRows = useMemo(() => {
    return rows.map((r) => {
      const reportedType = String(r?.reported_content_type || r?.content_type || 'content');
      const reportedId = String(r?.reported_content_id || r?.content_id || '');
      return {
        ...r,
        reported_content_type: reportedType,
        reported_content_id: reportedId,
      };
    });
  }, [rows]);

  const getPastReportsCount = async (report) => {
    try {
      const type = String(report?.reported_content_type || '');
      const id = String(report?.reported_content_id || '');
      if (!type || !id) return 0;
      const matches = await entities.Report.filter({
        reported_content_type: type,
        reported_content_id: id,
      });
      return Array.isArray(matches) ? matches.length : 0;
    } catch {
      return 0;
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-12 space-y-6">
      <Link to="/" className="text-[#3A3DFF] font-bold">
        &larr; Back to home
      </Link>

      <div className="p-6 rounded-2xl border border-slate-200 bg-white shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black text-slate-900">Admin Reports</h1>
            <p className="text-slate-600 font-semibold text-sm">
              Verified-user reports queue.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Link
              to="/AdminIncidentLog"
              className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-slate-800 font-black text-sm hover:bg-slate-50"
            >
              Incident Log
            </Link>
          </div>

          <div className="flex items-center gap-2">
            <span className="px-3 py-1 rounded-full border border-slate-200 bg-slate-50 text-slate-800 text-xs font-black">
              Pending appeals: {Number.isFinite(pendingAppealsCount) ? pendingAppealsCount : 0}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
              }}
              className="p-2 rounded-xl border border-slate-200 bg-slate-50 font-semibold text-sm"
            >
              <option value="pending">Pending</option>
              <option value="in_review">In Review</option>
              <option value="needs_info">Needs Info</option>
              <option value="pending_second_approval">Pending 2nd Approval</option>
              <option value="resolved">Resolved</option>
              <option value="dismissed">Dismissed</option>
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

        {!accessToken ? (
          <div className="text-slate-600 font-semibold">Sign in to view reports.</div>
        ) : !canView ? (
          <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 text-slate-700">
            <div className="font-black text-slate-900">Not authorized</div>
            <div className="text-sm font-semibold mt-1">Staff access required.</div>
          </div>
        ) : isLoading ? (
          <div className="text-slate-600 font-semibold">Loading reports…</div>
        ) : isError ? (
          <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 text-slate-700">
            <div className="font-black text-slate-900">Could not load reports</div>
            <div className="text-sm font-semibold mt-1">
              {String(error?.message || 'Unknown error')}
            </div>
          </div>
        ) : enrichedRows.length === 0 ? (
          <div className="text-slate-600 font-semibold">No reports in this status.</div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {enrichedRows.map((r) => (
              <ReportCard
                key={String(r?.id)}
                report={r}
                onSelect={async () => {
                  const pastCount = await getPastReportsCount(r);
                  setSelectedReport({ ...r, _pastReportsCount: pastCount });
                }}
              />
            ))}
          </div>
        )}
      </div>

      <div className="p-6 rounded-2xl border border-slate-200 bg-white shadow-sm">
        <AuditLogViewer moderatorEmail={moderatorEmail || null} staffRole={role} />
      </div>

      <div className="p-6 rounded-2xl border border-slate-200 bg-white shadow-sm">
        <AdminAppealsPanel moderatorEmail={moderatorEmail || null} staffRole={role} />
      </div>

      {selectedReport ? (
        <ReportActions
          report={selectedReport}
          moderatorEmail={moderatorEmail || 'admin'}
          accessToken={accessToken}
          onClose={() => setSelectedReport(null)}
          onActionComplete={() => {
            setSelectedReport(null);
            queryClient.invalidateQueries({ queryKey: ['adminReports'] });
          }}
        />
      ) : null}
    </div>
  );
}