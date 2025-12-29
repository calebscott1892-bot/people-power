import React from 'react';
import { motion } from 'framer-motion';
import { Sparkles, Lock, Check } from 'lucide-react';
import { cn } from "@/lib/utils";
import { toast } from 'sonner';

const REWARDS = [
  { id: 'border_blue', name: 'Blue Glow Border', points: 50, type: 'accent' },
  { id: 'border_gold', name: 'Gold Border', points: 100, type: 'accent' },
  { id: 'border_rainbow', name: 'Rainbow Border', points: 200, type: 'accent' },
  { id: 'flair_star', name: '⭐ Star Flair', points: 75, type: 'flair' },
  { id: 'flair_fire', name: '🔥 Fire Flair', points: 150, type: 'flair' },
  { id: 'flair_heart', name: '💚 Heart Flair', points: 125, type: 'flair' },
  { id: 'badge_helper', name: 'Community Helper Badge', points: 250, type: 'badge' },
  { id: 'badge_creator', name: 'Movement Creator Badge', points: 300, type: 'badge' },
];

export default function ExpressionRewardsPanel({ userStats, onUnlock }) {
  const [unlockingId, setUnlockingId] = React.useState(null);
  const unlockedAccents = userStats.unlocked_profile_accents || [];
  const unlockedFlair = userStats.unlocked_post_flair || [];
  const unlockedBadges = userStats.unlocked_profile_badges || [];

  const isUnlocked = (reward) => {
    if (reward.type === 'accent') return unlockedAccents.includes(reward.id);
    if (reward.type === 'flair') return unlockedFlair.includes(reward.id);
    if (reward.type === 'badge') return unlockedBadges.includes(reward.id);
    return false;
  };

  const canUnlock = (reward) => {
    return userStats.total_points >= reward.points && !isUnlocked(reward);
  };

  const handleUnlock = async (reward) => {
    if (!onUnlock) return;
    if (!reward) return;
    if (!canUnlock(reward)) return;

    setUnlockingId(reward.id);
    try {
      await onUnlock(reward);
      toast.success('Unlocked!');
    } catch (e) {
      toast.error(String(e?.message || 'Failed to unlock'));
    } finally {
      setUnlockingId(null);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-3xl shadow-xl border-3 border-slate-200 p-8"
    >
      <div className="flex items-center gap-3 mb-6">
        <div className="w-12 h-12 bg-gradient-to-br from-[#3A3DFF] to-[#5B5EFF] rounded-2xl flex items-center justify-center">
          <Sparkles className="w-6 h-6 text-[#FFC947]" />
        </div>
        <div>
          <h2 className="text-2xl font-black text-slate-900">Expression Rewards</h2>
          <p className="text-sm text-slate-600 font-semibold">Unlock customization for your profile & posts</p>
        </div>
      </div>

      <div className="bg-amber-50 rounded-xl p-4 mb-6 border-2 border-amber-200">
        <p className="text-sm text-slate-700 font-bold">
          💡 These rewards are purely cosmetic — they don&apos;t give you any advantages, just ways to express yourself!
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {REWARDS.map((reward) => {
          const unlocked = isUnlocked(reward);
          const available = canUnlock(reward);

          return (
            <motion.div
              key={reward.id}
              whileHover={{ scale: unlocked ? 1 : 1.02 }}
              onClick={() => handleUnlock(reward)}
              className={cn(
                "p-4 rounded-xl border-2 transition-all",
                unlocked
                  ? "bg-green-50 border-green-300"
                  : available
                  ? "bg-indigo-50 border-indigo-300 cursor-pointer"
                  : "bg-slate-50 border-slate-200 opacity-60"
              )}
              role={available && onUnlock ? 'button' : undefined}
              aria-disabled={!!unlockingId && unlockingId !== reward.id}
            >
              <div className="flex items-start justify-between mb-2">
                <h3 className="font-black text-slate-900 text-sm">{reward.name}</h3>
                {unlocked ? (
                  <Check className="w-5 h-5 text-green-600 flex-shrink-0" />
                ) : (
                  <Lock className="w-5 h-5 text-slate-400 flex-shrink-0" />
                )}
              </div>
              <div className="flex items-center gap-2 text-xs font-bold">
                <Sparkles className="w-3 h-3 text-[#FFC947]" />
                <span className={unlocked ? "text-green-600" : "text-slate-600"}>
                  {reward.points} points
                </span>
              </div>
              {unlocked && (
                <p className="text-xs text-green-700 mt-2 font-semibold">Unlocked!</p>
              )}
              {!unlocked && available && (
                <p className="text-xs text-indigo-700 mt-2 font-semibold">
                  {unlockingId === reward.id ? 'Unlocking…' : 'Ready to unlock!'}
                </p>
              )}
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}