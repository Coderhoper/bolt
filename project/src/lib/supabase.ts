import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const defaultTenantId = import.meta.env.VITE_DEFAULT_TENANT_ID || '';
let activeTenantId = defaultTenantId;

function browserClient(url: string, publishableKey: string, detectSessionInUrl = true, tenantId = defaultTenantId): SupabaseClient {
    // Tenant context is sent to PostgREST and server functions that must authorize
    // an action against a specific membership. Auth and Storage stay tenant-neutral.
  const tenantFetch: typeof fetch = (input, init) => {
    const requestUrl = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
      if (tenantId && (requestUrl.includes('/rest/v1/') || requestUrl.includes('/functions/v1/'))) {
        headers.set('x-tenant-id', tenantId);
      }
    return fetch(input, { ...init, headers });
  };

  return createClient(url, publishableKey, {
    global: { fetch: tenantFetch },
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

export function setTenantSupabase(url: string, publishableKey: string, tenantId: string) {
  activeTenantId = tenantId;
  supabase = browserClient(url, publishableKey, true, tenantId);
}

export function isTenantContextActive() {
  return Boolean(activeTenantId);
}

export function getActiveTenantId() {
  return activeTenantId;
}
