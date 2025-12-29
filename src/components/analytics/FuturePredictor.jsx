import React, { useMemo } from 'react';
import { cn } from '@/lib/utils';

export default function FuturePredictor({ movement, className = '' }) {
  const stats = useMemo(() => {
    const boosts = Number(movement?.boosts || 0) || 0;
    const supporters = Number(movement?.supporters || 0) || 0;
    const participants =
      (Number(movement?.verified_participants || 0) || 0) + (Number(movement?.unverified_participants || 0) || 0);
    const momentum = Number(movement?.momentum_score || 0) || 0;

    const baseReach = Number(movement?.actual_reach || 0) || Math.max((boosts + supporters) * 10, 50);
    const reach7d = Math.round(baseReach * (1 + Math.min(1, momentum / 100) * 0.35));
    const supporters7d = Math.round(supporters * (1 + Math.min(1, momentum / 100) * 0.25));
    const participants7d = Math.round(participants * (1 + Math.min(1, momentum / 100) * 0.2));

    return { baseReach, reach7d, supporters7d, participants7d, momentum };
  }, [movement]);

  return (
    <div className={cn('p-6 rounded-2xl border border-slate-200 bg-white shadow-sm space-y-4', className)}>
      <div>
        <div className="font-black text-slate-900">Future predictor</div>
        <div className="text-sm text-slate-600 font-semibold">Estimates based on current activity (not guarantees).</div>
      </div>

      {!movement ? (
        <div className="text-sm text-slate-600 font-semibold">Load a movement to see projections.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div className="p-3 rounded-xl border border-slate-200 bg-slate-50">
            <div className="text-xs font-bold text-slate-500 uppercase">Momentum</div>
            <div className="text-lg font-black text-slate-900">{stats.momentum}</div>
          </div>
          <div className="p-3 rounded-xl border border-slate-200 bg-slate-50">
            <div className="text-xs font-bold text-slate-500 uppercase">Reach (now)</div>
            <div className="text-lg font-black text-slate-900">{stats.baseReach}</div>
          </div>
          <div className="p-3 rounded-xl border border-slate-200 bg-slate-50">
            <div className="text-xs font-bold text-slate-500 uppercase">Reach (7d)</div>
            <div className="text-lg font-black text-slate-900">{stats.reach7d}</div>
          </div>
          <div className="p-3 rounded-xl border border-slate-200 bg-slate-50">
            <div className="text-xs font-bold text-slate-500 uppercase">Participants (7d)</div>
            <div className="text-lg font-black text-slate-900">{stats.participants7d}</div>
          </div>
        </div>
      )}
    </div>
  );
}