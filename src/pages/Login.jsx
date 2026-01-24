import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { useAuth } from '@/auth/AuthProvider';
const isProof = import.meta.env.VITE_C4_PROOF_PACK === "1";
import BackButton from '@/components/shared/BackButton';
import { toastFriendlyError } from '@/utils/toastErrors';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { syncUserWithBackend } from '@/api/usersClient';

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { signIn, signUp, resendConfirmationEmail, resetPasswordForEmail, isSupabaseConfigured, authErrorMessage } = useAuth();

  // Current auth UX flow summary (frontend):
  // - Signup calls Supabase signUp.
  //   - If Supabase returns a session => user is signed in immediately.
  //   - If Supabase requires email confirmation => no session is returned; we show a dedicated "Check your email" screen.
  // - Login calls Supabase signInWithPassword.
  // - Forgot password calls Supabase resetPasswordForEmail with redirect to /reset-password.
  const [mode, setMode] = useState('login'); // 'login' | 'signup' | 'check_email' | 'forgot'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [pendingEmail, setPendingEmail] = useState('');
  const [pendingConfirmationSentAt, setPendingConfirmationSentAt] = useState(null);
  const [forgotEmail, setForgotEmail] = useState('');
  const [checkEmailReason, setCheckEmailReason] = useState('signup_sent'); // 'signup_sent' | 'login_needs_verify'

  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);

  const redirectToEmailVerified = useMemo(() => {
    return typeof window !== 'undefined' ? `${window.location.origin}/email-verified` : undefined;
  }, []);

  const redirectToResetPassword = useMemo(() => {
    return typeof window !== 'undefined' ? `${window.location.origin}/reset-password` : undefined;
  }, []);

  const sanitizePostAuthRedirect = (to) => {
    const raw = String(to || '').trim();
    if (!raw) return '/';
    // Avoid self-loops and auth-only routes.
    const path = raw.startsWith('http') ? (() => {
      try {
        return new URL(raw).pathname || '/';
      } catch {
        return raw;
      }
    })() : raw;
    if (path === '/welcome' || path.startsWith('/welcome?') || path.startsWith('/welcome#')) return '/';
    if (path === '/login' || path.startsWith('/login?') || path.startsWith('/login#')) return '/';
    if (path === '/email-verified' || path.startsWith('/email-verified?') || path.startsWith('/email-verified#')) return '/';
    if (path === '/reset-password' || path.startsWith('/reset-password?') || path.startsWith('/reset-password#')) return '/';
    return raw;
  };

  useEffect(() => {
    // One-time toast when authFetch forces a sign-out.
    try {
      const once = sessionStorage.getItem('pp_session_expired_toast');
      if (once) {
        sessionStorage.removeItem('pp_session_expired_toast');
        const msg = String(once || '').trim() || 'Your session has expired. Please sign in again.';
        toast.error(msg);
        setStatus(msg);
      }
    } catch {
      // ignore
    }

    const reason = location.state?.reason;
    const message = location.state?.message;
    if (reason === 'session_expired') {
      setStatus(String(message || 'Your session has expired. Please sign in again.'));
    }

    if (reason === 'password_reset') {
      const text = String(message || 'Password updated. Please sign in.');
      toast.success(text);
    }
  }, [location.state]);

  useEffect(() => {
    if (mode !== 'forgot') return;
    setForgotEmail((prev) => prev || email);
  }, [email, mode]);

  const toFromRoute = () => {
    const rawFrom = location.state?.from;
    const to =
      typeof rawFrom === 'string'
        ? rawFrom
        : rawFrom?.pathname
          ? `${rawFrom.pathname}${rawFrom.search ?? ''}${rawFrom.hash ?? ''}`
          : '/';
    return sanitizePostAuthRedirect(to || '/');
  };

  const submitForgotPassword = async (e) => {
    e.preventDefault();
    setStatus('');
    if (!isSupabaseConfigured) return;

    const toEmail = String(forgotEmail || '').trim();
    if (!toEmail) {
      toast.error('Enter your email address');
      return;
    }

    setLoading(true);
    try {
      await resetPasswordForEmail(toEmail, redirectToResetPassword ? { redirectTo: redirectToResetPassword } : undefined);
      toast.success("If an account exists for this email, we've sent password reset instructions.");
      setMode('login');
    } catch (err) {
      toastFriendlyError(err, "Couldn't send reset email");
    } finally {
      setLoading(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setStatus('');
    setLoading(true);
    try {
      if (!isSupabaseConfigured) return;
      if (mode === 'signup') {
        const result = await signUp(
          String(email || '').trim(),
          String(password || ''),
          redirectToEmailVerified ? { emailRedirectTo: redirectToEmailVerified } : undefined
        );
        try { await syncUserWithBackend(); } catch { /* ignore for now */ }
        if (result?.status === 'signed_in') {
          toast.success('Account created. Welcome!');
          navigate('/welcome', { replace: true, state: { from: toFromRoute(), signedInJustNow: true } });
          return;
        }
        const emailValue = String(email || '').trim();
        setPendingEmail(emailValue);
        setPendingConfirmationSentAt(result?.confirmationSentAt || null);
        setCheckEmailReason('signup_sent');
        setMode('check_email');
        return;
      } else {
        await signIn(String(email || '').trim(), String(password || ''));
        try { await syncUserWithBackend(); } catch { /* ignore for now */ }
        navigate('/welcome', { replace: true, state: { from: toFromRoute(), signedInJustNow: true } });
      }
    } catch (err) {
      if (err?.code === 'EMAIL_NOT_CONFIRMED') {
        const emailValue = String(email || '').trim();
        setPendingEmail(emailValue);
        setCheckEmailReason('login_needs_verify');
        setMode('check_email');
        setStatus('');
        return;
      }
      setStatus(err?.message ?? 'Auth error');
    } finally {
      setLoading(false);
    }
  };

  const submitResend = async () => {
    if (!isSupabaseConfigured) return;
    const toEmail = String(pendingEmail || email || '').trim();
    if (!toEmail) {
      toast.error('Enter your email address');
      return;
    }

    setResendLoading(true);
    try {
      await resendConfirmationEmail(toEmail, redirectToEmailVerified ? { emailRedirectTo: redirectToEmailVerified } : undefined);
      toast.success("If an account exists for this email, we've re-sent the verification link.");
    } catch (err) {
      toastFriendlyError(err, "Couldn't resend verification email");
    } finally {
      setResendLoading(false);
    }
  };

  const headerTitle = mode === 'signup' ? 'Create account' : mode === 'forgot' ? 'Forgot password' : 'Sign in';
  const headerDesc =
    mode === 'signup'
      ? 'When you create an account, we’ll also email you to verify your address.'
      : mode === 'forgot'
        ? 'We’ll email you a password reset link.'
        : 'Sign in to continue.';

  return (
    <div className="min-h-[100vh] grid place-items-center px-4 py-10 bg-slate-50">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl font-black">{headerTitle}</CardTitle>
          <CardDescription>{headerDesc}</CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {!isSupabaseConfigured && !isProof ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
              {authErrorMessage || 'Sign-in is temporarily unavailable.'}
            </div>
          ) : null}

          {status ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">
              {status}
            </div>
          ) : null}

          {mode === 'check_email' ? (
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                {checkEmailReason === 'signup_sent' ? (
                  <>
                    <div className="text-sm font-semibold text-slate-800">
                      We’ve sent a verification link to <span className="font-black">{pendingEmail || email || 'your email'}</span>.
                    </div>
                    {pendingConfirmationSentAt ? (
                      <div className="text-xs text-slate-500 font-semibold mt-2">
                        Sent at {new Date(pendingConfirmationSentAt).toLocaleString()}.
                      </div>
                    ) : null}
                    <div className="text-xs text-slate-600 font-semibold mt-2">
                      Check your inbox (and spam folder), click the link to verify your account, and you should be signed in automatically.
                    </div>
                    <div className="text-xs text-slate-500 font-semibold mt-2">
                      If the link opens in a different browser/device, you can still come back here and sign in after verifying.
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-sm font-semibold text-slate-800">Please verify your email address to continue.</div>
                    <div className="text-xs text-slate-600 font-semibold mt-2">
                      If you don’t see the email for <span className="font-black">{pendingEmail || email || 'your email'}</span>, you can resend it.
                    </div>
                  </>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <Button type="button" onClick={() => setMode('login')} disabled={loading || resendLoading}>
                  Go to login
                </Button>
                <Button type="button" variant="outline" onClick={submitResend} disabled={loading || resendLoading}>
                  {resendLoading ? 'Resending…' : 'Resend confirmation email'}
                </Button>
              </div>

              <div className="text-xs text-slate-500 font-semibold">
                If you already verified, you can just <Link className="underline" to="/login">sign in</Link>.
              </div>
            </div>
          ) : mode === 'forgot' ? (
            <form onSubmit={submitForgotPassword} className="space-y-3">
              <div className="space-y-1">
                <div className="text-sm font-bold text-slate-800">Email</div>
                <Input
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  type="email"
                  required
                  placeholder="you@example.com"
                  disabled={loading || !isSupabaseConfigured}
                />
              </div>

              <Button type="submit" className="w-full" disabled={loading || !isSupabaseConfigured}>
                {loading ? 'Sending…' : 'Send reset link'}
              </Button>

              <Button type="button" variant="outline" className="w-full" onClick={() => setMode('login')} disabled={loading}>
                Back to sign in
              </Button>
            </form>
          ) : (
            <form onSubmit={submit} className="space-y-3">
              <div className="space-y-1">
                <div className="text-sm font-bold text-slate-800">Email</div>
                <Input
                  data-testid="login-email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  type="email"
                  required
                  placeholder="you@example.com"
                  disabled={loading || (!isSupabaseConfigured && !isProof)}
                />
              </div>

              <div className="space-y-1">
                <div className="text-sm font-bold text-slate-800">Password</div>
                <Input
                  data-testid="login-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  type="password"
                  required
                  minLength={6}
                  placeholder="••••••••"
                  disabled={loading || (!isSupabaseConfigured && !isProof)}
                />
              </div>

              {mode === 'login' ? (
                <button
                  type="button"
                  onClick={() => setMode('forgot')}
                  disabled={loading || (!isSupabaseConfigured && !isProof)}
                  className="text-left text-sm font-bold underline underline-offset-2 text-slate-700 hover:text-slate-900 disabled:opacity-70"
                >
                  Forgot password?
                </button>
              ) : (
                <div className="text-xs text-slate-600 font-semibold">
                  You may need to click the verification link in your email before you can log in.
                </div>
              )}

              <Button data-testid="login-submit" type="submit" className="w-full" disabled={loading || (!isSupabaseConfigured && !isProof)}>
                {loading ? 'Working…' : mode === 'signup' ? 'Create account' : 'Sign in'}
              </Button>

              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => {
                  setStatus('');
                  setMode(mode === 'signup' ? 'login' : 'signup');
                }}
                disabled={loading}
              >
                {mode === 'signup' ? 'Already have an account? Sign in' : 'New here? Create an account'}
              </Button>
            </form>
          )}

          <BackButton
            className="inline-flex items-center justify-center gap-2 text-sm font-bold text-slate-500 hover:text-slate-700"
            iconClassName="w-4 h-4"
          />
        </CardContent>
      </Card>
    </div>
  );
}
