import React from 'react';
import { motion } from 'framer-motion';
import { CheckCircle, Users, Image as ImageIcon, FileText } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import ReportButton from '../safety/ReportButton';

const categoryColors = {
  kindness: "from-pink-400 to-rose-400",
  community: "from-[#3A3DFF] to-[#5B5EFF]",
  cleanup: "from-green-400 to-emerald-400",
  gratitude: "from-amber-400 to-yellow-400",
  health: "from-cyan-400 to-blue-400",
  creativity: "from-purple-400 to-fuchsia-400"
};

const categoryEmoji = {
  kindness: "💝",
  community: "🤝",
  cleanup: "🌱",
  gratitude: "🙏",
  health: "💪",
  creativity: "🎨"
};

export default function ChallengeCard({ challenge, onComplete, isCompleted, userCompletion }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -4 }}
      className={cn(
        "bg-white rounded-2xl p-6 shadow-lg border-3 transition-all",
        isCompleted ? "border-green-500 bg-green-50" : "border-slate-200 hover:border-slate-300"
      )}
    >
      {/* Category Badge */}
      <div className="flex items-start justify-between mb-4">
        <div className={cn(
          "px-4 py-2 rounded-xl bg-gradient-to-r text-white font-bold text-sm flex items-center gap-2 shadow-md",
          categoryColors[challenge.category] || categoryColors.community
        )}>
          <span>{categoryEmoji[challenge.category]}</span>
          {challenge.category}
        </div>
        {isCompleted && (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="flex items-center gap-2 text-green-600 font-bold"
          >
            <CheckCircle className="w-5 h-5" fill="currentColor" />
            Completed
          </motion.div>
        )}
      </div>

      {/* Title & Description */}
      <h3 className="text-2xl font-black text-slate-900 mb-3 leading-tight">
        {challenge.title}
      </h3>
      {challenge.description && (
        <p className="text-slate-600 mb-4 leading-relaxed">
          {challenge.description}
        </p>
      )}

      {/* Evidence Indicators */}
      {userCompletion && (
        <div className="flex items-center gap-2 mb-4 text-sm">
          {userCompletion.evidence_type === 'image' && (
            <span className="flex items-center gap-1 px-3 py-1 bg-blue-100 text-blue-700 rounded-lg font-semibold">
              <ImageIcon className="w-4 h-4" />
              Photo Evidence
            </span>
          )}
          {userCompletion.evidence_type === 'text' && (
            <span className="flex items-center gap-1 px-3 py-1 bg-purple-100 text-purple-700 rounded-lg font-semibold">
              <FileText className="w-4 h-4" />
              Description Added
            </span>
          )}
          {userCompletion.is_verified ? (
            <span className="px-3 py-1 bg-green-100 text-green-700 rounded-lg font-bold">
              🟢 Verified
            </span>
          ) : (
            <span className="px-3 py-1 bg-slate-100 text-slate-700 rounded-lg font-bold">
              ⚪️ Unverified
            </span>
          )}
        </div>
      )}

      {/* Stats & Action */}
      <div className="space-y-3 pt-4 border-t-2 border-slate-100">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-slate-600">
            <Users className="w-5 h-5" />
            <span className="font-bold text-lg">
              {challenge.completions_today || 0}
            </span>
            <span className="text-sm">completed today</span>
          </div>
          
          {!isCompleted && (
            <Button
              onClick={() => onComplete(challenge)}
              className="bg-gradient-to-r from-[#FFC947] to-[#FFD666] hover:from-[#FFD666] hover:to-[#FFC947] text-slate-900 rounded-xl font-bold px-6 shadow-lg uppercase tracking-wide"
            >
              <CheckCircle className="w-4 h-4 mr-2" />
              Complete
            </Button>
          )}
        </div>
        <ReportButton contentType="challenge" contentId={challenge.id} variant="ghost" />
      </div>
    </motion.div>
  );
}