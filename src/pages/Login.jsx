import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { useAuth } from '@/auth/AuthProvider';
import { Navigate } from 'react-router-dom';
const isProof = import.meta.env.VITE_C4_PROOF_PACK === "1";
import BackButton from '@/components/shared/BackButton';
import { toastFriendlyError } from '@/utils/toastErrors';
import { getFriendlyError } from '@/utils/friendlyErrors';
import { usePendingGuard } from '@/hooks/usePendingGuard';
import { captureRequestDebugInfo } from '@/utils/requestDebug';
import { showPendingTimeoutToast } from '@/utils/pendingTimeoutToast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { PasswordStrength } from '@/components/ui/password-strength';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { signIn, signUp, resendConfirmationEmail, resetPasswordForEmail, isSupabaseConfigured, authErrorMessage, user } = useAuth();

  // Current auth UX flow summary (frontend):
  // - Signup calls Supabase signUp.
  //   - If Supabase returns a session => user is signed in immediately.
  //   - If Supabase requires email confirmation => no session is returned; we show a dedicated "Check your email" screen.
  // - Login calls Supabase signInWithPassword.
  // - Forgot password calls Supabase resetPasswordForEmail with redirect to /reset-password.
  const [mode, setMode] = useState('login'); // 'login' | 'signup' | 'check_email' | 'forgot'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);

  const [pendingEmail, setPendingEmail] = useState('');
  const [pendingConfirmationSentAt, setPendingConfirmationSentAt] = useState(null);
  const [forgotEmail, setForgotEmail] = useState('');
  const [checkEmailReason, setCheckEmailReason] = useState('signup_sent'); // 'signup_sent' | 'login_needs_verify'

  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);

  const authPendingGuard = usePendingGuard('Auth');
  const forgotPendingGuard = usePendingGuard('Forgot password');
  const resendPendingGuard = usePendingGuard('Resend confirmation');

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
    e?.preventDefault?.();
    setStatus('');
    if (!isSupabaseConfigured) {
      setStatus(authErrorMessage || 'Sign-in is temporarily unavailable.');
      return;
    }

    const toEmail = String(forgotEmail || '').trim();
    if (!toEmail) {
      toast.error('Enter your email address');
      return;
    }

    if (loading) return;

    forgotPendingGuard.start({
      retry: () => submitForgotPassword(null),
      onTimeout: () => {
        setLoading(false);
        captureRequestDebugInfo({
          label: 'Forgot password',
          endpoint: 'supabase:resetPasswordForEmail',
          method: 'POST',
          elapsed_ms: forgotPendingGuard.timeoutMs,
          error_message: 'Timed out after 20s',
        });
        showPendingTimeoutToast({ retry: () => submitForgotPassword(null) });
      },
    });

    setLoading(true);
    try {
      await resetPasswordForEmail(toEmail, redirectToResetPassword ? { redirectTo: redirectToResetPassword } : undefined);
      const resetSentMessage = 'If an account exists for that email, we’ve sent a password reset link. Please check your inbox, spam, and junk folders.';
      toast.success(resetSentMessage);
      setStatus(resetSentMessage);
      setMode('login');
    } catch (err) {
      toastFriendlyError(err, "Couldn't send reset email");
    } finally {
      setLoading(false);
      forgotPendingGuard.stop();
    }
  };

  const submit = async (e) => {
    e?.preventDefault?.();
    setStatus('');

    if (loading) return;

    const label = mode === 'signup' ? 'Create account' : 'Sign in';
    const endpoint = mode === 'signup' ? 'supabase:signUp' : 'supabase:signInWithPassword';
    const retry = () => submit(null);

    authPendingGuard.start({
      retry,
      onTimeout: () => {
        setLoading(false);
        captureRequestDebugInfo({
          label,
          endpoint,
          method: 'POST',
          elapsed_ms: authPendingGuard.timeoutMs,
          error_message: 'Timed out after 20s',
        });
        showPendingTimeoutToast({ retry });
      },
    });

    setLoading(true);
    try {
      if (!isSupabaseConfigured) {
        setStatus(authErrorMessage || 'Sign-in is temporarily unavailable.');
        return;
      }
      if (mode === 'signup' && String(password || '').length > 128) {
        setStatus('Password must be 128 characters or fewer.');
        return;
      }
      if (mode === 'signup') {
        const result = await signUp(
          String(email || '').trim(),
          String(password || ''),
          redirectToEmailVerified ? { emailRedirectTo: redirectToEmailVerified } : undefined
        );

        // Persist terms acceptance so downstream gates (OnboardingFlow) recognize it
        if (termsAccepted) {
          try {
            const emailKey = String(email || '').trim().toLowerCase();
            const prefix = emailKey ? `peoplepower_terms_accepted:${emailKey}` : 'peoplepower_terms_accepted';
            localStorage.setItem(prefix, 'true');
            localStorage.setItem('peoplepower_terms_accepted', 'true');
            localStorage.setItem('peoplepower_safety_accepted', 'true');
          } catch { /* ignore */ }
        }

        if (result?.status === 'signed_in') {
          toast.success('Account created. Welcome!');
          navigate(toFromRoute() || '/', { replace: true });
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
        navigate(toFromRoute() || '/', { replace: true });
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
      const friendly = getFriendlyError(err);
      setStatus(friendly?.title || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
      authPendingGuard.stop();
    }
  };

  const submitResend = async () => {
    if (!isSupabaseConfigured) {
      toast.error(authErrorMessage || 'Sign-in is temporarily unavailable.');
      return;
    }
    const toEmail = String(pendingEmail || email || '').trim();
    if (!toEmail) {
      toast.error('Enter your email address');
      return;
    }

    if (resendLoading) return;

    const retry = () => submitResend();
    resendPendingGuard.start({
      retry,
      onTimeout: () => {
        setResendLoading(false);
        captureRequestDebugInfo({
          label: 'Resend confirmation email',
          endpoint: 'supabase:resendConfirmationEmail',
          method: 'POST',
          elapsed_ms: resendPendingGuard.timeoutMs,
          error_message: 'Timed out after 20s',
        });
        showPendingTimeoutToast({ retry });
      },
    });

    setResendLoading(true);
    try {
      await resendConfirmationEmail(toEmail, redirectToEmailVerified ? { emailRedirectTo: redirectToEmailVerified } : undefined);
      toast.success("If an account exists for this email, we've re-sent the verification link.");
    } catch (err) {
      toastFriendlyError(err, "Couldn't resend verification email");
    } finally {
      setResendLoading(false);
      resendPendingGuard.stop();
    }
  };

  const showTabs = mode === 'login' || mode === 'signup';

  const headerTitle = mode === 'forgot' ? 'Forgot password' : mode === 'check_email' ? 'Check your email' : null;
  const headerDesc =
    mode === 'forgot'
      ? 'We\u2019ll email you a password reset link.'
      : mode === 'check_email'
        ? 'We sent you a verification link.'
        : null;

  // If user is already authenticated, redirect to home
  if (user) return <Navigate to="/" replace />;

  return (
    <div className="min-h-svh grid place-items-center px-4 py-10 bg-gradient-to-br from-slate-50 via-white to-blue-50">
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center gap-2">
          <img src="/logo.png?v=20260320-1" alt="People Power" className="w-14 h-14 object-contain" />
          <span className="text-xs font-semibold text-slate-500">Organize. Connect. Act.</span>
        </div>

      <Card className="w-full max-w-md">
        {showTabs ? (
          <div className="flex border-b border-slate-200" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'login'}
              onClick={() => { setStatus(''); setMode('login'); }}
              className={`flex-1 py-3 text-sm font-bold transition-colors ${
                mode === 'login'
                  ? 'border-b-2 border-slate-900 text-slate-900'
                  : 'text-slate-500 hover:text-slate-600'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'signup'}
              onClick={() => { setStatus(''); setMode('signup'); }}
              className={`flex-1 py-3 text-sm font-bold transition-colors ${
                mode === 'signup'
                  ? 'border-b-2 border-slate-900 text-slate-900'
                  : 'text-slate-500 hover:text-slate-600'
              }`}
            >
              Create Account
            </button>
          </div>
        ) : null}

        {headerTitle ? (
          <CardHeader>
            <CardTitle className="text-2xl font-black">{headerTitle}</CardTitle>
            {headerDesc ? <CardDescription>{headerDesc}</CardDescription> : null}
          </CardHeader>
        ) : null}

        <CardContent className={`space-y-4 ${showTabs ? 'pt-6' : ''}`}>
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
                <label htmlFor="forgot-email" className="text-sm font-bold text-slate-800">Email</label>
                <Input
                  id="forgot-email"
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
                <label htmlFor="login-email" className="text-sm font-bold text-slate-800">Email</label>
                <Input
                  id="login-email"
                  data-testid="login-email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  type="email"
                  required
                  placeholder="you@example.com"
                  autoComplete="email"
                  disabled={loading || (!isSupabaseConfigured && !isProof)}
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="login-password" className="text-sm font-bold text-slate-800">Password</label>
                <PasswordInput
                  id="login-password"
                  data-testid="login-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  placeholder="••••••••"
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  disabled={loading || (!isSupabaseConfigured && !isProof)}
                />
                {mode === 'signup' ? <PasswordStrength password={password} /> : null}
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
                <>
                  <label className="flex items-start gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      className="mt-1 h-5 w-5 rounded border-slate-300"
                      checked={termsAccepted}
                      onChange={(e) => setTermsAccepted(e.target.checked)}
                    />
                    <span className="font-semibold leading-snug">
                      I agree to the{' '}
                      <Link to="/terms-of-service" target="_blank" className="underline text-[#3A3DFF]">Terms of Service</Link>,{' '}
                      <Link to="/privacy-policy" target="_blank" className="underline text-[#3A3DFF]">Privacy Policy</Link>, and{' '}
                      <Link to="/community-guidelines" target="_blank" className="underline text-[#3A3DFF]">Community Guidelines</Link>.
                    </span>
                  </label>
                  <div className="text-xs text-slate-500 font-semibold">
                    We&apos;ll email you a verification link to confirm your address.
                  </div>
                </>
              )}

              <Button data-testid="login-submit" type="submit" className="w-full" disabled={loading || (!isSupabaseConfigured && !isProof) || (mode === 'signup' && !termsAccepted)} aria-busy={loading}>
                {loading ? 'Working…' : mode === 'signup' ? 'Create account' : 'Sign in'}
              </Button>
            </form>
          )}

          <div className="flex items-center justify-between gap-2">
            <BackButton
              className="inline-flex items-center justify-center gap-2 text-sm font-bold text-slate-500 hover:text-slate-700"
              iconClassName="w-4 h-4"
            />
            <Link
              to="/help"
              className="text-sm font-bold text-slate-500 hover:text-slate-700 underline underline-offset-2"
            >
              Can&apos;t sign in? Get help
            </Link>
          </div>
        </CardContent>
      </Card>
      </div>
    </div>
  );
}
