import React, { useMemo, useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { 
  User, Calendar, Zap, LogOut, 
  Plus, ChevronRight, Loader2, TrendingUp, Trophy, Flame, Shield
} from 'lucide-react';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import TagBadge from '../components/shared/TagBadge';
import { useAuth } from '@/auth/AuthProvider';
import { fetchMovementsPage, fetchMyFollowedMovements } from '@/api/movementsClient';
import EditProfileModal from '../components/profile/EditProfileModal';
import ShareButton from '@/components/shared/ShareButton';
import { entities } from '@/api/appClient';
import { fetchMyFollowers, fetchMyFollowingUsers } from '@/api/userFollowsClient';
import { fetchOrCreateUserChallengeStats } from '@/api/userChallengeStatsClient';
import { sanitizePublicLocation } from '@/utils/locationPrivacy';
import { logError } from '@/utils/logError';
import { fetchMyProfile } from '@/api/userProfileClient';
import { fetchMyBlocks, unblockUser } from '@/api/blocksClient';
import { allowLocalProfileFallback } from '@/utils/localFallback';
import { toast } from 'sonner';

function getMovementAuthorLabel(movement) {
  const displayName = String(
    movement?.creator_display_name ||
    movement?.author_display_name ||
    ''
  ).trim();
  const usernameRaw = String(
    movement?.creator_username ||
    movement?.author_username ||
    ''
  ).trim();
  const username = usernameRaw ? usernameRaw.replace(/^@/, '') : '';
  const fallback = String(movement?.author_name || movement?.creator_name || '').trim();
  const safeFallback = fallback && !fallback.includes('@') ? fallback : '';
  return displayName || (username ? `@${username}` : (safeFallback || 'Member'));
}

function getPublicProfilePath(user) {
  const raw = String(user?.username || '').trim().replace(/^@/, '');
  return raw ? `/u/${encodeURIComponent(raw)}` : null;
}

export default function Profile() {
  const { user: authUser, session, loading: authLoading, logout, isAdmin } = useAuth();
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showEditModal, setShowEditModal] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const accessToken = session?.access_token || null;

  useEffect(() => {
    if (authLoading) return;
    setUser(authUser ?? null);
    setIsLoading(false);
  }, [authUser, authLoading]);

  const { data: myMovements = [] } = useQuery({
    queryKey: ['myMovements', user?.email],
    queryFn: async () => {
      const all = await fetchMovementsPage({
        mine: true,
        limit: 200,
        offset: 0,
        fields: [
          'id',
          'title',
          'creator_display_name',
          'creator_username',
          'author_display_name',
          'author_username',
          'created_at',
          'created_date',
          'momentum_score',
          'tags',
        ].join(','),
        accessToken,
      });
      return all;
    },
    enabled: !!user?.email && !!accessToken
  });

  const { data: userProfile } = useQuery({
    queryKey: ['userProfile', user?.email],
    queryFn: async () => {
      if (!user?.email) return null;
      const token = accessToken ? String(accessToken) : null;
      try {
        if (token) {
          const profile = await fetchMyProfile({ accessToken: token });
          if (profile) return { ...profile, location: sanitizePublicLocation(profile?.location) };
        }
      } catch {
        // fall back to migration-mode cache
      }
      if (!allowLocalProfileFallback) return null;
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

  const resolvedProfile = useMemo(() => {
    const base = userProfile && typeof userProfile === 'object' ? userProfile : {};
    return { ...base };
  }, [userProfile]);

  const safeHandle = useMemo(() => {
    const emailLocal = String(user?.email || '').split('@')[0]?.toLowerCase() || '';
    const rawUsername = resolvedProfile?.username ? String(resolvedProfile.username) : '';
    const rawDisplay = resolvedProfile?.display_name || '';
    const candidate = rawUsername || rawDisplay;
    const trimmed = String(candidate || '').trim();
    if (trimmed) return trimmed.toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (emailLocal) return `member-${emailLocal.slice(0, 3)}${emailLocal.length}`;
    return 'member';
  }, [resolvedProfile, user]);

  const profilePhotoUrl = useMemo(() => {
    const raw =
      resolvedProfile?.profile_photo_url ||
      resolvedProfile?.avatar_url ||
      '';
    const trimmed = String(raw || '').trim();
    return trimmed || '';
  }, [resolvedProfile]);

  const formatPublicUserLabel = (u) => {
    const display = u?.display_name || u?.username || u?.name;
    if (display) return String(display);
    const email = String(u?.email || '').trim();
    if (!email) return 'Member';
    let hash = 0;
    for (let i = 0; i < email.length; i += 1) {
      hash = (hash * 31 + email.charCodeAt(i)) % 10000;
    }
    return `Member #${String(hash).padStart(4, '0')}`;
  };

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

  const { data: myBlocks } = useQuery({
    queryKey: ['myBlocks', user?.email],
    queryFn: async () => fetchMyBlocks({ accessToken }),
    enabled: !!user?.email && !!accessToken,
  });

  const unblockMutation = useMutation({
    mutationFn: async (email) => {
      if (!email) throw new Error('Missing user');
      return unblockUser(email, { accessToken });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['myBlocks', user?.email] });
      toast.success('User unblocked');
    },
    onError: (e) => toast.error(e?.message || 'Failed to unblock user'),
  });

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/');
    } catch (e) {
      logError(e, 'Sign out failed');
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
        {resolvedProfile?.banner_url ? (
          <div className="h-24 sm:h-32 bg-cover bg-center" style={{ backgroundImage: `url(${resolvedProfile.banner_url})` }} />
        ) : (
          <div className="h-24 sm:h-32 bg-gradient-to-r from-[#3A3DFF] via-[#5B5EFF] to-[#3A3DFF]" />
        )}
        
        {/* Profile Info */}
        <div className="px-4 sm:px-8 pb-6 sm:pb-8">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-6 mb-6 sm:mb-8">
            <div className="flex items-start gap-4 sm:gap-6">
              <div className="w-24 h-24 sm:w-32 sm:h-32 -mt-12 sm:-mt-16 bg-white rounded-full shadow-2xl flex items-center justify-center border-4 border-white overflow-hidden">
                {profilePhotoUrl ? (
                  <img src={profilePhotoUrl} alt="" className="w-full h-full rounded-full object-cover" />
                ) : (
                  <div className="w-20 h-20 sm:w-28 sm:h-28 bg-gradient-to-br from-[#FFC947] to-[#FFD666] rounded-full flex items-center justify-center">
                    <span className="text-3xl sm:text-5xl font-black text-slate-900">
                      {(resolvedProfile?.display_name?.[0] || user?.full_name?.[0] || resolvedProfile?.username?.[0] || safeHandle?.[0] || '?').toUpperCase()}
                    </span>
                  </div>
                )}
              </div>
              <div className="pt-2 sm:pt-4 flex-1">
                <h1 className="text-2xl sm:text-3xl font-black text-slate-900 mb-1">
                  {resolvedProfile?.display_name || user?.full_name || 'Anonymous User'}
                </h1>
                <p className="text-sm text-slate-500 font-semibold">
                  @{safeHandle || 'member'}
                </p>
                {isAdmin ? (
                  <span className="inline-flex mt-2 px-2 py-1 rounded-full bg-red-100 text-red-700 text-[10px] font-black uppercase">
                    Admin
                  </span>
                ) : null}
                {resolvedProfile?.bio ? (
                  <p className="mt-2 text-sm sm:text-base text-slate-700 whitespace-pre-line">
                    {resolvedProfile.bio}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="sm:pt-4 flex flex-col sm:flex-row gap-3">
              <Button
                onClick={() => setShowEditModal(true)}
                variant="outline"
                className="h-12 font-bold rounded-xl border-2 border-slate-300 uppercase tracking-wide"
              >
                Edit
              </Button>
              <ShareButton profile={resolvedProfile} label="Share profile" variant="outline" />
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
                <Button
                  asChild
                  size="sm"
                  className="bg-[#3A3DFF] hover:bg-[#2A2DDD] rounded-lg font-bold text-xs"
                >
                  <Link
                    to={createPageUrl('DailyChallenges')}
                    state={{ fromLabel: 'Profile', fromPath: createPageUrl('Profile') }}
                  >
                    View Challenges
                  </Link>
                </Button>
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
          {user?.created_date ? (
            <div className="space-y-3 mb-6 p-4 bg-slate-50 rounded-2xl border-2 border-slate-200">
              {/* Email intentionally hidden for privacy. */}
              <div className="flex items-center gap-3 text-slate-600">
                <Calendar className="w-5 h-5 text-slate-400" />
                <span className="font-bold">Joined {format(new Date(user.created_date), 'MMMM yyyy')}</span>
              </div>
            </div>
          ) : null}

          {/* Admin Dashboard Link */}
          {isAdmin && (
            <Link
              to={createPageUrl('AdminDashboard')}
              state={{ fromLabel: 'Profile', fromPath: createPageUrl('Profile') }}
            >
              <Button
                variant="outline"
                className="w-full h-12 font-bold rounded-xl border-2 border-red-300 text-red-700 hover:bg-red-50 uppercase tracking-wide mb-3"
              >
                <Shield className="w-4 h-4 mr-2" />
                Admin Panel
              </Button>
            </Link>
          )}

          {/* Blocked users */}
          <div className="mb-6 rounded-2xl border-2 border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-black text-slate-900 uppercase tracking-wider">
                Blocked users
              </div>
            </div>
            <p className="text-xs text-slate-600 font-semibold mb-3">
              Blocking hides your profile, movements, and messages from each other. They won’t be notified.
            </p>
            {Array.isArray(myBlocks?.blocked) && myBlocks.blocked.length > 0 ? (
              <div className="space-y-2">
                {myBlocks.blocked.map((entry) => {
                  const label =
                    entry?.display_name ||
                    (entry?.username ? `@${entry.username}` : 'Blocked user');
                  return (
                    <div
                      key={String(entry?.email || entry?.username || label)}
                      className="flex items-center justify-between gap-3 rounded-xl bg-white px-3 py-2"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-slate-800 truncate">
                          {label}
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-9 rounded-lg border-slate-200 text-xs font-bold"
                        disabled={unblockMutation.isPending}
                        onClick={() => unblockMutation.mutate(String(entry?.email || '').trim())}
                      >
                        Unblock
                      </Button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-xs text-slate-500 font-semibold">
                You haven’t blocked anyone yet.
              </div>
            )}
          </div>

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
        profile={resolvedProfile}
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
                to={`/movement/${encodeURIComponent(String(movement.id))}`}
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
                to={`/movement/${encodeURIComponent(String(movement.id))}`}
                className="block p-6 hover:bg-slate-50 transition-colors group"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-black text-lg text-slate-900 group-hover:text-[#3A3DFF] transition-colors mb-2 truncate">
                      {movement.title}
                    </h3>
              <div className="text-sm text-slate-500 font-bold">
                by {getMovementAuthorLabel(movement)}
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
              const label = formatPublicUserLabel(u);
              const profilePath = getPublicProfilePath(u);
              const content = (
                <div className="flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="font-black text-lg text-slate-900 group-hover:text-[#3A3DFF] transition-colors truncate">
                      {label}
                    </div>
                  </div>
                  <ChevronRight className="w-6 h-6 text-slate-400 group-hover:text-[#3A3DFF] transition-colors flex-shrink-0" strokeWidth={3} />
                </div>
              );
              return profilePath ? (
                <Link
                  key={email}
                  to={profilePath}
                  className="block p-6 hover:bg-slate-50 transition-colors group"
                >
                  {content}
                </Link>
              ) : (
                <div key={email} className="block p-6 bg-white">
                  {content}
                </div>
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
              const label = formatPublicUserLabel(u);
              const profilePath = getPublicProfilePath(u);
              const content = (
                <div className="flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="font-black text-lg text-slate-900 group-hover:text-[#3A3DFF] transition-colors truncate">
                      {label}
                    </div>
                  </div>
                  <ChevronRight className="w-6 h-6 text-slate-400 group-hover:text-[#3A3DFF] transition-colors flex-shrink-0" strokeWidth={3} />
                </div>
              );
              return profilePath ? (
                <Link
                  key={email}
                  to={profilePath}
                  className="block p-6 hover:bg-slate-50 transition-colors group"
                >
                  {content}
                </Link>
              ) : (
                <div key={email} className="block p-6 bg-white">
                  {content}
                </div>
              );
            })}
          </div>
        </motion.div>
      )}
    </div>
  );
}
