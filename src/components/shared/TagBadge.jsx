import React from 'react';
import { cn } from "@/lib/utils";

const tagColors = {
  protest: "bg-red-100 text-red-700 border-red-300",
  'meet-up': "bg-indigo-100 text-indigo-700 border-indigo-300",
  meetup: "bg-indigo-100 text-indigo-700 border-indigo-300",
  boycott: "bg-purple-100 text-purple-700 border-purple-300",
  'review bomb': "bg-pink-100 text-pink-700 border-pink-300",
  'community support': "bg-blue-100 text-blue-700 border-blue-300",
  fundraising: "bg-green-100 text-green-700 border-green-300",
  'awareness campaign': "bg-yellow-100 text-yellow-700 border-yellow-300",
  advocacy: "bg-orange-100 text-orange-700 border-orange-300",
  environment: "bg-emerald-100 text-emerald-700 border-emerald-300",
  health: "bg-rose-100 text-rose-700 border-rose-300",
  education: "bg-amber-100 text-amber-700 border-amber-300",
  local: "bg-cyan-100 text-cyan-700 border-cyan-300",
  other: "bg-slate-100 text-slate-700 border-slate-300"
};

export default function TagBadge({ tag, size = "sm" }) {
  const colorClass = tagColors[tag.toLowerCase()] || tagColors.other;
  
  return (
    <span className={cn(
      "inline-flex items-center rounded-full border-2 font-bold uppercase tracking-wide",
      size === "sm" ? "px-2.5 py-0.5 text-xs" : "px-3 py-1 text-sm",
      colorClass
    )}>
      {tag}
    </span>
  );
}