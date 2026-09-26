import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

function browserClient(url: string, publishableKey: string, detectSessionInUrl = true): SupabaseClient {
  return createClient(url, publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl,
    },
  });
}

// The regular deployment remains the default tenant. Slug routes replace this
// before React mounts, so AuthContext and every data page use the resolved DB.
const isTenantRoute = /^\/t\/[a-z0-9]+(?:-[a-z0-9]+)*\/?$/i.test(window.location.pathname);
// The tenant invite callback arrives before its database is resolved. Keep the
// default app client from consuming that token against the wrong Supabase project.
export let supabase = browserClient(supabaseUrl, supabaseAnonKey, !isTenantRoute);

export function setTenantSupabase(url: string, publishableKey: string) {
  supabase = browserClient(url, publishableKey);
}
