import { createClient } from '@supabase/supabase-js';

// Frontend Supabase client uses Vite env vars; backend loads its own SUPABASE_* values separately.
// If missing, we export a null client so the UI can degrade gracefully without crashing.
const supabaseUrl = import.meta?.env?.VITE_SUPABASE_URL ? String(import.meta.env.VITE_SUPABASE_URL).trim() : '';
const supabaseAnonKey = import.meta?.env?.VITE_SUPABASE_ANON_KEY
  ? String(import.meta.env.VITE_SUPABASE_ANON_KEY).trim()
  : '';

export const supabaseConfigError = !supabaseUrl || !supabaseAnonKey
  ? 'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in frontend env'
  : null;

if (supabaseConfigError && import.meta?.env?.DEV) {
  console.error('[supabaseClient]', supabaseConfigError);
}

const supabaseClient = supabaseConfigError
  ? null
  : createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        // Best-practice defaults for browser apps (mobile included):
        // - persistSession: Supabase stores/loads session for us
        // - autoRefreshToken: refreshes access tokens when possible
        // - detectSessionInUrl: supports OAuth flows and magic links safely
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });

let refreshInFlight = null;

function isSessionNearExpiry(session, withinSeconds = 60) {
  const expiresAt = session?.expires_at;
  if (!expiresAt) return false;
  const nowSeconds = Math.floor(Date.now() / 1000);
  return Number(expiresAt) - nowSeconds <= withinSeconds;
}

async function refreshOnce() {
  if (!supabaseClient) return null;
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const { data, error } = await supabaseClient.auth.refreshSession();
    if (error) throw error;
    return data?.session ?? null;
  })();
  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

// Central token helper used by API clients.
// - Uses persisted session from Supabase.
// - Refreshes when close to expiry (mobile background/resume).
// - Can force refresh when recovering from 401s.
export async function getValidAccessToken({ withinSeconds = 60, forceRefresh = false } = {}) {
  if (!supabaseClient) return null;

  const { data } = await supabaseClient.auth.getSession();
  const session = data?.session ?? null;
  if (!session) return null;

  const shouldRefresh = forceRefresh || isSessionNearExpiry(session, withinSeconds);
  if (!shouldRefresh) {
    return session?.access_token ? String(session.access_token) : null;
  }

  try {
    const refreshed = await refreshOnce();
    if (refreshed?.access_token) return String(refreshed.access_token);
  } catch {
    // fall back to current token; caller can handle 401 + re-login flow
  }

  return session?.access_token ? String(session.access_token) : null;
}

// NOTE: Supabase dashboard configuration required for email flows:
// - Auth > URL Configuration: set a correct Site URL (e.g. https://peoplepower.app)
// - Add Redirect URLs for (at least):
//   - <site>/reset-password
//   - <site>/email-verified
// Without this, password reset + email verification links may not redirect correctly.

export function getSupabaseClient() {
  return supabaseClient;
}

// Backwards-compatible export for any legacy imports (may be null).
export const supabase = supabaseClient;
