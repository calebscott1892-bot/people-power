import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Trophy, Zap, Award, TrendingUp } from 'lucide-react';
import { cn } from "@/lib/utils";
import { fetchOrCreateUserChallengeStats } from '@/api/userChallengeStatsClient';

const BADGES = {
  'first_movement': { name: 'Pioneer', icon: '🚀', color: 'from-blue-500 to-cyan-500', description: 'Created first movement' },
  'movement_creator_5': { name: 'Organizer', icon: '📢', color: 'from-green-500 to-emerald-500', description: 'Created 5 movements' },
  'movement_creator_10': { name: 'Movement Leader', icon: '⭐', color: 'from-yellow-500 to-amber-500', description: 'Created 10 movements' },
  'collaborator': { name: 'Team Player', icon: '🤝', color: 'from-purple-500 to-pink-500', description: 'Invited 5 collaborators' },
  'influencer': { name: 'Influencer', icon: '💫', color: 'from-indigo-500 to-purple-500', description: '50+ followers' },
  'commentator': { name: 'Voice', icon: '💬', color: 'from-cyan-500 to-blue-500', description: '25+ comments' },
  'impact_maker': { name: 'Impact Maker', icon: '🎯', color: 'from-red-500 to-orange-500', description: 'Reached impact goals' },
  'streak_7': { name: 'Consistent', icon: '🔥', color: 'from-orange-500 to-red-500', description: '7-day streak' },
  'streak_30': { name: 'Dedicated', icon: '💎', color: 'from-pink-500 to-rose-500', description: '30-day streak' },
};

const LEVELS = [
  { level: 1, name: 'Activist', minPoints: 0, color: 'text-slate-600' },
  { level: 2, name: 'Organizer', minPoints: 100, color: 'text-green-600' },
  { level: 3, name: 'Leader', minPoints: 250, color: 'text-blue-600' },
  { level: 4, name: 'Champion', minPoints: 500, color: 'text-purple-600' },
  { level: 5, name: 'Legend', minPoints: 1000, color: 'text-yellow-600' },
];

export default function GamificationWidget({ userEmail, compact = false }) {
  return <GamificationWidgetInner userEmail={userEmail} compact={compact} />;

}

function GamificationWidgetProd({ compact = false }) {
  if (compact) return null;
  return (
    <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-700 font-semibold">
      Points and streaks are temporarily disabled while we add server persistence.
    </div>
  );
}

function GamificationWidgetDev({ userEmail, compact = false }) {
  const email = String(userEmail || '').trim().toLowerCase();
  const { data: stats, isLoading } = useQuery({
    queryKey: ['userChallengeStats', email],
    enabled: !!email,
    queryFn: async () => fetchOrCreateUserChallengeStats(email),
    retry: 1,
  });

  const totalPoints = Number(stats?.total_points || 0) || 0;

  const level = useMemo(() => {
    const sorted = [...LEVELS].sort((a, b) => a.minPoints - b.minPoints);
    let current = sorted[0];
    for (const l of sorted) {
      if (totalPoints >= l.minPoints) current = l;
    }
    return current;
  }, [totalPoints]);

  const nextLevel = useMemo(() => {
    const sorted = [...LEVELS].sort((a, b) => a.minPoints - b.minPoints);
    const idx = sorted.findIndex((l) => l.level === level.level);
    return idx >= 0 ? sorted[idx + 1] || null : null;
  }, [level]);

  const progressPct = useMemo(() => {
    if (!nextLevel) return 100;
    const start = Number(level.minPoints) || 0;
    const end = Number(nextLevel.minPoints) || start;
    if (end <= start) return 0;
    const p = ((totalPoints - start) / (end - start)) * 100;
    return Math.max(0, Math.min(100, p));
  }, [level, nextLevel, totalPoints]);

  const effectiveCurrentStreak = useMemo(() => {
    const last = stats?.last_completion_date ? String(stats.last_completion_date) : null;
    if (!last) return 0;
    const today = new Date().toISOString().slice(0, 10);
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    const yesterday = d.toISOString().slice(0, 10);
    if (last === today || last === yesterday) return Number(stats?.current_streak || 0) || 0;
    return 0;
  }, [stats]);

  const earnedBadges = useMemo(() => {
    const ids = [];
    if (effectiveCurrentStreak >= 30) ids.push('streak_30');
    else if (effectiveCurrentStreak >= 7) ids.push('streak_7');

    return ids
      .map((id) => ({ id, ...(BADGES[id] || {}) }))
      .filter((b) => b && b.id && b.name);
  }, [effectiveCurrentStreak]);

  if (compact) {
    return (
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-[#FFC947]" fill="#FFC947" />
          <span className="font-black text-slate-900">{totalPoints}</span>
        </div>
        <div className={cn("font-black uppercase text-sm", level.color)}>
          {level.name}
        </div>
        {earnedBadges.length > 0 && (
          <div className="flex gap-1">
            {earnedBadges.slice(0, 3).map((badge) => (
              <span key={badge.id} className="text-lg" title={badge.name}>{badge.icon}</span>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (!email) {
    return (
      <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-600">
        Sign in to see your points and streak.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-600">
        Loading gamification…
      </div>
    );
  }

  return (
    <div className="bg-white rounded-3xl shadow-2xl border-3 border-slate-200 overflow-hidden">
      <div className="p-6 border-b-2 border-slate-200 bg-gradient-to-r from-slate-50 to-white">
        <div className="flex items-start justify-between gap-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#3A3DFF] to-[#5B5EFF] flex items-center justify-center">
              <Trophy className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-black text-slate-900">Progress</h2>
              <p className="text-slate-600 font-semibold text-sm">Points and streaks (non-financial).</p>
            </div>
          </div>

          <div className="text-right">
            <div className="text-2xl font-black text-[#FFC947]">{totalPoints}</div>
            <div className="text-xs text-slate-500 font-bold uppercase tracking-wide">Total points</div>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-6">
        <div className="p-5 rounded-2xl border-2 border-slate-200 bg-slate-50">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">Level</div>
              <div className={cn("text-xl font-black", level.color)}>{level.name}</div>
              {nextLevel ? (
                <div className="text-xs text-slate-500 font-semibold mt-1">
                  {Math.max(0, Number(nextLevel.minPoints || 0) - totalPoints)} points to {nextLevel.name}
                </div>
              ) : (
                <div className="text-xs text-slate-500 font-semibold mt-1">Top level reached</div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-[#FFC947]" fill="#FFC947" />
              <div className="text-right">
                <div className="text-sm font-black text-slate-900">{totalPoints} pts</div>
                <div className="text-xs text-slate-500 font-semibold">Lifetime</div>
              </div>
            </div>
          </div>

          <div className="mt-4 h-3 rounded-full bg-white border border-slate-200 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-[#3A3DFF] to-[#5B5EFF]"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="p-5 rounded-2xl border-2 border-slate-200 bg-white">
            <div className="flex items-center gap-2 text-slate-900">
              <TrendingUp className="w-5 h-5 text-slate-700" />
              <div className="font-black">Current streak</div>
            </div>
            <div className="mt-2 text-2xl font-black text-slate-900">{effectiveCurrentStreak}</div>
            <div className="text-xs font-semibold text-slate-500">days (active today or yesterday)</div>
          </div>

          <div className="p-5 rounded-2xl border-2 border-slate-200 bg-white">
            <div className="flex items-center gap-2 text-slate-900">
              <Award className="w-5 h-5 text-slate-700" />
              <div className="font-black">Longest streak</div>
            </div>
            <div className="mt-2 text-2xl font-black text-slate-900">{Number(stats?.longest_streak || 0) || 0}</div>
            <div className="text-xs font-semibold text-slate-500">days</div>
          </div>

          <div className="p-5 rounded-2xl border-2 border-slate-200 bg-white">
            <div className="flex items-center gap-2 text-slate-900">
              <Trophy className="w-5 h-5 text-slate-700" />
              <div className="font-black">Challenges</div>
            </div>
            <div className="mt-2 text-2xl font-black text-slate-900">{Number(stats?.total_challenges_completed || 0) || 0}</div>
            <div className="text-xs font-semibold text-slate-500">completed</div>
          </div>
        </div>

        <div className="p-5 rounded-2xl border-2 border-slate-200 bg-slate-50">
          <div className="font-black text-slate-900">Badges</div>
          {earnedBadges.length === 0 ? (
            <div className="text-sm text-slate-600 font-semibold mt-2">
              Earn streak badges by completing Daily Challenges.
            </div>
          ) : (
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
              {earnedBadges.map((b) => (
                <div key={b.id} className="p-4 rounded-2xl border-2 border-slate-200 bg-white flex items-start gap-3">
                  <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center bg-gradient-to-br text-white", b.color)}>
                    <span className="text-xl">{b.icon}</span>
                  </div>
                  <div className="min-w-0">
                    <div className="font-black text-slate-900">{b.name}</div>
                    <div className="text-xs font-semibold text-slate-600 mt-1">{b.description}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const GamificationWidgetInner = import.meta?.env?.DEV ? GamificationWidgetDev : GamificationWidgetProd;