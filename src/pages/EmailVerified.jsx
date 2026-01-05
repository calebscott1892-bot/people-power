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
              navigate('/welcome', { replace: true, state: { verifiedJustNow: true } });
            }, 900);
          }
        }
      } catch {
        if (!cancelled) {
          setVerified(false);
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [code, navigate]);

  return (
    <div className="min-h-[100vh] grid place-items-center px-4 py-10 bg-slate-50">
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
                <Link to="/welcome">Continue</Link>
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="text-sm text-slate-800 font-semibold">
                We couldn’t confirm your email yet.
              </div>
              <div className="text-xs text-slate-500 font-semibold">
                If you just clicked the verification link, try signing in again.
              </div>
              <Button asChild variant="outline" className="w-full">
                <Link to="/login">Go to login</Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
