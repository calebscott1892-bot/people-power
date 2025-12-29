import React from 'react';
import { MapPin, Lock } from 'lucide-react';
import { motion } from 'framer-motion';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export default function MapPreview({ location, showPrivacyNote = false }) {
  if (!location || !location.city) return null;

  const displayText = location.country 
    ? `${location.city}, ${location.country}`
    : location.city;

  const content = (
    <motion.div 
      whileHover={{ scale: 1.05 }}
      className="inline-flex items-center gap-2 px-3 py-2 bg-indigo-50 border-2 border-indigo-200 rounded-xl"
    >
      <motion.div
        animate={{ y: [0, -3, 0] }}
        transition={{ duration: 1.5, repeat: Infinity }}
      >
        <MapPin className="w-4 h-4 text-[#3A3DFF]" fill="#3A3DFF" />
      </motion.div>
      <span className="text-sm font-bold text-[#3A3DFF]">
        {displayText}
      </span>
      {showPrivacyNote && (
        <Lock className="w-3 h-3 text-indigo-400" />
      )}
    </motion.div>
  );

  if (showPrivacyNote) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            {content}
          </TooltipTrigger>
          <TooltipContent>
            <p className="text-xs">City-level location only for privacy</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return content;
}