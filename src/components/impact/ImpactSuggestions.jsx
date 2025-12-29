import React, { useMemo, useState } from 'react';
import { Button } from "@/components/ui/button";
import { Lightbulb, Loader2 } from 'lucide-react';

export default function ImpactSuggestions({ movement }) {
  const [generating, setGenerating] = useState(false);
  const [suggestions, setSuggestions] = useState(null);

  const generateSuggestions = async () => {
    setGenerating(true);
    try {
      const boosts = Number(movement?.boosts || 0) || 0;
      const supporters = Number(movement?.supporters || 0) || 0;
      const participants =
        (Number(movement?.verified_participants || 0) || 0) + (Number(movement?.unverified_participants || 0) || 0);

      const quickWins = [];
      if (supporters > participants) quickWins.push('Ask supporters to take one specific action (small, concrete, time-boxed).');
      quickWins.push('Post an update with a clear next step and a deadline.');
      quickWins.push('Add a short FAQ: what this is, what it isn’t, and how to help.');

      const growth = [];
      growth.push('Recruit 2–3 collaborators to share responsibility for outreach and coordination.');
      growth.push('Collect resources (links, docs) so newcomers can onboard quickly.');
      if (boosts < supporters) growth.push('Encourage boosts on milestone updates to increase visibility.');

      const engagement = [];
      engagement.push('Ask a single question to invite discussion (avoid multiple asks).');
      engagement.push('Highlight one concrete impact metric in each update (e.g., signatures, attendees, downloads).');
      if (participants === 0) engagement.push('Start with a low-friction action to convert first participants.');

      setSuggestions({ quick_wins: quickWins.slice(0, 4), growth_strategies: growth.slice(0, 4), engagement_tactics: engagement.slice(0, 4) });
    } finally {
      setGenerating(false);
    }
  };

  const hasMovement = !!movement;
  const title = useMemo(() => String(movement?.title || 'Movement'), [movement]);

  return (
    <div className="bg-white rounded-2xl border-3 border-slate-200 p-6 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-black text-slate-900">Impact suggestions</h3>
          <p className="text-sm text-slate-500 font-semibold">Simple, non-prescriptive ideas for {title}.</p>
        </div>
        <Button
          type="button"
          onClick={generateSuggestions}
          disabled={generating || !hasMovement}
          className="rounded-xl font-black"
        >
          {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lightbulb className="w-4 h-4 mr-2" />}
          {generating ? 'Generating…' : 'Generate'}
        </Button>
      </div>

      {!hasMovement ? (
        <div className="text-sm text-slate-600 font-semibold">Load a movement to generate suggestions.</div>
      ) : !suggestions ? (
        <div className="text-sm text-slate-600 font-semibold">Click Generate to see ideas.</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="p-4 rounded-2xl border-2 border-slate-200 bg-slate-50">
            <div className="font-black text-slate-900 mb-2">Quick wins</div>
            <div className="space-y-2">
              {(suggestions.quick_wins || []).map((s, i) => (
                <div key={i} className="text-sm text-slate-700 font-semibold">• {s}</div>
              ))}
            </div>
          </div>
          <div className="p-4 rounded-2xl border-2 border-slate-200 bg-slate-50">
            <div className="font-black text-slate-900 mb-2">Growth</div>
            <div className="space-y-2">
              {(suggestions.growth_strategies || []).map((s, i) => (
                <div key={i} className="text-sm text-slate-700 font-semibold">• {s}</div>
              ))}
            </div>
          </div>
          <div className="p-4 rounded-2xl border-2 border-slate-200 bg-slate-50">
            <div className="font-black text-slate-900 mb-2">Engagement</div>
            <div className="space-y-2">
              {(suggestions.engagement_tactics || []).map((s, i) => (
                <div key={i} className="text-sm text-slate-700 font-semibold">• {s}</div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}