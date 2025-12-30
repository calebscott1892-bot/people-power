import React, { useState, useEffect, Suspense, useMemo } from 'react';
import { getCurrentBackendStatus, subscribeBackendStatus } from '../utils/backendStatus';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { entities } from '@/api/appClient';
import { useAuth } from '@/auth/AuthProvider';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { fetchMovementsPage } from '@/api/movementsClient';
import { Plus, Zap, Loader2, Sparkles } from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import FilterTabs from '../components/shared/FilterTabs';
import MovementCard from '../components/home/MovementCard';
import IntroScreen from '../components/home/IntroScreen';
import SafetyModal from '../components/safety/SafetyModal';
import OnboardingFlow from '../components/onboarding/OnboardingFlow';
import FeatureTooltip from '../components/onboarding/FeatureTooltip';
import { useLanguage } from '@/components/utils/LanguageContext';
import { useMomentumDampening } from '../components/moderation/useMomentumDampening';
import AgeVerification from '../components/safety/AgeVerification';
import { getAgeFromBirthdate, shouldRestrictContent, getContentRiskLevel } from '../components/safety/ContentAgeFilter';
import { applyDecentralizationBoost } from '@/components/governance/PowerConcentrationLimiter';
import NextBestActionPanel from '../components/home/NextBestActionPanel';
import {
  getMovementCoordinates,
  haversineDistanceKm,
  readPrivateUserCoordinates,
  sanitizePublicLocation,
  writePrivateUserCoordinates,
} from '@/utils/locationPrivacy';

const AISearch = React.lazy(() => import('../components/home/AISearch'));
const PersonalizedRecommendations = React.lazy(() => import('../components/home/PersonalizedRecommendations'));
const AITrendingSection = React.lazy(() => import('../components/home/AITrendingSection'));

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toTime(v) {
  try {
    const t = new Date(v).getTime();
    return Number.isFinite(t) ? t : 0;
  } catch {
    return 0;
  }
}

function movementCity(m) {
  const c = m?.city || m?.location_city || m?.location?.city || '';
  return String(c || '').trim().toLowerCase();
}

function movementAuthorEmail(m) {
  const v =
    m?.author_email ??
    m?.created_by_email ??
    m?.owner_email ??
    m?.creator_email ??
    m?.created_by ??
    null;
  return v ? String(v).trim().toLowerCase() : null;
}

export default function Home() {
  const [backendStatus, setBackendStatus] = useState(getCurrentBackendStatus());
  const [offlineMovements, setOfflineMovements] = useState(null);
  const [showOfflineLabel, setShowOfflineLabel] = useState(false);

  // Listen for backend status changes
  useEffect(() => {
    const unsub = subscribeBackendStatus(setBackendStatus);
    return () => unsub();
  }, []);
  const { t } = useLanguage();
  const { user: authUser, authLoading } = useAuth();
  const reduceMotion = useReducedMotion();
  const [user, setUser] = useState(null);
  const [activeFilter, setActiveFilter] = useState('momentum');
  const [showIntro, setShowIntro] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const [showSafetyModal, setShowSafetyModal] = useState(false);
  const [gateReady, setGateReady] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showSearchTooltip, setShowSearchTooltip] = useState(false);
  const [showCreateTooltip, setShowCreateTooltip] = useState(false);
  const [userProfile, setUserProfile] = useState(null);
  const [showAgeVerification, setShowAgeVerification] = useState(false);
  const [userAge, setUserAge] = useState(null);

  const readGateReady = () => {
    try {
      const introSeen = localStorage.getItem('peoplepower_intro_seen') === 'true';
      const safetyAccepted = localStorage.getItem('peoplepower_safety_accepted') === 'true';
      const termsAccepted = localStorage.getItem('peoplepower_terms_accepted') === 'true';
      const onboardingInProgress = localStorage.getItem('peoplepower_onboarding_in_progress') === 'true';
      return introSeen && safetyAccepted && termsAccepted && !onboardingInProgress;
    } catch {
      return false;
    }
  };

  const aiOptIn = useMemo(() => {
    if (!user) return false;
    if (userProfile && typeof userProfile === 'object' && 'ai_features_enabled' in userProfile) {
      return !!userProfile.ai_features_enabled;
    }
    try {
      return localStorage.getItem('peoplepower_ai_opt_in') === 'true';
    } catch {
      return false;
    }
  }, [user, userProfile]);

  useEffect(() => {
    const hasSeenIntro = localStorage.getItem('peoplepower_intro_seen');
    const hasAcceptedSafety = localStorage.getItem('peoplepower_safety_accepted');
    const hasAcceptedTerms = localStorage.getItem('peoplepower_terms_accepted');
    setGateReady(readGateReady());
    
    if (!hasSeenIntro) {
      setShowIntro(true);
    } else if (!hasAcceptedSafety || !hasAcceptedTerms) {
      setShowSafetyModal(true);
    }

    loadUser(authUser);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      if (showOnboarding) {
        localStorage.setItem('peoplepower_onboarding_in_progress', 'true');
      } else {
        localStorage.removeItem('peoplepower_onboarding_in_progress');
      }
      setGateReady(readGateReady());
    } catch {
      // ignore
    }
  }, [showOnboarding]);

  useEffect(() => {
    if (authLoading) return;
    loadUser(authUser);
  }, [authUser, authLoading]);

  const { data: onboarding } = useQuery({
    queryKey: ['onboarding', user?.email],
    queryFn: async () => {
      if (!user) return null;
      const records = await entities.UserOnboarding.filter({ user_email: user.email });
      if (records.length > 0) return records[0];

      // Create a stub onboarding record so completion can persist locally.
      return entities.UserOnboarding.create({
        user_email: user.email,
        completed: false,
        current_step: 0,
        interests: [],
        completed_tutorials: [],
      });
    },
    enabled: !!user
  });

  useEffect(() => {
    if (user && onboarding === null && !showIntro && !showSafetyModal) {
      setShowOnboarding(true);
    } else if (onboarding && !onboarding.completed && !showIntro && !showSafetyModal) {
      setShowOnboarding(true);
    } else if (onboarding && onboarding.completed && !onboarding.completed_tutorials?.includes('search')) {
      setTimeout(() => setShowSearchTooltip(true), 1000);
    }
  }, [user, onboarding, showIntro, showSafetyModal]);

  const loadUser = async (currentUser) => {
    if (!currentUser) {
      setUser(null);
      setUserProfile(null);
      return;
    }

    setUser(currentUser);

    const profiles = await entities.UserProfile.filter({ user_email: currentUser.email });
    if (profiles.length > 0) {
      const p = profiles[0];

      // Privacy hardening: migrate any stored coordinates out of the profile.
      const legacy = p?.location?.coordinates;
      const legacyLat = legacy && typeof legacy.lat === 'number' ? legacy.lat : null;
      const legacyLng = legacy && typeof legacy.lng === 'number' ? legacy.lng : null;
      const hasLegacyCoords = legacyLat != null && legacyLng != null;

      if (hasLegacyCoords) {
        writePrivateUserCoordinates(currentUser.email, { lat: legacyLat, lng: legacyLng });
        const sanitized = sanitizePublicLocation(p?.location);
        try {
          await entities.UserProfile.update(p.id, {
            location: sanitized,
          });
          const updated = await entities.UserProfile.filter({ user_email: currentUser.email });
          setUserProfile(updated.length > 0 ? updated[0] : { ...p, location: sanitized });
        } catch {
          setUserProfile({ ...p, location: sanitizePublicLocation(p?.location) });
        }
      } else {
        setUserProfile({ ...p, location: sanitizePublicLocation(p?.location) });
      }
      
      // Check age verification
      if (!p.age_verified || !p.birthdate) {
        setShowAgeVerification(true);
      } else {
        const age = getAgeFromBirthdate(p.birthdate);
        setUserAge(age);
      }
    }
  };

  const handleAgeVerification = async ({ birthdate, age }) => {
    if (userProfile) {
      await entities.UserProfile.update(userProfile.id, {
        birthdate,
        age_verified: true,
        safety_settings: {
          content_warnings_enabled: age < 18,
          restrict_sensitive_content: age < 18
        }
      });
      setUserAge(age);
      setShowAgeVerification(false);
      
      const updated = await entities.UserProfile.filter({ user_email: user.email });
      if (updated.length > 0) {
        setUserProfile(updated[0]);
      }
    }
  };

  const handleContinue = () => {
    setIsExiting(true);
    localStorage.setItem('peoplepower_intro_seen', 'true');
    setTimeout(() => {
      setShowIntro(false);
      // Show safety modal after intro
      const hasAcceptedSafety = localStorage.getItem('peoplepower_safety_accepted');
      const hasAcceptedTerms = localStorage.getItem('peoplepower_terms_accepted');
      if (!hasAcceptedSafety || !hasAcceptedTerms) {
        setShowSafetyModal(true);
      }
      setGateReady(readGateReady());
    }, 1200);
  };

  const handleSafetyAccept = () => {
    localStorage.setItem('peoplepower_safety_accepted', 'true');
    localStorage.setItem('peoplepower_terms_accepted', 'true');
    setShowSafetyModal(false);
    setGateReady(true);
  };

  const MOVEMENTS_PAGE_SIZE = 20;
  const MOVEMENT_FEED_FIELDS = [
    'id',
    'title',
    'summary',
    'tags',
    'author_email',
    'creator_email',
    'city',
    'region',
    'country',
    'location_city',
    'location_region',
    'location_country',
    'location_lat',
    'location_lon',
    'momentum_score',
    'upvotes',
    'downvotes',
    'score',
    'verified_participants',
    'unverified_participants',
    'supporters',
    'created_at',
    'updated_at',
    'created_date',
  ];

  const {
    data: movementsPages,
    isLoading: isLoadingMovements,
    isError: isMovementsError,
    refetch: refetchMovements,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['movements', 'feed'],
    queryFn: ({ pageParam = 0 }) =>
      fetchMovementsPage({
        limit: MOVEMENTS_PAGE_SIZE,
        offset: pageParam,
        fields: MOVEMENT_FEED_FIELDS,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const list = Array.isArray(lastPage) ? lastPage : [];
      if (list.length < MOVEMENTS_PAGE_SIZE) return undefined;
      return allPages.length * MOVEMENTS_PAGE_SIZE;
    },
  });

  // Cache movements to localStorage on successful fetch
  useEffect(() => {
    const pages = Array.isArray(movementsPages?.pages) ? movementsPages.pages : [];
    const all = pages.flatMap((p) => (Array.isArray(p) ? p : []));
    if (all.length > 0 && backendStatus === 'healthy') {
      try {
        const compact = all.map(({ id, title, summary, tags, author_email, city, country, momentum_score, upvotes, downvotes, score, created_at, updated_at }) => ({ id, title, summary, tags, author_email, city, country, momentum_score, upvotes, downvotes, score, created_at, updated_at }));
        localStorage.setItem('peoplepower_movements_cache', JSON.stringify({ ts: Date.now(), data: compact.slice(0, 50) }));
      } catch {}
    }
  }, [movementsPages, backendStatus]);

  // Load from cache if offline or fetch error
  useEffect(() => {
    if (backendStatus === 'offline' || isMovementsError) {
      try {
        const raw = localStorage.getItem('peoplepower_movements_cache');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && Array.isArray(parsed.data)) {
            setOfflineMovements(parsed.data);
            setShowOfflineLabel(true);
          }
        }
      } catch {}
    } else {
      setOfflineMovements(null);
      setShowOfflineLabel(false);
    }
  }, [backendStatus, isMovementsError]);

  const rawMovements = useMemo(() => {
    if (offlineMovements) return offlineMovements;
    const pages = Array.isArray(movementsPages?.pages) ? movementsPages.pages : [];
    return pages.flatMap((p) => (Array.isArray(p) ? p : []));
  }, [movementsPages, offlineMovements]);

  const { data: leadershipCounts = {} } = useQuery({
    queryKey: ['leadershipCounts', 'movement_creator'],
    staleTime: 5 * 60 * 1000,
    retry: 0,
    queryFn: async () => {
      try {
        const roles = await entities.LeadershipRole.filter({ role_type: 'movement_creator', is_active: true });
        const map = {};
        (Array.isArray(roles) ? roles : []).forEach((r) => {
          const email = r?.user_email ? String(r.user_email).trim().toLowerCase() : '';
          if (!email) return;
          map[email] = (map[email] || 0) + 1;
        });
        return map;
      } catch {
        return {};
      }
    },
  });
  // Apply momentum dampening
  const { data: dampenedMovements = rawMovements, isLoading: isDampening } = useMomentumDampening(rawMovements);

  // Apply decentralization penalty (best-effort)
  const decentralizedMovements = useMemo(() => {
    try {
      return applyDecentralizationBoost(dampenedMovements, leadershipCounts);
    } catch {
      return dampenedMovements;
    }
  }, [dampenedMovements, leadershipCounts]);
  
  // Apply age-based filtering
  const movements = decentralizedMovements.filter(movement => {
    if (!userAge) return true; // Show all if age not set
    const riskLevel = getContentRiskLevel(movement);
    return !shouldRestrictContent(userAge, riskLevel);
  });
  
  const isLoading = isLoadingMovements || isDampening;

  const userEmail = useMemo(() => {
    const e = user?.email ? String(user.email).trim().toLowerCase() : null;
    return e || null;
  }, [user]);

  const { data: myNotifications = [] } = useQuery({
    queryKey: ['notifications:stub', userEmail],
    enabled: !!userEmail,
    staleTime: 30 * 1000,
    retry: 0,
    queryFn: async () => {
      if (!userEmail) return [];
      try {
        return await entities.Notification.filter({ recipient_email: userEmail, is_read: false }, '-created_date', {
          limit: 200,
          fields: 'id,is_read',
        });
      } catch {
        return [];
      }
    },
  });

  const unreadNotificationsCount = useMemo(() => {
    const list = Array.isArray(myNotifications) ? myNotifications : [];
    return list.length;
  }, [myNotifications]);

  const createdMovements = useMemo(() => {
    if (!userEmail) return [];
    const list = Array.isArray(movements) ? movements : [];
    return list.filter((m) => movementAuthorEmail(m) === userEmail);
  }, [movements, userEmail]);

  const sortedMovements = React.useMemo(() => {
    const list = Array.isArray(movements) ? [...movements] : [];

    if (activeFilter === 'new') {
      return list.sort((a, b) => toTime(b?.created_at) - toTime(a?.created_at));
    }

    if (activeFilter === 'impact') {
      return list.sort((a, b) => toNumber(b?.upvotes ?? b?.boosts) - toNumber(a?.upvotes ?? a?.boosts));
    }

    if (activeFilter === 'local') {
      const radiusKm = Number(userProfile?.catchment_radius_km || 50);
      const userCoords = userEmail ? readPrivateUserCoordinates(userEmail) : null;
      const userCity = movementCity(userProfile);

      const local = list.filter((m) => {
        const movementCoords = getMovementCoordinates(m);
        if (userCoords && movementCoords && Number.isFinite(radiusKm)) {
          const d = haversineDistanceKm(userCoords, movementCoords);
          return d != null && d <= radiusKm;
        }

        // Fallback: city match when we don't have coordinates.
        return !!(userCity && movementCity(m) && movementCity(m) === userCity);
      });

      return local.sort((a, b) => toTime(b?.created_at) - toTime(a?.created_at));
    }

    // momentum (default)
    return list.sort(
      (a, b) =>
        toNumber(b?.score ?? b?.momentum_score) - toNumber(a?.score ?? a?.momentum_score)
    );
  }, [movements, activeFilter, userProfile, userEmail]);

  const localConfig = useMemo(() => {
    if (activeFilter !== 'local') return null;
    const radiusKm = Number(userProfile?.catchment_radius_km || 50);
    const coords = userEmail ? readPrivateUserCoordinates(userEmail) : null;
    const city = movementCity(userProfile);
    return {
      radiusKm: Number.isFinite(radiusKm) ? radiusKm : 50,
      hasCoords: !!coords,
      hasCity: !!city,
    };
  }, [activeFilter, userEmail, userProfile]);

  const handleOnboardingComplete = async () => {
    setShowOnboarding(false);
    localStorage.setItem('peoplepower_onboarding_completed', 'true');
    localStorage.removeItem('peoplepower_onboarding_in_progress');
    setTimeout(() => setShowSearchTooltip(true), 500);
  };

  const handleSearchTooltipDismiss = async () => {
    setShowSearchTooltip(false);
    if (onboarding) {
      await entities.UserOnboarding.update(onboarding.id, {
        completed_tutorials: [...(onboarding.completed_tutorials || []), 'search']
      });
    }
    if (aiOptIn) {
      setTimeout(() => setShowCreateTooltip(true), 500);
    }
  };

  const handleCreateTooltipDismiss = async () => {
    setShowCreateTooltip(false);
    if (onboarding) {
      await entities.UserOnboarding.update(onboarding.id, {
        completed_tutorials: [...(onboarding.completed_tutorials || []), 'search', 'create']
      });
    }
  };

  return (
    <>
      {showIntro && <IntroScreen onContinue={handleContinue} isExiting={isExiting} />}
      {showSafetyModal && <SafetyModal onAccept={handleSafetyAccept} />}
      {showAgeVerification && <AgeVerification onVerify={handleAgeVerification} minAge={13} />}
      {showOnboarding && user && (
        <OnboardingFlow user={user} onComplete={handleOnboardingComplete} />
      )}
      
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: showIntro ? 0 : 1 }}
        transition={{ duration: 0.8, delay: showIntro ? 0 : 0.5 }}
        className="space-y-6 sm:space-y-8 pb-24 sm:pb-32 min-h-[70vh]"
      >
      {/* Hero Section */}
      <motion.div 
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center py-8 sm:py-12"
      >
        <motion.div 
          animate={{ 
            rotate: [0, 5, -5, 0],
            scale: [1, 1.05, 1]
          }}
          transition={{ duration: 3, repeat: Infinity }}
          className="inline-flex items-center gap-2 px-4 py-2 sm:px-5 sm:py-2.5 bg-gradient-to-r from-[#FFC947] to-[#FFD666] text-slate-900 rounded-full text-xs sm:text-sm font-black mb-4 sm:mb-6 shadow-lg shadow-yellow-400/40 uppercase tracking-wide"
        >
          <Sparkles className="w-4 h-4" />
          {t('theMovementEngine')}
        </motion.div>
        <h1 className="text-4xl sm:text-6xl lg:text-7xl font-black text-slate-900 mb-4 sm:mb-6 tracking-tight leading-none">
          {t('peoplePower')}
        </h1>
        <p className="text-base sm:text-xl text-slate-600 max-w-2xl mx-auto leading-relaxed font-semibold">
          {t('homeTagline')}
        </p>
      </motion.div>

      {/* Next Best Action */}
      <NextBestActionPanel
        userEmail={userEmail}
        gateReady={gateReady}
        createdMovements={createdMovements}
        unreadNotificationsCount={unreadNotificationsCount}
      />

      {/* AI Search (opt-in only) */}
      {aiOptIn ? (
        <div className="relative">
          <Suspense fallback={null}>
            <AISearch allMovements={movements} />
          </Suspense>
          <FeatureTooltip
            show={showSearchTooltip}
            onDismiss={handleSearchTooltipDismiss}
            title="Smart Search"
            description="Use natural language to find movements. Try 'environmental initiatives in my area' or 'social justice campaigns'."
            position="bottom"
            highlight={true}
          />
        </div>
      ) : null}

      {/* AI Sections (opt-in only) */}
      {aiOptIn ? (
        <Suspense fallback={null}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <PersonalizedRecommendations user={user} allMovements={movements} interests={onboarding?.interests ?? []} />
            <AITrendingSection movements={movements} />
          </div>
        </Suspense>
      ) : null}

      {/* Filter & Actions Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-white p-3 sm:p-4 rounded-2xl sm:rounded-3xl border-3 border-slate-200 shadow-lg">
        <FilterTabs activeFilter={activeFilter} onFilterChange={setActiveFilter} />

        <div className="relative">
          {gateReady ? (
            <Link to={createPageUrl('CreateMovement')}>
              <motion.button
                whileHover={reduceMotion ? undefined : { scale: 1.05 }}
                whileTap={reduceMotion ? undefined : { scale: 0.95 }}
                className="flex items-center gap-2 px-5 py-3 sm:px-7 sm:py-4 bg-gradient-to-r from-[#FFC947] to-[#FFD666] text-slate-900 rounded-2xl font-black shadow-xl shadow-yellow-400/40 hover:shadow-yellow-400/60 transition-shadow uppercase tracking-wide"
                >
                <Plus className="w-5 h-5" strokeWidth={3} />
                {t('startMovement')}
                </motion.button>
            </Link>
          ) : (
            <motion.button
              type="button"
              whileHover={reduceMotion ? undefined : { scale: 1.0 }}
              whileTap={reduceMotion ? undefined : { scale: 0.98 }}
              className="flex items-center gap-2 px-5 py-3 sm:px-7 sm:py-4 bg-slate-200 text-slate-600 rounded-2xl font-black shadow-inner uppercase tracking-wide cursor-not-allowed"
              disabled
              aria-disabled="true"
              title="Accept safety & terms to continue"
            >
              <Plus className="w-5 h-5" strokeWidth={3} />
              {t('startMovement')}
            </motion.button>
          )}
          <FeatureTooltip
            show={aiOptIn ? showCreateTooltip : false}
            onDismiss={handleCreateTooltipDismiss}
            title="Create with AI"
            description="Start your movement with AI-powered assistance. Get ideas, descriptions, and strategy suggestions instantly."
            position="bottom"
            highlight={true}
          />
        </div>
      </div>

      {/* Movements List */}
      <div className="space-y-4 sm:space-y-5">
        {showOfflineLabel && offlineMovements ? (
          <div className="text-center py-2 mb-2 text-xs font-bold text-yellow-900 bg-yellow-100 rounded-xl">
            Showing last saved version (offline). Data may be outdated.
          </div>
        ) : null}
        {isLoading && !offlineMovements ? (
          <div className="flex flex-col items-center justify-center py-16 sm:py-24">
            <Loader2 className="w-10 h-10 text-[#3A3DFF] animate-spin mb-4" />
            <p className="text-slate-500 font-bold">{t('loadingMovements')}</p>
          </div>
        ) : !offlineMovements && isMovementsError ? (
          <div className="text-center py-16 sm:py-24">
            <div className="w-24 h-24 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <Zap className="w-12 h-12 text-slate-400" />
            </div>
            <h3 className="text-2xl font-black text-slate-900 mb-3">We couldn’t load movements right now.</h3>
            <p className="text-slate-500 mb-6 font-semibold">Please try again.</p>
            <button
              onClick={() => refetchMovements()}
              className="px-7 py-4 bg-white text-slate-900 rounded-xl font-black shadow-lg hover:shadow-xl transition-shadow border-2 border-slate-200 uppercase tracking-wide"
            >
              Retry
            </button>
          </div>
        ) : movements.length === 0 ? (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: reduceMotion ? 0 : undefined }}
            className="text-center py-16 sm:py-24"
          >
            <div className="w-24 h-24 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <Zap className="w-12 h-12 text-slate-400" />
            </div>
            <h3 className="text-2xl font-black text-slate-900 mb-3">{t('noMovementsYet')}</h3>
            <p className="text-slate-500 mb-6 font-semibold">{t('beTheFirst')}</p>
            {gateReady ? (
              <Link to={createPageUrl('CreateMovement')}>
                <button className="px-5 py-3 sm:px-7 sm:py-4 bg-gradient-to-r from-[#FFC947] to-[#FFD666] text-slate-900 rounded-xl font-black shadow-lg hover:shadow-xl transition-shadow uppercase tracking-wide">
                  {t('createFirstMovement')}
                </button>
              </Link>
            ) : null}
          </motion.div>
        ) : sortedMovements.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: reduceMotion ? 0 : undefined }}
            className="text-center py-16 sm:py-24"
          >
            <div className="w-24 h-24 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <Zap className="w-12 h-12 text-slate-400" />
            </div>
            {activeFilter === 'local' && localConfig && !localConfig.hasCoords && !localConfig.hasCity ? (
              <>
                <h3 className="text-2xl font-black text-slate-900 mb-3">Set your Local area</h3>
                <p className="text-slate-500 mb-6 font-semibold">
                  Local is approximate. Set your city and radius in your profile to see nearby movements.
                </p>
                <Link to={createPageUrl('Profile')}>
                  <button className="px-5 py-3 sm:px-7 sm:py-4 bg-white text-slate-900 rounded-xl font-black shadow-lg hover:shadow-xl transition-shadow border-2 border-slate-200 uppercase tracking-wide">
                    Update location
                  </button>
                </Link>
              </>
            ) : activeFilter === 'local' && localConfig ? (
              <>
                <h3 className="text-2xl font-black text-slate-900 mb-3">No nearby movements found</h3>
                <p className="text-slate-500 mb-6 font-semibold">
                  Try increasing your radius (currently ~{localConfig.radiusKm}km) to discover more.
                </p>
                <Link to={createPageUrl('Profile')}>
                  <button className="px-5 py-3 sm:px-7 sm:py-4 bg-white text-slate-900 rounded-xl font-black shadow-lg hover:shadow-xl transition-shadow border-2 border-slate-200 uppercase tracking-wide">
                    Adjust radius
                  </button>
                </Link>
              </>
            ) : (
              <>
                <h3 className="text-2xl font-black text-slate-900 mb-3">Nothing to show here yet</h3>
                <p className="text-slate-500 mb-6 font-semibold">Try a different filter.</p>
              </>
            )}
          </motion.div>
        ) : (
          <>
            {sortedMovements.map((movement, index) => (
              <MovementCard
                key={movement?.id ?? movement?._id ?? index}
                movement={movement}
                index={index}
              />
            ))}
            {hasNextPage ? (
              <div className="pt-6 flex justify-center">
                <button
                  type="button"
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                  className="px-6 py-3 rounded-2xl bg-white border-2 border-slate-200 text-slate-900 font-black shadow-sm hover:shadow-md transition"
                >
                  {isFetchingNextPage ? 'Loading…' : 'Load more'}
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>

      {/* Floating Create Button (Mobile) */}
      {gateReady ? (
          <Link 
            to={createPageUrl('CreateMovement')}
            className="fixed bottom-24 right-5 md:hidden z-40"
          >
            <motion.button
              whileHover={reduceMotion ? undefined : { scale: 1.1 }}
              whileTap={reduceMotion ? undefined : { scale: 0.9 }}
              animate={
                reduceMotion
                  ? { boxShadow: "0 10px 30px rgba(58, 61, 255, 0.3)" }
                  : {
                      boxShadow: [
                        "0 10px 30px rgba(58, 61, 255, 0.3)",
                        "0 10px 40px rgba(58, 61, 255, 0.5)",
                        "0 10px 30px rgba(58, 61, 255, 0.3)",
                      ],
                    }
              }
              transition={reduceMotion ? { duration: 0 } : { duration: 2, repeat: Infinity }}
              className="w-16 h-16 bg-gradient-to-br from-[#FFC947] to-[#FFD666] text-slate-900 rounded-full shadow-2xl flex items-center justify-center border-3 border-white"
              aria-label={t('startMovement')}
              title={t('startMovement')}
            >
              <Plus className="w-8 h-8" strokeWidth={3} />
            </motion.button>
          </Link>
      ) : null}
    </motion.div>
    </>
  );
}
