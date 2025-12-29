import React, { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, UserPlus, UserMinus, Loader2, Zap, TrendingUp, Trophy, MessageCircle, Edit } from 'lucide-react';
import { motion } from 'framer-motion';
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import TagBadge from '../components/shared/TagBadge';
import EditProfileModal from '../components/profile/EditProfileModal';
import GamificationWidget from '../components/gamification/GamificationWidget';
import GiftPointsModal from '@/components/challenges/GiftPointsModal';
import { entities } from '@/api/appClient';
import { useAuth } from '@/auth/AuthProvider';
import { fetchUserFollow, setUserFollow } from '@/api/userFollowsClient';
import { checkActionAllowed, formatWaitMs } from '@/utils/antiBrigading';
import { createConversation } from '@/api/messagesClient';
import { fetchOrCreateUserChallengeStats } from '@/api/userChallengeStatsClient';
import { giftPoints } from '@/api/pointGiftsClient';
import { fetchMovementsPage } from '@/api/movementsClient';

export default function UserProfile() {
  const navigate = useNavigate();
  const { email: emailParam } = useParams();
  const [searchParams] = useSearchParams();
  const { user, session } = useAuth();
  const accessToken = session?.access_token || null;
  const profileEmail = useMemo(() => {
    const fromParam = emailParam ? String(emailParam) : '';
    const fromQuery = searchParams?.get('email') ? String(searchParams.get('email')) : '';
    const raw = (fromParam || fromQuery || '').trim();
    return raw || null;
  }, [emailParam, searchParams]);
  const [currentUser, setCurrentUser] = useState(null);
  const [isFollowing, setIsFollowing] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showGiftModal, setShowGiftModal] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    setCurrentUser(user || null);
  }, [user]);

  const { data: followState } = useQuery({
    queryKey: ['userFollow', profileEmail, currentUser?.email],
    queryFn: async () => fetchUserFollow(profileEmail, { accessToken }),
    enabled: !!accessToken && !!profileEmail && !!currentUser?.email,
  });

  useEffect(() => {
    if (followState && typeof followState.following === 'boolean' && profileEmail !== currentUser?.email) {
      setIsFollowing(!!followState.following);
    }
  }, [followState, profileEmail, currentUser?.email]);

  const { data: userProfile, isLoading: profileLoading } = useQuery({
    queryKey: ['userProfile', profileEmail],
    queryFn: async () => {
      const profiles = await entities.UserProfile.filter({ user_email: profileEmail });
      if (profiles.length > 0) return profiles[0];
      
      // Create profile if doesn't exist
      const users = await entities.User.filter({ email: profileEmail });
      if (users.length === 0) return null;
      
      const user = users[0];
      return entities.UserProfile.create({
        user_email: user.email,
        display_name: user.full_name,
        username: user.email.split('@')[0],
        bio: '',
        followers_count: 0,
        following_count: 0
      });
    },
    enabled: !!profileEmail
  });

  const { data: userMovements = [] } = useQuery({
    queryKey: ['userMovements', profileEmail],
    queryFn: async () => {
      const email = profileEmail ? String(profileEmail) : null;
      if (!email) return [];
      const all = await fetchMovementsPage({
        limit: 500,
        offset: 0,
        fields: [
          'id',
          'title',
          'tags',
          'momentum_score',
          'author_email',
          'author_name',
          'created_at',
          'created_date',
        ].join(','),
      });
      return (Array.isArray(all) ? all : [])
        .filter((m) => String(m?.author_email || '').toLowerCase() === String(email).toLowerCase())
        .sort((a, b) => String(b?.created_at || b?.created_date || '').localeCompare(String(a?.created_at || a?.created_date || '')));
    },
    enabled: !!profileEmail
  });

  const { data: participatedMovements = [] } = useQuery({
    queryKey: ['participatedMovements', profileEmail],
    queryFn: async () => {
      const participations = await entities.Participation.filter({ user_email: profileEmail });
      if (participations.length === 0) return [];
      
      const movementIds = new Set(
        participations
          .map((p) => (p?.movement_id == null ? '' : String(p.movement_id)))
          .filter(Boolean)
      );
      if (movementIds.size === 0) return [];

      const all = await fetchMovementsPage({
        limit: 500,
        offset: 0,
        fields: [
          'id',
          'title',
          'tags',
          'momentum_score',
          'author_email',
          'author_name',
          'created_at',
          'created_date',
        ].join(','),
      });

      return (Array.isArray(all) ? all : [])
        .filter((m) => movementIds.has(String(m?.id || '')))
        .sort((a, b) => String(b?.created_at || b?.created_date || '').localeCompare(String(a?.created_at || a?.created_date || '')));
    },
    enabled: !!profileEmail
  });

  const { data: userStats } = useQuery({
    queryKey: ['userChallengeStats', profileEmail],
    queryFn: async () => {
      return fetchOrCreateUserChallengeStats(profileEmail);
    },
    enabled: !!profileEmail
  });

  const { data: myStats } = useQuery({
    queryKey: ['userChallengeStats', currentUser?.email],
    queryFn: async () => {
      if (!currentUser?.email) return null;
      return fetchOrCreateUserChallengeStats(currentUser.email);
    },
    enabled: !!currentUser?.email,
  });

  const toggleFollowMutation = useMutation({
    mutationFn: async () => {
      if (!accessToken) throw new Error('Sign in to follow');
      if (!currentUser?.email || !profileEmail) throw new Error('Missing profile');

      const nextFollowing = !isFollowing;
      if (nextFollowing) {
        const rateCheck = await checkActionAllowed({
          email: currentUser?.email ?? null,
          action: 'user_follow',
          contextId: profileEmail,
          accessToken,
        });
        if (!rateCheck?.ok) {
          const wait = rateCheck?.retryAfterMs ? ` Try again in ${formatWaitMs(rateCheck.retryAfterMs)}.` : '';
          throw new Error(String(rateCheck?.reason || 'Please slow down.') + wait);
        }
      }

      return setUserFollow(profileEmail, !isFollowing, { accessToken });
    },
    onSuccess: async (next) => {
      setIsFollowing(!!next?.following);
      await queryClient.invalidateQueries({ queryKey: ['userFollow', profileEmail, currentUser?.email] });
      toast.success(next?.following ? 'Following!' : 'Unfollowed');
    },
    onError: (e) => toast.error(e?.message || 'Failed to update follow'),
  });

  if (profileLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-32">
        <Loader2 className="w-12 h-12 text-[#3A3DFF] animate-spin mb-4" />
        <p className="text-slate-500 font-bold">Loading profile...</p>
      </div>
    );
  }

  if (!userProfile) {
    return (
      <div className="flex flex-col items-center justify-center py-32">
        <h2 className="text-2xl font-black text-slate-900 mb-2">User not found</h2>
        <Link to={createPageUrl('Home')}>
          <Button>Back to Home</Button>
        </Link>
      </div>
    );
  }

  const isOwnProfile = currentUser?.email === profileEmail;
  const displayedFollowersCount = followState?.followers_count ?? userProfile.followers_count ?? 0;
  const displayedFollowingCount = followState?.following_count ?? userProfile.following_count ?? 0;

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <Link to={createPageUrl('Home')} className="inline-flex items-center gap-2 text-slate-600 hover:text-slate-900 group font-bold">
        <ArrowLeft className="w-5 h-5 group-hover:-translate-x-1 transition-transform" strokeWidth={2.5} />
        Back
      </Link>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-3xl shadow-2xl border-3 border-slate-200 overflow-hidden"
      >
        {userProfile.banner_url ? (
          <div className="h-32 bg-cover bg-center" style={{ backgroundImage: `url(${userProfile.banner_url})` }} />
        ) : (
          <div className="h-32 bg-gradient-to-r from-[#3A3DFF] via-[#5B5EFF] to-[#3A3DFF]" />
        )}
        
        <div className="px-8 pb-8">
          <div className="flex items-start justify-between gap-6 mb-6">
            <div className="flex items-start gap-6">
              <div className="w-32 h-32 -mt-16 bg-white rounded-3xl shadow-2xl flex items-center justify-center border-4 border-white">
                {userProfile.profile_photo_url ? (
                  <img src={userProfile.profile_photo_url} alt="" className="w-full h-full rounded-2xl object-cover" />
                ) : (
                  <div className="w-28 h-28 bg-gradient-to-br from-[#FFC947] to-[#FFD666] rounded-2xl flex items-center justify-center">
                    <span className="text-5xl font-black text-slate-900">
                      {(userProfile.display_name?.[0] || userProfile.username?.[0] || '?').toUpperCase()}
                    </span>
                  </div>
                )}
              </div>
              <div className="pt-4">
                <h1 className="text-3xl font-black text-slate-900 mb-1">
                  {userProfile.display_name || 'Anonymous'}
                </h1>
                <p className="text-sm text-slate-500 font-semibold">@{userProfile.username}</p>
              </div>
            </div>
            
            {isOwnProfile && (
              <div className="pt-4 flex gap-3">
                <Button
                  onClick={() => setShowEditModal(true)}
                  variant="outline"
                  className="h-12 font-bold rounded-xl border-2 border-slate-300 uppercase tracking-wide"
                >
                  <Edit className="w-4 h-4 mr-2" />
                  Edit
                </Button>
              </div>
            )}

            {!isOwnProfile && currentUser && (
              <div className="pt-4 flex gap-3">
                <Button
                  onClick={() => toggleFollowMutation.mutate()}
                  disabled={toggleFollowMutation.isPending}
                  className={cn(
                    "h-12 font-bold rounded-xl uppercase tracking-wide",
                    isFollowing
                      ? "bg-slate-200 hover:bg-slate-300 text-slate-700"
                      : "bg-gradient-to-r from-[#3A3DFF] to-[#5B5EFF] hover:from-[#2A2DDD] hover:to-[#4B4EFF] text-white"
                  )}
                >
                  {isFollowing ? (
                    <>
                      <UserMinus className="w-4 h-4 mr-2" />
                      Unfollow
                    </>
                  ) : (
                    <>
                      <UserPlus className="w-4 h-4 mr-2" />
                      Follow
                    </>
                  )}
                </Button>
                <Button
                  onClick={async () => {
                    try {
                      if (!accessToken) throw new Error('Sign in to message');
                      const convo = await createConversation(profileEmail, { accessToken });
                      const id = convo?.id ? String(convo.id) : null;
                      navigate(id ? `/Messages?conversationId=${encodeURIComponent(id)}` : '/Messages');
                    } catch (e) {
                      toast.error(e?.message || 'Failed to start conversation');
                    }
                  }}
                  variant="outline"
                  className="h-12 font-bold rounded-xl border-2 border-slate-300 uppercase tracking-wide"
                >
                  <MessageCircle className="w-4 h-4 mr-2" />
                  Message
                </Button>

                <Button
                  onClick={() => {
                    if (!currentUser?.email) {
                      toast.error('Sign in to gift points');
                      return;
                    }
                    setShowGiftModal(true);
                  }}
                  variant="outline"
                  className="h-12 font-bold rounded-xl border-2 border-slate-300 uppercase tracking-wide"
                >
                  <Trophy className="w-4 h-4 mr-2" />
                  Gift points
                </Button>
              </div>
            )}
          </div>

          {userProfile.bio && (
            <p className="text-slate-700 mb-6 text-lg">{userProfile.bio}</p>
          )}

          {userProfile.skills && userProfile.skills.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider mb-3">Skills & Expertise</h3>
              <div className="flex flex-wrap gap-2">
                {userProfile.skills.map((skill, i) => (
                  <span
                    key={i}
                    className="px-3 py-1.5 bg-gradient-to-r from-[#3A3DFF] to-[#5B5EFF] text-white rounded-lg text-sm font-bold shadow-md"
                  >
                    {skill}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            <div className="bg-gradient-to-br from-indigo-50 to-white p-5 rounded-2xl border-2 border-indigo-200 text-center">
              <div className="text-3xl font-black text-[#3A3DFF] mb-1">
                {displayedFollowersCount}
              </div>
              <div className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                Followers
              </div>
            </div>
            
            <div className="bg-gradient-to-br from-yellow-50 to-white p-5 rounded-2xl border-2 border-yellow-200 text-center">
              <div className="text-3xl font-black text-[#FFC947] mb-1">
                {displayedFollowingCount}
              </div>
              <div className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                Following
              </div>
            </div>
            
            <div className="bg-gradient-to-br from-slate-50 to-white p-5 rounded-2xl border-2 border-slate-200 text-center">
              <div className="text-3xl font-black text-slate-900 mb-1">
                {userMovements.length}
              </div>
              <div className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                Movements
              </div>
            </div>

            <div className="bg-gradient-to-br from-purple-50 to-white p-5 rounded-2xl border-2 border-purple-200 text-center">
              <div className="text-3xl font-black text-purple-600 mb-1">
                {userStats?.total_points || 0}
              </div>
              <div className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                Points
              </div>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Gamification Widget */}
      <GamificationWidget userEmail={profileEmail} />

      {/* Movement History */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-white rounded-3xl shadow-2xl border-3 border-slate-200 overflow-hidden"
      >
        <div className="p-6 border-b-2 border-slate-200 bg-gradient-to-r from-slate-50 to-white">
          <h2 className="text-2xl font-black text-slate-900 uppercase tracking-tight">Movement History</h2>
        </div>

        {userMovements.length === 0 && participatedMovements.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-slate-500 font-bold">No movements yet</p>
          </div>
        ) : (
          <div className="p-6 space-y-6">
            {/* Created Movements */}
            {userMovements.length > 0 && (
              <div>
                <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider mb-3 flex items-center gap-2">
                  <Zap className="w-4 h-4 text-[#FFC947]" fill="#FFC947" />
                  Created ({userMovements.length})
                </h3>
                <div className="space-y-2">
                  {userMovements.map((movement) => (
                    <Link
                      key={movement.id}
                      to={createPageUrl(`MovementDetails?id=${movement.id}`)}
                      className="block p-4 hover:bg-slate-50 transition-colors group rounded-xl border-2 border-slate-200"
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <h4 className="font-black text-slate-900 group-hover:text-[#3A3DFF] transition-colors mb-1 truncate">
                            {movement.title}
                          </h4>
                          {movement.tags && movement.tags.length > 0 && (
                            <div className="flex gap-2">
                              {movement.tags.slice(0, 3).map((tag, i) => (
                                <TagBadge key={i} tag={tag} />
                              ))}
                            </div>
                          )}
                        </div>
                        <span className="flex items-center gap-1 font-black text-[#3A3DFF]">
                          <TrendingUp className="w-4 h-4" />
                          {movement.momentum_score > 0 ? '+' : ''}{movement.momentum_score || 0}
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Participated Movements */}
            {participatedMovements.length > 0 && (
              <div>
                <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider mb-3 flex items-center gap-2">
                  <Trophy className="w-4 h-4 text-purple-600" />
                  Participated ({participatedMovements.length})
                </h3>
                <div className="space-y-2">
                  {participatedMovements.map((movement) => (
                    <Link
                      key={movement.id}
                      to={createPageUrl(`MovementDetails?id=${movement.id}`)}
                      className="block p-4 hover:bg-slate-50 transition-colors group rounded-xl border-2 border-slate-200"
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <h4 className="font-black text-slate-900 group-hover:text-[#3A3DFF] transition-colors mb-1 truncate">
                            {movement.title}
                          </h4>
                          {movement.tags && movement.tags.length > 0 && (
                            <div className="flex gap-2">
                              {movement.tags.slice(0, 3).map((tag, i) => (
                                <TagBadge key={i} tag={tag} />
                              ))}
                            </div>
                          )}
                        </div>
                        <span className="text-xs font-bold text-slate-500 uppercase">
                          by {movement.author_name}
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </motion.div>

      <EditProfileModal
        open={showEditModal}
        onClose={() => setShowEditModal(false)}
        profile={userProfile}
        userEmail={profileEmail}
        userStats={userStats}
      />

      {!isOwnProfile && currentUser?.email && myStats ? (
        <GiftPointsModal
          open={showGiftModal}
          onClose={() => setShowGiftModal(false)}
          fromUser={{ display_name: currentUser?.full_name || currentUser?.email }}
          toUser={userProfile}
          userStats={myStats}
          onGift={async ({ amount, message }) => {
            await giftPoints(currentUser.email, profileEmail, { amount, message });
            await queryClient.invalidateQueries({ queryKey: ['userChallengeStats'] });
            toast.success('Gift sent');
          }}
        />
      ) : null}
    </div>
  );
}