import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';

export default function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();

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

  return <Outlet />;
}
