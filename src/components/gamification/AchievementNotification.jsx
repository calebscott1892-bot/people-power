import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trophy, X } from 'lucide-react';
import confetti from 'canvas-confetti';

export default function AchievementNotification({ achievement, onDismiss }) {
  const [show, setShow] = useState(true);

  useEffect(() => {
    if (achievement) {
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 }
      });

      const timer = setTimeout(() => {
        setShow(false);
        setTimeout(onDismiss, 300);
      }, 5000);

      return () => clearTimeout(timer);
    }
  }, [achievement, onDismiss]);

  if (!achievement) return null;

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: -100, scale: 0.8 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -100, scale: 0.8 }}
          className="fixed top-24 left-1/2 -translate-x-1/2 z-[100] max-w-md w-full mx-4"
        >
          <div className="bg-gradient-to-br from-yellow-400 via-orange-400 to-red-400 rounded-2xl shadow-2xl p-6 border-4 border-white">
            <div className="flex items-start gap-4">
              <div className="text-4xl">{achievement.icon}</div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <Trophy className="w-5 h-5 text-white" />
                  <h3 className="font-black text-white text-lg uppercase">Achievement Unlocked!</h3>
                </div>
                <p className="text-2xl font-black text-white mb-1">{achievement.name}</p>
                <p className="text-white/90 font-bold text-sm">{achievement.description}</p>
                {achievement.points && (
                  <p className="text-white font-black mt-2">+{achievement.points} points</p>
                )}
              </div>
              <button
                onClick={() => {
                  setShow(false);
                  setTimeout(onDismiss, 300);
                }}
                className="text-white hover:bg-white/20 rounded-lg p-1 transition-colors"
                aria-label="Dismiss achievement notification"
                title="Dismiss"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}