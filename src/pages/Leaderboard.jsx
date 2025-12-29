import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Trophy, Loader2 } from 'lucide-react';
import { fetchMovementsPage } from '@/api/movementsClient';

function normalizeEmail(value) {
  const s = String(value ?? '').trim().toLowerCase();
  return s || null;
}

export default function Leaderboard() {
  const { data: movements = [], isLoading } = useQuery({
    queryKey: ['movements'],
    queryFn: () =>
      fetchMovementsPage({
        limit: 500,
        offset: 0,
        fields: ['id', 'author_email', 'momentum_score', 'created_at', 'created_date'].join(','),
      }),
  });

  const rows = useMemo(() => {
    const byAuthor = new Map();
    for (const m of movements) {
      const author = normalizeEmail(m?.author_email) || 'unknown';
      const prev = byAuthor.get(author) || {
        author_email: author,
        created_count: 0,
        total_momentum: 0,
        last_created_at: null,
      };
      const momentum = Number(m?.momentum_score || 0);
      const createdAt = m?.created_at || null;
      byAuthor.set(author, {
        ...prev,
        created_count: prev.created_count + 1,
        total_momentum: prev.total_momentum + (Number.isFinite(momentum) ? momentum : 0),
        last_created_at: createdAt && (!prev.last_created_at || String(createdAt) > String(prev.last_created_at))
          ? createdAt
          : prev.last_created_at,
      });
    }

    return Array.from(byAuthor.values())
      .filter((r) => r.author_email !== 'unknown')
      .sort((a, b) => {
        if (b.total_momentum !== a.total_momentum) return b.total_momentum - a.total_momentum;
        if (b.created_count !== a.created_count) return b.created_count - a.created_count;
        return String(a.author_email).localeCompare(String(b.author_email));
      })
      .slice(0, 50);
  }, [movements]);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="bg-white rounded-3xl shadow-2xl border-3 border-slate-200 overflow-hidden">
        <div className="p-8 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#FFC947] to-[#FFD666] flex items-center justify-center">
              <Trophy className="w-6 h-6 text-slate-900" />
            </div>
            <div>
              <h1 className="text-3xl font-black text-slate-900">Leaderboard</h1>
              <p className="text-slate-600 font-semibold">Top movement creators by momentum</p>
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="p-10 flex items-center gap-2 text-slate-600 font-semibold">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading leaderboard...
          </div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-slate-600 font-semibold">No leaderboard data yet.</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {rows.map((r, idx) => (
              <div key={r.author_email} className="p-6 flex items-center justify-between">
                <div className="flex items-center gap-4 min-w-0">
                  <div className="w-10 h-10 rounded-2xl bg-slate-100 flex items-center justify-center font-black text-slate-900">
                    {idx + 1}
                  </div>
                  <div className="min-w-0">
                    <div className="font-black text-slate-900 truncate">{r.author_email}</div>
                    <div className="text-sm text-slate-500 font-semibold">
                      {r.created_count} created
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-black text-[#3A3DFF]">{r.total_momentum}</div>
                  <div className="text-xs text-slate-500 font-bold uppercase tracking-wide">Momentum</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}