import { getActiveTenantId, isTenantContextActive, supabase } from '@/lib/supabase';

const ownerUrl = String(import.meta.env.VITE_OWNER_SUPABASE_URL || '').replace(/\/$/, '');
const ownerPublicKey = String(import.meta.env.VITE_OWNER_SUPABASE_ANON_KEY || '');

export async function invokeTenantOwnerBridge<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<T> {
  if (!isTenantContextActive() || !getActiveTenantId()) throw new Error('Open this page from an active tenant workspace.');
  if (!ownerUrl || !ownerPublicKey) throw new Error('Owner messaging is not configured for this deployment.');
  const { data, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !data.session?.access_token) throw new Error('Sign in again to use tenant support.');

  const response = await fetch(`${ownerUrl}/functions/v1/tenant-bridge`, {
    method: 'POST',
    headers: {
      apikey: ownerPublicKey,
      Authorization: `Bearer ${data.session.access_token}`,
      'Content-Type': 'application/json',
      'x-tenant-id': getActiveTenantId(),
    },
    body: JSON.stringify(body),
  });
  let result: Record<string, unknown> = {};
  try { result = await response.json() as Record<string, unknown>; } catch { /* report a stable error below */ }
  if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'Owner messaging request failed.');
  return result as T;
}
