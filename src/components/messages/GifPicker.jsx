import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Search } from 'lucide-react';
import { Input } from "@/components/ui/input";

const TRENDING_GIFS = [
  { id: 1, url: 'https://media.giphy.com/media/3o7abKhOpu0NwenH3O/giphy.gif', title: 'thumbs up' },
  { id: 2, url: 'https://media.giphy.com/media/3o6Zt481isNVuQI1l6/giphy.gif', title: 'clapping' },
  { id: 3, url: 'https://media.giphy.com/media/g9582DNuQppxC/giphy.gif', title: 'happy' },
  { id: 4, url: 'https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif', title: 'dancing' },
  { id: 5, url: 'https://media.giphy.com/media/26u4cqiYI30juCOGY/giphy.gif', title: 'excited' },
  { id: 6, url: 'https://media.giphy.com/media/3oz8xAFtqoOUUrsh7W/giphy.gif', title: 'laughing' },
];

export default function GifPicker({ onSelectGif, onClose }) {
  const [searchTerm, setSearchTerm] = useState('');

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className="absolute bottom-full left-0 right-0 mb-2 bg-white rounded-2xl shadow-2xl border-3 border-slate-200 p-4 z-50"
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-black text-slate-900">Choose a GIF</h3>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-slate-600 text-sm font-bold"
        >
          Close
        </button>
      </div>

      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <Input
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search GIFs..."
          className="pl-10 rounded-xl border-2"
        />
      </div>

      <div className="grid grid-cols-3 gap-2 max-h-64 overflow-y-auto">
        {TRENDING_GIFS
          .filter(gif => !searchTerm || gif.title.toLowerCase().includes(searchTerm.toLowerCase()))
          .map((gif) => (
            <button
              key={gif.id}
              onClick={() => {
                onSelectGif(gif.url);
                onClose();
              }}
              className="aspect-square rounded-xl overflow-hidden hover:ring-2 ring-[#3A3DFF] transition-all"
            >
              <img src={gif.url} alt={gif.title} className="w-full h-full object-cover" />
            </button>
          ))}
      </div>
    </motion.div>
  );
}