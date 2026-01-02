import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getSupabaseClient, supabaseConfigError } from '@/api/supabaseClient';
import { fetchMyProfile } from '@/api/userProfileClient';
import { getStaffRole } from '@/utils/staff';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [serverStaffRole, setServerStaffRole] = useState(null);
  const authDisabledMessage = 'Sign-in is temporarily unavailable; configuration error. Please contact support.';
  const staffRole = useMemo(() => {
    const serverRole = String(serverStaffRole || '').trim().toLowerCase();
    if (serverRole === 'admin' || serverRole === 'moderator') return serverRole;
    const claimedRoleRaw = user?.app_metadata?.role || user?.user_metadata?.role || user?.role || '';
    const claimedRole = String(claimedRoleRaw || '').trim().toLowerCase();
    const emailRole = getStaffRole(user?.email);
    if (emailRole && emailRole !== 'user') return emailRole;
    if (claimedRole === 'admin' || claimedRole === 'moderator') return claimedRole;
    return 'user';
  }, [user, serverStaffRole]);
  const isAdmin = staffRole === 'admin';
  const isStaff = staffRole === 'admin' || staffRole === 'moderator';

  useEffect(() => {
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
      setSession(data?.session ?? null);
      setUser(data?.session?.user ?? null);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession ?? null);
      setUser(newSession?.user ?? null);
      setLoading(false);
    });

    return () => {
      mounted = false;
      sub?.subscription?.unsubscribe?.();
    };
  }, []);

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

  const signIn = async (email, password) => {
    const supabase = getSupabaseClient();
    if (supabaseConfigError || !supabase) throw new Error(authDisabledMessage);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  };

  const signUp = async (email, password) => {
    const supabase = getSupabaseClient();
    if (supabaseConfigError || !supabase) throw new Error(authDisabledMessage);
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
    return data;
  };

  // Logout: calls Supabase signOut and clears local auth state.
  const logout = useCallback(async () => {
    const supabase = getSupabaseClient();
    if (supabaseConfigError || !supabase) throw new Error(authDisabledMessage);
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    setSession(null);
    setUser(null);
    setServerStaffRole(null);
  }, [authDisabledMessage]);

  const value = useMemo(
    () => ({
      session,
      user,
      loading,
      signIn,
      signUp,
      signOut: logout,
      staffRole,
      isAdmin,
      isStaff,
      isSupabaseConfigured: !supabaseConfigError,
      authErrorMessage: supabaseConfigError ? authDisabledMessage : null,
      logout,
    }),
    [session, user, loading, staffRole, isAdmin, isStaff, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
