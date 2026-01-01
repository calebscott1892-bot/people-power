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

const supabaseClient = supabaseConfigError ? null : createClient(supabaseUrl, supabaseAnonKey);

export function getSupabaseClient() {
  return supabaseClient;
}

// Backwards-compatible export for any legacy imports (may be null).
export const supabase = supabaseClient;
