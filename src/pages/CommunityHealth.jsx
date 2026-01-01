import React, { useEffect, useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { useNavigate } from 'react-router-dom';
import BarChart from '@/components/ui/BarChart';
import { getServerBaseUrl } from '@/api/serverBase';
import { logError } from '@/utils/logError';
import AdminBackButton from '@/components/admin/AdminBackButton';

function formatNumber(n) {
  if (n == null) return '—';
  return Number(n).toLocaleString();
}

function formatSeconds(s) {
  if (s == null) return '—';
  const min = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return min ? `${min}m ${sec}s` : `${sec}s`;
}

function percentChange(current, prev) {
  if (prev == null || prev === 0 || current == null) return null;
  const pct = ((current - prev) / Math.abs(prev)) * 100;
  return Math.round(pct);
}

function TrendArrow({ value, prev }) {
  if (prev == null || value == null) return null;
  if (value > prev) return <span style={{ color: '#e53e3e', fontWeight: 700 }}>▲</span>;
  if (value < prev) return <span style={{ color: '#38a169', fontWeight: 700 }}>▼</span>;
  return <span style={{ color: '#718096' }}>—</span>;
}

export default function CommunityHealth() {
  const { user, session, isAdmin } = useAuth();
  const accessToken = session?.access_token || null;
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!user || !isAdmin) {
      navigate('/');
      return;
    }
    if (!accessToken) {
      setError(new Error('Missing access token'));
      setLoading(false);
      return;
    }
    setLoading(true);
    const baseUrl = getServerBaseUrl();
    fetch(`${baseUrl}/admin/community-health`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    })
      .then((r) => r.ok ? r.json() : Promise.reject(r))
      .then(setStats)
      .catch((err) => {
        setError(err);
        logError(err, 'CommunityHealth load failed');
      })
      .finally(() => setLoading(false));
  }, [user, isAdmin, accessToken, navigate]);

  if (!user || !isAdmin) return null;

  // Helper to get value for a metric from stats
  function getMetric(key) {
    return stats?.current?.[key] ?? null;
  }
  function getPrevMetric(key) {
    return stats?.previous?.[key] ?? null;
  }

  const metricList = [
    { key: 'total_users', label: 'Total users', isPct: false },
    { key: 'active_users', label: 'Active users (7d)', isPct: false },
    { key: 'new_users', label: 'New users (7d)', isPct: false },
    { key: 'movements_created', label: 'Movements created (7d)', isPct: false },
    { key: 'reports_created', label: 'Reports created (7d)', isPct: false },
    { key: 'pct_reports_action', label: '% Reports with action (7d)', isPct: true },
    { key: 'suspicious_activity_flags', label: 'Suspicious activity flags (7d)', isPct: false },
    { key: 'harassment_protection_triggers', label: 'Harassment protection triggers (7d)', isPct: false },
    { key: 'crisis_detection_events', label: 'Crisis detection events (7d)', isPct: false },
    { key: 'avg_report_response_time', label: 'Avg. response time to reports', isTime: true },
  ];

  return (
    <div className="max-w-4xl mx-auto px-4 py-10 space-y-8">
      <AdminBackButton />
      <h1 className="text-3xl font-black text-slate-900 mb-2">Community Health</h1>
      <div className="inline-flex items-center px-3 py-1 rounded-full bg-slate-900 text-white text-xs font-black uppercase">
        Admin mode – changes here affect the whole platform
      </div>
      <div className="mb-4 p-3 rounded-xl border border-yellow-200 bg-yellow-50 text-slate-800 text-sm font-semibold">
        This view shows platform-level signals only. No individual content is exposed.
      </div>
      {loading ? (
        <div className="text-slate-600 font-semibold">Loading…</div>
      ) : error ? (
        <div className="text-rose-700 font-semibold">Failed to load stats.</div>
      ) : stats ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {metricList.map((m) => {
            const value = m.isTime ? formatSeconds(getMetric(m.key)) : m.isPct ? (getMetric(m.key) != null ? getMetric(m.key) + '%' : '—') : formatNumber(getMetric(m.key));
            const prev = getPrevMetric(m.key);
            const trend = m.isTime ? null : percentChange(getMetric(m.key), prev);
            return (
              <div key={m.key} className={`p-5 rounded-2xl border border-slate-200 bg-white shadow-sm ${trend != null && Math.abs(trend) > 30 ? 'border-yellow-400' : ''}`}>
                <div className="text-xs font-black text-slate-600">{m.label}</div>
                <div className="text-2xl font-black text-slate-900 flex items-center gap-2">
                  {value}
                  <TrendArrow value={getMetric(m.key)} prev={prev} />
                  {trend != null && (
                    <span className={`text-xs font-bold ${trend > 0 ? 'text-red-600' : trend < 0 ? 'text-green-700' : 'text-slate-500'}`}>{trend > 0 ? '+' : ''}{trend}%</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
      {/* Bar chart for content category distribution */}
      {stats?.current?.content_category_dist?.length ? (
        <div className="mt-8">
          <div className="text-lg font-black text-slate-900 mb-2">Content Category Distribution (7d)</div>
          <BarChart
            data={stats.current.content_category_dist.map((c) => ({ label: c.category, value: c.count }))}
            labelKey="label"
            valueKey="value"
            height={180}
            barColor="#3A3DFF"
          />
        </div>
      ) : null}
      {/* Bar chart for trend: compare previous period */}
      {stats?.current?.content_category_dist?.length && stats?.previous?.content_category_dist?.length ? (
        <div className="mt-8">
          <div className="text-lg font-black text-slate-900 mb-2">Category Change vs Previous 7d</div>
          <BarChart
            data={stats.current.content_category_dist.map((c) => {
              const prev = stats.previous.content_category_dist.find((p) => p.category === c.category);
              const diff = prev ? c.count - prev.count : c.count;
              return { label: c.category, value: diff };
            })}
            labelKey="label"
            valueKey="value"
            height={140}
            barColor="#e53e3e"
          />
        </div>
      ) : null}
    </div>
  );
}
