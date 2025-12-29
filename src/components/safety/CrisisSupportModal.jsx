import React, { useEffect, useRef } from 'react';
import { Heart, Phone, MessageCircle, Globe, X } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { motion, useReducedMotion } from 'framer-motion';
import { focusFirstInteractive, trapFocusKeyDown } from '@/components/utils/focusTrap';

const crisisResources = [
  {
    name: 'National Suicide Prevention Lifeline',
    phone: '988',
    available: '24/7',
    icon: Phone,
    description: 'Free and confidential support'
  },
  {
    name: 'Crisis Text Line',
    contact: 'Text HOME to 741741',
    available: '24/7',
    icon: MessageCircle,
    description: 'Text with a trained crisis counselor'
  },
  {
    name: 'International Association for Suicide Prevention',
    contact: 'iasp.info/resources/Crisis_Centres',
    available: 'Worldwide resources',
    icon: Globe,
    description: 'Find help in your country'
  }
];

export default function CrisisSupportModal({ onClose, severity = 'moderate' }) {
  const reduceMotion = useReducedMotion();
  const dialogRef = useRef(null);

  useEffect(() => {
    focusFirstInteractive(dialogRef.current);
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
      role="presentation"
      onKeyDown={(e) => {
        trapFocusKeyDown(e, dialogRef.current);
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose?.();
        }
      }}
    >
      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="crisis_support_title"
        aria-describedby="crisis_support_desc"
        tabIndex={-1}
        initial={reduceMotion ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: reduceMotion ? 0 : undefined }}
        className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full border-4 border-pink-300 overflow-hidden"
      >
        {/* Header */}
        <div className="p-6 bg-gradient-to-r from-pink-500 to-rose-500 text-white">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center">
                <Heart className="w-7 h-7" fill="white" />
              </div>
              <div>
                <h2 id="crisis_support_title" className="text-2xl font-black">You Are Not Alone</h2>
                <p id="crisis_support_desc" className="text-white/90 font-semibold text-sm">Help is available right now</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-white/80 hover:text-white transition-colors"
              aria-label="Close"
              title="Close"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Supportive Message */}
          <div className="p-4 bg-pink-50 border-2 border-pink-200 rounded-xl">
            <p className="text-slate-900 font-bold mb-2">
              {severity === 'critical' && '🚨 If you are in immediate danger, please call emergency services (911) now.'}
              {severity === 'severe' && '💝 You matter. Your life has value. Please reach out for support.'}
              {severity === 'moderate' && '🤗 It takes courage to acknowledge struggle. Help is here.'}
            </p>
            <p className="text-sm text-slate-600">
              These feelings can pass. Trained counselors are ready to listen without judgment.
            </p>
          </div>

          {/* Crisis Resources */}
          <div className="space-y-3">
            <h3 className="font-black text-slate-900 text-lg">Immediate Support Resources:</h3>
            {crisisResources.map((resource, idx) => {
              const Icon = resource.icon;
              return (
                <div key={idx} className="p-4 bg-white rounded-xl border-3 border-slate-200 hover:border-pink-300 transition-colors">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 bg-pink-100 rounded-lg flex items-center justify-center flex-shrink-0">
                      <Icon className="w-5 h-5 text-pink-600" />
                    </div>
                    <div className="flex-1">
                      <h4 className="font-black text-slate-900 text-sm">{resource.name}</h4>
                      <p className="text-pink-600 font-bold text-lg mb-1">
                        {resource.phone || resource.contact}
                      </p>
                      <p className="text-xs text-slate-600">{resource.description}</p>
                      <p className="text-xs text-slate-500 mt-1">Available: {resource.available}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Additional Support */}
          <div className="p-4 bg-blue-50 border-2 border-blue-200 rounded-xl">
            <p className="text-sm font-bold text-blue-900 mb-2">Other Ways to Get Help:</p>
            <ul className="text-xs text-slate-700 space-y-1">
              <li>• Talk to a trusted friend, family member, or mentor</li>
              <li>• Contact your doctor or mental health professional</li>
              <li>• Visit your local emergency room</li>
              <li>• Call a local crisis center or mental health hotline</li>
            </ul>
          </div>

          {/* Platform Notice */}
          <div className="p-3 bg-slate-50 border-2 border-slate-200 rounded-xl">
            <p className="text-xs text-slate-600 text-center">
              This platform is not a substitute for professional mental health care. 
              We encourage you to seek help from trained professionals.
            </p>
          </div>

          <Button
            onClick={onClose}
            variant="outline"
            className="w-full rounded-xl font-bold"
          >
            I understand
          </Button>
        </div>
      </motion.div>
    </div>
  );
}