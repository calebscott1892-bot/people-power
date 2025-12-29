import React from 'react';
import { Link } from 'react-router-dom';

export default function AdminReviewQueue() {
  return (
    <div className="p-6 rounded-2xl border border-slate-200 bg-white shadow-sm space-y-3">
      <div className="font-black text-slate-900">Admin review queue</div>
      <div className="text-sm text-slate-600 font-semibold">
        Review pending user reports and apply moderation actions.
      </div>
      <div>
        <Link
          to="/admin-reports"
          className="inline-flex items-center px-4 py-2 rounded-xl border border-slate-200 bg-white text-slate-800 font-black text-xs hover:bg-slate-50"
        >
          Open reports
        </Link>
      </div>
    </div>
  );
}