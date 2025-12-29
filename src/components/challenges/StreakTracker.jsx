import React from 'react';
import { motion } from 'framer-motion';
import { Flame, Award } from 'lucide-react';
import { cn } from "@/lib/utils";

export default function StreakTracker({ currentStreak, longestStreak, lastCompletionDate = null, compact = false }) {
  const streakDots = Array.from({ length: 7 }, (_, i) => i + 1);

  const todayKey = () => new Date().toISOString().slice(0, 10);
  const yesterdayKey = () => {
    const d = new Date(`${todayKey()}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  };

  const last = lastCompletionDate ? String(lastCompletionDate) : null;
  const isBroken = !!(last && currentStreak === 0 && last !== todayKey() && last !== yesterdayKey());

  const getStreakColor = (streak) => {
    if (streak >= 30) return 'from-purple-500 to-pink-500';
    if (streak >= 7) return 'from-orange-500 to-red-500';
    if (streak >= 3) return 'from-yellow-500 to-orange-500';
    return 'from-blue-500 to-cyan-500';
  };

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <motion.div
          animate={{ rotate: [0, -5, 5, -5, 0] }}
          transition={{ duration: 2, repeat: Infinity, repeatDelay: 3 }}
          className={cn(
            "w-8 h-8 rounded-full bg-gradient-to-br flex items-center justify-center shadow-lg",
            getStreakColor(currentStreak)
          )}
        >
          <Flame className="w-4 h-4 text-white" fill="white" />
        </motion.div>
        <div>
          <div className="text-lg font-black text-slate-900">{currentStreak} Day Streak</div>
          <div className="text-xs text-slate-500 font-semibold">Best: {longestStreak}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl p-6 shadow-xl border-3 border-slate-200">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <motion.div
            animate={{ rotate: [0, -10, 10, -10, 0] }}
            transition={{ duration: 2, repeat: Infinity, repeatDelay: 2 }}
            className={cn(
              "w-14 h-14 rounded-2xl bg-gradient-to-br flex items-center justify-center shadow-lg",
              getStreakColor(currentStreak)
            )}
          >
            <Flame className="w-8 h-8 text-white" fill="white" />
          </motion.div>
          <div>
            <div className="text-3xl font-black text-slate-900">{currentStreak}</div>
            <div className="text-sm text-slate-500 font-bold uppercase tracking-wide">Day Streak</div>
          </div>
        </div>
        
        <div className="text-right">
          <div className="flex items-center gap-2 text-[#FFC947] mb-1">
            <Award className="w-5 h-5" />
            <span className="text-xl font-black">{longestStreak}</span>
          </div>
          <div className="text-xs text-slate-500 font-bold uppercase">Best Streak</div>
          {isBroken ? (
            <div className="mt-2 text-xs font-black text-rose-600">Streak broken</div>
          ) : null}
        </div>
      </div>

      {/* Visual Tracker */}
      <div className="flex items-center justify-between gap-2">
        {streakDots.map((day) => {
          const isActive = day <= (currentStreak % 7 || (currentStreak > 0 ? 7 : 0));
          
          return (
            <motion.div
              key={day}
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: day * 0.05 }}
              className="flex-1"
            >
              <div className="relative">
                <div
                  className={cn(
                    "aspect-square rounded-full border-3 transition-all duration-300",
                    isActive
                      ? `bg-gradient-to-br ${getStreakColor(currentStreak)} border-white shadow-lg`
                      : "bg-slate-100 border-slate-200"
                  )}
                />
                {isActive && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="absolute inset-0 flex items-center justify-center"
                  >
                    <div className="w-2 h-2 bg-white rounded-full" />
                  </motion.div>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Streak Milestones */}
      <div className="mt-6 pt-6 border-t-2 border-slate-100">
        <div className="text-xs font-black text-slate-900 uppercase tracking-wider mb-3">
          Next Milestone
        </div>
        <div className="space-y-2">
          {[
            { days: 1, points: 5, label: '1-day streak' },
            { days: 3, points: 15, label: '3-day streak' },
            { days: 7, points: 40, label: '1-week streak' },
            { days: 30, points: 200, label: '1-month streak' }
          ].map(({ days, points, label }) => {
            const isReached = currentStreak >= days;
            const nextMilestone = currentStreak < days;
            
            if (isReached && !nextMilestone) return null;
            
            return (
              <div key={days} className={cn(
                "flex items-center justify-between p-3 rounded-xl",
                nextMilestone ? "bg-indigo-50 border-2 border-indigo-200" : "bg-slate-50"
              )}>
                <span className={cn(
                  "text-sm font-bold",
                  nextMilestone ? "text-[#3A3DFF]" : "text-slate-500"
                )}>
                  {label}
                </span>
                <span className={cn(
                  "text-sm font-black",
                  nextMilestone ? "text-[#FFC947]" : "text-slate-400"
                )}>
                  +{points} pts
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}