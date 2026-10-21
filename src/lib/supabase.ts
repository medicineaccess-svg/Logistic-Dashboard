import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigured = Boolean(url && key);

// Only the publishable/anon key is ever used in the browser. All access control is enforced
// by Postgres Row Level Security and SECURITY DEFINER functions that read auth.uid().
export const supabase = createClient(url ?? 'https://invalid.local', key ?? 'missing-key', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  realtime: { params: { eventsPerSecond: 5 } },
});
