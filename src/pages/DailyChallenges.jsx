import React, { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { Zap } from 'lucide-react';
import { toast } from 'sonner';
import { toastFriendlyError } from '@/utils/toastErrors';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import ChallengeFilters from '@/components/challenges/ChallengeFilters';
import ChallengeCard from '@/components/challenges/ChallengeCard';
import CompletionModal from '@/components/challenges/CompletionModal';
import StreakTracker from '@/components/challenges/StreakTracker';
import { fetchOrCreateUserChallengeStats, listChallengeCompletions, recordChallengeCompletion } from '@/api/userChallengeStatsClient';
import { logError } from '@/utils/logError';
import { dailyChallengeDefaults } from '@/data/dailyChallengeDefaults';
import { getAwTimeKey, getAwTimeKeyNDaysAgo } from '@/utils/awTime';
import { useFeatureFlag } from '@/utils/featureFlags';
import { fetchChallenges } from '@/api/challengesClient';
import BackButton from '@/components/shared/BackButton';

function normalizeChallenge(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = raw.id ?? raw._id ?? raw.challenge_id;
  const title = raw.title ?? raw.name;
  if (!id || !title) return null;
  return {
    id: String(id),
    category: raw.category ? String(raw.category) : 'community',
    title: String(title),
    description: raw.description ? String(raw.description) : '',
    points: Number(raw.points ?? raw.point_value ?? 10) || 10,
    start_date: raw.start_date ? String(raw.start_date) : null,
    end_date: raw.end_date ? String(raw.end_date) : null,
    status: raw.status ? String(raw.status) : 'active',
  };
}

function todayKey() {
  return getAwTimeKey();
}

function dateNDaysAgoKey(daysAgo) {
  return getAwTimeKeyNDaysAgo(daysAgo);
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
  const location = useLocation();
  const showBackButton = location.key !== 'default' || !!location.state?.fromLabel || !!location.state?.fromPath;

  const email = user?.email || null;
  const userId = user?.id || user?.email || null;
  const { enabled: dailyChallengesEnabled, loading: dailyChallengesLoading } = useFeatureFlag('daily_challenges', userId, {
    defaultEnabled: true,
    enableWhileLoading: true,
  });

  const {
    data: userStats,
    isError: userStatsError,
    error: userStatsErrorObj,
    refetch: refetchUserStats,
  } = useQuery({
    queryKey: ['userChallengeStats', email],
    enabled: dailyChallengesEnabled && !!email,
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
    enabled: dailyChallengesEnabled,
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
    enabled: dailyChallengesEnabled && !!email,
    queryFn: async () => listChallengeCompletions({ userEmail: email }),
    retry: 1,
  });

  const {
    data: challengeRecords = [],
    error: challengesErrorObj,
  } = useQuery({
    queryKey: ['challenges', 'daily'],
    enabled: dailyChallengesEnabled,
    queryFn: async () => {
      try {
        const list = await fetchChallenges();
        return Array.isArray(list) ? list : [];
      } catch (_err) {
        void _err;
        return [];
      }
    },
    retry: 1,
  });

  const anyLoadError = userStatsError || allCompletionsError || myCompletionsError;

  useEffect(() => {
    if (userStatsErrorObj) logError(userStatsErrorObj, 'Daily challenges user stats load failed');
  }, [userStatsErrorObj]);

  useEffect(() => {
    if (allCompletionsErrorObj) logError(allCompletionsErrorObj, 'Daily challenges community completions load failed');
  }, [allCompletionsErrorObj]);

  useEffect(() => {
    if (myCompletionsErrorObj) logError(myCompletionsErrorObj, 'Daily challenges user completions load failed');
  }, [myCompletionsErrorObj]);

  useEffect(() => {
    if (challengesErrorObj) logError(challengesErrorObj, 'Daily challenges load failed');
  }, [challengesErrorObj]);

  const { challengeList, usingFallback } = useMemo(() => {
    const fromDb = Array.isArray(challengeRecords)
      ? challengeRecords.map(normalizeChallenge).filter(Boolean)
      : [];
    if (fromDb.length) return { challengeList: fromDb, usingFallback: false };
    return { challengeList: dailyChallengeDefaults, usingFallback: true };
  }, [challengeRecords]);

  const activeChallenges = useMemo(() => {
    const today = todayKey();
    return challengeList.filter((c) => {
      if (String(c?.status || 'active') === 'archived') return false;
      const start = c?.start_date ? String(c.start_date) : null;
      const end = c?.end_date ? String(c.end_date) : null;
      if (start && start > today) return false;
      if (end && end < today) return false;
      return true;
    });
  }, [challengeList]);

  // NOTE: Daily Challenges reset at midnight Australian Western Time (UTC+8).
  const dailyRotation = useMemo(() => {
    const today = todayKey();
    const list = activeChallenges.length ? activeChallenges : challengeList;
    if (!list.length) return [];

    const scheduled = list.filter((c) => {
      const start = c?.start_date ? String(c.start_date) : null;
      const end = c?.end_date ? String(c.end_date) : null;
      if (!start && !end) return false;
      if (start && start > today) return false;
      if (end && end < today) return false;
      return true;
    });

    if (scheduled.length) return scheduled;

    let hash = 0;
    for (let i = 0; i < today.length; i += 1) {
      hash = (hash * 31 + today.charCodeAt(i)) % list.length;
    }
    return [list[hash]];
  }, [activeChallenges, challengeList]);

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
      return challengeList.filter((c) => ids.has(c.id));
    }

    if (activeFilter === 'popular') {
      const list = [...challengeList];
      list.sort((a, b) => (communityCountsWeek.get(b.id) || 0) - (communityCountsWeek.get(a.id) || 0));
      return list;
    }

    if (activeFilter === 'today') {
      return dailyRotation;
    }

    // week shows the active set; counts/stats differ.
    return activeChallenges.length ? activeChallenges : challengeList;
  }, [activeFilter, myCompletions, communityCountsWeek, challengeList, activeChallenges, dailyRotation]);

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto py-16">
        <div className="bg-white rounded-3xl shadow-2xl border-3 border-slate-200 p-10 text-center">
          <div className="text-slate-600 font-semibold">Loading...</div>
        </div>
      </div>
    );
  }

  if (dailyChallengesLoading) {
    return (
      <div className="max-w-4xl mx-auto py-16">
        <div className="bg-white rounded-3xl shadow-2xl border-3 border-slate-200 p-10 text-center">
          <div className="text-slate-600 font-semibold">Loading challenges…</div>
        </div>
      </div>
    );
  }

  if (!dailyChallengesEnabled) {
    return (
      <div className="max-w-4xl mx-auto py-16">
        <div className="bg-white rounded-3xl shadow-2xl border-3 border-slate-200 p-10 text-center space-y-3">
          <h1 className="text-3xl font-black text-slate-900">Daily Challenges</h1>
          <p className="text-slate-600 font-semibold">Daily Challenges are currently disabled.</p>
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
      {showBackButton ? <BackButton /> : null}
      <div className="bg-white rounded-3xl shadow-2xl border-3 border-slate-200 overflow-hidden">
        <div className="p-6 sm:p-8 border-b border-slate-200">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#3A3DFF] to-[#5B5EFF] flex items-center justify-center">
                <Zap className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl sm:text-3xl font-black text-slate-900">Daily Challenges</h1>
                <p className="text-slate-600 font-semibold">
                  Optional, positive actions — track streaks and earn expression-only points.
                </p>
              </div>
            </div>

            <div className="text-left sm:text-right">
              <div className="text-2xl font-black text-[#FFC947]">{userStats?.total_points || 0}</div>
              <div className="text-xs text-slate-500 font-bold uppercase tracking-wide">Total points</div>
              <div className="text-xs text-slate-500 font-semibold mt-2">
                Today: {completionsToday.length} completed
              </div>
            </div>
          </div>
        </div>

        <div className="p-4 sm:p-6 space-y-6">
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

          {usingFallback && (
            <div className="text-xs text-slate-500 font-semibold">
              You’re seeing default challenges. These may be updated over time.
            </div>
          )}

          <StreakTracker
            currentStreak={effectiveCurrentStreak(userStats)}
            longestStreak={Number(userStats?.longest_streak || 0) || 0}
            lastCompletionDate={userStats?.last_completion_date || null}
          />

          <ChallengeFilters activeFilter={activeFilter} onFilterChange={setActiveFilter} />

          {filteredChallenges.length === 0 ? (
            <div className="p-6 rounded-2xl border-2 border-slate-200 bg-slate-50 text-slate-700 font-semibold">
              No challenges available right now. Check back soon.
            </div>
          ) : (
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
          )}

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
              toastFriendlyError(e, 'Failed to complete');
            } finally {
              setSelectedChallenge(null);
            }
          }}
        />
      )}

    </div>
  );
}
