import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { getSupabaseClient, supabaseConfigError } from '@/api/supabaseClient';
const isProof = import.meta.env.VITE_C4_PROOF_PACK === "1";
import { SERVER_BASE } from '@/api/serverBase';
import { fetchMyProfile } from '@/api/userProfileClient';
import { upsertMyPublicKey } from '@/api/keysClient';
import { getOrCreateIdentityKeypair } from '@/lib/e2eeCrypto';
import { logError } from '@/utils/logError';
import { httpFetch } from '@/utils/httpFetch';
import { getStaffRole } from '@/utils/staff';
import { configureAuthFetch, installAuthFetch } from '@/auth/authFetch';
import { queryKeys } from '@/lib/queryKeys';

// --- Backend user sync for persistence proof ---
import { syncUserWithBackend } from '@/api/usersClient';


// Move sessionRef to top-level so it can be exported and used by getAccessToken
export const sessionRef = { current: null };

const AuthContext = createContext(null);
const AUTH_DISABLED_MESSAGE = 'Sign-in is temporarily unavailable; configuration error. Please contact support.';

export function AuthProvider({ children }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [serverStaffRole, setServerStaffRole] = useState(null);
  const lastKeyPublishRef = useRef({ accessToken: null, email: null });
  // sessionRef is now top-level and exported
  const staffRole = useMemo(() => {
    const serverRole = String(serverStaffRole || '').trim().toLowerCase();
    if (serverRole === 'admin' || serverRole === 'moderator') return serverRole;
    const emailRole = getStaffRole(user?.email);
    if (emailRole && emailRole !== 'user') return emailRole;
    return 'user';
  }, [user, serverStaffRole]);
  const isAdmin = staffRole === 'admin';
  const isStaff = staffRole === 'admin' || staffRole === 'moderator';
  const emailConfirmedAt = user?.email_confirmed_at ?? null;
  const isEmailVerified = !!emailConfirmedAt;

  const isAuthReady = !loading;

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const applySession = useCallback(
    (nextSession) => {
      setSession(nextSession ?? null);
      setUser(nextSession?.user ?? null);
      setLoading(false);
    },
    []
  );

  const refreshProofUser = useCallback(async () => {
    setLoading(true);
    try {
      const res = await httpFetch(`${SERVER_BASE}/auth/me`, { credentials: 'include' });
      if (!res.ok) {
        setUser(null);
        return null;
      }
      const data = await res.json();
      const id = data?.user?.id ?? data?.id ?? null;
      const email = data?.user?.email ?? data?.email ?? null;
      const role = data?.user?.role ?? data?.role ?? 'user';
      if (id && email) {
        const next = { id: String(id), email: String(email), role: String(role || 'user') };
        setUser(next);
        return next;
      }
      setUser(null);
      return null;
    } catch {
      setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  // Current auth/token flow summary:
  // - We create the Supabase client in `src/api/supabaseClient.js` (persisted sessions + auto refresh enabled).
  // - On startup we call `supabase.auth.getSession()` and keep the session/user in React state.
  // - We subscribe to `supabase.auth.onAuthStateChange` to stay in sync (sign-in, refresh, sign-out).
  // - API requests attach the access token via `Authorization: Bearer <token>`.
  //   (We also install a global fetch wrapper to attach the latest token and handle session expiry consistently.)
  useEffect(() => {
    if (isProof) {
      // Proof mode: cookie-based auth against backend
      refreshProofUser();
      return;
    }
    // ...existing code for Supabase...
    const supabase = getSupabaseClient();
    if (supabaseConfigError) {
      setSession(null);
      setUser(null);
      setServerStaffRole(null);
      setLoading(false);
      return undefined;
    }
    if (!supabase) {
      setSession(null);
      setUser(null);
      setServerStaffRole(null);
      setLoading(false);
      return undefined;
    }
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      applySession(data?.session ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      applySession(newSession ?? null);
    });
    return () => {
      mounted = false;
      sub?.subscription?.unsubscribe?.();
    };
  }, [applySession, refreshProofUser]);

  // Keep React Query caches in sync with auth state.
  useEffect(() => {
    const email = user?.email ? String(user.email).trim().toLowerCase() : null;
    if (!isAuthReady) return;

    // When auth changes, refresh user-bound queries.
    queryClient.invalidateQueries({ queryKey: queryKeys.userProfile.me(email) }).catch(() => {});
    queryClient.invalidateQueries({ queryKey: queryKeys.blocks.mine(email) }).catch(() => {});
  }, [queryClient, user?.email, isAuthReady]);

  useEffect(() => {
    configureAuthFetch({
      getAccessToken: () => {
        const s = sessionRef.current;
        return s?.access_token ? String(s.access_token) : null;
      },
      getSession: () => sessionRef.current,
      refreshSession: async () => {
        const supabase = getSupabaseClient();
        if (!supabase) return null;
        const { data, error } = await supabase.auth.refreshSession();
        if (error) throw error;
        return data?.session ?? null;
      },
      onAuthExpired: async ({ message }) => {
        try {
          const msg = String(message || '').trim() || 'Your session has expired. Please sign in again.';
          sessionStorage.setItem('pp_session_expired_toast', msg);
        } catch {
          // ignore
        }

        // Clear local auth state so protected routes redirect predictably.
        setSession(null);
        setUser(null);
        setServerStaffRole(null);

        const from =
          typeof window !== 'undefined'
            ? `${window.location.pathname}${window.location.search ?? ''}${window.location.hash ?? ''}`
            : '/';
        navigate('/login', { replace: true, state: { from, reason: 'session_expired', message } });
      },
    });

    installAuthFetch();
  }, [navigate]);

  useEffect(() => {
    const accessToken = session?.access_token ? String(session.access_token) : null;
    if (!accessToken) {
      setServerStaffRole(null);
      return;
    }
    let active = true;
    fetchMyProfile({ accessToken, includeMeta: true })
      .then((res) => {
        const role = res?.meta?.staff_role ? String(res.meta.staff_role).toLowerCase() : null;
        if (active && (role === 'admin' || role === 'moderator' || role === 'user')) {
          setServerStaffRole(role);
        }
      })
      .catch(() => {
        if (active) setServerStaffRole(null);
      });
    return () => {
      active = false;
    };
  }, [session?.access_token]);

  // Publish the user's identity public key shortly after sign-in.
  // This lets other users message a newly created account without requiring
  // them to first open the Messages page.
  useEffect(() => {
    const accessToken = session?.access_token ? String(session.access_token) : null;
    const email = user?.email ? String(user.email).trim().toLowerCase() : null;
    if (!accessToken || !email) return;

    const prev = lastKeyPublishRef.current;
    if (prev.accessToken === accessToken && prev.email === email) return;
    lastKeyPublishRef.current = { accessToken, email };

    let cancelled = false;
    (async () => {
      try {
        const kp = await getOrCreateIdentityKeypair(email);
        if (cancelled) return;
        await upsertMyPublicKey(kp.publicKey, { accessToken });
      } catch (e) {
        if (!cancelled) {
          logError(e, 'AuthProvider: failed to publish messaging public key', { email });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [session?.access_token, user?.email]);

  const signIn = useCallback(async (email, password) => {
    const supabase = getSupabaseClient();
    if (supabaseConfigError || !supabase) throw new Error(AUTH_DISABLED_MESSAGE);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      const msg = String(error?.message || 'Sign-in failed');
      if (msg.toLowerCase().includes('email not confirmed')) {
        const e = new Error('Please verify your email address, then sign in.');
        e.code = 'EMAIL_NOT_CONFIRMED';
        throw e;
      }
      throw error;
    }

    // Ensure UI updates immediately even before onAuthStateChange fires.
    if (data?.session) {
      applySession(data.session);
      // Backend user sync for persistence proof
      try {
        await syncUserWithBackend();
      } catch (e) {
        // Log but do not block login
        logError(e, 'Failed to sync user with backend after signIn');
      }
    }
    return { status: 'signed_in', session: data?.session ?? null, user: data?.user ?? null };
  }, [applySession]);

  const signUp = useCallback(async (email, password, options = {}) => {
    const supabase = getSupabaseClient();
    if (supabaseConfigError || !supabase) throw new Error(AUTH_DISABLED_MESSAGE);
    const emailRedirectTo = options?.emailRedirectTo ? String(options.emailRedirectTo) : null;
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      ...(emailRedirectTo ? { options: { emailRedirectTo } } : null),
    });
    if (error) throw error;

    // Supabase behavior depends on project settings:
    // - If email confirmation is OFF, `data.session` is usually present => user is immediately signed in.
    // - If email confirmation is REQUIRED, `data.session` is null but `data.user.confirmation_sent_at` is present.
    if (data?.session) {
      applySession(data.session);
      // Backend user sync for persistence proof
      try {
        await syncUserWithBackend();
      } catch (e) {
        // Log but do not block signup
        logError(e, 'Failed to sync user with backend after signUp');
      }
      return { status: 'signed_in', session: data.session, user: data.user ?? null };
    }

    const confirmationSentAt = data?.user?.confirmation_sent_at || null;
    return {
      status: 'confirmation_required',
      session: null,
      user: data?.user ?? null,
      confirmationSentAt,
    };
  }, [applySession]);

  const resendConfirmationEmail = useCallback(async (email, options = {}) => {
    const supabase = getSupabaseClient();
    if (supabaseConfigError || !supabase) throw new Error(AUTH_DISABLED_MESSAGE);
    const toEmail = String(email || '').trim();
    if (!toEmail) throw new Error('Email is required');

    // Supabase v2: auth.resend({ type: 'signup', email, options?: { emailRedirectTo } })
    const fn = supabase?.auth?.resend;
    if (typeof fn !== 'function') {
      throw new Error('Resend is not supported by this Supabase client version.');
    }

    const emailRedirectTo = options?.emailRedirectTo ? String(options.emailRedirectTo) : null;
    const { error } = await fn({
      type: 'signup',
      email: toEmail,
      ...(emailRedirectTo ? { options: { emailRedirectTo } } : null),
    });
    if (error) throw error;
    return { ok: true };
  }, []);

  const resetPasswordForEmail = useCallback(async (email, options = {}) => {
    const supabase = getSupabaseClient();
    if (supabaseConfigError || !supabase) throw new Error(AUTH_DISABLED_MESSAGE);
    const toEmail = String(email || '').trim();
    if (!toEmail) throw new Error('Email is required');
    const redirectTo = options?.redirectTo ? String(options.redirectTo) : null;
    const { error } = await supabase.auth.resetPasswordForEmail(
      toEmail,
      redirectTo ? { redirectTo } : undefined
    );
    if (error) throw error;
    return { ok: true };
  }, []);

  // Logout: calls Supabase signOut and clears local auth state.
  const logout = useCallback(async () => {
    const supabase = getSupabaseClient();
    if (supabaseConfigError || !supabase) throw new Error(AUTH_DISABLED_MESSAGE);
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    setSession(null);
    setUser(null);
    setServerStaffRole(null);

    try {
      queryClient.clear();
    } catch {
      // ignore
    }
  }, [queryClient]);

  const value = useMemo(() => {
    if (isProof) {
      return {
        session: null,
        user,
        accessToken: null,
        loading,
        signIn: async (email, password) => {
          const res = await httpFetch(`${SERVER_BASE}/auth/proof/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ email, password }),
          });
          const data = await res.json().catch(() => null);
          if (!res.ok) throw new Error(data?.error || 'Auth error');
          await refreshProofUser();
          return { ok: true };
        },
        signUp: async (email, password) => {
          const res = await httpFetch(`${SERVER_BASE}/auth/proof/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ email, password }),
          });
          const data = await res.json().catch(() => null);
          if (!res.ok) throw new Error(data?.error || 'Auth error');
          await refreshProofUser();
          return { ok: true, status: 'signed_in' };
        },
        resendConfirmationEmail: async () => { throw new Error('Not implemented in proof mode'); },
        resetPasswordForEmail: async () => { throw new Error('Not implemented in proof mode'); },
        signOut: async () => { await httpFetch(`${SERVER_BASE}/auth/proof/logout`, { method: 'POST', credentials: 'include' }); setUser(null); },
        staffRole: 'user',
        isAdmin: false,
        isStaff: false,
        emailConfirmedAt: null,
        isEmailVerified: true,
        isAuthReady: !loading,
        isSupabaseConfigured: true,
        authErrorMessage: null,
        logout: async () => { await httpFetch(`${SERVER_BASE}/auth/proof/logout`, { method: 'POST', credentials: 'include' }); setUser(null); },
      };
    }
    return {
      session,
      user,
      accessToken: session?.access_token ? String(session.access_token) : null,
      loading,
      signIn,
      signUp,
      resendConfirmationEmail,
      resetPasswordForEmail,
      signOut: logout,
      staffRole,
      isAdmin,
      isStaff,
      emailConfirmedAt,
      isEmailVerified,
      isAuthReady,
      isSupabaseConfigured: !supabaseConfigError,
      authErrorMessage: supabaseConfigError ? AUTH_DISABLED_MESSAGE : null,
      logout,
    };
  }, [
    session,
    user,
    loading,
    signIn,
    signUp,
    resendConfirmationEmail,
    resetPasswordForEmail,
    logout,
    staffRole,
    isAdmin,
    isStaff,
    emailConfirmedAt,
    isEmailVerified,
    isAuthReady,
    // proof
    isProof,
    refreshProofUser
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

// Helper to get access token for backend sync

export function getAccessToken() {
  return sessionRef.current?.access_token ? String(sessionRef.current.access_token) : null;
}
