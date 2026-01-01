import React, { Suspense } from 'react';
import './App.css';
import { Routes, Route } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { Toaster as SonnerToaster } from 'sonner';
import Layout from '@/pages/Layout';
import RequireAuth from '@/components/auth/RequireAuth';
import RequireAdmin from '@/components/auth/RequireAdmin';
import { BackNavProvider } from '@/components/shared/BackNavProvider';

const Home = React.lazy(() => import('@/pages/Home'));
const Login = React.lazy(() => import('@/pages/Login'));
const Profile = React.lazy(() => import('@/pages/Profile'));
const CreateMovement = React.lazy(() => import('@/pages/CreateMovement'));
const MovementDetails = React.lazy(() => import('@/pages/MovementDetails'));
const Messages = React.lazy(() => import('@/pages/Messages'));
const DailyChallenges = React.lazy(() => import('@/pages/DailyChallenges'));
const Leaderboard = React.lazy(() => import('@/pages/Leaderboard'));
const Notifications = React.lazy(() => import('@/pages/Notifications'));
const CollaborationInvites = React.lazy(() => import('@/pages/CollaborationInvites'));
const AdminDashboard = React.lazy(() => import('@/pages/AdminDashboard'));
const AdminReports = React.lazy(() => import('@/pages/AdminReports'));
const AdminChallenges = React.lazy(() => import('@/pages/AdminChallenges'));
const AdminIncidentLog = React.lazy(() => import('@/pages/AdminIncidentLog'));
const CommunityHealth = React.lazy(() => import('@/pages/CommunityHealth'));
const FeatureFlags = React.lazy(() => import('@/pages/FeatureFlags'));
const ResearchConfig = React.lazy(() => import('@/pages/ResearchConfig'));
const SystemHealth = React.lazy(() => import('@/pages/SystemHealth'));
const Search = React.lazy(() => import('@/pages/Search'));
const ReportCenter = React.lazy(() => import('@/pages/ReportCenter'));
const UserProfile = React.lazy(() => import('@/pages/UserProfile'));
const TermsOfService = React.lazy(() => import('@/pages/TermsOfService'));
const ContentPolicy = React.lazy(() => import('@/pages/ContentPolicy'));
const CommunityGuidelines = React.lazy(() => import('@/pages/CommunityGuidelines'));
const LegalHub = React.lazy(() => import('@/pages/LegalHub'));
const PrivacyPolicy = React.lazy(() =>
  import('@/pages/PrivacyPolicy').catch((err) => {
    if (import.meta?.env?.DEV) {
      console.error('[PrivacyPolicy] Failed to load module', err);
    }
    // Fallback: render a safe inline policy so this route never crashes the app.
    return {
      default: function PrivacyPolicyFallback() {
        return (
          <div className="max-w-4xl mx-auto px-4 py-10 space-y-8">
            <div className="bg-white rounded-3xl shadow-xl border border-slate-200 overflow-hidden">
              <div className="bg-gradient-to-r from-emerald-600 to-teal-500 text-white px-6 py-6 sm:px-8 sm:py-8">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide opacity-80">Privacy Policy</p>
                    <h1 className="text-2xl sm:text-3xl font-black leading-tight">PRIVACY POLICY</h1>
                    <p className="text-sm sm:text-base font-semibold mt-1">Last Updated: December 2024</p>
                  </div>
                </div>
                <p className="mt-6 text-sm sm:text-base font-semibold">
                  This is an early-access version of People Power. Please avoid posting sensitive personal information while features are evolving.
                </p>
              </div>

              <div className="p-6 sm:p-8 space-y-6 text-slate-800 text-sm sm:text-base leading-6">
                <section className="space-y-2">
                  <h2 className="text-lg sm:text-xl font-black text-slate-900">1. What data we collect</h2>
                  <p>We collect account details, profile info, and user-generated content such as movements, messages, and reports.</p>
                </section>
                <section className="space-y-2">
                  <h2 className="text-lg sm:text-xl font-black text-slate-900">2. How we use your data</h2>
                  <p>We use data to operate the platform, support safety and moderation, and improve reliability.</p>
                </section>
                <section className="space-y-2">
                  <h2 className="text-lg sm:text-xl font-black text-slate-900">3. Location & local features</h2>
                  <p>Location is optional and is stored at a city or approximate level for local discovery.</p>
                </section>
                <section className="space-y-2">
                  <h2 className="text-lg sm:text-xl font-black text-slate-900">4. Your choices</h2>
                  <p>You can update your profile, adjust local settings, and request account deletion via support.</p>
                </section>
                <p className="text-xs text-slate-500">
                  This placeholder does not replace any legally binding terms that may apply to your use of People Power.
                </p>
              </div>
            </div>
          </div>
        );
      },
    };
  })
);

function RouteLoading() {
  return (
    <div className="min-h-[50vh] flex items-center justify-center text-slate-600 font-semibold">
      Loading…
    </div>
  );
}

export default function App() {
  return (
    <>
      <Suspense fallback={<RouteLoading />}>
        <BackNavProvider>
          <Routes>
            <Route path="/login" element={<Login />} />

            <Route element={<Layout />}>
              {/* Public legal pages */}
              <Route path="/terms-of-service" element={<TermsOfService />} />
              <Route path="/privacy-policy" element={<PrivacyPolicy />} />
              <Route path="/content-policy" element={<ContentPolicy />} />
              <Route path="/community-guidelines" element={<CommunityGuidelines />} />
              <Route path="/legal-hub" element={<LegalHub />} />
              <Route path="/termsofservice" element={<TermsOfService />} />
              <Route path="/PrivacyPolicy" element={<PrivacyPolicy />} />
              <Route path="/privacy" element={<PrivacyPolicy />} />
              <Route path="/contentpolicy" element={<ContentPolicy />} />
              <Route path="/communityguidelines" element={<CommunityGuidelines />} />
              <Route path="/legalhub" element={<LegalHub />} />
              <Route path="/search" element={<Search />} />
              <Route path="/report" element={<ReportCenter />} />
              <Route path="/help/report" element={<ReportCenter />} />

              {/* Public home */}
              <Route path="/" element={<Home />} />
              <Route path="/movements/:id" element={<MovementDetails />} />

              {/* Protected app routes */}
              <Route element={<RequireAuth />}>
                <Route path="/profile" element={<Profile />} />
                <Route path="/create-movement" element={<CreateMovement />} />
                <Route path="/createmovement" element={<CreateMovement />} />
                <Route path="/CreateMovement" element={<CreateMovement />} />

                {/* Main content pages */}
                <Route path="/messages" element={<Messages />} />
                <Route path="/daily-challenges" element={<DailyChallenges />} />
                <Route path="/leaderboard" element={<Leaderboard />} />
                <Route path="/notifications" element={<Notifications />} />
                <Route path="/collaboration-invites" element={<CollaborationInvites />} />

                {/* Admin-only */}
                <Route element={<RequireAdmin />}>
                  <Route path="/admin-dashboard" element={<AdminDashboard />} />
                  <Route path="/admin" element={<AdminDashboard />} />
                  <Route path="/admin-challenges" element={<AdminChallenges />} />
                  <Route path="/system-health" element={<SystemHealth />} />
                  <Route path="/community-health" element={<CommunityHealth />} />
                  <Route path="/feature-flags" element={<FeatureFlags />} />
                  <Route path="/research-config" element={<ResearchConfig />} />
                </Route>

                {/* Admin-only moderation routes */}
                <Route element={<RequireAdmin />}>
                  <Route path="/admin-reports" element={<AdminReports />} />
                  <Route path="/admin-incident-log" element={<AdminIncidentLog />} />
                </Route>

                <Route path="/user-profile" element={<UserProfile />} />
                <Route path="/u/:username" element={<UserProfile />} />
              </Route>
            </Route>
          </Routes>
        </BackNavProvider>
      </Suspense>
      <Toaster position="top-right" />
      <SonnerToaster position="top-right" richColors />
    </>
  );
}
