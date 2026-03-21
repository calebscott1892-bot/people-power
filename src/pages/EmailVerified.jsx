import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';

import { getSupabaseClient } from '@/api/supabaseClient';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

function useQueryParam(name) {
  const location = useLocation();
  return useMemo(() => {
    try {
      const params = new URLSearchParams(location.search || '');
      return params.get(name);
    } catch {
      return null;
    }
  }, [location.search, name]);
}

export default function EmailVerified() {
  const navigate = useNavigate();
  const code = useQueryParam('code');

  const [loading, setLoading] = useState(true);
  const [verified, setVerified] = useState(false);
  const [errorHint, setErrorHint] = useState('');

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) {
      setVerified(false);
      setLoading(false);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        // Supabase v2 recommended pattern for email links: exchange `code` into a session.
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        }

        const { data, error } = await supabase.auth.getUser();
        if (error) throw error;

        const user = data?.user || null;
        const confirmedAt = user?.email_confirmed_at || null;
        if (!cancelled) {
          const ok = !!confirmedAt;
          setVerified(ok);
          setLoading(false);
          if (ok) {
            setTimeout(() => {
              navigate('/', { replace: true });
            }, 900);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setVerified(false);
          setLoading(false);
          const msg = String(err?.message || '').toLowerCase();
          if (msg.includes('expired') || msg.includes('invalid') || msg.includes('used')) {
            setErrorHint('This verification link may have expired or already been used. Try signing in — if your email is already confirmed you\u2019re all set. Otherwise, request a new verification from the sign-in page.');
          }
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [code, navigate]);

  return (
    <div className="min-h-svh grid place-items-center px-4 py-10 bg-gradient-to-br from-slate-50 via-white to-blue-50">
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center gap-2">
          <img src="/logo.png?v=20260320-1" alt="People Power" className="w-14 h-14 object-contain" />
        </div>

      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-xl font-black">Email verification</CardTitle>
          <CardDescription>Confirming your email address…</CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {loading ? (
            <div className="text-sm text-slate-600 font-semibold">Checking…</div>
          ) : verified ? (
            <div className="space-y-3">
              <div className="text-sm text-slate-800 font-semibold">
                Email verified! You can now start using People Power.
              </div>
              <Button asChild className="w-full">
                <Link to="/">Continue</Link>
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="text-sm text-slate-800 font-semibold">
                We couldn’t confirm your email yet.
              </div>
              <div className="text-xs text-slate-500 font-semibold">
                {errorHint || 'If you just clicked the verification link, try signing in again.'}
              </div>
              <Button asChild variant="outline" className="w-full">
                <Link to="/login">Go to login</Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
      </div>
    </div>
  );
}
