import React from 'react';
import { motion } from 'framer-motion';

const REACTIONS = ['❤️', '👍', '😂', '😮', '😢', '🔥', '🎉', '👏'];

export default function ReactionPicker({ onSelectReaction, onClose }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      className="absolute bottom-full mb-2 bg-white rounded-2xl shadow-2xl border-3 border-slate-200 p-2 flex gap-1 z-50"
    >
      {REACTIONS.map((emoji) => (
        <button
          key={emoji}
          onClick={() => {
            onSelectReaction(emoji);
            onClose();
          }}
          className="w-10 h-10 rounded-xl hover:bg-slate-100 transition-colors flex items-center justify-center text-2xl"
        >
          {emoji}
        </button>
      ))}
    </motion.div>
  );
}