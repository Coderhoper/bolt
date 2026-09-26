import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { tenantMigrations } from './tenantMigrations.ts';

const productionAppBaseUrl = 'https://bolt-six-mauve.vercel.app';
const allowedOrigins = new Set([
  productionAppBaseUrl,
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

function headersFor(request: Request) {
  const requestOrigin = request.headers.get('Origin') || '';
  const origin = allowedOrigins.has(requestOrigin) ? requestOrigin : productionAppBaseUrl;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

function reply(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headersFor(request), 'Content-Type': 'application/json' },
  });
}

function readJson(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function bodyOf(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { message: text.slice(0, 1000) }; }
}

function projectUrl(ref: string) {
  return `https://${ref}.supabase.co`;
}

function projectRegion(region: string): string | null {
  // Supabase currently has no African project region. These are the nearest
  // supported regions: Mumbai for East Africa and Ireland for Southern Africa.
  const regions: Record<string, string> = {
    'africa-east': 'ap-south-1',
    'africa-south': 'eu-west-1',
    'eu-west': 'eu-west-1',
    'us-east': 'us-east-1',
  };
  return regions[region] || null;
}

function randomDatabasePassword() {
  const bytes = new Uint8Array(48);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function flattenKeys(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.filter(item => !!item && typeof item === 'object') as Record<string, unknown>[];
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    if (Array.isArray(record.keys)) return record.keys.filter(item => !!item && typeof item === 'object') as Record<string, unknown>[];
    if (Array.isArray(record.api_keys)) return record.api_keys.filter(item => !!item && typeof item === 'object') as Record<string, unknown>[];
  }
  return [];
}

function findKey(keys: Record<string, unknown>[], keyType: 'publishable' | 'secret') {
  const row = keys.find(item => String(item.type || '').toLowerCase() === keyType)
    || keys.find(item => String(item.name || '').toLowerCase() === keyType)
    || keys.find(item => String(item.api_key || '').startsWith(keyType === 'publishable' ? 'sb_publishable_' : 'sb_secret_'));
  return typeof row?.api_key === 'string' ? row.api_key : typeof row?.key === 'string' ? row.key : '';
}

function allServicesHealthy(payload: unknown) {
  const statuses: string[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    if (typeof record.status === 'string') statuses.push(record.status.toUpperCase());
    Object.values(record).forEach(visit);
  };
  visit(payload);
  return statuses.length > 0 && statuses.every(status => status === 'ACTIVE_HEALTHY');
}

function migrationApplied(history: unknown, version: string, name: string) {
  if (!Array.isArray(history)) return false;
  return history.some(item => {
    if (!item || typeof item !== 'object') return false;
    const row = item as Record<string, unknown>;
    return String(row.version || '') === version || String(row.name || '') === name;
  });
}

function migrationQuery(migrationName: string, sql: string) {
  const sqlLines = sql.split(/\r?\n/);
  const firstStatement = sqlLines.findIndex(line => line.trim() !== '');
  // Management query fallback runs each migration inside a transactional DO
  // block, so remove only an explicit whole-file BEGIN/COMMIT wrapper.
  if (firstStatement >= 0 && sqlLines[firstStatement].trim().toUpperCase() === 'BEGIN;') sqlLines.splice(firstStatement, 1);
  let normalizedLast = -1;
  for (let index = sqlLines.length - 1; index >= 0; index -= 1) {
    if (sqlLines[index].trim() !== '') { normalizedLast = index; break; }
  }
  if (normalizedLast >= 0 && sqlLines[normalizedLast].trim().toUpperCase() === 'COMMIT;') sqlLines.splice(normalizedLast, 1);
  const migrationSql = sqlLines.join('\n');
  const delimiterFor = (prefix: string) => {
    let suffix = 0;
    while (migrationSql.includes(`$${prefix}_${suffix}$`)) suffix += 1;
    return `$${prefix}_${suffix}$`;
  };
  const block = delimiterFor('tenant_owner_migration_block');
  const body = delimiterFor('tenant_owner_migration_sql');
  const name = `''${migrationName.replaceAll("'", "''")}''`;
  return `DO ${block}
DECLARE already_applied boolean;
BEGIN
  EXECUTE 'CREATE SCHEMA IF NOT EXISTS tenant_internal';
  EXECUTE 'CREATE TABLE IF NOT EXISTS tenant_internal.schema_migrations (migration_name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())';
  EXECUTE 'SELECT EXISTS (SELECT 1 FROM tenant_internal.schema_migrations WHERE migration_name = ${name})' INTO already_applied;
  IF NOT already_applied THEN
    EXECUTE ${body}${migrationSql}${body};
    EXECUTE 'INSERT INTO tenant_internal.schema_migrations(migration_name) VALUES (${name})';
  END IF;
END
${block};`;
}

async function managementRequest(token: string, path: string, method = 'GET', body?: unknown) {
  return await fetch(`https://api.supabase.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function getProjectKeys(token: string, ref: string) {
  const response = await managementRequest(token, `/projects/${encodeURIComponent(ref)}/api-keys?reveal=true`);
  if (!response.ok) return { error: response.status, publishable: '', secret: '' };
  const keys = flattenKeys(await bodyOf(response));
  let publishable = findKey(keys, 'publishable');
  let secret = findKey(keys, 'secret');

  if (!publishable) {
    const created = await managementRequest(token, `/projects/${encodeURIComponent(ref)}/api-keys?reveal=true`, 'POST', {
      type: 'publishable', name: 'default', description: 'Browser-safe tenant application key',
    });
    if (!created.ok) return { error: created.status, publishable: '', secret };
    const key = await bodyOf(created) as Record<string, unknown> | null;
    publishable = typeof key?.api_key === 'string' ? key.api_key : '';
  }
  if (!secret) {
    const created = await managementRequest(token, `/projects/${encodeURIComponent(ref)}/api-keys?reveal=true`, 'POST', {
      type: 'secret', name: 'default', description: 'Server-only tenant onboarding key',
    });
    if (!created.ok) return { error: created.status, publishable, secret: '' };
    const key = await bodyOf(created) as Record<string, unknown> | null;
    secret = typeof key?.api_key === 'string' ? key.api_key : '';
  }
  if (!publishable.startsWith('sb_publishable_') || !secret) {
    return { error: 500, publishable: '', secret: '' };
  }
  return { error: 0, publishable, secret };
}

function publicManagementError(status: number, step: string) {
  if (status === 401 || status === 403) {
    return {
      code: 'management_permission_denied',
      message: 'The Supabase Management token needs organization project creation, project API key management, database migration, and Auth configuration permissions.',
    };
  }
  if (status === 404) return { code: 'management_resource_not_found', message: 'The configured Supabase organization or tenant project could not be found.' };
  if (status === 429) return { code: 'management_rate_limited', message: 'Supabase rate limited this onboarding step. Retry in a minute; the tenant job is resumable.' };
  if (status === 400 || status === 402) {
    return {
      code: 'project_capacity_or_configuration',
      message: step === 'creating_project'
        ? 'Supabase rejected project creation. Check organization project capacity, billing plan, region, and the Management token permissions.'
        : 'Supabase rejected this setup step. Check the tenant project settings and retry the provisioning job.',
    };
  }
  return { code: `supabase_http_${status}`, message: `Supabase returned HTTP ${status} during ${step.replaceAll('_', ' ')}. Retry the job or inspect the project logs.` };
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') {
    const origin = request.headers.get('Origin') || '';
    if (origin && !allowedOrigins.has(origin)) return new Response('Origin not allowed', { status: 403 });
    return new Response('ok', { headers: headersFor(request) });
  }
  if (request.method !== 'POST') return reply(request, { error: 'Method not allowed' }, 405);

  const bearer = request.headers.get('Authorization') || '';
  const token = bearer.replace(/^Bearer\s+/i, '');
  const ownerUrl = Deno.env.get('SUPABASE_URL');
  const publishableKeysRaw = Deno.env.get('SUPABASE_PUBLISHABLE_KEYS');
  const secretKeysRaw = Deno.env.get('SUPABASE_SECRET_KEYS');
  let ownerPublishableKey = '';
  let ownerSecretKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (publishableKeysRaw) {
    const keys = readJson(publishableKeysRaw);
    if (!keys) return reply(request, { error: 'Owner provisioning service is misconfigured' }, 503);
    ownerPublishableKey = typeof keys.default === 'string' ? keys.default : '';
  }
  if (secretKeysRaw) {
    const keys = readJson(secretKeysRaw);
    if (!keys) return reply(request, { error: 'Owner provisioning service is misconfigured' }, 503);
    ownerSecretKey ||= typeof keys.default === 'string' ? keys.default : '';
  }
  ownerPublishableKey ||= Deno.env.get('SUPABASE_ANON_KEY') || '';
  if (!token || !ownerUrl || !ownerPublishableKey) {
    return reply(request, { error: 'Owner provisioning service is not configured' }, 503);
  }

  const ownerUserDb = createClient(ownerUrl, ownerPublishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const [{ data: userResult, error: authError }, { data: claimResult }] = await Promise.all([
    ownerUserDb.auth.getUser(token), ownerUserDb.auth.getClaims(token),
  ]);
  const user = userResult.user;
  if (authError || !user) return reply(request, { error: 'Authentication required' }, 401);
  if (claimResult?.claims?.aal !== 'aal2') return reply(request, { error: 'Verified MFA is required' }, 403);

  const { data: staff, error: staffError } = await ownerUserDb.from('owner_staff')
    .select('role,is_active').eq('user_id', user.id).maybeSingle();
  if (staffError || !staff?.is_active || !['platform_admin', 'provisioner'].includes(staff.role)) {
    return reply(request, { error: 'Owner provisioning access required' }, 403);
  }

  let payload: { action?: string; tenantId?: string };
  try { payload = await request.json(); }
  catch { return reply(request, { error: 'Invalid request' }, 400); }

  const managementToken = Deno.env.get('lapdav');
  const organizationSlug = Deno.env.get('org_slug');
  if (!managementToken || !organizationSlug) {
    return reply(request, { error: 'Set the owner project secrets named lapdav and org_slug' }, 503);
  }

  if (payload.action === 'check') {
    const response = await managementRequest(managementToken,
      `/organizations/${encodeURIComponent(organizationSlug)}/projects?limit=100`);
    if (response.ok) {
      const projects = await bodyOf(response);
      return reply(request, {
        status: 'connected',
        projectCount: Array.isArray(projects) ? projects.length : null,
        detail: 'The token can list projects in the configured organization. Provisioning also requires project creation, API key, database migration, and Auth configuration permissions; project capacity depends on the organization plan.',
      });
    }
    if (response.status === 401) return reply(request, { error: 'The lapdav token was rejected or has expired' }, 502);
    if (response.status === 403) return reply(request, { error: 'The token cannot access this organization. Check its organization scope and project permissions.' }, 502);
    if (response.status === 404) return reply(request, { error: 'org_slug was not found. Use the organization slug, not a project reference.' }, 502);
    return reply(request, { error: `Supabase Management API returned HTTP ${response.status}` }, 502);
  }

  if (payload.action !== 'advance' || !payload.tenantId || !/^[0-9a-f-]{36}$/i.test(payload.tenantId)) {
    return reply(request, { error: 'Invalid provisioning request' }, 400);
  }
  if (!ownerSecretKey) return reply(request, {
    error: 'The owner Supabase Edge Function secret key is missing. Ensure SUPABASE_SECRET_KEYS or SUPABASE_SERVICE_ROLE_KEY is available to the function.',
  }, 503);

  const ownerWorkerDb = createClient(ownerUrl, ownerSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: rawClaim, error: claimError } = await ownerWorkerDb.rpc('owner_claim_provisioning_job', {
    p_tenant_id: payload.tenantId,
    p_actor_id: user.id,
    p_actor_email: user.email || '',
  });
  if (claimError) return reply(request, { error: claimError.message }, 409);
  const claim = rawClaim as Record<string, unknown> | null;
  if (!claim) return reply(request, { error: 'The provisioning job returned no state' }, 500);
  if (claim.complete) return reply(request, { complete: true, step: 'complete', slug: claim.slug });
  if (claim.busy) return reply(request, {
    complete: false, busy: true, step: claim.step, waitSeconds: claim.retry_after_seconds || 5,
  });

  const tenantId = String(claim.tenant_id);
  const jobId = String(claim.job_id);
  const leaseToken = String(claim.lease_token);
  const slug = String(claim.slug);
  const name = String(claim.name);
  const region = String(claim.region);
  const adminEmail = String(claim.admin_email);
  let ref = typeof claim.project_ref === 'string' ? claim.project_ref : '';
  let tenantUrl = typeof claim.supabase_url === 'string' ? claim.supabase_url : '';
  let publishableKey = typeof claim.publishable_key === 'string' ? claim.publishable_key : '';
  let step = String(claim.step || 'queued');
  let stepIndex = Number(claim.step_index || 0);

  const save = async (nextStep: string, nextIndex = stepIndex, status = 'running', errorCode: string | null = null) => {
    const { error } = await ownerWorkerDb.rpc('owner_save_provisioning_progress', {
      p_tenant_id: tenantId,
      p_job_id: jobId,
      p_lease_token: leaseToken,
      p_actor_id: user.id,
      p_actor_email: user.email || '',
      p_step: nextStep,
      p_step_index: nextIndex,
      p_project_ref: ref || null,
      p_supabase_url: tenantUrl || null,
      p_publishable_key: publishableKey || null,
      p_job_status: status,
      p_error_code: errorCode,
      p_release_lease: true,
    });
    if (error) throw new Error(`Could not save provisioning progress: ${error.message}`);
    step = nextStep;
    stepIndex = nextIndex;
  };
  const failed = async (code: string, message: string) => {
    try { await save(step, stepIndex, 'failed', code); } catch { /* the lease may have expired; retry recovers the state */ }
    return reply(request, { error: message, code, step, complete: false }, 502);
  };
  const managementFailure = async (response: Response) => {
    const detail = publicManagementError(response.status, step);
    return await failed(detail.code, detail.message);
  };

  try {
    if (step === 'queued' || step === 'creating_project') {
      const targetRegion = projectRegion(region);
      if (!targetRegion) return await failed('unsupported_region', 'Choose a supported tenant region before provisioning.');

      // A deterministic name recovers a create that succeeded just before a
      // worker timeout, keeping project creation idempotent across retries.
      const projectsResponse = await managementRequest(managementToken,
        `/organizations/${encodeURIComponent(organizationSlug)}/projects?limit=100`);
      if (!projectsResponse.ok) return await managementFailure(projectsResponse);
      const projectsPayload = await bodyOf(projectsResponse);
      const projects = Array.isArray(projectsPayload) ? projectsPayload as Record<string, unknown>[] : [];
      const projectName = `Hardware ${slug} ${tenantId.slice(0, 8)}`;
      let project = projects.find(item => item.name === projectName);

      if (!project) {
        const createResponse = await managementRequest(managementToken, '/projects', 'POST', {
          organization_slug: organizationSlug,
          name: projectName,
          region: targetRegion,
          db_pass: randomDatabasePassword(),
        });
        if (!createResponse.ok) return await managementFailure(createResponse);
        project = await bodyOf(createResponse) as Record<string, unknown> | null;
      }
      ref = String(project?.ref || '');
      if (!/^[a-z0-9]{20}$/.test(ref)) return await failed('project_reference_missing', 'Supabase created or found a project but returned no valid project reference. Retry the job.');
      tenantUrl = projectUrl(ref);
      await save('waiting_for_project', 0);
      return reply(request, { complete: false, step: 'waiting_for_project', waitSeconds: 12, message: 'Tenant project created; waiting for its database and Auth services.' });
    }

    if (!ref) return await failed('project_reference_missing', 'This tenant job has no saved Supabase project reference. Retry it to recover the project.');
    if (!tenantUrl) tenantUrl = projectUrl(ref);

    if (step === 'waiting_for_project') {
      const healthResponse = await managementRequest(managementToken, `/projects/${encodeURIComponent(ref)}/health`);
      if (!healthResponse.ok) return await managementFailure(healthResponse);
      if (!allServicesHealthy(await bodyOf(healthResponse))) {
        await save('waiting_for_project', stepIndex);
        return reply(request, { complete: false, step: 'waiting_for_project', waitSeconds: 12, message: 'Supabase is starting the tenant database and Auth services.' });
      }
      const keys = await getProjectKeys(managementToken, ref);
      if (keys.error) return await managementFailure(new Response(null, { status: keys.error }));
      publishableKey = keys.publishable;
      await save('migrating', 0);
      return reply(request, { complete: false, step: 'migrating', stepIndex: 0, stepCount: tenantMigrations.length, message: 'Tenant services are healthy; preparing the hardware catalogue and tenant schema.' });
    }

    if (step === 'migrating') {
      if (!publishableKey.startsWith('sb_publishable_')) {
        const keys = await getProjectKeys(managementToken, ref);
        if (keys.error) return await managementFailure(new Response(null, { status: keys.error }));
        publishableKey = keys.publishable;
      }
      if (stepIndex >= tenantMigrations.length) {
        await save('configuring_auth', stepIndex);
        return reply(request, { complete: false, step: 'configuring_auth', stepIndex, stepCount: tenantMigrations.length, message: 'Database schema and catalogue are ready; configuring tenant sign-in.' });
      }

      const migration = tenantMigrations[stepIndex];
      const migrationName = `${migration.version}_${migration.name}`;
      const historyResponse = await managementRequest(managementToken, `/projects/${encodeURIComponent(ref)}/database/migrations`);
      let needsQueryFallback = historyResponse.status === 403;
      if (!historyResponse.ok && !needsQueryFallback) return await managementFailure(historyResponse);
      if (historyResponse.ok) {
        const history = await bodyOf(historyResponse);
        if (!migrationApplied(history, migration.version, migration.name)) {
          const applyResponse = await managementRequest(managementToken,
            `/projects/${encodeURIComponent(ref)}/database/migrations`, 'POST', {
              name: migration.name,
              query: migration.sql,
            });
          if (!applyResponse.ok && applyResponse.status === 403) needsQueryFallback = true;
          else if (!applyResponse.ok) return await managementFailure(applyResponse);
          else await bodyOf(applyResponse);
        }
      }
      if (needsQueryFallback) {
        // The migration endpoint is not enabled for every account. Its beta
        // SQL-query fallback uses an in-database ledger and one transactional
        // DO block so a retry cannot re-run a migration that already committed.
        const queryResponse = await managementRequest(managementToken,
          `/projects/${encodeURIComponent(ref)}/database/query`, 'POST', {
            query: migrationQuery(migrationName, migration.sql),
            read_only: false,
          });
        if (!queryResponse.ok) return await managementFailure(queryResponse);
        await bodyOf(queryResponse);
      }
      const nextIndex = stepIndex + 1;
      const nextStep = nextIndex >= tenantMigrations.length ? 'configuring_auth' : 'migrating';
      await save(nextStep, nextIndex);
      return reply(request, {
        complete: false,
        step: nextStep,
        stepIndex: nextIndex,
        stepCount: tenantMigrations.length,
        message: `Applied tenant database migration ${nextIndex} of ${tenantMigrations.length}.`,
      });
    }

    if (step === 'configuring_auth') {
      const appBase = (Deno.env.get('TENANT_APP_BASE_URL') || productionAppBaseUrl).replace(/\/$/, '');
      let baseUrl: URL;
      try { baseUrl = new URL(appBase); }
      catch { return await failed('invalid_tenant_app_url', 'TENANT_APP_BASE_URL must be a valid HTTPS URL.'); }
      if (baseUrl.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(baseUrl.hostname)) {
        return await failed('invalid_tenant_app_url', 'TENANT_APP_BASE_URL must use HTTPS outside localhost.');
      }
      const allowList = [
        `${appBase}/t/**`,
        'http://localhost:5173/t/**',
        'http://127.0.0.1:5173/t/**',
      ].join(',');
      const authResponse = await managementRequest(managementToken,
        `/projects/${encodeURIComponent(ref)}/config/auth`, 'PATCH', {
          site_url: appBase,
          uri_allow_list: allowList,
          disable_signup: true,
        });
      if (!authResponse.ok) return await managementFailure(authResponse);
      await bodyOf(authResponse);
      await save('inviting_admin', stepIndex);
      return reply(request, { complete: false, step: 'inviting_admin', stepIndex, message: 'Tenant sign-in is configured; sending the first administrator invitation.' });
    }

    if (step === 'inviting_admin') {
      if (!/^[^'@\s]+@[^'@\s]+\.[^'@\s]+$/.test(adminEmail)) {
        return await failed('invalid_admin_email', 'Set a valid first tenant administrator email in the Owner tenant record.');
      }
      const keys = await getProjectKeys(managementToken, ref);
      if (keys.error) return await managementFailure(new Response(null, { status: keys.error }));
      const inviteRedirect = `${(Deno.env.get('TENANT_APP_BASE_URL') || productionAppBaseUrl).replace(/\/$/, '')}/t/${slug}`;
      const inviteUrl = `${tenantUrl}/auth/v1/invite?redirect_to=${encodeURIComponent(inviteRedirect)}`;
      const inviteResponse = await fetch(inviteUrl, {
        method: 'POST',
        headers: {
          apikey: keys.secret,
          Authorization: `Bearer ${keys.secret}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: adminEmail, data: { name, role: 'admin' } }),
      });
      if (!inviteResponse.ok) {
        const errorBody = await bodyOf(inviteResponse);
        const errorText = JSON.stringify(errorBody).toLowerCase();
        if (!((inviteResponse.status === 400 || inviteResponse.status === 422)
          && (errorText.includes('already registered') || errorText.includes('already exists') || errorText.includes('email_exists')))) {
          return await failed('admin_invite_failed', 'The first administrator invitation could not be sent. Check tenant Auth email delivery and retry the job.');
        }
      } else {
        await bodyOf(inviteResponse);
      }

      const sqlEmail = adminEmail.replaceAll("'", "''");
      const promoteResponse = await managementRequest(managementToken,
        `/projects/${encodeURIComponent(ref)}/database/query`, 'POST', {
          query: `DO $tenant_owner_admin$
DECLARE profiles_updated integer;
BEGIN
  UPDATE public.profiles AS profile SET role = 'admin', status = 'active'
  FROM auth.users AS auth_user
  WHERE auth_user.id = profile.id AND lower(auth_user.email) = lower('${sqlEmail}');
  GET DIAGNOSTICS profiles_updated = ROW_COUNT;
  IF profiles_updated <> 1 THEN RAISE EXCEPTION 'Tenant administrator profile was not created'; END IF;
END
$tenant_owner_admin$;`,
          read_only: false,
        });
      if (!promoteResponse.ok) return await managementFailure(promoteResponse);
      await bodyOf(promoteResponse);

      await save('complete', tenantMigrations.length, 'succeeded');
      return reply(request, {
        complete: true,
        step: 'complete',
        slug,
        tenantUrl: `${(Deno.env.get('TENANT_APP_BASE_URL') || productionAppBaseUrl).replace(/\/$/, '')}/t/${slug}`,
        message: 'Tenant database, catalogue, sign-in and first administrator invitation are ready.',
      });
    }

    if (step === 'complete') return reply(request, { complete: true, step: 'complete', slug });
    return await failed('unknown_provisioning_step', 'The provisioning job has an unknown step. Contact platform support before retrying.');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Tenant provisioning failed unexpectedly.';
    return await failed('provisioning_request_failed', message.slice(0, 300));
  }
});
