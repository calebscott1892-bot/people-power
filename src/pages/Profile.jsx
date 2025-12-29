import React, { useMemo, useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { useQuery } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { 
  User, Mail, Calendar, Zap, LogOut, 
  Plus, ChevronRight, Loader2, TrendingUp, Trophy, Flame, Shield
} from 'lucide-react';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import TagBadge from '../components/shared/TagBadge';
import { useAuth } from '@/auth/AuthProvider';
import { fetchMovementsPage, fetchMyFollowedMovements } from '@/api/movementsClient';
import EditProfileModal from '../components/profile/EditProfileModal';
import { entities } from '@/api/appClient';
import { fetchMyFollowers, fetchMyFollowingUsers } from '@/api/userFollowsClient';
import { fetchOrCreateUserChallengeStats } from '@/api/userChallengeStatsClient';
import { sanitizePublicLocation } from '@/utils/locationPrivacy';

function parseAdminEmails(raw) {
  return String(raw || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export default function Profile() {
  const { user: authUser, session, loading: authLoading, signOut } = useAuth();
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showEditModal, setShowEditModal] = useState(false);
  const navigate = useNavigate();
  const accessToken = session?.access_token || null;

  const adminEmails = useMemo(() => parseAdminEmails(import.meta?.env?.VITE_ADMIN_EMAILS), []);
  const isAdmin = useMemo(() => {
    const email = String(user?.email || '').trim().toLowerCase();
    return !!(email && adminEmails.includes(email));
  }, [user?.email, adminEmails]);

  useEffect(() => {
    if (authLoading) return;
    setUser(authUser ?? null);
    setIsLoading(false);
  }, [authUser, authLoading]);

  const { data: myMovements = [] } = useQuery({
    queryKey: ['myMovements', user?.email],
    queryFn: async () => {
      const all = await fetchMovementsPage({
        limit: 200,
        offset: 0,
        fields: [
          'id',
          'title',
          'author_email',
          'created_at',
          'created_date',
          'momentum_score',
          'tags',
        ].join(','),
      });
      return all.filter((m) => String(m?.author_email || '') === String(user.email || ''));
    },
    enabled: !!user?.email
  });

  const { data: userProfile } = useQuery({
    queryKey: ['userProfile', user?.email],
    queryFn: async () => {
      if (!user?.email) return null;
      try {
        const profiles = await entities.UserProfile.filter({ user_email: user.email });
        if (profiles.length > 0) {
          const p = profiles[0];
          return { ...p, location: sanitizePublicLocation(p?.location) };
        }
        return entities.UserProfile.create({
          user_email: user.email,
          display_name: user.full_name,
          username: String(user.email).split('@')[0],
          bio: '',
          followers_count: 0,
          following_count: 0
        });
      } catch {
        return null;
      }
    },
    enabled: !!user?.email
  });

  const { data: followedMovements = [] } = useQuery({
    queryKey: ['followedMovements', user?.email],
    queryFn: async () => fetchMyFollowedMovements({ accessToken }),
    enabled: !!user?.email && !!accessToken
  });

  const { data: userStats } = useQuery({
    queryKey: ['userChallengeStats', user?.email],
    queryFn: async () => {
      if (!user?.email) return null;
      return fetchOrCreateUserChallengeStats(user.email);
    },
    enabled: !!user?.email
  });

  const { data: myFollowingUsers = [] } = useQuery({
    queryKey: ['myFollowingUsers', user?.email],
    queryFn: async () => fetchMyFollowingUsers({ accessToken }),
    enabled: !!user?.email && !!accessToken,
  });

  const { data: myFollowers = [] } = useQuery({
    queryKey: ['myFollowers', user?.email],
    queryFn: async () => fetchMyFollowers({ accessToken }),
    enabled: !!user?.email && !!accessToken,
  });

  const handleLogout = async () => {
    try {
      await signOut();
      navigate('/');
    } catch (e) {
      console.warn('signOut failed', e);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-32">
        <Loader2 className="w-12 h-12 text-[#3A3DFF] animate-spin mb-4" />
        <p className="text-slate-500 font-bold">Loading profile...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="max-w-xl mx-auto py-20 px-6 text-center space-y-4">
        <div className="w-16 h-16 mx-auto rounded-full bg-slate-100 flex items-center justify-center">
          <User className="w-8 h-8 text-slate-400" />
        </div>
        <h2 className="text-2xl font-black text-slate-900">Sign in to see your profile</h2>
        <p className="text-slate-500 font-semibold">
          Create an account or sign in to view and manage your movements.
        </p>
        <button
          onClick={() => navigate('/login')}
          className="inline-flex items-center justify-center px-6 py-3 rounded-2xl bg-[#3A3DFF] text-white font-bold shadow-md hover:opacity-90 transition"
        >
          Go to login
        </button>
      </div>
    );
  }

  const totalMomentum = myMovements.reduce((sum, m) => sum + (m?.momentum_score || 0), 0);

  const safeDate = (d) => {
    try { return format(new Date(d), 'MMM d, yyyy'); } catch { return ''; }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Profile Card */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-3xl shadow-2xl border-3 border-slate-200 overflow-hidden"
      >
        {/* Header Banner */}
        {userProfile?.banner_url ? (
          <div className="h-32 bg-cover bg-center" style={{ backgroundImage: `url(${userProfile.banner_url})` }} />
        ) : (
          <div className="h-32 bg-gradient-to-r from-[#3A3DFF] via-[#5B5EFF] to-[#3A3DFF]" />
        )}
        
        {/* Profile Info */}
        <div className="px-8 pb-8">
          <div className="flex items-start justify-between gap-6 mb-8">
            <div className="flex items-start gap-6">
              <div className="w-32 h-32 -mt-16 bg-white rounded-3xl shadow-2xl flex items-center justify-center border-4 border-white">
                {userProfile?.profile_photo_url ? (
                  <img src={userProfile.profile_photo_url} alt="" className="w-full h-full rounded-2xl object-cover" />
                ) : (
                  <div className="w-28 h-28 bg-gradient-to-br from-[#FFC947] to-[#FFD666] rounded-2xl flex items-center justify-center">
                    <span className="text-5xl font-black text-slate-900">
                      {(userProfile?.display_name?.[0] || user?.full_name?.[0] || user?.email?.[0] || '?').toUpperCase()}
                    </span>
                  </div>
                )}
              </div>
              <div className="pt-4 flex-1">
                <h1 className="text-3xl font-black text-slate-900 mb-1">
                  {userProfile?.display_name || user?.full_name || 'Anonymous User'}
                </h1>
                <p className="text-sm text-slate-500 font-semibold">
                  @{userProfile?.username || String(user?.email || '').split('@')[0] || 'user'}
                </p>
              </div>
            </div>

            <div className="pt-4">
              <Button
                onClick={() => setShowEditModal(true)}
                variant="outline"
                className="h-12 font-bold rounded-xl border-2 border-slate-300 uppercase tracking-wide"
              >
                Edit
              </Button>
            </div>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            <motion.div 
              whileHover={{ scale: 1.05 }}
              className="bg-gradient-to-br from-indigo-50 to-white p-5 rounded-2xl border-2 border-indigo-200 text-center"
            >
              <div className="text-3xl font-black text-[#3A3DFF] mb-1">
                {myMovements.length}
              </div>
              <div className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                Created
              </div>
            </motion.div>
            
            <motion.div 
              whileHover={{ scale: 1.05 }}
              className="bg-gradient-to-br from-yellow-50 to-white p-5 rounded-2xl border-2 border-yellow-200 text-center"
            >
              <div className="text-3xl font-black text-[#FFC947] mb-1">
                {followedMovements.length}
              </div>
              <div className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                Following
              </div>
            </motion.div>
            
            <motion.div 
              whileHover={{ scale: 1.05 }}
              className="bg-gradient-to-br from-slate-50 to-white p-5 rounded-2xl border-2 border-slate-200 text-center"
            >
              <div className="text-3xl font-black text-slate-900 mb-1">
                {totalMomentum > 0 ? `+${totalMomentum}` : totalMomentum}
              </div>
              <div className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                Momentum
              </div>
            </motion.div>

            <motion.div 
              whileHover={{ scale: 1.05 }}
              className="bg-gradient-to-br from-purple-50 to-white p-5 rounded-2xl border-2 border-purple-200 text-center"
            >
              <div className="flex items-center justify-center gap-2 mb-1">
                <Trophy className="w-6 h-6 text-purple-600" />
                <div className="text-3xl font-black text-purple-600">
                  {userStats?.total_points || 0}
                </div>
              </div>
              <div className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                Points
              </div>
            </motion.div>
          </div>

          {/* Challenge Stats */}
          {userStats && (userStats.current_streak > 0 || userStats.total_challenges_completed > 0) && (
            <div className="mb-6 p-4 bg-gradient-to-r from-indigo-50 to-purple-50 rounded-2xl border-2 border-indigo-100">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider">
                  Challenge Stats
                </h3>
                <Link to={createPageUrl('DailyChallenges')}>
                  <Button 
                    size="sm" 
                    className="bg-[#3A3DFF] hover:bg-[#2A2DDD] rounded-lg font-bold text-xs"
                  >
                    View Challenges
                  </Button>
                </Link>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center gap-3">
                  <motion.div
                    animate={{ rotate: [0, -5, 5, -5, 0] }}
                    transition={{ duration: 2, repeat: Infinity, repeatDelay: 3 }}
                    className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-red-500 flex items-center justify-center shadow-lg"
                  >
                    <Flame className="w-5 h-5 text-white" fill="white" />
                  </motion.div>
                  <div>
                    <div className="text-2xl font-black text-slate-900">
                      {userStats.current_streak}
                    </div>
                    <div className="text-xs text-slate-600 font-bold">
                      Day Streak
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center shadow-lg">
                    <Zap className="w-5 h-5 text-white" fill="white" />
                  </div>
                  <div>
                    <div className="text-2xl font-black text-slate-900">
                      {userStats.total_challenges_completed}
                    </div>
                    <div className="text-xs text-slate-600 font-bold">
                      Completed
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* User Details */}
          <div className="space-y-3 mb-6 p-4 bg-slate-50 rounded-2xl border-2 border-slate-200">
            <div className="flex items-center gap-3 text-slate-600">
              <Mail className="w-5 h-5 text-slate-400" />
              <span className="font-bold">{user?.email}</span>
            </div>
            {user?.created_date && (
              <div className="flex items-center gap-3 text-slate-600">
                <Calendar className="w-5 h-5 text-slate-400" />
                <span className="font-bold">Joined {format(new Date(user.created_date), 'MMMM yyyy')}</span>
              </div>
            )}
          </div>

          {/* Admin Dashboard Link */}
          {isAdmin && (
            <Link to={createPageUrl('AdminReports')}>
              <Button
                variant="outline"
                className="w-full h-12 font-bold rounded-xl border-2 border-red-300 text-red-700 hover:bg-red-50 uppercase tracking-wide mb-3"
              >
                <Shield className="w-4 h-4 mr-2" />
                Admin Reports
              </Button>
            </Link>
          )}

          {/* Logout Button */}
          <Button
            onClick={handleLogout}
            variant="outline"
            className="w-full h-12 font-bold rounded-xl border-2 border-slate-300 uppercase tracking-wide"
          >
            <LogOut className="w-4 h-4 mr-2" />
            Sign Out
          </Button>
        </div>
      </motion.div>

      <EditProfileModal
        open={showEditModal}
        onClose={() => setShowEditModal(false)}
        profile={userProfile}
        userEmail={user?.email}
        userStats={userStats}
      />

      {/* My Movements */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-white rounded-3xl shadow-2xl border-3 border-slate-200 overflow-hidden"
      >
        <div className="p-6 border-b-2 border-slate-200 flex items-center justify-between bg-gradient-to-r from-slate-50 to-white">
          <h2 className="text-2xl font-black text-slate-900 uppercase tracking-tight">My Movements</h2>
          <Link to={createPageUrl('CreateMovement')}>
            <Button className="bg-gradient-to-r from-[#FFC947] to-[#FFD666] hover:from-[#FFD666] hover:to-[#FFC947] text-slate-900 font-black rounded-xl h-10 px-5 uppercase tracking-wide">
              <Plus className="w-4 h-4 mr-1" strokeWidth={3} />
              New
            </Button>
          </Link>
        </div>

        {myMovements.length === 0 ? (
          <div className="p-16 text-center">
            <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <Zap className="w-10 h-10 text-slate-400" />
            </div>
            <h3 className="font-black text-xl text-slate-900 mb-2">No movements yet</h3>
            <p className="text-slate-500 mb-6 font-semibold">Start your first movement and inspire others!</p>
            <Link to={createPageUrl('CreateMovement')}>
              <Button className="bg-gradient-to-r from-[#FFC947] to-[#FFD666] text-slate-900 font-black rounded-xl h-12 px-6 uppercase tracking-wide">
                Create Movement
              </Button>
            </Link>
          </div>
        ) : (
          <div className="divide-y-2 divide-slate-100">
            {myMovements.map((movement) => (
              <Link
                key={movement.id}
                to={createPageUrl(`MovementDetails?id=${movement.id}`)}
                className="block p-6 hover:bg-slate-50 transition-colors group"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-black text-lg text-slate-900 group-hover:text-[#3A3DFF] transition-colors mb-2 truncate">
                      {movement.title}
                    </h3>
                    <div className="flex items-center gap-4 text-sm mb-3">
                      <span className="text-slate-500 font-bold">
                        {safeDate(movement.created_date)}
                      </span>
                      <span className="flex items-center gap-1 font-black text-[#3A3DFF]">
                        <TrendingUp className="w-4 h-4" />
                        {movement.momentum_score > 0 ? '+' : ''}{movement.momentum_score || 0}
                      </span>
                    </div>
                    {movement.tags && movement.tags.length > 0 && (
                      <div className="flex gap-2">
                        {movement.tags.slice(0, 3).map((tag, i) => (
                          <TagBadge key={i} tag={tag} />
                        ))}
                      </div>
                    )}
                  </div>
                  <ChevronRight className="w-6 h-6 text-slate-400 group-hover:text-[#3A3DFF] transition-colors flex-shrink-0" strokeWidth={3} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </motion.div>

      {/* Following */}
      {followedMovements.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-white rounded-3xl shadow-2xl border-3 border-slate-200 overflow-hidden"
        >
          <div className="p-6 border-b-2 border-slate-200 bg-gradient-to-r from-slate-50 to-white">
            <h2 className="text-2xl font-black text-slate-900 uppercase tracking-tight">Following</h2>
          </div>
          <div className="divide-y-2 divide-slate-100">
            {followedMovements.map((movement) => (
              <Link
                key={movement.id}
                to={createPageUrl(`MovementDetails?id=${movement.id}`)}
                className="block p-6 hover:bg-slate-50 transition-colors group"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-black text-lg text-slate-900 group-hover:text-[#3A3DFF] transition-colors mb-2 truncate">
                      {movement.title}
                    </h3>
                    <div className="text-sm text-slate-500 font-bold">
                      by {movement.author_name || 'Anonymous'}
                    </div>
                  </div>
                  <ChevronRight className="w-6 h-6 text-slate-400 group-hover:text-[#3A3DFF] transition-colors flex-shrink-0" strokeWidth={3} />
                </div>
              </Link>
            ))}
          </div>
        </motion.div>
      )}

      {/* Following People */}
      {myFollowingUsers.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="bg-white rounded-3xl shadow-2xl border-3 border-slate-200 overflow-hidden"
        >
          <div className="p-6 border-b-2 border-slate-200 bg-gradient-to-r from-slate-50 to-white">
            <h2 className="text-2xl font-black text-slate-900 uppercase tracking-tight">Following People</h2>
          </div>
          <div className="divide-y-2 divide-slate-100">
            {myFollowingUsers.map((u) => {
              const email = String(u?.email || '').trim();
              if (!email) return null;
              return (
                <Link
                  key={email}
                  to={createPageUrl(`UserProfile?email=${encodeURIComponent(email)}`)}
                  className="block p-6 hover:bg-slate-50 transition-colors group"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="font-black text-lg text-slate-900 group-hover:text-[#3A3DFF] transition-colors truncate">
                        {email}
                      </div>
                    </div>
                    <ChevronRight className="w-6 h-6 text-slate-400 group-hover:text-[#3A3DFF] transition-colors flex-shrink-0" strokeWidth={3} />
                  </div>
                </Link>
              );
            })}
          </div>
        </motion.div>
      )}

      {/* Followers */}
      {myFollowers.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="bg-white rounded-3xl shadow-2xl border-3 border-slate-200 overflow-hidden"
        >
          <div className="p-6 border-b-2 border-slate-200 bg-gradient-to-r from-slate-50 to-white">
            <h2 className="text-2xl font-black text-slate-900 uppercase tracking-tight">Followers</h2>
          </div>
          <div className="divide-y-2 divide-slate-100">
            {myFollowers.map((u) => {
              const email = String(u?.email || '').trim();
              if (!email) return null;
              return (
                <Link
                  key={email}
                  to={createPageUrl(`UserProfile?email=${encodeURIComponent(email)}`)}
                  className="block p-6 hover:bg-slate-50 transition-colors group"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="font-black text-lg text-slate-900 group-hover:text-[#3A3DFF] transition-colors truncate">
                        {email}
                      </div>
                    </div>
                    <ChevronRight className="w-6 h-6 text-slate-400 group-hover:text-[#3A3DFF] transition-colors flex-shrink-0" strokeWidth={3} />
                  </div>
                </Link>
              );
            })}
          </div>
        </motion.div>
      )}
    </div>
  );
}