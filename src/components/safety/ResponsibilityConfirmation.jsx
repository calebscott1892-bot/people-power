import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

export default function ResponsibilityConfirmation() {
  const storageKey = 'peoplepower_responsibility_confirmed_v1';
  const [confirmed, setConfirmed] = useState(() => {
    try {
      return localStorage.getItem(storageKey) === 'true';
    } catch {
      return false;
    }
  });
  const [checked, setChecked] = useState(false);

  const canConfirm = useMemo(() => checked && !confirmed, [checked, confirmed]);

  const confirm = () => {
    try {
      localStorage.setItem(storageKey, 'true');
    } catch {
      // ignore
    }
    setConfirmed(true);
  };

  if (confirmed) {
    return (
      <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-600">
        <div className="font-black text-slate-900">Responsibility check</div>
        <div className="mt-1 font-semibold">Confirmed on this device.</div>
      </div>
    );
  }

  return (
    <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-600 space-y-3">
      <div>
        <div className="font-black text-slate-900">Responsibility check</div>
        <div className="mt-1 font-semibold">
          Use People Power safely and respectfully. Avoid harassment, illegal activity, and misinformation.
        </div>
      </div>

      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
          className="mt-1 w-5 h-5 rounded accent-[#3A3DFF]"
        />
        <div className="text-sm font-semibold text-slate-700">
          I understand and agree to follow the community guidelines.
          <div className="mt-1">
            <Link to="/community-guidelines" className="underline font-black text-slate-800">
              Read guidelines
            </Link>
          </div>
        </div>
      </div>

      <Button type="button" onClick={confirm} disabled={!canConfirm} className="rounded-xl font-black">
        Confirm
      </Button>
    </div>
  );
}