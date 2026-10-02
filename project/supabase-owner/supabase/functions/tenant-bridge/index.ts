type Json = Record<string, unknown>;

const defaultAppOrigin = 'https://bolt-six-mauve.vercel.app';
const normalizeOrigin = (value: string) => {
  try { return new URL(value).origin; } catch { return ''; }
};
const appOrigin = normalizeOrigin(Deno.env.get('TENANT_APP_BASE_URL') || '') || defaultAppOrigin;
const configuredOrigins = (Deno.env.get('TENANT_APP_ALLOWED_ORIGINS') || '')
  .split(',').map(value => normalizeOrigin(value.trim())).filter(Boolean);
const allowedOrigins = new Set([
  defaultAppOrigin, appOrigin, 'http://localhost:5173', 'http://127.0.0.1:5173', ...configuredOrigins,
]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const tenantSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const allowedMetrics = new Set(['dashboard', 'products', 'sales', 'purchases', 'stock-movements', 'reports', 'settings', 'other']);

function responseHeaders(request: Request) {
  const requestOrigin = normalizeOrigin(request.headers.get('Origin') || '');
  return {
    'Access-Control-Allow-Origin': allowedOrigins.has(requestOrigin) ? requestOrigin : appOrigin,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-tenant-id',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

function reply(request: Request, value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { ...responseHeaders(request), 'Content-Type': 'application/json' },
  });
}

async function decode(response: Response): Promise<unknown> {
  const raw = await response.text();
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return { message: raw.slice(0, 500) }; }
}

function objectValue(value: unknown): Json | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Json : null;
}

function readKeys(raw: string | undefined): Json | null {
  if (!raw) return null;
  try { return objectValue(JSON.parse(raw)); } catch { return null; }
}

Deno.serve(async request => {
  try {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: responseHeaders(request) });
  if (request.method !== 'POST') return reply(request, { error: 'Method not allowed' }, 405);

  const ownerUrl = Deno.env.get('SUPABASE_URL') || '';
  const publishableMap = readKeys(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS'));
  const secretMap = readKeys(Deno.env.get('SUPABASE_SECRET_KEYS'));
  const ownerPublishableKey = String(publishableMap?.default || Deno.env.get('SUPABASE_ANON_KEY') || '');
  const ownerSecretKey = String(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || secretMap?.default || '');
  const bearer = (request.headers.get('Authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1] || '';
  if (!ownerUrl || !ownerPublishableKey || !ownerSecretKey || !bearer) {
    return reply(request, { error: 'Tenant support service is not configured' }, 503);
  }

  const requestedTenantId = request.headers.get('x-tenant-id') || '';
  if (!uuidPattern.test(requestedTenantId)) return reply(request, { error: 'A valid active tenant context is required' }, 400);

  let payload: Json | null;
  try { payload = objectValue(await request.json()); }
  catch { payload = null; }
  if (!payload) return reply(request, { error: 'Invalid request' }, 400);

  // Load tenant routing data only from the Owner plane; never trust a project URL
  // or tenant UUID supplied in the JSON body.
  const tenantQuery = new URL(`${ownerUrl}/rest/v1/tenants`);
  tenantQuery.searchParams.set('select', 'id,slug,status,supabase_project_ref,supabase_publishable_key');
  tenantQuery.searchParams.set('id', `eq.${requestedTenantId}`);
  tenantQuery.searchParams.set('limit', '1');
  const ownerHeaders = { apikey: ownerSecretKey, Authorization: `Bearer ${ownerSecretKey}` };
  const tenantResponse = await fetch(tenantQuery, { headers: ownerHeaders });
  if (!tenantResponse.ok) return reply(request, { error: 'Could not verify this tenant workspace' }, 503);
  const tenantRows = await decode(tenantResponse);
  const tenant = Array.isArray(tenantRows) ? objectValue(tenantRows[0]) : null;
  if (!tenant || tenant.status !== 'active' || typeof tenant.slug !== 'string' || !tenantSlugPattern.test(tenant.slug)) {
    return reply(request, { error: 'This tenant workspace is not active' }, 403);
  }
  const projectRef = String(tenant.supabase_project_ref || '');
  const tenantPublishableKey = String(tenant.supabase_publishable_key || '');
  if (!/^[a-z0-9]{20}$/.test(projectRef) || !tenantPublishableKey.startsWith('sb_publishable_')) {
    return reply(request, { error: 'This tenant workspace has no shared database configuration' }, 503);
  }
  const tenantUrl = `https://${projectRef}.supabase.co`;

  // Validate the tenant-issued access token against that tenant's Auth service,
  // then let the tenant database itself confirm the header-selected membership.
  const authResponse = await fetch(`${tenantUrl}/auth/v1/user`, {
    headers: { apikey: tenantPublishableKey, Authorization: `Bearer ${bearer}` },
  });
  if (!authResponse.ok) return reply(request, { error: 'Tenant sign-in has expired. Sign in again.' }, 401);
  const user = objectValue(await decode(authResponse));
  if (typeof user?.id !== 'string' || !uuidPattern.test(user.id)) return reply(request, { error: 'Tenant identity could not be verified' }, 401);

  const membershipResponse = await fetch(`${tenantUrl}/rest/v1/rpc/get_current_tenant_membership`, {
    method: 'POST',
    headers: {
      apikey: tenantPublishableKey,
      Authorization: `Bearer ${bearer}`,
      'Content-Type': 'application/json',
      'x-tenant-id': requestedTenantId,
    },
    body: '{}',
  });
  if (!membershipResponse.ok) return reply(request, { error: 'Active tenant membership could not be verified' }, 403);
  const membershipResult = await decode(membershipResponse);
  const membership = Array.isArray(membershipResult) ? objectValue(membershipResult[0]) : objectValue(membershipResult);
  if (membership?.status !== 'active' || typeof membership.role !== 'string') {
    return reply(request, { error: 'Active tenant membership is required' }, 403);
  }
  const action = String(payload.action || '');
  const adminRequired = new Set(['inbox_list', 'inbox_read', 'ticket_list', 'ticket_create', 'ticket_reply', 'meeting_list', 'report_alert']);
  if (adminRequired.has(action) && membership.role !== 'admin') {
    return reply(request, { error: 'Only tenant administrators can use the owner inbox and support desk' }, 403);
  }

  const ownerRequest = async (path: string, method = 'GET', body?: unknown, prefer?: string) => {
    return await fetch(`${ownerUrl}/rest/v1/${path}`, {
      method,
      headers: {
        ...ownerHeaders,
        'Content-Type': 'application/json',
        ...(prefer ? { Prefer: prefer } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  };

  if (action === 'metric') {
    const metricName = String(payload.page || '');
    if (!allowedMetrics.has(metricName)) return reply(request, { error: 'Unsupported usage signal' }, 400);
    const metricResponse = await ownerRequest('rpc/owner_record_tenant_metric', 'POST', {
      p_tenant_id: requestedTenantId,
      p_metric_key: `page.${metricName}`,
      p_increment: 1,
    });
    if (!metricResponse.ok) return reply(request, { error: 'Could not record aggregate usage' }, 502);
    return reply(request, { ok: true });
  }

  if (action === 'report_alert') {
    const code = String(payload.code || '');
    if (!new Set(['dashboard_load_failed', 'catalogue_unavailable', 'sign_in_issue', 'slow_response']).has(code)) {
      return reply(request, { error: 'Select a supported technical alert' }, 400);
    }
    const result = await ownerRequest('rpc/owner_report_tenant_alert', 'POST', {
      p_tenant_id: requestedTenantId, p_code: code,
    });
    if (!result.ok) return reply(request, { error: 'Could not report this technical issue' }, 400);
    return reply(request, { alert_id: await decode(result) });
  }

  if (action === 'inbox_list') {
    const messagesQuery = new URL(`${ownerUrl}/rest/v1/owner_inbox_messages`);
    messagesQuery.searchParams.set('select', 'id,title,body,priority,created_at,expires_at');
    messagesQuery.searchParams.set('tenant_id', `eq.${requestedTenantId}`);
    messagesQuery.searchParams.set('is_active', 'eq.true');
    messagesQuery.searchParams.set('or', `(expires_at.is.null,expires_at.gt.${new Date().toISOString()})`);
    messagesQuery.searchParams.set('order', 'created_at.desc');
    messagesQuery.searchParams.set('limit', '100');
    const messagesResponse = await fetch(messagesQuery, { headers: ownerHeaders });
    if (!messagesResponse.ok) return reply(request, { error: 'Could not load tenant inbox' }, 502);
    const messages = await decode(messagesResponse);
    const readQuery = new URL(`${ownerUrl}/rest/v1/owner_inbox_reads`);
    readQuery.searchParams.set('select', 'message_id,read_at');
    readQuery.searchParams.set('tenant_id', `eq.${requestedTenantId}`);
    readQuery.searchParams.set('user_id', `eq.${user.id}`);
    const readResponse = await fetch(readQuery, { headers: ownerHeaders });
    if (!readResponse.ok) return reply(request, { error: 'Could not load inbox read status' }, 502);
    const reads = await decode(readResponse);
    const readsById = new Map<string, string>(Array.isArray(reads) ? reads.map(item => {
      const row = objectValue(item);
      return [String(row?.message_id || ''), String(row?.read_at || '')] as const;
    }) : []);
    return reply(request, {
      messages: (Array.isArray(messages) ? messages : []).map(item => {
        const row = objectValue(item) || {};
        return { ...row, read_at: readsById.get(String(row.id || '')) || null };
      }),
    });
  }

  if (action === 'inbox_read') {
    const messageId = String(payload.message_id || '');
    if (!uuidPattern.test(messageId)) return reply(request, { error: 'Invalid inbox message' }, 400);
    const result = await ownerRequest('rpc/owner_inbox_mark_read', 'POST', {
      p_tenant_id: requestedTenantId, p_message_id: messageId, p_user_id: user.id,
    });
    return result.ok ? reply(request, { ok: true }) : reply(request, { error: 'Could not mark message read' }, 400);
  }

  if (action === 'meeting_list') {
    const meetingQuery = new URL(`${ownerUrl}/rest/v1/owner_meetings`);
    meetingQuery.searchParams.set('select', 'id,title,purpose,starts_at,ends_at,timezone,provider,meeting_url,agenda,status,outcome,follow_up_at,follow_up_note');
    meetingQuery.searchParams.set('tenant_id', `eq.${requestedTenantId}`);
    meetingQuery.searchParams.set('starts_at', `gte.${new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()}`);
    meetingQuery.searchParams.set('order', 'starts_at.asc');
    meetingQuery.searchParams.set('limit', '100');
    const meetingResponse = await fetch(meetingQuery, { headers: ownerHeaders });
    if (!meetingResponse.ok) return reply(request, { error: 'Could not load onboarding meetings' }, 502);
    return reply(request, { meetings: await decode(meetingResponse) });
  }

  if (action === 'ticket_list') {
    const ticketsQuery = new URL(`${ownerUrl}/rest/v1/support_tickets`);
    ticketsQuery.searchParams.set('select', 'id,title,summary,status,severity,created_at,updated_at,last_response_at');
    ticketsQuery.searchParams.set('tenant_id', `eq.${requestedTenantId}`);
    ticketsQuery.searchParams.set('order', 'updated_at.desc');
    ticketsQuery.searchParams.set('limit', '100');
    const ticketsResponse = await fetch(ticketsQuery, { headers: ownerHeaders });
    if (!ticketsResponse.ok) return reply(request, { error: 'Could not load support requests' }, 502);
    const ticketRows = await decode(ticketsResponse);
    const ids = Array.isArray(ticketRows) ? ticketRows.map(item => String(objectValue(item)?.id || '')).filter(id => uuidPattern.test(id)) : [];
    if (!ids.length) return reply(request, { tickets: [], messages: [] });
    const messageQuery = new URL(`${ownerUrl}/rest/v1/support_ticket_messages`);
    messageQuery.searchParams.set('select', 'id,ticket_id,author_kind,author_email,body,created_at');
    messageQuery.searchParams.set('ticket_id', `in.(${ids.join(',')})`);
    messageQuery.searchParams.set('order', 'created_at.asc');
    const messagesResponse = await fetch(messageQuery, { headers: ownerHeaders });
    if (!messagesResponse.ok) return reply(request, { error: 'Could not load support conversation' }, 502);
    return reply(request, { tickets: ticketRows, messages: await decode(messagesResponse) });
  }

  if (action === 'ticket_create') {
    const title = typeof payload.title === 'string' ? payload.title.trim() : '';
    const body = typeof payload.body === 'string' ? payload.body.trim() : '';
    if (title.length < 2 || title.length > 160 || body.length < 1 || body.length > 5000) {
      return reply(request, { error: 'Enter a title and a message for support' }, 400);
    }
    const result = await ownerRequest('rpc/owner_create_tenant_ticket', 'POST', {
      p_tenant_id: requestedTenantId,
      p_user_id: user.id,
      p_author_email: typeof user.email === 'string' ? user.email : null,
      p_title: title,
      p_body: body,
    });
    if (!result.ok) return reply(request, { error: 'Could not create support request' }, 400);
    return reply(request, { ticket_id: await decode(result) });
  }

  if (action === 'ticket_reply') {
    const ticketId = String(payload.ticket_id || '');
    const body = typeof payload.body === 'string' ? payload.body.trim() : '';
    if (!uuidPattern.test(ticketId) || body.length < 1 || body.length > 5000) return reply(request, { error: 'Enter a valid reply' }, 400);
    const result = await ownerRequest('rpc/owner_add_tenant_ticket_reply', 'POST', {
      p_tenant_id: requestedTenantId,
      p_ticket_id: ticketId,
      p_user_id: user.id,
      p_author_email: typeof user.email === 'string' ? user.email : null,
      p_body: body,
    });
    if (!result.ok) return reply(request, { error: 'Could not add reply to this support request' }, 400);
    return reply(request, { ok: true });
  }

  return reply(request, { error: 'Unsupported tenant bridge action' }, 400);
  } catch (error) {
    console.error('tenant-bridge request failed', error instanceof Error ? error.message : 'Unknown error');
    return reply(request, { error: 'Owner support service encountered a temporary error' }, 502);
  }
});
