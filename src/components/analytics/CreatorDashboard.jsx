import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'framer-motion';
import { TrendingUp, Users, Zap, Calendar, FileSignature, Sparkles, Loader2, Eye, ArrowRight, FlaskConical } from 'lucide-react';
import { LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { format, subDays, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import { entities, integrations } from '@/api/appClient';
import { useResearchFlagsForMovement } from '@/utils/researchFlags';
import {
  cacheAIResult,
  getCachedAIResult,
  hasExceededAILimit,
  incrementAICounter,
  hashPayload,
} from '@/utils/aiGuardrail';
import { listMovementEventsPage } from '@/api/eventsClient';
import { listMovementPetitionsPage } from '@/api/petitionsClient';
import { fetchEventRsvpSummary } from '@/api/eventRsvpsClient';
import { fetchPetitionSignatureSummary } from '@/api/petitionSignaturesClient';

const COLORS = ['#3A3DFF', '#5B5EFF', '#FFC947', '#FFD666'];

export default function CreatorDashboard({ movement, isOwner, userProfile }) {
  const reduceMotion = useReducedMotion();
  const [timeRange, setTimeRange] = useState('30'); // days
  const [aiInsights, setAiInsights] = useState(null);
  const [loadingInsights, setLoadingInsights] = useState(false);
  const [aiLimitNotice, setAiLimitNotice] = useState('');

  const movementId = useMemo(() => String(movement?.id || ''), [movement]);
  const { data: researchFlags = { enabled: false, features: [] } } = useResearchFlagsForMovement(movementId);

  // Fetch analytics data
  const {
    data: analyticsData = [],
    isLoading: analyticsLoading,
    isError: analyticsError,
    error: analyticsErrorObj,
    refetch: refetchAnalytics,
  } = useQuery({
    queryKey: ['movementAnalytics', movementId, timeRange],
    enabled: !!movementId,
    queryFn: async () => {
      const endDate = new Date();
      const startDate = subDays(endDate, parseInt(timeRange));
      
      const analytics = await entities.MovementAnalytics.filter({
        movement_id: movementId
      }, '-date', 100);

      return analytics.filter(a => {
        const date = parseISO(a.date);
        return date >= startDate && date <= endDate;
      });
    },
    staleTime: 5 * 60 * 1000
  });

  // Fetch related data
  const {
    data: events = [],
    isError: eventsError,
    error: eventsErrorObj,
    refetch: refetchEvents,
  } = useQuery({
    queryKey: ['events', movementId],
    enabled: !!movementId,
    queryFn: () => listMovementEventsPage(movementId, { limit: 200, offset: 0, fields: 'id' }),
    staleTime: 5 * 60 * 1000
  });

  const {
    data: rsvps = [],
    isError: rsvpsError,
    error: rsvpsErrorObj,
    refetch: refetchRsvps,
  } = useQuery({
    queryKey: ['eventRsvps', 'movement', movementId],
    queryFn: async () => {
      const eventIds = events.map(e => e.id);
      if (eventIds.length === 0) return [];

      const allSummaries = await Promise.all(
        eventIds.map(async (id) => {
          const data = await fetchEventRsvpSummary(id);
          const summary = data?.summary || { going_count: 0, interested_count: 0, attended_count: 0 };
          return { event_id: String(id), ...summary };
        })
      );
      return allSummaries;
    },
    enabled: !!movementId && events.length > 0,
    staleTime: 5 * 60 * 1000
  });

  const {
    data: petitions = [],
    isError: petitionsError,
    error: petitionsErrorObj,
    refetch: refetchPetitions,
  } = useQuery({
    queryKey: ['petitions', movementId],
    enabled: !!movementId,
    queryFn: () => listMovementPetitionsPage(movementId, { limit: 200, offset: 0, fields: 'id' }),
    staleTime: 5 * 60 * 1000
  });

  const {
    data: signatures = [],
    isError: signaturesError,
    error: signaturesErrorObj,
    refetch: refetchSignatures,
  } = useQuery({
    queryKey: ['petitionSignatures', 'movement', movementId],
    queryFn: async () => {
      const petitionIds = petitions.map(p => p.id);
      if (petitionIds.length === 0) return [];

      const allSummaries = await Promise.all(
        petitionIds.map(async (id) => {
          const data = await fetchPetitionSignatureSummary(id);
          const summary = data?.summary || { count: 0, velocity_7d: 0, velocity_24h: 0 };
          return { petition_id: String(id), ...summary };
        })
      );
      return allSummaries;
    },
    enabled: !!movementId && petitions.length > 0,
    staleTime: 5 * 60 * 1000
  });

  const anyError = analyticsError || eventsError || petitionsError || rsvpsError || signaturesError;

  useEffect(() => {
    if (analyticsErrorObj) console.warn('[CreatorDashboard] analytics load failed', analyticsErrorObj);
  }, [analyticsErrorObj]);
  useEffect(() => {
    if (eventsErrorObj) console.warn('[CreatorDashboard] events load failed', eventsErrorObj);
  }, [eventsErrorObj]);
  useEffect(() => {
    if (petitionsErrorObj) console.warn('[CreatorDashboard] petitions load failed', petitionsErrorObj);
  }, [petitionsErrorObj]);
  useEffect(() => {
    if (rsvpsErrorObj) console.warn('[CreatorDashboard] rsvps load failed', rsvpsErrorObj);
  }, [rsvpsErrorObj]);
  useEffect(() => {
    if (signaturesErrorObj) console.warn('[CreatorDashboard] signatures load failed', signaturesErrorObj);
  }, [signaturesErrorObj]);

  // Calculate metrics
  const currentData = analyticsData[analyticsData.length - 1] || {};
  const previousData = analyticsData[analyticsData.length - 8] || {};

  const growthMetrics = {
    followers: {
      current: currentData.followers || movement.supporters || 0,
      change: ((currentData.followers || 0) - (previousData.followers || 0))
    },
    boosts: {
      current: currentData.boosts || movement.boosts || 0,
      change: ((currentData.boosts || 0) - (previousData.boosts || 0))
    },
    participants: {
      current: currentData.participants || movement.verified_participants || 0,
      change: ((currentData.participants || 0) - (previousData.participants || 0))
    },
    momentum: {
      current: currentData.momentum_score || movement.momentum_score || 0,
      change: ((currentData.momentum_score || 0) - (previousData.momentum_score || 0))
    }
  };

  // Conversion funnel
  const totalViews = analyticsData.reduce((sum, d) => sum + (d.views || 0), 0);
  const totalSupporters = currentData.supporters || 0;
  const totalParticipants = currentData.participants || 0;

  const conversionData = [
    { name: 'Views', value: totalViews, percentage: 100 },
    { name: 'Supporters', value: totalSupporters, percentage: totalViews > 0 ? ((totalSupporters / totalViews) * 100).toFixed(1) : 0 },
    { name: 'Participants', value: totalParticipants, percentage: totalSupporters > 0 ? ((totalParticipants / totalSupporters) * 100).toFixed(1) : 0 }
  ];

  // Local vs Global
  const localEngagement = analyticsData.reduce((sum, d) => sum + (d.local_engagement || 0), 0);
  const globalEngagement = analyticsData.reduce((sum, d) => sum + (d.global_engagement || 0), 0);
  const engagementSplit = [
    { name: 'Local', value: localEngagement },
    { name: 'Global', value: globalEngagement }
  ];

  // Event attendance
  const attendanceRate = (() => {
    if (!Array.isArray(rsvps) || rsvps.length === 0) return 0;
    const going = rsvps.reduce((sum, r) => sum + (typeof r?.going_count === 'number' ? r.going_count : 0), 0);
    const interested = rsvps.reduce(
      (sum, r) => sum + (typeof r?.interested_count === 'number' ? r.interested_count : 0),
      0
    );
    const total = going + interested;
    if (total <= 0) return 0;
    return Number(((going / total) * 100).toFixed(1));
  })();

  // Petition velocity (signatures per day)
  const petitionVelocity = (() => {
    if (!Array.isArray(signatures) || signatures.length === 0) return 0;
    const total = signatures.reduce((sum, s) => sum + (typeof s?.count === 'number' ? s.count : 0), 0);
    return Number((total / Math.max(1, parseInt(timeRange))).toFixed(1));
  })();

  // Generate AI insights
  const generateInsights = async () => {
    if (!userProfile?.ai_features_enabled) return;

    setAiLimitNotice('');
    if (hasExceededAILimit()) {
      setAiLimitNotice('AI usage limit reached for this session.');
      return;
    }
    
    setLoadingInsights(true);
    try {
      const payloadHash = hashPayload({
        movementId: movement?.id ?? movement?._id ?? null,
        title: movement?.title ?? null,
        timeRange,
        growthMetrics,
        conversionData,
        localEngagement,
        globalEngagement,
        eventsCount: Array.isArray(events) ? events.length : 0,
        attendanceRate,
        petitionsCount: Array.isArray(petitions) ? petitions.length : 0,
        petitionVelocity,
      });

      const cached = getCachedAIResult('aiCreatorInsights', payloadHash);
      if (cached) {
        setAiInsights(cached);
        return;
      }

      incrementAICounter();
      const response = await integrations.Core.InvokeLLM({
        prompt: `Analyze this movement's performance data and provide actionable insights:

Movement: ${movement.title}
Time Range: ${timeRange} days

Growth Metrics:
- Followers: ${growthMetrics.followers.current} (${growthMetrics.followers.change >= 0 ? '+' : ''}${growthMetrics.followers.change})
- Boosts: ${growthMetrics.boosts.current} (${growthMetrics.boosts.change >= 0 ? '+' : ''}${growthMetrics.boosts.change})
- Participants: ${growthMetrics.participants.current} (${growthMetrics.participants.change >= 0 ? '+' : ''}${growthMetrics.participants.change})
- Momentum Score: ${growthMetrics.momentum.current} (${growthMetrics.momentum.change >= 0 ? '+' : ''}${growthMetrics.momentum.change})

Conversion:
- Views to Supporters: ${conversionData[1].percentage}%
- Supporters to Participants: ${conversionData[2].percentage}%

Engagement:
- Local: ${localEngagement} (${((localEngagement / (localEngagement + globalEngagement)) * 100).toFixed(0)}%)
- Global: ${globalEngagement} (${((globalEngagement / (localEngagement + globalEngagement)) * 100).toFixed(0)}%)

Events: ${events.length} total, ${attendanceRate}% attendance rate
Petitions: ${petitions.length} total, ${petitionVelocity} signatures/day

Provide:
1. What's Working (2-3 specific strengths)
2. What to Improve (2-3 actionable recommendations)
3. Next Best Action (1 concrete next step)`,
        response_json_schema: {
          type: "object",
          properties: {
            whats_working: {
              type: "array",
              items: { type: "string" }
            },
            what_to_improve: {
              type: "array",
              items: { type: "string" }
            },
            next_action: {
              type: "string"
            }
          }
        }
      });

      setAiInsights(response);
      cacheAIResult('aiCreatorInsights', payloadHash, response);
    } catch (error) {
      console.error('AI insights failed:', error);
    } finally {
      setLoadingInsights(false);
    }
  };

  if (!isOwner) {
    return (
      <div className="text-center py-12">
        <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <TrendingUp className="w-8 h-8 text-slate-400" />
        </div>
        <p className="text-slate-500 font-semibold">Analytics available to movement owners only</p>
      </div>
    );
  }

  if (analyticsLoading) {
    return (
      <div className="flex items-center gap-2 text-slate-600 font-semibold">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading analytics…
      </div>
    );
  }

  if (anyError) {
    return (
      <div className="bg-white rounded-2xl p-6 border-2 border-slate-200 shadow-sm space-y-3">
        <div className="font-black text-slate-900">We couldn’t load analytics right now.</div>
        <div className="text-sm text-slate-600 font-semibold">Please try again.</div>
        <button
          type="button"
          onClick={() => {
            refetchAnalytics();
            refetchEvents();
            refetchPetitions();
            refetchRsvps();
            refetchSignatures();
          }}
          className="inline-flex items-center justify-center px-4 py-2 rounded-xl bg-[#3A3DFF] text-white font-bold hover:opacity-90"
        >
          Retry
        </button>
      </div>
    );
  }


  return (
    <div className="space-y-6">
      {/* Experimental/Research Mode tag */}
      {researchFlags.enabled && (
        <div className="flex items-center gap-2 mb-4">
          <FlaskConical className="w-5 h-5 text-yellow-500" />
          <span className="text-xs font-bold text-yellow-700 uppercase tracking-wider">Experimental / Research Mode</span>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-black text-slate-900">Creator Analytics</h2>
          <p className="text-sm text-slate-600 font-semibold">Private insights for movement organizers</p>
        </div>
        <select
          value={timeRange}
          onChange={(e) => setTimeRange(e.target.value)}
          className="px-4 py-2 border-2 border-slate-200 rounded-xl font-bold text-sm"
        >
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
        </select>
      </div>

      {analyticsData.length === 0 && (
        <div className="bg-white rounded-2xl p-6 border-2 border-slate-200 shadow-sm">
          <div className="font-black text-slate-900">No analytics yet</div>
          <div className="text-sm text-slate-600 font-semibold mt-1">
            As people view, follow, RSVP, and sign, you’ll see trends here.
          </div>
        </div>
      )}

      {/* Growth Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Followers', ...growthMetrics.followers, icon: Users, color: 'from-blue-500 to-cyan-500' },
          { label: 'Boosts', ...growthMetrics.boosts, icon: Zap, color: 'from-yellow-500 to-orange-500' },
          { label: 'Participants', ...growthMetrics.participants, icon: Users, color: 'from-purple-500 to-pink-500' },
          { label: 'Momentum', ...growthMetrics.momentum, icon: TrendingUp, color: 'from-green-500 to-emerald-500' }
        ].map((metric, idx) => {
          const Icon = metric.icon;
          return (
            <motion.div
              key={metric.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={reduceMotion ? { duration: 0 } : { delay: idx * 0.1 }}
              className="bg-white rounded-2xl p-5 border-2 border-slate-200 shadow-sm"
            >
              <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center mb-3 bg-gradient-to-br", metric.color)}>
                <Icon className="w-5 h-5 text-white" />
              </div>
              <div className="text-3xl font-black text-slate-900 mb-1">{metric.current}</div>
              <div className="text-xs text-slate-500 font-bold mb-2">{metric.label}</div>
              <div className={cn("text-sm font-bold flex items-center gap-1", 
                metric.change >= 0 ? "text-green-600" : "text-red-600"
              )}>
                {metric.change >= 0 ? '+' : ''}{metric.change}
                <span className="text-xs">({timeRange}d)</span>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Growth Chart */}
      {analyticsData.length > 0 && (
        <div className="bg-white rounded-2xl p-6 border-2 border-slate-200 shadow-sm">
          <h3 className="text-lg font-black text-slate-900 mb-4">Growth Over Time</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={analyticsData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tickFormatter={(date) => format(parseISO(date), 'MMM d')} />
              <YAxis />
              <Tooltip labelFormatter={(date) => format(parseISO(date), 'MMM d, yyyy')} />
              <Legend />
              <Line type="monotone" dataKey="followers" stroke="#3A3DFF" strokeWidth={2} isAnimationActive={!reduceMotion} />
              <Line type="monotone" dataKey="boosts" stroke="#FFC947" strokeWidth={2} isAnimationActive={!reduceMotion} />
              <Line type="monotone" dataKey="participants" stroke="#8B5CF6" strokeWidth={2} isAnimationActive={!reduceMotion} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Conversion Funnel */}
      <div className="bg-white rounded-2xl p-6 border-2 border-slate-200 shadow-sm">
        <h3 className="text-lg font-black text-slate-900 mb-4">Conversion Funnel</h3>
        <div className="space-y-3">
          {conversionData.map((stage, idx) => (
            <div key={stage.name} className="relative">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-bold text-slate-700">{stage.name}</span>
                <span className="text-sm font-black text-slate-900">{stage.value.toLocaleString()} ({stage.percentage}%)</span>
              </div>
              <div className="h-8 bg-slate-100 rounded-lg overflow-hidden">
                <motion.div
                  initial={{ width: reduceMotion ? `${stage.percentage}%` : 0 }}
                  animate={{ width: `${stage.percentage}%` }}
                  transition={{ delay: reduceMotion ? 0 : idx * 0.2, duration: reduceMotion ? 0 : 0.5 }}
                  className={cn("h-full flex items-center justify-end pr-3 text-xs font-bold text-white",
                    idx === 0 ? "bg-blue-500" : idx === 1 ? "bg-purple-500" : "bg-green-500"
                  )}
                />
              </div>
              {idx < conversionData.length - 1 && (
                <ArrowRight className="w-5 h-5 text-slate-300 absolute -bottom-5 left-1/2 -translate-x-1/2" />
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Local vs Global */}
        {(localEngagement + globalEngagement) > 0 && (
          <div className="bg-white rounded-2xl p-6 border-2 border-slate-200 shadow-sm">
            <h3 className="text-lg font-black text-slate-900 mb-4">Engagement Split</h3>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={engagementSplit}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={(entry) => `${entry.name}: ${entry.value}`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                  isAnimationActive={!reduceMotion}
                >
                  {engagementSplit.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Quick Stats */}
        <div className="bg-white rounded-2xl p-6 border-2 border-slate-200 shadow-sm space-y-4">
          <h3 className="text-lg font-black text-slate-900 mb-4">Quick Stats</h3>
          
          {events.length > 0 && (
            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
              <div className="flex items-center gap-3">
                <Calendar className="w-5 h-5 text-[#3A3DFF]" />
                <span className="text-sm font-bold text-slate-700">Event Attendance</span>
              </div>
              <span className="text-lg font-black text-slate-900">{attendanceRate}%</span>
            </div>
          )}

          {petitions.length > 0 && (
            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
              <div className="flex items-center gap-3">
                <FileSignature className="w-5 h-5 text-[#3A3DFF]" />
                <span className="text-sm font-bold text-slate-700">Signature Velocity</span>
              </div>
              <span className="text-lg font-black text-slate-900">{petitionVelocity}/day</span>
            </div>
          )}

          <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
            <div className="flex items-center gap-3">
              <Eye className="w-5 h-5 text-[#3A3DFF]" />
              <span className="text-sm font-bold text-slate-700">Total Views</span>
            </div>
            <span className="text-lg font-black text-slate-900">{totalViews.toLocaleString()}</span>
          </div>
        </div>
      </div>

      {/* Experimental AI analytics (example) */}
      {researchFlags.features.includes('exp_ai_impact_v2') && (
        <div className="bg-gradient-to-br from-indigo-50 to-purple-50 rounded-2xl p-6 border-3 border-yellow-300 mb-6">
          <div className="flex items-center gap-3 mb-2">
            <FlaskConical className="w-6 h-6 text-yellow-500" />
            <h3 className="text-lg font-black text-yellow-900">Experimental: AI Impact Insights v2</h3>
          </div>
          <div className="text-xs font-semibold text-yellow-700 mb-2">This block is for research only. Results are not used for production decisions.</div>
          {/* ...insert experimental AI analytics block here... */}
          <div className="italic text-slate-600">[Experimental AI analytics would render here]</div>
        </div>
      )}

      {/* CreatorDashboard v2 (experimental layout) */}
      {researchFlags.features.includes('exp_creator_dashboard_v2') && (
        <div className="bg-gradient-to-br from-yellow-50 to-orange-50 rounded-2xl p-6 border-3 border-yellow-400 mb-6">
          <div className="flex items-center gap-3 mb-2">
            <FlaskConical className="w-6 h-6 text-yellow-500" />
            <h3 className="text-lg font-black text-yellow-900">Experimental: Creator Dashboard v2</h3>
          </div>
          <div className="text-xs font-semibold text-yellow-700 mb-2">This is a research-only layout. No irreversible changes allowed.</div>
          <div className="italic text-slate-600">[Experimental CreatorDashboard v2 would render here]</div>
        </div>
      )}

      {/* Existing AI Insights (only if not in research mode) */}
      {!researchFlags.enabled && userProfile?.ai_features_enabled && (
        <div className="bg-gradient-to-br from-indigo-50 to-purple-50 rounded-2xl p-6 border-3 border-indigo-200">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <Sparkles className="w-6 h-6 text-[#3A3DFF]" />
              <h3 className="text-lg font-black text-slate-900">AI-Generated Insights</h3>
            </div>
            {!aiInsights && (
              <button
                onClick={generateInsights}
                disabled={loadingInsights || hasExceededAILimit()}
                className="px-4 py-2 bg-[#3A3DFF] hover:bg-[#2A2DDD] text-white rounded-xl font-bold text-sm disabled:opacity-50"
              >
                {loadingInsights ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Generate Insights'}
              </button>
            )}
          </div>

          <div className="text-xs font-semibold text-slate-600">
            AI-generated — may be incomplete or inaccurate
          </div>
          {aiLimitNotice ? (
            <div className="text-xs font-semibold text-slate-600 mt-2">{aiLimitNotice}</div>
          ) : null}

          {aiInsights && (
            <div className="space-y-4">
              <div className="bg-white rounded-xl p-4 border-2 border-green-200">
                <h4 className="font-black text-green-900 mb-2 flex items-center gap-2">
                  ✅ What&apos;s Working
                </h4>
                <ul className="space-y-2">
                  {(Array.isArray(aiInsights?.whats_working) ? aiInsights.whats_working : []).map((item, idx) => (
                    <li key={idx} className="text-sm text-green-800 font-semibold">• {item}</li>
                  ))}
                </ul>
              </div>

              <div className="bg-white rounded-xl p-4 border-2 border-amber-200">
                <h4 className="font-black text-amber-900 mb-2 flex items-center gap-2">
                  💡 What to Improve
                </h4>
                <ul className="space-y-2">
                  {(Array.isArray(aiInsights?.what_to_improve) ? aiInsights.what_to_improve : []).map((item, idx) => (
                    <li key={idx} className="text-sm text-amber-800 font-semibold">• {item}</li>
                  ))}
                </ul>
              </div>

              <div className="bg-white rounded-xl p-4 border-2 border-indigo-200">
                <h4 className="font-black text-indigo-900 mb-2 flex items-center gap-2">
                  🎯 Next Best Action
                </h4>
                <p className="text-sm text-indigo-800 font-semibold">{String(aiInsights?.next_action || '')}</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
