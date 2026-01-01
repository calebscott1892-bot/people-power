import React, { useState } from 'react';
import { motion } from 'framer-motion';

const REACTIONS = ['❤️', '👍', '😂', '😮', '😢', '🔥', '🎉', '👏'];

export default function ReactionPicker({ onSelectReaction, onClose }) {
  const [custom, setCustom] = useState('');
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      className="absolute bottom-full mb-2 bg-white rounded-2xl shadow-2xl border-3 border-slate-200 p-2 flex flex-wrap gap-1 z-50"
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
      <div className="flex items-center gap-1">
        <input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder="Emoji"
          className="h-9 w-16 rounded-lg border border-slate-200 px-2 text-sm"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              const value = custom.trim();
              if (value) {
                onSelectReaction(value);
                setCustom('');
                onClose();
              }
            }
          }}
        />
        <button
          type="button"
          className="h-9 px-2 rounded-lg border border-slate-200 text-xs font-bold"
          onClick={() => {
            const value = custom.trim();
            if (value) {
              onSelectReaction(value);
              setCustom('');
              onClose();
            }
          }}
        >
          Add
        </button>
      </div>
    </motion.div>
  );
}
