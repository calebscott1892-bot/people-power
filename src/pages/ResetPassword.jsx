import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { toast } from 'sonner';
import { toastFriendlyError } from '@/utils/toastErrors';

import { getSupabaseClient } from '@/api/supabaseClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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

export default function ResetPassword() {
  const navigate = useNavigate();
  const code = useQueryParam('code');

  const [checkingLink, setCheckingLink] = useState(true);
  const [hasSession, setHasSession] = useState(false);

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) {
      setHasSession(false);
      setCheckingLink(false);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        // Supabase v2 recommended pattern for email links:
        // exchange the `code` query param into a browser session.
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        }

        const { data } = await supabase.auth.getSession();
        if (!cancelled) {
          setHasSession(!!data?.session);
        }
      } catch {
        if (!cancelled) setHasSession(false);
      } finally {
        if (!cancelled) setCheckingLink(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [code]);

  const onSubmit = async (e) => {
    e.preventDefault();

    const supabase = getSupabaseClient();
    if (!supabase) {
      toast.error('Supabase is not configured.');
      return;
    }

    const p = String(password || '');
    const c = String(confirm || '');

    if (p.length < 6) {
      toast.error('Password must be at least 6 characters.');
      return;
    }

    if (p !== c) {
      toast.error('Passwords do not match.');
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: p });
      if (error) throw error;

      // After successful update, sign out so the user returns through normal login.
      await supabase.auth.signOut();

      navigate('/login', {
        replace: true,
        state: { reason: 'password_reset', message: 'Password updated. Please sign in.' },
      });
    } catch (err) {
      toastFriendlyError(err, 'Failed to reset password');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-[100vh] grid place-items-center px-4 py-10 bg-slate-50">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-xl font-black">Reset password</CardTitle>
          <CardDescription>
            Set a new password for your People Power account.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {checkingLink ? (
            <div className="text-sm text-slate-600 font-semibold">Checking reset link…</div>
          ) : !hasSession ? (
            <div className="space-y-3">
              <div className="text-sm text-slate-700 font-semibold">
                This reset link is invalid or expired. Please request a new one.
              </div>
              <Button asChild variant="outline" className="w-full">
                <Link to="/login">Back to login</Link>
              </Button>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-3">
              <div className="space-y-1">
                <div className="text-sm font-bold text-slate-800">New password</div>
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} required />
              </div>

              <div className="space-y-1">
                <div className="text-sm font-bold text-slate-800">Confirm password</div>
                <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} minLength={6} required />
              </div>

              <Button type="submit" className="w-full" disabled={saving}>
                {saving ? 'Saving…' : 'Update password'}
              </Button>
            </form>
          )}

          <div className="text-xs text-slate-500 font-semibold">
            Having trouble? Make sure you opened the link in the same browser where you requested it.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
