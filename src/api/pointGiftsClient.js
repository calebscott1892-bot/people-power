import { entities } from '@/api/appClient';
import { fetchOrCreateUserChallengeStats } from '@/api/userChallengeStatsClient';

function normalizeEmail(email) {
  const s = String(email || '').trim().toLowerCase();
  return s || null;
}

export async function giftPoints(fromUserEmail, toUserEmail, { amount, message } = {}) {
  const fromEmail = normalizeEmail(fromUserEmail);
  const toEmail = normalizeEmail(toUserEmail);
  if (!fromEmail || !toEmail) throw new Error('Missing users');
  if (fromEmail === toEmail) throw new Error("You can't gift points to yourself");

  const pts = Number(amount || 0);
  if (!Number.isFinite(pts) || pts <= 0) throw new Error('Invalid amount');

  const fromStats = await fetchOrCreateUserChallengeStats(fromEmail);
  const toStats = await fetchOrCreateUserChallengeStats(toEmail);

  const fromTotal = Number(fromStats?.total_points || 0) || 0;
  const maxGiftable = Math.floor(fromTotal * 0.2);
  if (pts < 5) throw new Error('Minimum gift is 5 points');
  if (pts > maxGiftable) throw new Error(`You can gift up to ${maxGiftable} points (20% of your total)`);

  const nextFromTotal = fromTotal - pts;
  const toTotal = Number(toStats?.total_points || 0) || 0;
  const nextToTotal = toTotal + pts;

  if (fromStats?.id) {
    await entities.UserChallengeStats.update(fromStats.id, { total_points: nextFromTotal });
  }
  if (toStats?.id) {
    await entities.UserChallengeStats.update(toStats.id, { total_points: nextToTotal });
  }

  const record = await entities.PointGift.create({
    from_user_email: fromEmail,
    to_user_email: toEmail,
    amount: pts,
    message: message ? String(message).slice(0, 200) : null,
    created_at: new Date().toISOString(),
  });

  return record;
}
