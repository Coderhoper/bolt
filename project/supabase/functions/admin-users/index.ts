import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-tenant-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const appBaseUrl = (Deno.env.get('TENANT_APP_BASE_URL') || 'https://bolt-six-mauve.vercel.app').replace(/\/$/, '');
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

async function listUsers(adminClient: ReturnType<typeof createClient>) {
  const users: { id: string; email?: string }[] = [];
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    users.push(...data.users.map(user => ({ id: user.id, email: user.email || '' })));
    if (data.users.length < 1000) break;
  }
  return users;
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authorization = request.headers.get('Authorization');
  const token = authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'Authentication required' }, 401);

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anonKey || !serviceKey) return json({ error: 'Server is not configured' }, 500);

  const authClient = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data: { user }, error: authError } = await authClient.auth.getUser(token);
  if (authError || !user) return json({ error: 'Invalid session' }, 401);

  const adminClient = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  let tenantId = request.headers.get('x-tenant-id') || '';

  if (tenantId) {
    if (!uuidPattern.test(tenantId)) return json({ error: 'A valid tenant context is required' }, 400);
    const [{ data: tenant, error: tenantError }, { data: membership, error: membershipError }] = await Promise.all([
      adminClient.from('business_tenants').select('id,slug,status').eq('id', tenantId).maybeSingle(),
      adminClient.from('tenant_memberships').select('role,status').eq('tenant_id', tenantId).eq('user_id', user.id).maybeSingle(),
    ]);
    if (tenantError || tenant?.status !== 'active') return json({ error: 'Tenant is unavailable' }, 403);
    if (membershipError || membership?.role !== 'admin' || membership.status !== 'active') {
      return json({ error: 'Tenant administrator access required' }, 403);
    }

    let payload: Record<string, unknown>;
    try { payload = await request.json(); } catch { return json({ error: 'Invalid request body' }, 400); }

    if (payload.action === 'list') {
      const { data: memberships, error: membershipListError } = await adminClient.from('tenant_memberships')
        .select('user_id,role,status,created_at').eq('tenant_id', tenantId).order('created_at', { ascending: false });
      if (membershipListError) return json({ error: 'Could not load tenant users' }, 500);
      const ids = (memberships || []).map(row => row.user_id);
      if (!ids.length) return json({ profiles: [] });
      const [{ data: profiles, error: profileListError }, users] = await Promise.all([
        adminClient.from('profiles').select('id,name,created_at').in('id', ids),
        listUsers(adminClient),
      ]);
      if (profileListError) return json({ error: 'Could not load tenant user profiles' }, 500);
      const profileById = new Map((profiles || []).map(profile => [profile.id, profile]));
      const emailById = new Map(users.map(account => [account.id, account.email || '']));
      const rows = (memberships || []).flatMap(membershipRow => {
        const profile = profileById.get(membershipRow.user_id);
        return profile ? [{
          ...profile,
          role: membershipRow.role,
          status: membershipRow.status,
          email: emailById.get(membershipRow.user_id) || '',
          membership_created_at: membershipRow.created_at,
        }] : [];
      });
      return json({ profiles: rows });
    }

    if (payload.action === 'create') {
      const name = typeof payload.name === 'string' ? payload.name.trim() : '';
      const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
      const role = payload.role === 'admin' ? 'admin' : 'owner';
      if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return json({ error: 'A name and valid email address are required' }, 400);
      }

      let existingUser: { id: string; email?: string } | undefined;
      try { existingUser = (await listUsers(adminClient)).find(account => account.email.toLowerCase() === email); }
      catch { return json({ error: 'Could not check existing tenant accounts' }, 500); }

      let userId = existingUser?.id;
      if (!userId) {
        const { data: invited, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
          data: { name },
          redirectTo: `${appBaseUrl}/t/${tenant.slug}`,
        });
        if (inviteError || !invited.user) return json({ error: inviteError?.message || 'Could not send the invitation' }, 400);
        userId = invited.user.id;
      }

      const { error: profileError } = await adminClient.from('profiles')
        .update({ name, status: 'active' }).eq('id', userId);
      if (profileError) return json({ error: 'The tenant user profile could not be configured' }, 500);

      const { error: membershipUpsertError } = await adminClient.from('tenant_memberships').upsert({
        tenant_id: tenantId, user_id: userId, role, status: 'active',
      }, { onConflict: 'tenant_id,user_id' });
      if (membershipUpsertError) return json({ error: 'The tenant membership could not be created' }, 500);
      return json({ id: userId, email, name, role, invited: !existingUser,
        message: existingUser ? 'Existing account added to this business.' : 'Invitation sent to the new user.' });
    }

    if (payload.action === 'status') {
      const id = typeof payload.id === 'string' ? payload.id : '';
      const status = payload.status === 'inactive' ? 'inactive' : payload.status === 'active' ? 'active' : null;
      if (!id || !status) return json({ error: 'A user and valid status are required' }, 400);
      if (id === user.id && status === 'inactive') return json({ error: 'You cannot deactivate your own account' }, 400);
      const { data: target, error: targetError } = await adminClient.from('tenant_memberships')
        .select('user_id').eq('tenant_id', tenantId).eq('user_id', id).maybeSingle();
      if (targetError || !target) return json({ error: 'User is not a member of this business' }, 404);
      const { error } = await adminClient.from('tenant_memberships')
        .update({ status }).eq('tenant_id', tenantId).eq('user_id', id);
      if (error) return json({ error: 'Could not update the tenant membership' }, 500);
      return json({ id, status });
    }

    return json({ error: 'Unknown action' }, 400);
  }

  // The legacy single-business installation continues to authorize its users
  // from profiles and keeps its existing password-based account creation flow.
  const { data: caller, error: profileError } = await adminClient.from('profiles')
    .select('role,status').eq('id', user.id).maybeSingle();
  if (profileError || caller?.role !== 'admin' || caller.status !== 'active') {
    return json({ error: 'Administrator access required' }, 403);
  }

  let payload: Record<string, unknown>;
  try { payload = await request.json(); } catch { return json({ error: 'Invalid request body' }, 400); }

  if (payload.action === 'list') {
    const [{ data: profiles, error: listError }, users] = await Promise.all([
      adminClient.from('profiles').select('*').order('created_at', { ascending: false }),
      listUsers(adminClient),
    ]);
    if (listError) return json({ error: 'Could not load user accounts' }, 500);
    const emails = new Map(users.map(account => [account.id, account.email || '']));
    return json({ profiles: (profiles || []).map(profile => ({ ...profile, email: emails.get(profile.id) || '' })) });
  }

  if (payload.action === 'create') {
    const name = typeof payload.name === 'string' ? payload.name.trim() : '';
    const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
    const password = typeof payload.password === 'string' ? payload.password : '';
    const role = payload.role === 'admin' ? 'admin' : 'owner';
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8) {
      return json({ error: 'Name, valid email, and a password of at least 8 characters are required' }, 400);
    }
    if (role === 'owner') {
      const { count, error } = await adminClient.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'owner');
      if (error) return json({ error: 'Could not check owner account limit' }, 500);
      if ((count || 0) >= 3) return json({ error: 'Maximum 3 owners allowed' }, 409);
    }
    const { data, error } = await adminClient.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { name }, app_metadata: { role },
    });
    if (error || !data.user) return json({ error: error?.message || 'Could not create user' }, 400);
    const { error: roleError } = await adminClient.from('profiles').update({ name, role, status: 'active' }).eq('id', data.user.id);
    if (roleError) {
      await adminClient.auth.admin.deleteUser(data.user.id);
      return json({ error: 'User profile could not be configured' }, 500);
    }
    return json({ id: data.user.id, email, name, role });
  }

  if (payload.action === 'status') {
    const id = typeof payload.id === 'string' ? payload.id : '';
    const status = payload.status === 'inactive' ? 'inactive' : payload.status === 'active' ? 'active' : null;
    if (!id || !status) return json({ error: 'A user and valid status are required' }, 400);
    if (id === user.id && status === 'inactive') return json({ error: 'You cannot deactivate your own account' }, 400);
    const { error: authUpdateError } = await adminClient.auth.admin.updateUserById(id, {
      ban_duration: status === 'inactive' ? '876000h' : 'none',
    });
    if (authUpdateError) return json({ error: authUpdateError.message }, 400);
    const { error } = await adminClient.from('profiles').update({ status }).eq('id', id);
    if (error) {
      await adminClient.auth.admin.updateUserById(id, { ban_duration: status === 'inactive' ? 'none' : '876000h' });
      return json({ error: 'Could not update the user profile' }, 500);
    }
    return json({ id, status });
  }

  return json({ error: 'Unknown action' }, 400);
});
