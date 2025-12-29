import React from 'react';
import { Link } from 'react-router-dom';

export default function Footer() {
  const links = [
    { to: '/terms-of-service', label: 'Terms of Service' },
    { to: '/content-policy', label: 'Content Policy' },
    { to: '/community-guidelines', label: 'Community Guidelines' },
    { to: '/privacy-policy', label: 'Privacy Policy' },
  ];

  const year = 2025;

  return (
    <footer className="w-full border-t border-slate-200 bg-slate-50/95 backdrop-blur">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2">
        <nav aria-label="Legal" className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1">
          {links.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              className="text-xs font-semibold text-slate-500 hover:text-slate-900 underline-offset-4 hover:underline"
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="mt-2 text-center text-xs font-semibold text-slate-500">
          {year} People Power
        </div>
      </div>

      <div style={{ height: 'env(safe-area-inset-bottom)' }} />
    </footer>
  );
}
