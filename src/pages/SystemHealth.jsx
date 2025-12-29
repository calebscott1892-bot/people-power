import React from 'react';
import { useQuery } from 'react-query';
import { useAuth } from '../auth/AuthProvider';
import { Navigate } from 'react-router-dom';

function fetchMigrationLogs(token) {
  return fetch('/admin/migrations', {
    headers: { Authorization: `Bearer ${token}` },
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
  const { user, accessToken, isAdmin } = useAuth();
  const { data, error, isLoading } = useQuery(
    ['migrationLogs', accessToken],
    () => fetchMigrationLogs(accessToken),
    { enabled: !!accessToken }
  );

  if (!user || !isAdmin) return <Navigate to="/" replace />;
  if (isLoading) return <div>Loading system health…</div>;
  if (error) return <div>Error loading logs: {error.message}</div>;

  const logs = data?.logs || [];
  const lastBackup = getLastBackup(logs);
  const backupStatus = getBackupStatus(logs);

  return (
    <div style={{ maxWidth: 800, margin: '2rem auto', padding: '2rem' }}>
      <h1>System Health</h1>
      <div style={{ margin: '1rem 0', fontWeight: 'bold' }}>Backup Status: {backupStatus}</div>
      <div>Last backup: {lastBackup ? new Date(lastBackup.finished_at).toLocaleString() : 'Never'}</div>
      <h2 style={{ marginTop: '2rem' }}>Recent Migration/Backup Logs</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '1rem' }}>
        <thead>
          <tr>
            <th>Started</th>
            <th>Type</th>
            <th>Status</th>
            <th>Message</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          {logs.slice(0, 20).map((log) => (
            <tr key={log.id} style={{ background: log.status === 'failed' ? '#ffeaea' : undefined }}>
              <td>{new Date(log.started_at).toLocaleString()}</td>
              <td>{log.type}</td>
              <td>{log.status}</td>
              <td>{log.message}</td>
              <td>
                <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.85em' }}>
                  {log.details ? JSON.stringify(log.details, null, 2) : ''}
                </pre>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
