import React, { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthProvider';
import { Navigate } from 'react-router-dom';
import AdminBackButton from '@/components/admin/AdminBackButton';
import { logError } from '@/utils/logError';
import { getServerBaseUrl } from '@/api/serverBase';

function fetchMigrationLogs(token) {
  const baseUrl = getServerBaseUrl();
  return fetch(`${baseUrl}/admin/migrations`, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
  }).then((r) => {
    if (!r.ok) throw new Error('Failed to fetch migration logs');
    return r.json();
  });
}

function getLastBackup(logs) {
  return logs.find((l) => l.type === 'backup' && l.status === 'success');
}

function getBackupStatus(logs) {
  const last = getLastBackup(logs);
  if (!last) return 'No backups in last 7 days';
  const lastDate = new Date(last.finished_at);
  const now = new Date();
  const diffDays = (now - lastDate) / (1000 * 60 * 60 * 24);
  if (diffDays > 7) return 'No backups in last 7 days';
  return 'Backups OK';
}

export default function SystemHealth() {
  const { user, session, loading, isAdmin } = useAuth();
  const accessToken = session?.access_token || null;
  const { data, error, isLoading } = useQuery({
    queryKey: ['migrationLogs', accessToken],
    queryFn: () => fetchMigrationLogs(accessToken),
    enabled: !!accessToken,
  });

  useEffect(() => {
    if (error) logError(error, 'SystemHealth load failed');
  }, [error]);

  if (loading) return <div>Loading system health…</div>;
  if (!user || !isAdmin) return <Navigate to="/" replace />;
  if (isLoading) return <div>Loading system health…</div>;
  if (error) return <div>Unable to load system health right now.</div>;

  const logs = data?.logs || [];
  const lastBackup = getLastBackup(logs);
  const backupStatus = getBackupStatus(logs);

  return (
    <div className="max-w-5xl mx-auto px-4 py-10 space-y-6">
      <AdminBackButton />
      <div>
        <h1 className="text-2xl font-black text-slate-900">System Health</h1>
        <div className="inline-flex items-center mt-3 px-3 py-1 rounded-full bg-slate-900 text-white text-xs font-black uppercase">
          Admin mode – changes here affect the whole platform
        </div>
      </div>

      <div className="p-4 rounded-2xl border border-slate-200 bg-white shadow-sm space-y-2">
        <div className="font-black text-slate-900">Backup Status: {backupStatus}</div>
        <div className="text-sm text-slate-600 font-semibold">
          Last backup: {lastBackup ? new Date(lastBackup.finished_at).toLocaleString() : 'Never'}
        </div>
      </div>

      <div className="p-4 rounded-2xl border border-slate-200 bg-white shadow-sm">
        <h2 className="text-lg font-black text-slate-900 mb-3">Recent Migration/Backup Logs</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-slate-500">
              <tr>
                <th className="py-2 pr-4">Started</th>
                <th className="py-2 pr-4">Type</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Message</th>
                <th className="py-2">Details</th>
              </tr>
            </thead>
            <tbody>
              {logs.slice(0, 20).map((log) => (
                <tr key={log.id} className={log.status === 'failed' ? 'bg-red-50' : ''}>
                  <td className="py-2 pr-4 whitespace-nowrap">{new Date(log.started_at).toLocaleString()}</td>
                  <td className="py-2 pr-4">{log.type}</td>
                  <td className="py-2 pr-4">{log.status}</td>
                  <td className="py-2 pr-4">{log.message}</td>
                  <td className="py-2">
                    <pre className="whitespace-pre-wrap text-xs text-slate-600">
                      {log.details ? JSON.stringify(log.details, null, 2) : ''}
                    </pre>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
