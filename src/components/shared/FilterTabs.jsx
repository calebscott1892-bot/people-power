import React from 'react';
import { Flame, Sparkles, Trophy, MapPin } from 'lucide-react';
import { cn } from "@/lib/utils";
import { motion } from 'framer-motion';

const filters = [
  { id: 'momentum', label: 'Momentum', icon: Flame },
  { id: 'new', label: 'New', icon: Sparkles },
  { id: 'impact', label: 'Impact', icon: Trophy },
  { id: 'local', label: 'Local', icon: MapPin },
];

export default function FilterTabs({ activeFilter, onFilterChange }) {
  return (
    <div className="flex items-center gap-1 sm:gap-2 p-1.5 bg-slate-200 rounded-2xl border-2 border-slate-300 overflow-x-auto sm:overflow-visible">
      {filters.map((filter) => {
        const Icon = filter.icon;
        const isActive = activeFilter === filter.id;
        
        return (
          <button
            key={filter.id}
            onClick={() => onFilterChange(filter.id)}
            className={cn(
              "relative flex items-center gap-2 px-3 sm:px-5 py-2 sm:py-3 rounded-xl font-extrabold text-xs sm:text-sm transition-all shrink-0 whitespace-nowrap",
              isActive ? "text-white" : "text-slate-600 hover:text-slate-900"
            )}
          >
            {isActive && (
              <motion.div
                layoutId="activeFilter"
                className="absolute inset-0 bg-gradient-to-br from-[#3A3DFF] to-[#5B5EFF] rounded-xl shadow-lg"
                transition={{ type: "spring", bounce: 0.2, duration: 0.5 }}
              />
            )}
            <span className="relative flex items-center gap-2 uppercase tracking-wide">
              <Icon className="w-4 h-4" />
              {filter.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
