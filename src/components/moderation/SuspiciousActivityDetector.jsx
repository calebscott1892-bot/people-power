import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { entities } from '@/api/appClient';
import { Button } from '@/components/ui/button';

export default function SuspiciousActivityDetector() {
  const [refreshNonce, setRefreshNonce] = useState(0);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['suspiciousActivitySummary', refreshNonce],
    queryFn: async () => {
      let comments = [];
      try {
        const list = await entities.Comment.list('-created_date', {
          limit: 500,
          fields: ['id', 'user_email', 'content', 'created_date'],
        });
        comments = Array.isArray(list) ? list : [];
      } catch {
        comments = [];
      }

      const now = Date.now();
      const oneHourAgo = now - 60 * 60 * 1000;
      const recent = comments
        .filter((c) => {
          const ts = c?.created_date ? new Date(c.created_date).getTime() : 0;
          return ts && ts >= oneHourAgo;
        })
        .slice(-200);

      const spamKeywords = ['scam', 'crypto', 'giveaway', 'airdrop', 'free money', 'telegram', 'whatsapp', 'dm me'];
      const negativeKeywords = ['hate', 'idiot', 'stupid', 'liar', 'fake', 'fraud'];

      let spamSignals = 0;
      let harassmentSignals = 0;

      const byUser = new Map();
      for (const c of recent) {
        const email = String(c?.user_email || '').toLowerCase();
        if (!email) continue;
        byUser.set(email, (byUser.get(email) || 0) + 1);
        const text = String(c?.content || '').toLowerCase();
        if (spamKeywords.some((k) => text.includes(k))) spamSignals += 1;
        if (negativeKeywords.some((k) => text.includes(k))) harassmentSignals += 1;
      }

      const heavyPosters = [...byUser.values()].filter((n) => n >= 5).length;
      const volumeSignals = heavyPosters > 0 ? heavyPosters : 0;

      const totalSignals = spamSignals + harassmentSignals + volumeSignals;

      return {
        recent_count: recent.length,
        spam_signals: spamSignals,
        harassment_signals: harassmentSignals,
        volume_signals: volumeSignals,
        total_signals: totalSignals,
        scanned_at: new Date().toISOString(),
      };
    },
    retry: 1,
  });

  const severity = useMemo(() => {
    const s = Number(data?.total_signals || 0) || 0;
    if (s >= 10) return { label: 'High', className: 'text-orange-600' };
    if (s >= 4) return { label: 'Medium', className: 'text-yellow-600' };
    return { label: 'Low', className: 'text-slate-600' };
  }, [data]);

  return (
    <div className="p-6 rounded-2xl border border-slate-200 bg-white shadow-sm space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="font-black text-slate-900">Suspicious activity</div>
          <div className="text-sm text-slate-600 font-semibold">
            Lightweight heuristic scan (estimates; not a verdict).
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          className="rounded-xl font-black"
          onClick={() => setRefreshNonce((n) => n + 1)}
        >
          Run scan
        </Button>
      </div>

      {isLoading ? (
        <div className="text-sm text-slate-600 font-semibold">Scanning…</div>
      ) : isError ? (
        <div className="text-sm text-slate-600 font-semibold">Unable to scan right now.</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div className="p-3 rounded-xl border border-slate-200 bg-slate-50">
            <div className="text-xs font-bold text-slate-500 uppercase">Severity</div>
            <div className={`text-lg font-black ${severity.className}`}>{severity.label}</div>
          </div>
          <div className="p-3 rounded-xl border border-slate-200 bg-slate-50">
            <div className="text-xs font-bold text-slate-500 uppercase">Recent comments</div>
            <div className="text-lg font-black text-slate-900">{Number(data?.recent_count || 0) || 0}</div>
          </div>
          <div className="p-3 rounded-xl border border-slate-200 bg-slate-50">
            <div className="text-xs font-bold text-slate-500 uppercase">Spam signals</div>
            <div className="text-lg font-black text-slate-900">{Number(data?.spam_signals || 0) || 0}</div>
          </div>
          <div className="p-3 rounded-xl border border-slate-200 bg-slate-50">
            <div className="text-xs font-bold text-slate-500 uppercase">Harassment signals</div>
            <div className="text-lg font-black text-slate-900">{Number(data?.harassment_signals || 0) || 0}</div>
          </div>
          <div className="p-3 rounded-xl border border-slate-200 bg-slate-50">
            <div className="text-xs font-bold text-slate-500 uppercase">Volume signals</div>
            <div className="text-lg font-black text-slate-900">{Number(data?.volume_signals || 0) || 0}</div>
          </div>
        </div>
      )}

      <div className="text-xs text-slate-500 font-semibold">
        {data?.scanned_at ? `Last scan: ${new Date(data.scanned_at).toLocaleString()}` : 'No scan yet.'}
      </div>
    </div>
  );
}