import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { Zap } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import ChallengeFilters from '@/components/challenges/ChallengeFilters';
import ChallengeCard from '@/components/challenges/ChallengeCard';
import CompletionModal from '@/components/challenges/CompletionModal';
import StreakTracker from '@/components/challenges/StreakTracker';
import { fetchOrCreateUserChallengeStats, listChallengeCompletions, recordChallengeCompletion } from '@/api/userChallengeStatsClient';

const CHALLENGES = [
  {
    id: 'challenge-kindness-compliment',
    category: 'kindness',
    title: 'Give someone a genuine compliment',
    description: 'In-person or online. Keep it respectful and specific.',
    points: 10,
  },
  {
    id: 'challenge-community-reachout',
    category: 'community',
    title: 'Reach out to a local organizer',
    description: 'Ask how you can help or what they need right now.',
    points: 15,
  },
  {
    id: 'challenge-cleanup-small',
    category: 'cleanup',
    title: 'Do a 10-minute cleanup',
    description: 'Pick up litter or tidy a shared space.',
    points: 15,
  },
  {
    id: 'challenge-health-walk',
    category: 'health',
    title: 'Take a 20-minute walk',
    description: 'Bonus: invite someone to join you.',
    points: 10,
  },
  {
    id: 'challenge-creativity-poster',
    category: 'creativity',
    title: 'Create a simple awareness graphic',
    description: 'A quick poster, infographic, or shareable message.',
    points: 20,
  },

];

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function dateNDaysAgoKey(daysAgo) {
  const d = new Date(`${todayKey()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

function effectiveCurrentStreak(stats) {
  const last = stats?.last_completion_date ? String(stats.last_completion_date) : null;
  if (!last) return 0;
  const t = todayKey();
  const y = dateNDaysAgoKey(1);
  if (last === t || last === y) return Number(stats?.current_streak || 0) || 0;
  return 0;
}

export default function DailyChallenges() {
  const { user, loading } = useAuth();
  const queryClient = useQueryClient();
  const [activeFilter, setActiveFilter] = useState('today');
  const [selectedChallenge, setSelectedChallenge] = useState(null);

  const email = user?.email || null;

  const {
    data: userStats,
    isError: userStatsError,
    error: userStatsErrorObj,
    refetch: refetchUserStats,
  } = useQuery({
    queryKey: ['userChallengeStats', email],
    enabled: !!email,
    queryFn: async () => fetchOrCreateUserChallengeStats(email),
    retry: 1,
  });

  const {
    data: allCompletions = [],
    isError: allCompletionsError,
    error: allCompletionsErrorObj,
    refetch: refetchAllCompletions,
  } = useQuery({
    queryKey: ['challengeCompletions', 'all'],
    queryFn: async () => listChallengeCompletions(),
    retry: 1,
  });

  const {
    data: myCompletions = [],
    isError: myCompletionsError,
    error: myCompletionsErrorObj,
    refetch: refetchMyCompletions,
  } = useQuery({
    queryKey: ['challengeCompletions', email],
    enabled: !!email,
    queryFn: async () => listChallengeCompletions({ userEmail: email }),
    retry: 1,
  });

  const anyLoadError = userStatsError || allCompletionsError || myCompletionsError;

  useEffect(() => {
    if (userStatsErrorObj) console.warn('[DailyChallenges] failed to load user stats', userStatsErrorObj);
  }, [userStatsErrorObj]);

  useEffect(() => {
    if (allCompletionsErrorObj) console.warn('[DailyChallenges] failed to load community completions', allCompletionsErrorObj);
  }, [allCompletionsErrorObj]);

  useEffect(() => {
    if (myCompletionsErrorObj) console.warn('[DailyChallenges] failed to load my completions', myCompletionsErrorObj);
  }, [myCompletionsErrorObj]);

  const completionsToday = useMemo(() => {
    const t = todayKey();
    return myCompletions.filter((c) => c?.date === t);
  }, [myCompletions]);

  const isCompleted = (challengeId) => {
    const t = todayKey();
    return myCompletions.some((c) => c?.challenge_id === challengeId && c?.date === t);
  };

  const getUserCompletion = (challengeId) => {
    const t = todayKey();
    return myCompletions.find((c) => c?.challenge_id === challengeId && c?.date === t) || null;
  };

  const communityCountsToday = useMemo(() => {
    const t = todayKey();
    const counts = new Map();
    for (const c of allCompletions) {
      if (!c || c.date !== t) continue;
      const id = c.challenge_id;
      if (!id) continue;
      counts.set(id, (counts.get(id) || 0) + 1);
    }
    return counts;
  }, [allCompletions]);

  const communityCountsWeek = useMemo(() => {
    const earliest = dateNDaysAgoKey(6);
    const counts = new Map();
    for (const c of allCompletions) {
      if (!c || !c.date) continue;
      if (String(c.date) < earliest) continue;
      const id = c.challenge_id;
      if (!id) continue;
      counts.set(id, (counts.get(id) || 0) + 1);
    }
    return counts;
  }, [allCompletions]);

  const filteredChallenges = useMemo(() => {
    if (activeFilter === 'mine') {
      const ids = new Set(myCompletions.map((c) => c?.challenge_id).filter(Boolean));
      return CHALLENGES.filter((c) => ids.has(c.id));
    }

    if (activeFilter === 'popular') {
      const list = [...CHALLENGES];
      list.sort((a, b) => (communityCountsWeek.get(b.id) || 0) - (communityCountsWeek.get(a.id) || 0));
      return list;
    }

    // today/week both show the same challenge set; counts/stats differ.
    return CHALLENGES;
  }, [activeFilter, myCompletions, communityCountsWeek]);

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto py-16">
        <div className="bg-white rounded-3xl shadow-2xl border-3 border-slate-200 p-10 text-center">
          <div className="text-slate-600 font-semibold">Loading...</div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="max-w-4xl mx-auto py-16">
        <div className="bg-white rounded-3xl shadow-2xl border-3 border-slate-200 p-10 text-center space-y-3">
          <h1 className="text-3xl font-black text-slate-900">Daily Challenges</h1>
          <p className="text-slate-600 font-semibold">Sign in to track your completions and streak.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div className="bg-white rounded-3xl shadow-2xl border-3 border-slate-200 overflow-hidden">
        <div className="p-8 border-b border-slate-200">
          <div className="flex items-start justify-between gap-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#3A3DFF] to-[#5B5EFF] flex items-center justify-center">
                <Zap className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-3xl font-black text-slate-900">Daily Challenges</h1>
                <p className="text-slate-600 font-semibold">
                  Optional, positive actions — track streaks and earn expression-only points.
                </p>
              </div>
            </div>

            <div className="text-right">
              <div className="text-2xl font-black text-[#FFC947]">{userStats?.total_points || 0}</div>
              <div className="text-xs text-slate-500 font-bold uppercase tracking-wide">Total points</div>
              <div className="text-xs text-slate-500 font-semibold mt-2">
                Today: {completionsToday.length} completed
              </div>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {anyLoadError && (
            <div className="p-6 rounded-2xl border-2 border-slate-200 bg-slate-50 text-slate-700 space-y-3">
              <div className="font-black">We couldn’t load challenges right now.</div>
              <div className="text-sm font-semibold">Please try again.</div>
              <button
                type="button"
                onClick={() => {
                  refetchUserStats();
                  refetchAllCompletions();
                  refetchMyCompletions();
                }}
                className="inline-flex items-center justify-center px-6 py-3 rounded-2xl bg-[#3A3DFF] text-white font-bold shadow-md hover:opacity-90 transition"
              >
                Retry
              </button>
            </div>
          )}

          <StreakTracker
            currentStreak={effectiveCurrentStreak(userStats)}
            longestStreak={Number(userStats?.longest_streak || 0) || 0}
            lastCompletionDate={userStats?.last_completion_date || null}
          />

          <ChallengeFilters activeFilter={activeFilter} onFilterChange={setActiveFilter} />

          <div className="grid grid-cols-1 gap-6">
            {filteredChallenges.map((challenge) => (
              <ChallengeCard
                key={challenge.id}
                challenge={{
                  ...challenge,
                  completions_today: communityCountsToday.get(challenge.id) || 0,
                }}
                onComplete={(c) => {
                  if (isCompleted(c.id)) return;
                  setSelectedChallenge(c);
                }}
                isCompleted={isCompleted(challenge.id)}
                userCompletion={getUserCompletion(challenge.id)}
              />
            ))}
          </div>

          {activeFilter === 'mine' && filteredChallenges.length === 0 && (
            <div className="p-6 rounded-2xl border-2 border-slate-200 bg-slate-50 text-slate-700 font-semibold">
              No completions yet — complete a challenge to see it here.
            </div>
          )}
        </div>
      </div>

      {selectedChallenge && (
        <CompletionModal
          challenge={selectedChallenge}
          onClose={() => setSelectedChallenge(null)}
          onComplete={async (payload) => {
            try {
              await recordChallengeCompletion(email, selectedChallenge, payload);
              await queryClient.invalidateQueries({ queryKey: ['challengeCompletions'] });
              await queryClient.invalidateQueries({ queryKey: ['userChallengeStats'] });
              toast.success('Challenge completed');
            } catch (e) {
              toast.error(String(e?.message || 'Failed to complete'));
            } finally {
              setSelectedChallenge(null);
            }
          }}
        />
      )}

    </div>
  );
}
