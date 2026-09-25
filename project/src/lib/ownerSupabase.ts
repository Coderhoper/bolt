import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_OWNER_SUPABASE_URL;
const anonKey = import.meta.env.VITE_OWNER_SUPABASE_ANON_KEY;

// Deliberately never fall back to the tenant Supabase project. The owner plane
// must remain a separately configured database and identity boundary.
export const ownerSupabase = url && anonKey
  ? createClient(url, anonKey, {
      auth: {
        storageKey: 'owner-plane-auth',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;
