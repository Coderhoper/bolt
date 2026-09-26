import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);

  const bearer = request.headers.get('Authorization') || '';
  const token = bearer.replace(/^Bearer\s+/i, '');
  const url = Deno.env.get('SUPABASE_URL');
  const publishableKeysRaw = Deno.env.get('SUPABASE_PUBLISHABLE_KEYS');
  let publishableKey = '';
  if (publishableKeysRaw) {
    try { publishableKey = JSON.parse(publishableKeysRaw).default || ''; }
    catch { return reply({ error: 'Owner provisioning service is misconfigured' }, 503); }
  }
  publishableKey ||= Deno.env.get('SUPABASE_ANON_KEY') || '';
  if (!token || !url || !publishableKey) return reply({ error: 'Owner provisioning service is not configured' }, 503);

  const db = createClient(url, publishableKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const [{ data: userResult, error: authError }, { data: claimResult }] = await Promise.all([
    db.auth.getUser(token), db.auth.getClaims(token),
  ]);
  const user = userResult.user;
  if (authError || !user) return reply({ error: 'Authentication required' }, 401);
  if (claimResult?.claims?.aal !== 'aal2') return reply({ error: 'Verified MFA is required' }, 403);

  const { data: staff } = await db.from('owner_staff').select('role,is_active').eq('user_id', user.id).maybeSingle();
  if (!staff?.is_active || !['platform_admin', 'provisioner'].includes(staff.role)) {
    return reply({ error: 'Owner provisioning access required' }, 403);
  }

  let payload: { action?: string };
  try { payload = await request.json(); }
  catch { return reply({ error: 'Invalid request' }, 400); }
  if (payload.action !== 'check') return reply({ error: 'Only non-mutating connection checks are enabled' }, 403);

  const managementToken = Deno.env.get('lapdav');
  const organizationSlug = Deno.env.get('org_slug');
  if (!managementToken || !organizationSlug) {
    return reply({ error: 'Set the owner project secrets named lapdav and org_slug' }, 503);
  }

  let response: Response;
  try {
    response = await fetch(`https://api.supabase.com/v1/organizations/${encodeURIComponent(organizationSlug)}/projects?limit=1`, {
      headers: { Authorization: `Bearer ${managementToken}`, Accept: 'application/json' },
    });
  } catch {
    return reply({ error: 'Could not reach the Supabase Management API' }, 502);
  }

  if (response.ok) {
    return reply({
      status: 'connected',
      detail: 'The token can read projects in the configured organization. Project creation remains disabled.',
    });
  }
  if (response.status === 401) return reply({ error: 'The lapdav token was rejected or has expired' }, 502);
  if (response.status === 403) return reply({ error: 'The token cannot access this organization. Check its organization scope and project permissions.' }, 502);
  if (response.status === 404) return reply({ error: 'org_slug was not found. Use the organization slug, not a project reference.' }, 502);
  return reply({ error: `Supabase Management API returned HTTP ${response.status}` }, 502);
});
