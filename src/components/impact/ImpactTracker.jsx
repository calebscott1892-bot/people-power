import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { TrendingUp, Activity, Users } from 'lucide-react';
import { cn } from "@/lib/utils";
import { entities } from "@/api/appClient";

export default function ImpactTracker({ movement }) {
  const [metrics, setMetrics] = useState({
    engagement_rate: 0,
    growth_rate: 0,
    conversion_rate: 0
  });
  const queryClient = useQueryClient();

  const calculateMetrics = useCallback(() => {
    const totalEngagement = (movement.boosts || 0) + (movement.supporters || 0);
    const totalParticipants = (movement.verified_participants || 0) + (movement.unverified_participants || 0);
    const reach = movement.actual_reach || Math.max(totalEngagement * 10, 100);

    const engagementRate = reach > 0 ? (totalEngagement / reach) * 100 : 0;
    const conversionRate = totalEngagement > 0 ? (totalParticipants / totalEngagement) * 100 : 0;

    // Calculate growth rate based on momentum
    const growthRate = movement.momentum_score > 0 ? Math.min(movement.momentum_score * 2, 100) : 0;

    setMetrics({
      engagement_rate: Math.round(engagementRate * 10) / 10,
      growth_rate: Math.round(growthRate * 10) / 10,
      conversion_rate: Math.round(conversionRate * 10) / 10
    });
  }, [movement]);

  useEffect(() => {
    calculateMetrics();
  }, [calculateMetrics]);

  const updateMetricsMutation = useMutation({
    mutationFn: async () => {
      if (!movement?.id) return null;
      await entities.Movement.update(movement.id, {
        impact_metrics: metrics,
        actual_reach: movement.boosts * 10 + movement.supporters * 5
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['movement'] });
    }
  });

  const shouldPersist = useMemo(() => {
    const existing = movement?.impact_metrics && typeof movement.impact_metrics === 'object' ? movement.impact_metrics : null;
    if (!existing) return true;
    try {
      return JSON.stringify(existing) !== JSON.stringify(metrics);
    } catch {
      return true;
    }
  }, [movement, metrics]);

  useEffect(() => {
    if (!movement?.id) return;
    if (metrics.engagement_rate <= 0 && metrics.growth_rate <= 0 && metrics.conversion_rate <= 0) return;
    if (!shouldPersist) return;
    updateMetricsMutation.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movement?.id, shouldPersist]);

  const engagementTrend = metrics.engagement_rate >= 8 ? 'up' : metrics.engagement_rate >= 4 ? 'stable' : 'down';
  const growthTrend = metrics.growth_rate >= 60 ? 'up' : metrics.growth_rate >= 25 ? 'stable' : 'down';
  const conversionTrend = metrics.conversion_rate >= 60 ? 'up' : metrics.conversion_rate >= 30 ? 'stable' : 'down';

  return (
    <div className="bg-white rounded-2xl border-3 border-slate-200 p-6 space-y-4">
      <div>
        <h3 className="font-black text-slate-900">Impact tracker</h3>
        <p className="text-sm text-slate-500 font-semibold">Quick metrics based on current movement stats.</p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <MetricCard
          icon={<Activity className="w-5 h-5" />}
          label="Engagement"
          value={`${metrics.engagement_rate}%`}
          trend={engagementTrend}
        />
        <MetricCard
          icon={<TrendingUp className="w-5 h-5" />}
          label="Growth"
          value={`${metrics.growth_rate}%`}
          trend={growthTrend}
        />
        <MetricCard
          icon={<Users className="w-5 h-5" />}
          label="Conversion"
          value={`${metrics.conversion_rate}%`}
          trend={conversionTrend}
        />
      </div>

      <div className="text-xs text-slate-500 font-semibold">
        These values are estimates from visible counters and may be incomplete.
      </div>
    </div>
  );
}

function MetricCard({ icon, label, value, trend }) {
  const colors = {
    up: 'text-green-600 bg-green-50 border-green-200',
    down: 'text-red-600 bg-red-50 border-red-200',
    stable: 'text-blue-600 bg-blue-50 border-blue-200'
  };

  return (
    <div className={cn("rounded-xl p-3 border-2 text-center", colors[trend])}>
      <div className="flex justify-center mb-1">{icon}</div>
      <p className="text-xs font-bold uppercase mb-1">{label}</p>
      <p className="text-lg font-black">{value}</p>
    </div>
  );
}