import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getCurrentBackendStatus, subscribeBackendStatus } from '../utils/backendStatus';
import { Link, useLocation, Outlet, useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Home, User, Zap, MessageCircle, Megaphone, Bell, Shield, Plus, Search, LogOut, HelpCircle, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from "@/lib/utils";
import LanguageSwitcher from '@/components/shared/LanguageSwitcher';
import { LanguageProvider, useLanguage } from '@/components/utils/LanguageContext';
import { useAuth } from '@/auth/AuthProvider';
import ErrorBoundary from '@/components/shared/ErrorBoundary';
import Footer from '@/components/layout/Footer';
import { useFeatureFlag } from '@/utils/featureFlags';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { entities } from '@/api/appClient';
import { fetchMyProfile } from '@/api/userProfileClient';
import { allowLocalProfileFallback } from '@/utils/localFallback';
import { queryKeys } from '@/lib/queryKeys';
import { toast } from 'sonner';
import { toastFriendlyError } from '@/utils/toastErrors';
import IntroScreen from '@/components/home/IntroScreen';
import UpdateBanner from '@/components/updates/UpdateBanner';
import UpdatesPanel from '@/components/updates/UpdatesPanel';
import TutorialModal from '@/components/tutorial/TutorialModal';
import FeedbackBugDialog from '@/components/shared/FeedbackBugDialog';

function EarlyAccessBanner() {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem('pp_early_access_dismissed');
      if (stored === '1') setHidden(true);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!hidden) return;
    try {
      localStorage.setItem('pp_early_access_dismissed', '1');
    } catch {
      // ignore
    }
  }, [hidden]);

  if (hidden) return null;

  return (
    <div className="w-full border-b border-amber-200 bg-amber-50 text-amber-900 px-4 sm:px-6 py-3">
      <div className="max-w-7xl mx-auto flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-3">
        <div className="flex-1">
          <div className="font-black text-sm sm:text-base">People Power — Early Access</div>
          <p className="text-xs sm:text-[13px] leading-snug text-amber-900/90">
            This is a pre-release version of People Power. Some features are still stabilising and data may be
            periodically reset during deployment. Thanks for helping us improve the platform.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setHidden(true)}
          className="text-xs font-bold underline underline-offset-2 whitespace-nowrap"
          aria-label="Dismiss early access banner"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

function LayoutContent({ children }) {
  const [backendStatus, setBackendStatus] = useState(getCurrentBackendStatus());
  const { user: authUser, session, isAdmin, logout } = useAuth();
  const [showIntroAgain, setShowIntroAgain] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [updatesOpen, setUpdatesOpen] = useState(false);
  const [hideTutorialPromptThisSession, setHideTutorialPromptThisSession] = useState(false);
  const userId = authUser?.id || authUser?.email || null;
  const { enabled: multiLanguageEnabled } = useFeatureFlag('multi_language', userId);
  useFeatureFlag('daily_challenges', userId, {
    defaultEnabled: true,
    enableWhileLoading: true,
  });
  const profileEmail = authUser?.email ? String(authUser.email) : null;
  const accessToken = session?.access_token ? String(session.access_token) : null;
  const lastResumeRefetchAtRef = useRef(0);
  const isFetchingRef = useRef(false);
  const refetchRef = useRef(null);

  const getHttpStatus = (err) => {
    if (!err) return null;
    const direct = err?.status ?? err?.statusCode;
    if (typeof direct === 'number') return direct;
    const resp = err?.response?.status ?? err?.response?.statusCode;
    if (typeof resp === 'number') return resp;
    const cause = err?.cause?.status ?? err?.cause?.statusCode;
    if (typeof cause === 'number') return cause;
    return null;
  };

  const userProfileQuery = useQuery({
    queryKey: queryKeys.userProfile.me(profileEmail),
    enabled: !!profileEmail && !!accessToken,
    retry: (failureCount, error) => {
      const status = getHttpStatus(error);
      if (status === 401 || status === 403) return false;
      return failureCount < 2;
    },
    retryDelay: (attemptIndex) => {
      // Exponential backoff: 1s, 2s (capped).
      const base = 1000;
      const delay = base * Math.pow(2, attemptIndex);
      return Math.min(delay, 8000);
    },
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
    queryFn: async () => {
      if (!profileEmail) return null;
      if (!accessToken) return null;

      try {
        const profile = await fetchMyProfile({ accessToken, profileEmail });
        return profile || null;
      } catch (e) {
        if (!allowLocalProfileFallback) throw e;
        try {
          const profiles = await entities.UserProfile.filter({ user_email: profileEmail });
          return Array.isArray(profiles) && profiles.length > 0 ? profiles[0] : null;
        } catch {
          return null;
        }
      }
    },
  });

  useEffect(() => {
    isFetchingRef.current = !!userProfileQuery.isFetching;
    refetchRef.current = userProfileQuery.refetch;
  }, [userProfileQuery.isFetching, userProfileQuery.refetch]);

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      if (!profileEmail || !accessToken) return;
      if (isFetchingRef.current) return;

      const now = Date.now();
      if (now - lastResumeRefetchAtRef.current < 30_000) return;
      lastResumeRefetchAtRef.current = now;

      const refetch = refetchRef.current;
      if (typeof refetch === 'function') refetch();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [profileEmail, accessToken]);

  const userProfile = userProfileQuery.data;
  const userProfileLoading = userProfileQuery.isLoading;
  const userProfileFetching = userProfileQuery.isFetching;
  const userProfileIsError = userProfileQuery.isError;

  const hideFooter = location.pathname === '/login';

  const hasSeenTutorialV2 = !!userProfile?.has_seen_tutorial_v2;
  const shouldShowTutorialPrompt =
    !!authUser &&
    !!accessToken &&
    !!profileEmail &&
    !!userProfile &&
    !userProfileLoading &&
    !userProfileFetching &&
    !hasSeenTutorialV2 &&
    !hideTutorialPromptThisSession;

  useEffect(() => {
    // Listen for backend status changes
    const unsub = subscribeBackendStatus(setBackendStatus);
    return () => unsub();
  }, []);

  const profileLabel = useMemo(() => {
    const base =
      userProfile?.display_name ||
      userProfile?.username ||
      '';
    const trimmed = String(base).trim();
    return trimmed || 'Account';
  }, [userProfile]);

  const profileInitial = useMemo(() => {
    const base =
      userProfile?.display_name ||
      userProfile?.username ||
      '';
    const trimmed = String(base).trim();
    if (trimmed) return trimmed[0].toUpperCase();
    return '?';
  }, [userProfile]);

  const profilePhotoUrl = useMemo(() => {
    const raw =
      userProfile?.profile_photo_url ||
      userProfile?.avatar_url ||
      '';
    const trimmed = String(raw || '').trim();
    return trimmed || '';
  }, [userProfile]);

  // Logout: calls Supabase signOut and returns to home/intro.
  const handleLogout = async () => {
    try {
      await logout();
      toast.success('Signed out');
      navigate('/');
    } catch (e) {
      toastFriendlyError(e, "Couldn't sign out, please try again");
    }
  };

  const searchLabel = t('search') || 'Search';
  const searchName = searchLabel ? `${searchLabel.charAt(0).toUpperCase()}${searchLabel.slice(1)}` : 'Search';

  const navItems = [
    { name: t('home'), page: 'Home', icon: Home },
    { name: searchName, page: 'Search', icon: Search },
    { name: t('challenges') || 'Challenges', page: 'DailyChallenges', icon: Zap },
    { name: t('create') || 'Create', page: 'CreateMovement', icon: Plus, variant: 'create' },
    { name: t('leaderboard'), page: 'Leaderboard', icon: Bell },
    { name: `${t('messages') || 'Messages'} (soon)`, page: 'Messages', icon: MessageCircle, comingSoon: true },
    { name: t('profile'), page: 'Profile', icon: User },
  ];

  const isActive = (page) => {
    const currentPath = location.pathname;
    return currentPath.includes(page);
  };

  // Combined fixed bottom stack height (NAV + legal footer).
  // Increased slightly so content never hides behind the stacked bars.
  const bottomStackPaddingPx = useMemo(() => 156, []);

  const hideBottomStack = useMemo(() => {
    // Hide bottom navigation during intro/safety/onboarding gating on Home.
    if (location.pathname !== '/') return false;
    try {
      const introSeen = localStorage.getItem('peoplepower_intro_seen') === 'true';
      const safetyAccepted = localStorage.getItem('peoplepower_safety_accepted') === 'true';
      const termsAccepted = localStorage.getItem('peoplepower_terms_accepted') === 'true';
      const onboardingInProgress = localStorage.getItem('peoplepower_onboarding_in_progress') === 'true';
      return !(introSeen && safetyAccepted && termsAccepted) || onboardingInProgress;
    } catch {
      return false;
    }
  }, [location.pathname]);

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      {/* Connection / syncing banner (non-blocking, degraded-mode friendly) */}
      {backendStatus === 'offline' ? (
        <div className="w-full border-b border-slate-200 bg-slate-900 text-white px-4 sm:px-6 py-2">
          <div className="max-w-7xl mx-auto flex items-center justify-center gap-2 text-sm font-bold">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>You&apos;re offline. Browsing may use saved data — reconnecting…</span>
          </div>
        </div>
      ) : backendStatus === 'degraded' ? (
        <div className="w-full border-b border-amber-200 bg-amber-50 text-amber-900 px-4 sm:px-6 py-2">
          <div className="max-w-7xl mx-auto flex items-center justify-center gap-2 text-sm font-bold">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Reconnecting to People Power — some data may be out of date.</span>
          </div>
        </div>
      ) : userProfileFetching ? (
        <div className="w-full border-b border-slate-200 bg-white text-slate-700 px-4 sm:px-6 py-2">
          <div className="max-w-7xl mx-auto flex items-center justify-center gap-2 text-sm font-bold">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Syncing…</span>
          </div>
        </div>
      ) : userProfileIsError ? (
        <div className="w-full border-b border-amber-200 bg-amber-50 text-amber-900 px-4 sm:px-6 py-2">
          <div className="max-w-7xl mx-auto flex items-center justify-center gap-3 text-sm font-bold">
            <span>Couldn&apos;t load your profile.</span>
            <button
              type="button"
              onClick={() => userProfileQuery.refetch()}
              className="underline underline-offset-2"
            >
              Retry
            </button>
          </div>
        </div>
      ) : null}

      {/* Update notice banner (under backend status banner) */}
      {authUser && accessToken && profileEmail && userProfile && !userProfileLoading && !userProfileFetching ? (
        <UpdateBanner
          profile={userProfile}
          profileEmail={profileEmail}
          accessToken={accessToken}
          onMarkedSeen={(latestVersion) => {
            queryClient.setQueryData(queryKeys.userProfile.me(profileEmail), (prev) => {
              if (!prev || typeof prev !== 'object') return prev;
              return { ...prev, last_seen_update_version: latestVersion };
            });
          }}
        />
      ) : null}

      {/* Always-available update reports */}
      <UpdatesPanel
        open={updatesOpen}
        onOpenChange={setUpdatesOpen}
        profileEmail={profileEmail}
        accessToken={accessToken}
        onMarkedSeen={(latestVersion) => {
          if (!profileEmail) return;
          queryClient.setQueryData(queryKeys.userProfile.me(profileEmail), (prev) => {
            if (!prev || typeof prev !== 'object') return prev;
            return { ...prev, last_seen_update_version: latestVersion };
          });
        }}
      />

      {showIntroAgain ? (
        <IntroScreen onContinue={() => setShowIntroAgain(false)} isExiting={false} />
      ) : null}
      {/* Main scrollable content */}
      <div
        className="flex-1 overflow-x-hidden"
        style={{
          paddingBottom: `calc(${bottomStackPaddingPx}px + env(safe-area-inset-bottom))`,
        }}
      >
        {/* Header */}
        <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-xl border-b-4 border-slate-200 shadow-sm">
          <div className="max-w-7xl mx-auto px-4 sm:px-6">
            <div className="flex items-center justify-between h-14 sm:h-16 md:h-20">
              {/* Logo */}
              <button
                type="button"
                onClick={() => setShowIntroAgain(true)}
                className="flex items-center gap-2 md:gap-3 group cursor-pointer"
                title="View welcome screen"
                aria-label="View welcome screen"
              >
                <motion.div
                  whileHover={{ rotate: 10, scale: 1.1 }}
                  className="w-9 h-9 sm:w-10 sm:h-10 md:w-12 md:h-12 bg-gradient-to-br from-[#3A3DFF] to-[#5B5EFF] rounded-2xl flex items-center justify-center shadow-xl shadow-indigo-500/30"
                >
                  <Zap className="w-5 h-5 sm:w-6 sm:h-6 md:w-7 md:h-7 text-[#FFC947]" fill="#FFC947" strokeWidth={3} />
                </motion.div>
                <div className="hidden sm:flex flex-col">
                  <span className="text-xl md:text-2xl font-black text-slate-900 leading-none tracking-tight">
                    PEOPLE POWER
                  </span>
                  <span className="text-xs font-bold text-[#3A3DFF] uppercase tracking-wider">
                    Unite • Act • Transform
                  </span>
                </div>
              </button>

              {/* Desktop - Language & Profile */}
              <div className="flex items-center gap-3">
                {multiLanguageEnabled ? <LanguageSwitcher /> : null}
                {authUser ? (
                  <button
                    type="button"
                    onClick={() => setTutorialOpen(true)}
                    className="flex items-center gap-2 px-2 py-2 text-slate-600 hover:text-slate-900 rounded-xl transition-colors"
                    aria-label="Help and tutorial"
                    title="Help & tutorial"
                  >
                    <HelpCircle className="w-4 h-4" />
                    <span className="hidden md:inline text-xs font-bold">Help</span>
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setUpdatesOpen(true)}
                  className="flex items-center gap-2 px-2 py-2 text-slate-600 hover:text-slate-900 rounded-xl transition-colors"
                  aria-label="View update reports"
                  title="What’s new"
                >
                  <Bell className="w-4 h-4" />
                  <span className="hidden md:inline text-xs font-bold">Updates</span>
                </button>
                {authUser ? (
                  <button
                    type="button"
                    onClick={() => setFeedbackOpen(true)}
                    className="flex items-center gap-2 px-2 py-2 text-slate-600 hover:text-slate-900 rounded-xl transition-colors"
                    aria-label="Send feedback or report a bug"
                  >
                    <Megaphone className="w-4 h-4" />
                    <span className="hidden md:inline text-xs font-bold">Feedback</span>
                  </button>
                ) : null}
                {authUser ? (
                  <div className="flex items-center gap-3">
                    {isAdmin && (
                      <Link
                        to={createPageUrl('AdminDashboard')}
                        className="hidden md:flex items-center gap-2 px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-xl font-bold transition-colors"
                      >
                        <Shield className="w-4 h-4" />
                        {t('admin')}
                      </Link>
                    )}
                    <Link to={createPageUrl('Profile')} className="flex items-center gap-2 hover:opacity-80 transition-opacity">
                      <span className="hidden sm:block text-sm font-bold text-slate-700">
                        {profileLabel}
                      </span>
                      {isAdmin ? (
                        <span className="hidden sm:inline-flex ml-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[10px] font-black uppercase">
                          Admin
                        </span>
                      ) : null}
                      {/* Avatar flow: local preview → authenticated upload on Save → profile_photo_url persisted via profile update. */}
                      <div className="w-10 h-10 bg-gradient-to-br from-[#3A3DFF] to-[#5B5EFF] rounded-full flex items-center justify-center text-white font-black text-sm shadow-lg overflow-hidden">
                        {profilePhotoUrl ? (
                          <img src={profilePhotoUrl} alt={profileLabel} className="w-full h-full object-cover" />
                        ) : (
                          profileInitial
                        )}
                      </div>
                    </Link>
                    <button
                      type="button"
                      onClick={handleLogout}
                      className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 hover:text-slate-900 hover:bg-slate-50 font-bold text-xs sm:text-sm"
                      aria-label="Sign out"
                    >
                      <LogOut className="w-4 h-4" />
                      <span className="hidden sm:inline">Sign out</span>
                    </button>
                  </div>
                ) : (
                  <Link
                    to="/login"
                    className="px-4 py-2 md:px-6 md:py-3 bg-gradient-to-r from-[#FFC947] to-[#FFD666] text-slate-900 rounded-xl font-black text-xs md:text-sm hover:shadow-xl shadow-lg shadow-yellow-400/40 transition-all uppercase tracking-wide"
                  >
                    {t('signIn')}
                  </Link>
                )}
              </div>
            </div>
          </div>
        </header>

        <FeedbackBugDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />

        <EarlyAccessBanner />

        {shouldShowTutorialPrompt ? (
          <div className="px-4 sm:px-6 mt-3">
            <div className="max-w-7xl mx-auto rounded-2xl border border-slate-200 bg-white p-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-black text-slate-900">New to People Power? Start a quick tour.</div>
                <div className="text-xs text-slate-600 font-semibold mt-1">
                  A guided walkthrough of movements, boosting, following, and what’s coming soon.
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setHideTutorialPromptThisSession(true)}
                  className="text-xs font-bold text-slate-600 hover:text-slate-900"
                >
                  Maybe later
                </button>
                <button
                  type="button"
                  onClick={() => setTutorialOpen(true)}
                  className="inline-flex items-center justify-center h-9 px-4 rounded-md bg-primary text-primary-foreground text-xs font-black"
                >
                  Start tour
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {/* Main Content */}
        <main className="flex-1 max-w-7xl mx-auto px-3 sm:px-6 py-4 sm:py-6 md:py-8">
          {children}
        </main>
      </div>

      <TutorialModal
        open={tutorialOpen}
        onOpenChange={setTutorialOpen}
        accessToken={accessToken}
        profileEmail={profileEmail}
        hasSeen={hasSeenTutorialV2}
        onCompleted={() => {
          queryClient.setQueryData(queryKeys.userProfile.me(profileEmail), (prev) => {
            if (!prev || typeof prev !== 'object') return prev;
            return { ...prev, has_seen_tutorial_v2: true };
          });
        }}
      />

      {/* ✅ Fixed bottom stack: NAV (top) + LEGAL FOOTER (bottom) */}
      {!hideBottomStack ? (
      <div className="fixed inset-x-0 bottom-0 z-50">
        {/* Main bottom nav (no longer fixed itself; it sits above the legal footer) */}
        <nav className="w-full bg-white border-t-4 border-slate-200 shadow-2xl">
          <div className="max-w-7xl mx-auto px-4 sm:px-6">
            <div className="flex items-center justify-around px-2 py-2">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.page);
                const isCreate = item.variant === 'create';
                const comingSoon = !!item.comingSoon;

                return (
                  <Link
                    key={item.page}
                    to={createPageUrl(item.page)}
                    aria-label={item.name}
                    className={cn(
                      "flex flex-col items-center gap-1 px-3 py-2 rounded-xl transition-all min-w-[54px] sm:min-w-[60px]",
                      isCreate && "-mt-5 sm:-mt-6 bg-gradient-to-r from-[#FFC947] to-[#FFD666] text-slate-900 shadow-lg shadow-yellow-400/40",
                      !isCreate && (active ? "text-[#3A3DFF]" : (comingSoon ? "text-slate-400" : "text-slate-500"))
                    )}
                  >
                    <Icon
                      className={cn(
                        isCreate ? "w-6 h-6 sm:w-7 sm:h-7" : "w-5 h-5 sm:w-6 sm:h-6",
                        active && !isCreate && "scale-110"
                      )}
                      strokeWidth={active && !isCreate ? 2.5 : 2}
                    />
                    <span
                      className={cn(
                        "hidden sm:inline text-xs font-bold",
                        isCreate && "uppercase tracking-wide"
                      )}
                    >
                      {item.name}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        </nav>

        {/* Legal footer bar at very bottom */}
        {!hideFooter ? <Footer /> : null}
      </div>
      ) : null}
    </div>
  );
}

export default function Layout() {
  return (
    <LanguageProvider>
      <ErrorBoundary>
        <LayoutContent>
          <Outlet />
        </LayoutContent>
      </ErrorBoundary>
    </LanguageProvider>
  );
}
