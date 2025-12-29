import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import PlatformConfigPanel from '@/components/admin/PlatformConfigPanel';

export default function AdminDashboard() {
  const { user, isAdmin } = useAuth();
  const adminEmail = user?.email ? String(user.email) : '';

  return (
    <div className="max-w-6xl mx-auto px-4 py-12 space-y-6">
      <Link to="/" className="text-[#3A3DFF] font-bold">
        &larr; Back to home
      </Link>

      <div className="p-6 rounded-2xl border border-slate-200 bg-white shadow-sm space-y-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900">Admin Dashboard</h1>
          <p className="text-slate-600 font-semibold text-sm">Moderation + platform tools.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {isAdmin && (
                      <Link
                        to="/CommunityHealth"
                        className="p-4 rounded-2xl border border-slate-200 bg-white hover:bg-slate-50 transition-colors"
                      >
                        <div className="font-black text-slate-900">Community Health</div>
                        <div className="text-sm font-semibold text-slate-600 mt-1">View platform-level safety & governance signals.</div>
                      </Link>
                    )}
          <Link
            to="/admin-reports"
            className="p-4 rounded-2xl border border-slate-200 bg-white hover:bg-slate-50 transition-colors"
          >
            <div className="font-black text-slate-900">Reports Queue</div>
            <div className="text-sm font-semibold text-slate-600 mt-1">Review and resolve user reports.</div>
          </Link>

          <Link
            to="/AdminIncidentLog"
            className="p-4 rounded-2xl border border-slate-200 bg-white hover:bg-slate-50 transition-colors"
          >
            <div className="font-black text-slate-900">Incident Log</div>
            <div className="text-sm font-semibold text-slate-600 mt-1">View safety-related incidents (read-only).</div>
          </Link>

          <Link
            to="/SystemHealth"
            className="p-4 rounded-2xl border border-slate-200 bg-white hover:bg-slate-50 transition-colors"
          >
            <div className="font-black text-slate-900">System Health</div>
            <div className="text-sm font-semibold text-slate-600 mt-1">View backup/migration status.</div>
          </Link>

          <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50">
            <div className="font-black text-slate-900">Signed in as</div>
            <div className="text-sm font-semibold text-slate-600 mt-1 break-all">
              {adminEmail || 'admin'}
            </div>
          </div>
        </div>
      </div>

      <div className="p-6 rounded-2xl border border-slate-200 bg-white shadow-sm">
        <PlatformConfigPanel adminEmail={adminEmail} />
      </div>
    </div>
  );
}