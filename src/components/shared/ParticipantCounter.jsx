import React from 'react';
import { Users, UserCheck, Heart } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from "@/lib/utils";

export default function ParticipantCounter({ 
  verified = 0, 
  unverified = 0, 
  supporters = 0,
  size = "md",
  layout = "horizontal" 
}) {
  const isVertical = layout === "vertical";
  const iconSize = size === "lg" ? "w-5 h-5" : "w-4 h-4";
  const textSize = size === "lg" ? "text-base" : "text-sm";
  
  const counters = [
    { 
      value: verified, 
      icon: UserCheck, 
      label: "Verified", 
      color: "text-[#3A3DFF]",
      bg: "bg-indigo-50"
    },
    { 
      value: unverified, 
      icon: Users, 
      label: "Joined", 
      color: "text-slate-600",
      bg: "bg-slate-100"
    },
    { 
      value: supporters, 
      icon: Heart, 
      label: "Support", 
      color: "text-[#FFC947]",
      bg: "bg-yellow-50"
    },
  ];

  return (
    <div className={cn(
      "flex gap-3",
      isVertical ? "flex-col" : "flex-row flex-wrap"
    )}>
      {counters.map((counter) => {
        const Icon = counter.icon;
        return (
          <motion.div
            key={counter.label}
            whileHover={{ scale: 1.05 }}
            className={cn(
              "flex items-center gap-2 px-3 py-2 rounded-xl border-2",
              counter.bg,
              counter.label === "Verified" ? "border-indigo-200" : 
              counter.label === "Support" ? "border-yellow-200" : "border-slate-200"
            )}
          >
            <Icon className={cn(iconSize, counter.color)} />
            <div className="flex flex-col">
              <span className={cn("font-mono font-bold tabular-nums", textSize, counter.color)}>
                {counter.value.toLocaleString()}
              </span>
              <span className="text-xs text-slate-500 font-semibold uppercase tracking-wide">
                {counter.label}
              </span>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}