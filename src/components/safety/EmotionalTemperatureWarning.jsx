import React, { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { AlertTriangle, ThermometerSun, Info, X, CheckCircle } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { focusFirstInteractive, trapFocusKeyDown } from '@/components/utils/focusTrap';

const intensityConfig = {
  high: {
    icon: ThermometerSun,
    color: 'from-orange-500 to-red-500',
    textColor: 'text-orange-700',
    bgColor: 'bg-orange-50',
    borderColor: 'border-orange-300',
    title: 'High-Intensity Movement',
    description: 'This movement involves strong claims or urgent calls to action.'
  },
  critical: {
    icon: AlertTriangle,
    color: 'from-red-600 to-red-800',
    textColor: 'text-red-700',
    bgColor: 'bg-red-50',
    borderColor: 'border-red-400',
    title: 'Critical Content Warning',
    description: 'This movement involves real-world risks, controversial claims, or urgent actions.'
  }
};

export default function EmotionalTemperatureWarning({ intensity, onProceed, onCancel }) {
  const [understood, setUnderstood] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const reduceMotion = useReducedMotion();
  const dialogRef = useRef(null);

  const config = intensityConfig[intensity.intensity_level] || intensityConfig.high;
  const Icon = config.icon;

  const handleProceed = () => {
    if (dontShowAgain) {
      localStorage.setItem('peoplepower_skip_intensity_warnings', 'true');
    }
    onProceed();
  };

  useEffect(() => {
    const root = dialogRef.current;
    if (!root) return;
    const preferred = root.querySelector('#understood');
    if (preferred && typeof preferred.focus === 'function') {
      preferred.focus();
      return;
    }
    focusFirstInteractive(root);
  }, []);

  return (
    <motion.div
      initial={reduceMotion ? { opacity: 1 } : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={reduceMotion ? { opacity: 1 } : { opacity: 0 }}
      transition={{ duration: reduceMotion ? 0 : undefined }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onCancel}
      role="presentation"
      onKeyDown={(e) => {
        trapFocusKeyDown(e, dialogRef.current);
        if (e.key === 'Escape') {
          e.stopPropagation();
          onCancel?.();
        }
      }}
    >
      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="intensity_warning_title"
        aria-describedby="intensity_warning_desc"
        tabIndex={-1}
        initial={reduceMotion ? { scale: 1, y: 0 } : { scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={reduceMotion ? { scale: 1, y: 0 } : { scale: 0.9, y: 20 }}
        transition={{ duration: reduceMotion ? 0 : undefined }}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-3xl shadow-2xl max-w-lg w-full border-4 border-slate-300 overflow-hidden"
      >
        {/* Header */}
        <div className={cn("p-6 bg-gradient-to-r text-white", config.color)}>
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center backdrop-blur-sm">
                <Icon className="w-6 h-6" />
              </div>
              <div>
                <h2 id="intensity_warning_title" className="text-2xl font-black">{config.title}</h2>
              </div>
            </div>
            <button
              type="button"
              onClick={onCancel}
              className="text-white/80 hover:text-white transition-colors"
              aria-label="Close"
              title="Close"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
          <p id="intensity_warning_desc" className="text-white/90 font-semibold">{config.description}</p>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {/* Warning Flags */}
          {intensity.warning_flags && intensity.warning_flags.length > 0 && (
            <div className={cn("p-4 rounded-2xl border-2", config.bgColor, config.borderColor)}>
              <p className="font-bold text-sm text-slate-700 mb-2">Content includes:</p>
              <ul className="space-y-2">
                {intensity.warning_flags.map((flag, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-sm">
                    <AlertTriangle className={cn("w-4 h-4 flex-shrink-0 mt-0.5", config.textColor)} />
                    <span className="font-semibold text-slate-700">
                      {flag.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Critical Thinking Prompts */}
          <div className="bg-blue-50 p-4 rounded-2xl border-2 border-blue-200">
            <div className="flex items-start gap-3 mb-3">
              <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-black text-blue-900 text-sm mb-2">Before you engage, consider:</p>
                <ul className="space-y-1.5 text-sm text-slate-700">
                  <li className="flex items-start gap-2">
                    <span className="text-blue-600 font-black">•</span>
                    <span>What sources support the claims made?</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-blue-600 font-black">•</span>
                    <span>Are there real-world consequences to participating?</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-blue-600 font-black">•</span>
                    <span>Have you verified the information independently?</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-blue-600 font-black">•</span>
                    <span>Is this aligned with your values and judgment?</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>

          {/* Acknowledgment */}
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <Checkbox
                id="understood"
                checked={understood}
                onCheckedChange={setUnderstood}
                className="mt-1"
              />
              <label
                htmlFor="understood"
                className="text-sm text-slate-700 font-semibold cursor-pointer leading-relaxed"
              >
                I understand this content may involve intense emotions, controversial claims, or real-world actions, and I will engage critically and responsibly.
              </label>
            </div>

            <div className="flex items-start gap-3">
              <Checkbox
                id="dontShow"
                checked={dontShowAgain}
                onCheckedChange={setDontShowAgain}
              />
              <label
                htmlFor="dontShow"
                className="text-sm text-slate-500 font-semibold cursor-pointer"
              >
                Don&apos;t show me intensity warnings again
              </label>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-4">
            <Button
              onClick={handleProceed}
              disabled={!understood}
              className="flex-1 h-12 bg-[#3A3DFF] hover:bg-[#2A2DDD] rounded-xl font-black disabled:opacity-50"
            >
              <CheckCircle className="w-5 h-5 mr-2" />
              I Understand, Continue
            </Button>
            <Button
              onClick={onCancel}
              variant="outline"
              className="h-12 rounded-xl font-bold border-2"
            >
              Go Back
            </Button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}