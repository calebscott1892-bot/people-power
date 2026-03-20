import React from 'react';
import { Link } from 'react-router-dom';
import C4FooterCredit from '@/components/c4-footer-credit/C4FooterCredit';

export default function Footer() {
  const links = [
    { to: '/terms-of-service', label: 'Terms of Service' },
    { to: '/content-policy', label: 'Content Policy' },
    { to: '/community-guidelines', label: 'Community Guidelines' },
    { to: '/privacy-policy', label: 'Privacy Policy' },
    { to: '/report', label: 'Report a problem' },
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

        <div className="mt-2 flex items-center justify-center gap-x-3">
          <span className="text-xs font-semibold text-slate-500">
            {year} People Power
          </span>
          <span className="text-slate-300 select-none" aria-hidden="true">|</span>
          <C4FooterCredit
            href="https://c4studios.com.au/"
            label="Designed with C4 Studios"
            size="small"
            showText={true}
            colorScheme="light"
          />
        </div>
      </div>

      <div style={{ height: 'env(safe-area-inset-bottom)' }} />
    </footer>
  );
}
