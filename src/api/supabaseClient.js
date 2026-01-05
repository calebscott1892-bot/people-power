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
