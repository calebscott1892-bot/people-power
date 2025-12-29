import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Lightbulb } from 'lucide-react';
import { Button } from "@/components/ui/button";

export default function FeatureTooltip({ 
  show, 
  onDismiss, 
  title, 
  description, 
  position = 'bottom',
  highlight = false 
}) {
  if (!show) return null;

  const positions = {
    top: 'bottom-full mb-2',
    bottom: 'top-full mt-2',
    left: 'right-full mr-2',
    right: 'left-full ml-2'
  };

  return (
    <AnimatePresence>
      {show && (
        <>
          {/* Highlight overlay */}
          {highlight && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-slate-900/40 z-40 pointer-events-none"
            />
          )}
          
          {/* Tooltip */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: position === 'bottom' ? -10 : 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className={`absolute ${positions[position]} left-0 right-0 z-50 pointer-events-auto`}
          >
            <div className="bg-gradient-to-br from-[#3A3DFF] to-[#5B5EFF] rounded-2xl p-5 shadow-2xl border-2 border-white max-w-sm">
              <div className="flex items-start gap-3 mb-3">
                <div className="w-8 h-8 bg-[#FFC947] rounded-lg flex items-center justify-center flex-shrink-0">
                  <Lightbulb className="w-4 h-4 text-slate-900" />
                </div>
                <div className="flex-1">
                  <h4 className="font-black text-white mb-1">{title}</h4>
                  <p className="text-sm text-white/90 leading-relaxed">{description}</p>
                </div>
                <button
                  onClick={onDismiss}
                  className="text-white/80 hover:text-white transition-colors"
                  aria-label="Dismiss tooltip"
                  title="Dismiss tooltip"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <Button
                onClick={onDismiss}
                size="sm"
                className="w-full bg-[#FFC947] hover:bg-[#FFD666] text-slate-900 rounded-xl font-bold"
              >
                Got it!
              </Button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}