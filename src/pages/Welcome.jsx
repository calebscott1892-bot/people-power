import React, { useEffect, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { toast } from 'sonner';

import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function Welcome() {
  const { user, isEmailVerified } = useAuth();
  const location = useLocation();

  const state = location?.state && typeof location.state === 'object' ? location.state : null;
  const verifiedJustNow = !!state?.verifiedJustNow;
  const signedInJustNow = !!state?.signedInJustNow;

  const continueTo = useMemo(() => {
    const rawFrom = state?.from;
    const candidate =
      typeof rawFrom === 'string'
        ? rawFrom
        : rawFrom?.pathname
          ? `${rawFrom.pathname}${rawFrom.search ?? ''}${rawFrom.hash ?? ''}`
          : '/';

    const path = String(candidate || '').trim() || '/';
    if (path === '/welcome' || path.startsWith('/welcome?') || path.startsWith('/welcome#')) return '/';
    if (path === '/login' || path.startsWith('/login?') || path.startsWith('/login#')) return '/';
    if (path === '/email-verified' || path.startsWith('/email-verified?') || path.startsWith('/email-verified#')) return '/';
    if (path === '/reset-password' || path.startsWith('/reset-password?') || path.startsWith('/reset-password#')) return '/';
    return path;
  }, [state?.from]);

  useEffect(() => {
    if (verifiedJustNow) {
      toast.success('Your email has been verified. Welcome to People Power!');
    }
  }, [verifiedJustNow]);

  const email = useMemo(() => (user?.email ? String(user.email) : '—'), [user?.email]);

  return (
    <div className="min-h-[60vh] grid place-items-center px-4 py-10">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle className="text-2xl font-black">Welcome to People Power</CardTitle>
          <CardDescription>
            You’re logged in as <span className="font-bold">{email}</span>.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="text-sm text-slate-800 font-semibold">
              You can now create movements, follow others, and track your impact.
            </div>
            {!isEmailVerified ? (
              <div className="mt-2 text-xs text-amber-800 font-semibold">
                We’ve also emailed you a verification link. Please confirm your email when you get a chance.
              </div>
            ) : null}
          </div>

          {signedInJustNow && !isEmailVerified ? (
            <div className="text-xs text-slate-500 font-semibold">
              If you don’t see the email, check your spam folder.
            </div>
          ) : null}

          <div className="flex flex-col sm:flex-row gap-2">
            <Button asChild className="w-full">
              <Link to={continueTo}>{continueTo === '/' ? 'Continue to Home' : 'Continue'}</Link>
            </Button>
            <Button asChild variant="outline" className="w-full">
              <Link to="/profile">Go to Profile</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
