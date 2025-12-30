import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Shield } from 'lucide-react';
import { createPageUrl } from '@/utils';
import { Button } from '@/components/ui/button';

export default function SafetyModal({ onAccept }) {
  const [acknowledged, setAcknowledged] = useState(false);
  const dialogRef = useRef(null);

  useEffect(() => {
    // Focus the checkbox first to make the required acknowledgment explicit.
    const root = dialogRef.current;
    if (!root) return;
    const checkbox = root.querySelector('input[type="checkbox"]');
    if (checkbox && typeof checkbox.focus === 'function') checkbox.focus();
  }, []);

  const legalLinks = useMemo(
    () => [
      { to: createPageUrl('TermsOfService'), label: 'Terms of Service' },
      { to: '/content-policy', label: 'Content Policy' },
      { to: '/community-guidelines', label: 'Community Guidelines' },
    ],
    []
  );

  return (
    <div className="fixed inset-0 z-[100] flex items-start sm:items-center justify-center p-4 py-6 bg-slate-900/80 backdrop-blur-sm overflow-y-auto">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="safety_modal_title"
        aria-describedby="safety_modal_desc"
        tabIndex={-1}
        className="bg-white rounded-3xl shadow-2xl max-w-lg w-full border-4 border-slate-300 max-h-[calc(100vh-3rem)] overflow-y-auto"
      >
        <div className="p-6 bg-gradient-to-r from-[#3A3DFF] to-[#5B5EFF] text-white">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center flex-shrink-0">
              <Shield className="w-7 h-7" />
            </div>
            <div>
              <h2 id="safety_modal_title" className="text-2xl font-black">Safety & Responsibility</h2>
              <p id="safety_modal_desc" className="text-white/90 font-semibold text-sm">
                Please read and accept before continuing.
              </p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-4">
          <div className="p-4 bg-amber-50 border-2 border-amber-200 rounded-2xl">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-700 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-slate-800 space-y-1">
                <p className="font-black">You’re responsible for your participation.</p>
                <p className="font-semibold text-slate-700">
                  Always verify information independently, follow local laws, and prioritize your safety—especially for offline actions and events.
                </p>
              </div>
            </div>
          </div>

          <div className="p-4 bg-slate-50 border-2 border-slate-200 rounded-2xl">
            <div className="text-sm text-slate-800 space-y-2">
              <p className="font-black">Quick links</p>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {legalLinks.map((l) => (
                  <Link
                    key={l.to}
                    to={l.to}
                    target="_blank"
                    className="text-sm font-bold text-[#3A3DFF] hover:underline"
                  >
                    {l.label}
                  </Link>
                ))}
              </div>
            </div>
          </div>

          <label className="flex items-start gap-3 text-sm text-slate-800">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 rounded border-slate-300"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
            />
            <span className="font-semibold">
              I understand and accept the Terms of Service and agree to act safely and responsibly.
            </span>
          </label>

          <Button
            type="button"
            className="w-full h-12 bg-gradient-to-r from-[#FFC947] to-[#FFD666] hover:from-[#FFD666] hover:to-[#FFC947] text-slate-900 rounded-2xl font-black"
            disabled={!acknowledged}
            onClick={() => {
              if (!acknowledged) return;
              onAccept?.();
            }}
          >
            I Accept & Continue
          </Button>
        </div>
      </div>
    </div>
  );
}
