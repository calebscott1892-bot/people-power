import React, { Suspense } from 'react';
import './App.css';
import { Routes, Route } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import Layout from '@/pages/Layout';
import RequireAuth from '@/components/auth/RequireAuth';
import RequireAdmin from '@/components/auth/RequireAdmin';
import RequireStaff from '@/components/auth/RequireStaff';

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
const UserProfile = React.lazy(() => import('@/pages/UserProfile'));
const TermsOfService = React.lazy(() => import('@/pages/TermsOfService'));
const ContentPolicy = React.lazy(() => import('@/pages/ContentPolicy'));
const CommunityGuidelines = React.lazy(() => import('@/pages/CommunityGuidelines'));
const LegalHub = React.lazy(() => import('@/pages/LegalHub'));

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
        <Routes>
          <Route path="/login" element={<Login />} />

          <Route element={<Layout />}>
            {/* Public legal pages */}
            <Route path="/terms-of-service" element={<TermsOfService />} />
            <Route path="/content-policy" element={<ContentPolicy />} />
            <Route path="/community-guidelines" element={<CommunityGuidelines />} />
            <Route path="/legal-hub" element={<LegalHub />} />
            <Route path="/termsofservice" element={<TermsOfService />} />
            <Route path="/contentpolicy" element={<ContentPolicy />} />
            <Route path="/communityguidelines" element={<CommunityGuidelines />} />
            <Route path="/legalhub" element={<LegalHub />} />

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
              </Route>

              {/* Staff: moderators + admins */}
              <Route element={<RequireStaff />}>
                <Route path="/admin-reports" element={<AdminReports />} />
              </Route>

              <Route path="/user-profile" element={<UserProfile />} />
            </Route>
          </Route>
        </Routes>
      </Suspense>
      <Toaster position="top-right" />
    </>
  );
}