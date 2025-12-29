import React from 'react';
import { motion } from 'framer-motion';
import { Calendar, TrendingUp, Clock, CheckCircle } from 'lucide-react';
import { cn } from "@/lib/utils";

const filters = [
  { id: 'today', label: 'Today', icon: Calendar },
  { id: 'week', label: 'This Week', icon: Clock },
  { id: 'popular', label: 'Popular', icon: TrendingUp },
  { id: 'mine', label: 'My Completions', icon: CheckCircle }
];

export default function ChallengeFilters({ activeFilter, onFilterChange }) {
  return (
    <div className="flex flex-wrap gap-3">
      {filters.map((filter) => {
        const Icon = filter.icon;
        const isActive = activeFilter === filter.id;
        
        return (
          <motion.button
            key={filter.id}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => onFilterChange(filter.id)}
            className={cn(
              "relative px-6 py-3 rounded-xl font-bold text-sm transition-all uppercase tracking-wide border-2",
              isActive
                ? "text-white shadow-lg"
                : "text-slate-600 border-slate-300 hover:border-slate-400 bg-white"
            )}
          >
            {isActive && (
              <motion.div
                layoutId="activeFilter"
                className="absolute inset-0 bg-gradient-to-r from-[#3A3DFF] to-[#5B5EFF] rounded-xl"
                transition={{ type: "spring", bounce: 0.2, duration: 0.5 }}
              />
            )}
            <span className="relative flex items-center gap-2">
              <Icon className="w-4 h-4" strokeWidth={2.5} />
              {filter.label}
            </span>
          </motion.button>
        );
      })}
    </div>
  );
}