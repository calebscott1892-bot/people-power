import React, { useMemo } from 'react';
import { cn } from '@/lib/utils';

export default function StrategyReplicator({ movement, className = '' }) {
  const ideas = useMemo(() => {
    const tags = Array.isArray(movement?.tags) ? movement.tags.map((t) => String(t).trim()).filter(Boolean) : [];
    const momentum = Number(movement?.momentum_score || 0) || 0;
    const list = [];

    list.push('Share a clear, factual one-sentence summary of the goal.');
    list.push('Post a concrete next step with a time and place (if relevant).');
    list.push('Use a single “ask” per post to reduce confusion.');

    if (tags.length > 0) list.push(`Use consistent tags: ${tags.slice(0, 3).join(', ')}.`);
    if (momentum < 20) list.push('Start with low-friction actions to build momentum (e.g., share, comment, invite).');
    else list.push('Convert supporters into participants by assigning small, specific roles.');

    return list.slice(0, 6);
  }, [movement]);

  return (
    <div className={cn('p-6 rounded-2xl border border-slate-200 bg-white shadow-sm space-y-3', className)}>
      <div>
        <div className="font-black text-slate-900">Strategy replicator</div>
        <div className="text-sm text-slate-600 font-semibold">Reusable, non-prescriptive patterns.</div>
      </div>

      {!movement ? (
        <div className="text-sm text-slate-600 font-semibold">Load a movement to see suggestions.</div>
      ) : (
        <div className="space-y-2">
          {ideas.map((s, idx) => (
            <div key={idx} className="p-3 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-700 font-semibold">
              {s}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}