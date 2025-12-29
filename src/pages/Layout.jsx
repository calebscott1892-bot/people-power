import React, { useEffect, useMemo, useState } from 'react';
import { getCurrentBackendStatus, subscribeBackendStatus } from '../utils/backendStatus';
import { Link, useLocation, Outlet } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Home, User, Zap, MessageCircle, Bell, Shield, Plus } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from "@/lib/utils";
import LanguageSwitcher from '@/components/shared/LanguageSwitcher';
import { LanguageProvider, useLanguage } from '@/components/utils/LanguageContext';
import { useAuth } from '@/auth/AuthProvider';
import ErrorBoundary from '@/components/shared/ErrorBoundary';
import Footer from '@/components/layout/Footer';
import { isStaff } from '@/utils/staff';

function parseAdminEmails(raw) {
  return String(raw || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function LayoutContent({ children }) {
  const [backendStatus, setBackendStatus] = useState(getCurrentBackendStatus());
  const { user: authUser } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [isStaffUser, setIsStaffUser] = useState(false);
  const location = useLocation();
  const { t } = useLanguage();

  const adminEmails = useMemo(() => parseAdminEmails(import.meta?.env?.VITE_ADMIN_EMAILS), []);

  const hideFooter = location.pathname === '/login';

  useEffect(() => {
    // Listen for backend status changes
    const unsub = subscribeBackendStatus(setBackendStatus);
    return () => unsub();
  }, []);

  useEffect(() => {
    const email = String(authUser?.email || '').trim().toLowerCase();
    setIsAdmin(!!(email && adminEmails.includes(email)));
    setIsStaffUser(!!(email && isStaff(email)));
  }, [authUser, adminEmails]);

  const navItems = [
    { name: t('home'), page: 'Home', icon: Home },
    { name: t('challenges'), page: 'DailyChallenges', icon: Zap },
    { name: t('create') || 'Create', page: 'CreateMovement', icon: Plus, variant: 'create' },
    { name: t('leaderboard'), page: 'Leaderboard', icon: Bell },
    { name: t('messages'), page: 'Messages', icon: MessageCircle },
    { name: t('profile'), page: 'Profile', icon: User },
  ];

  const isActive = (page) => {
    const currentPath = location.pathname;
    return currentPath.includes(page);
  };

  // Combined fixed bottom stack height (NAV + legal footer).
  // Increased slightly so content never hides behind the stacked bars.
  const bottomStackPaddingPx = useMemo(() => 132, []);

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
      {/* Backend status banner */}
      {(backendStatus === 'offline' || backendStatus === 'degraded') && (
        <div className={
          'w-full text-center py-2 px-4 font-bold text-white ' +
          (backendStatus === 'offline' ? 'bg-red-600' : 'bg-yellow-500')
        }>
          {backendStatus === 'offline'
            ? 'Connection to People Power servers appears offline. Some actions may not work.'
            : 'People Power is experiencing issues. Some data may be out of date.'}
        </div>
      )}
      {/* Main scrollable content */}
      <div
        className="flex-1"
        style={{
          paddingBottom: `calc(${bottomStackPaddingPx}px + env(safe-area-inset-bottom))`,
        }}
      >
        {/* Header */}
        <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-xl border-b-4 border-slate-200 shadow-sm">
          <div className="max-w-7xl mx-auto px-4 sm:px-6">
            <div className="flex items-center justify-between h-16 md:h-20">
              {/* Logo */}
              <Link
                to={createPageUrl('Home')}
                className="flex items-center gap-2 md:gap-3 group"
              >
                <motion.div
                  whileHover={{ rotate: 10, scale: 1.1 }}
                  className="w-10 h-10 md:w-12 md:h-12 bg-gradient-to-br from-[#3A3DFF] to-[#5B5EFF] rounded-2xl flex items-center justify-center shadow-xl shadow-indigo-500/30"
                >
                  <Zap className="w-6 h-6 md:w-7 md:h-7 text-[#FFC947]" fill="#FFC947" strokeWidth={3} />
                </motion.div>
                <div className="hidden sm:flex flex-col">
                  <span className="text-xl md:text-2xl font-black text-slate-900 leading-none tracking-tight">
                    PEOPLE POWER
                  </span>
                  <span className="text-xs font-bold text-[#3A3DFF] uppercase tracking-wider">
                    Unite • Act • Transform
                  </span>
                </div>
              </Link>

              {/* Desktop - Language & Profile */}
              <div className="flex items-center gap-3">
                <LanguageSwitcher />
                {authUser ? (
                  <div className="flex items-center gap-3">
                    {isStaffUser && (
                      <Link
                        to={createPageUrl('AdminIncidentLog')}
                        className="hidden md:flex items-center gap-2 px-4 py-2 border border-slate-200 bg-white hover:bg-slate-50 text-slate-800 rounded-xl font-bold transition-colors"
                      >
                        <Shield className="w-4 h-4" />
                        Incidents
                      </Link>
                    )}
                    {isAdmin && (
                      <>
                        <Link
                          to={createPageUrl('SystemHealth')}
                          className="hidden md:flex items-center gap-2 px-4 py-2 border border-slate-200 bg-white hover:bg-slate-50 text-slate-800 rounded-xl font-bold transition-colors"
                        >
                          <Shield className="w-4 h-4" />
                          System Health
                        </Link>
                        <Link
                          to={createPageUrl('AdminDashboard')}
                          className="hidden md:flex items-center gap-2 px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-xl font-bold transition-colors"
                        >
                          <Shield className="w-4 h-4" />
                          {t('admin')}
                        </Link>
                      </>
                    )}
                    <Link to={createPageUrl('Profile')} className="flex items-center gap-2 hover:opacity-80 transition-opacity">
                      <span className="hidden sm:block text-sm font-bold text-slate-700">
                        {authUser.full_name || authUser.email}
                      </span>
                      <div className="w-10 h-10 bg-gradient-to-br from-[#3A3DFF] to-[#5B5EFF] rounded-full flex items-center justify-center text-white font-black text-sm shadow-lg">
                        {(authUser.full_name?.[0] || authUser.email?.[0] || '?').toUpperCase()}
                      </div>
                    </Link>
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

        {/* Main Content */}
        <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 py-6 md:py-8">
          {children}
        </main>
      </div>

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

                return (
                  <Link
                    key={item.page}
                    to={createPageUrl(item.page)}
                    className={cn(
                      "flex flex-col items-center gap-1 px-3 py-2 rounded-xl transition-all min-w-[60px]",
                      isCreate && "-mt-6 bg-gradient-to-r from-[#FFC947] to-[#FFD666] text-slate-900 shadow-lg shadow-yellow-400/40",
                      !isCreate && (active ? "text-[#3A3DFF]" : "text-slate-500")
                    )}
                  >
                    <Icon
                      className={cn(
                        isCreate ? "w-7 h-7" : "w-6 h-6",
                        active && !isCreate && "scale-110"
                      )}
                      strokeWidth={active && !isCreate ? 2.5 : 2}
                    />
                    <span className={cn("text-xs font-bold", isCreate && "uppercase tracking-wide")}>{item.name}</span>
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
