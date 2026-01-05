import React, { useEffect, useRef, useState } from 'react';
import { ShieldCheck, Calendar } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { focusFirstInteractive, trapFocusKeyDown } from '@/components/utils/focusTrap';

export default function AgeVerification({ onVerify, minAge = 13 }) {
  const [birthdate, setBirthdate] = useState('');
  const [error, setError] = useState('');
  const dialogRef = useRef(null);

  useEffect(() => {
    const root = dialogRef.current;
    if (!root) return;
    focusFirstInteractive(root);
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    
    if (!birthdate) {
      setError('Please enter your birthdate');
      return;
    }

    const birth = new Date(birthdate);
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
      age--;
    }

    if (age < minAge) {
      setError(`You must be at least ${minAge} years old to use this platform`);
      return;
    }

    onVerify({ birthdate, age });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
      role="presentation"
      onKeyDown={(e) => {
        trapFocusKeyDown(e, dialogRef.current);
        if (e.key === 'Escape') e.stopPropagation();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="age_verification_title"
        aria-describedby="age_verification_desc"
        tabIndex={-1}
        className="bg-white rounded-3xl shadow-2xl max-w-md w-full border-4 border-slate-300 overflow-hidden"
      >
        <div className="p-6 bg-gradient-to-r from-indigo-500 to-purple-500 text-white">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center">
              <ShieldCheck className="w-7 h-7" />
            </div>
            <div>
              <h2 id="age_verification_title" className="text-2xl font-black">Age Verification</h2>
              <p id="age_verification_desc" className="text-white/90 font-semibold text-sm">Required for safety</p>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="p-4 bg-blue-50 border-2 border-blue-200 rounded-xl">
            <p className="text-sm text-slate-700">
              This information helps us provide age-appropriate content and safety features.
            </p>
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-bold text-slate-700">
              <Calendar className="w-4 h-4" />
              Date of Birth
            </label>
            <Input
              type="date"
              value={birthdate}
              onChange={(e) => {
                setBirthdate(e.target.value);
                setError('');
              }}
              max={new Date().toISOString().split('T')[0]}
              className="h-12 rounded-xl border-2 border-slate-300 bg-slate-50 text-slate-900"
            />
          </div>

          {error && (
            <div className="p-3 bg-red-50 border-2 border-red-200 rounded-xl">
              <p className="text-sm text-red-700 font-bold">{error}</p>
            </div>
          )}

          <Button
            type="submit"
            className="w-full h-12 bg-[#3A3DFF] hover:bg-[#2A2DDD] rounded-xl font-bold"
          >
            Continue
          </Button>

          <p className="text-xs text-slate-500 text-center">
            Your birthdate is private and used only for safety features
          </p>
        </form>
      </div>
    </div>
  );
}