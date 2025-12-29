import { entities } from '@/api/appClient';

function normalizeEmail(email) {
  const s = String(email || '').trim().toLowerCase();
  return s || null;
}

export async function fetchOrCreateUserChallengeStats(userEmail) {
  const email = normalizeEmail(userEmail);
  if (!email) return null;

  const existing = await entities.UserChallengeStats.filter({ user_email: email });
  if (Array.isArray(existing) && existing.length > 0) return existing[0];

  return entities.UserChallengeStats.create({
    user_email: email,
    total_points: 0,
    current_streak: 0,
    total_challenges_completed: 0,
    unlocked_profile_accents: [],
    unlocked_post_flair: [],
    unlocked_profile_badges: [],
    created_at: new Date().toISOString(),
  });
}

export async function unlockExpressionReward(userEmail, reward) {
  const email = normalizeEmail(userEmail);
  if (!email) throw new Error('Missing user email');

  const stats = await fetchOrCreateUserChallengeStats(email);
  if (!stats?.id) throw new Error('Missing stats record');

  const totalPoints = Number(stats?.total_points || 0);
  const cost = Number(reward?.points || 0);
  if (!Number.isFinite(cost) || cost <= 0) throw new Error('Invalid reward');

  const type = String(reward?.type || '');
  const rewardId = String(reward?.id || '');
  if (!rewardId) throw new Error('Invalid reward');

  const unlockedAccents = Array.isArray(stats?.unlocked_profile_accents) ? stats.unlocked_profile_accents : [];
  const unlockedFlair = Array.isArray(stats?.unlocked_post_flair) ? stats.unlocked_post_flair : [];
  const unlockedBadges = Array.isArray(stats?.unlocked_profile_badges) ? stats.unlocked_profile_badges : [];

  const alreadyUnlocked =
    (type === 'accent' && unlockedAccents.includes(rewardId)) ||
    (type === 'flair' && unlockedFlair.includes(rewardId)) ||
    (type === 'badge' && unlockedBadges.includes(rewardId));

  if (alreadyUnlocked) return stats;
  if (totalPoints < cost) throw new Error('Not enough points');

  const updates = { total_points: totalPoints - cost };
  if (type === 'accent') updates.unlocked_profile_accents = [...new Set([...unlockedAccents, rewardId])];
  else if (type === 'flair') updates.unlocked_post_flair = [...new Set([...unlockedFlair, rewardId])];
  else if (type === 'badge') updates.unlocked_profile_badges = [...new Set([...unlockedBadges, rewardId])];
  else throw new Error('Invalid reward type');

  return entities.UserChallengeStats.update(stats.id, updates);
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function yesterdayKey() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function getEffectiveCurrentStreak(stats) {
  const last = stats?.last_completion_date ? String(stats.last_completion_date) : null;
  if (!last) return 0;
  const t = todayKey();
  const y = yesterdayKey();
  if (last === t || last === y) return Number(stats?.current_streak || 0) || 0;
  return 0;
}

export async function listChallengeCompletions({ userEmail } = {}) {
  const email = normalizeEmail(userEmail);
  if (email) return entities.ChallengeCompletion.filter({ user_email: email });
  return entities.ChallengeCompletion.list();
}

export async function recordChallengeCompletion(userEmail, challenge, completionPayload) {
  const email = normalizeEmail(userEmail);
  if (!email) throw new Error('Missing user email');
  if (!challenge?.id) throw new Error('Missing challenge');

  const t = todayKey();
  const challengeId = String(challenge.id);
  const points = Number(challenge?.points || 0) || 0;

  const evidenceType = String(completionPayload?.evidence_type || 'none');
  const evidenceText = completionPayload?.evidence_text ? String(completionPayload.evidence_text) : null;
  const evidenceImageUrl = completionPayload?.evidence_image_url ? String(completionPayload.evidence_image_url) : null;
  const isVerified = evidenceType !== 'none' && (evidenceType === 'text' || evidenceType === 'image');

  // Prevent duplicate completion of the same challenge on the same day.
  const existingToday = await entities.ChallengeCompletion.filter({
    user_email: email,
    challenge_id: challengeId,
    date: t,
  });
  if (Array.isArray(existingToday) && existingToday.length > 0) return existingToday[0];

  const completion = await entities.ChallengeCompletion.create({
    user_email: email,
    challenge_id: challengeId,
    date: t,
    points,
    evidence_type: evidenceType,
    evidence_text: evidenceText,
    evidence_image_url: evidenceImageUrl,
    is_verified: !!isVerified,
    created_at: new Date().toISOString(),
  });

  // Update aggregated stats.
  const stats = await fetchOrCreateUserChallengeStats(email);
  if (!stats?.id) return completion;

  const last = stats?.last_completion_date ? String(stats.last_completion_date) : null;
  const y = yesterdayKey();
  const didAdvanceStreak = last !== t;

  const prevEffectiveStreak = getEffectiveCurrentStreak(stats);
  let nextStreak = prevEffectiveStreak;
  if (didAdvanceStreak) {
    if (last === y) nextStreak = prevEffectiveStreak + 1;
    else nextStreak = 1;
  }

  const nextLongest = Math.max(Number(stats?.longest_streak || 0) || 0, nextStreak);
  const nextTotalChallengesCompleted = (Number(stats?.total_challenges_completed || 0) || 0) + 1;

  let nextPoints = (Number(stats?.total_points || 0) || 0) + points;
  let awardedBonus = 0;

  // Award streak bonuses at milestones once per day.
  const alreadyAwardedToday = String(stats?.last_streak_bonus_date || '') === t;
  if (!alreadyAwardedToday && didAdvanceStreak) {
    const milestoneBonuses = {
      1: 5,
      3: 15,
      7: 40,
      30: 200,
    };
    const bonus = milestoneBonuses[nextStreak] || 0;
    if (bonus > 0) {
      awardedBonus = bonus;
      nextPoints += bonus;
    }
  }

  await entities.UserChallengeStats.update(stats.id, {
    total_points: nextPoints,
    total_challenges_completed: nextTotalChallengesCompleted,
    current_streak: nextStreak,
    longest_streak: nextLongest,
    last_completion_date: t,
    last_streak_bonus_date: awardedBonus > 0 ? t : (stats?.last_streak_bonus_date || null),
  });

  return completion;
}
