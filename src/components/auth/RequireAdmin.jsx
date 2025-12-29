import React, { useMemo } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';

function parseAdminEmails(raw) {
  return String(raw || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export default function RequireAdmin() {
  const { user, loading } = useAuth();
  const location = useLocation();

  const adminEmails = useMemo(
    () => parseAdminEmails(import.meta?.env?.VITE_ADMIN_EMAILS),
    []
  );

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center text-slate-600 font-semibold">
        Loading…
      </div>
    );
  }

  if (!user) {
    const from = `${location.pathname}${location.search ?? ''}${location.hash ?? ''}`;
    return <Navigate to="/login" replace state={{ from }} />;
  }

  const email = String(user?.email || '').trim().toLowerCase();
  const isAdmin = !!(email && adminEmails.includes(email));

  if (!isAdmin) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12">
        <div className="p-6 rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="text-xl font-black text-slate-900">Not authorized</div>
          <div className="mt-2 text-slate-600 font-semibold">
            This page is only available to admin accounts.
          </div>
        </div>
      </div>
    );
  }

  return <Outlet />;
}
