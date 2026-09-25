import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
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
  const { data: caller, error: profileError } = await adminClient.from('profiles')
    .select('role,status').eq('id', user.id).maybeSingle();
  if (profileError || caller?.role !== 'admin' || caller.status !== 'active') {
    return json({ error: 'Administrator access required' }, 403);
  }

  let payload: Record<string, unknown>;
  try { payload = await request.json(); } catch { return json({ error: 'Invalid request body' }, 400); }

  if (payload.action === 'list') {
    const [{ data: profiles, error: listError }, { data: users, error: usersError }] = await Promise.all([
      adminClient.from('profiles').select('*').order('created_at', { ascending: false }),
      adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    ]);
    if (listError || usersError) return json({ error: 'Could not load user accounts' }, 500);
    const emails = new Map(users.users.map(account => [account.id, account.email || '']));
    return json({ profiles: (profiles || []).map(profile => ({ ...profile, email: emails.get(profile.id) || '' })) });
  }

  if (payload.action === 'create') {
    const name = typeof payload.name === 'string' ? payload.name.trim() : '';
    const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
    const password = typeof payload.password === 'string' ? payload.password : '';
    const role = payload.role === 'admin' ? 'admin' : 'owner';
    if (!name || !email || password.length < 8) return json({ error: 'Name, valid email, and a password of at least 8 characters are required' }, 400);
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
