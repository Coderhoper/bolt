-- Dedicated OWNER Supabase project only. This migration stores tenant routing
-- metadata and durable progress; it never stores database or secret API keys.

alter table public.tenants
  add column if not exists supabase_project_ref text,
  add column if not exists supabase_url text,
  add column if not exists supabase_publishable_key text,
  add column if not exists provisioning_step text not null default 'queued';

alter table public.provisioning_jobs
  add column if not exists current_step text not null default 'queued',
  add column if not exists step_index integer not null default 0 check (step_index >= 0),
  add column if not exists lease_token uuid,
  add column if not exists lease_expires_at timestamptz;

create unique index if not exists tenants_supabase_project_ref_unique
  on public.tenants(supabase_project_ref) where supabase_project_ref is not null;

-- Tenant records and their durable provisioning job must be created together
-- by owner_create_tenant; direct inserts could leave unusable orphan records.
drop policy if exists "provisioners create tenant records" on public.tenants;

create or replace function public.owner_create_tenant(
  p_name text, p_slug text, p_plan text, p_region text,
  p_primary_contact text, p_contact_email text, p_isolation_level text
) returns uuid language plpgsql security definer set search_path = public, auth
as $$
declare tenant_key uuid;
begin
  if not public.owner_can_provision() then raise exception 'Provisioner role and MFA are required'; end if;
  if p_isolation_level <> 'database_per_tenant' then
    raise exception 'Only dedicated database per tenant provisioning is currently supported';
  end if;
  if nullif(trim(p_contact_email), '') is null
     or trim(p_contact_email) !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception 'A valid first tenant administrator email is required';
  end if;
  if p_region not in ('africa-east','africa-south','eu-west','us-east') then
    raise exception 'Choose a supported tenant region';
  end if;
  insert into public.tenants(name, slug, plan, region, primary_contact, contact_email, isolation_level, created_by)
  values (trim(p_name), lower(trim(p_slug)), p_plan, p_region,
    nullif(trim(p_primary_contact),''), lower(trim(p_contact_email)), 'database_per_tenant', auth.uid())
  returning id into tenant_key;
  insert into public.provisioning_jobs(tenant_id, idempotency_key, requested_by)
  values (tenant_key, 'tenant:' || tenant_key::text, auth.uid());
  perform public.append_owner_audit('provisioning.queued','tenant',tenant_key::text,jsonb_build_object('job_kind','tenant_environment'));
  return tenant_key;
end
$$;

create or replace function public.owner_set_tenant_admin_email(p_tenant_id uuid, p_email text)
returns void language plpgsql security definer set search_path = public, auth
as $$
begin
  if not public.owner_can_provision() then raise exception 'Provisioner role and MFA are required'; end if;
  if p_email is null or length(trim(p_email)) > 254
     or trim(p_email) !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception 'Enter a valid first tenant administrator email';
  end if;
  update public.tenants set contact_email = lower(trim(p_email)), updated_at = now()
  where id = p_tenant_id and (status <> 'active' or supabase_project_ref is null);
  if not found then raise exception 'Tenant is already provisioned or was not found'; end if;
end
$$;

-- Acquires a short lease so repeated clicks and browser retries cannot create
-- duplicate projects or race the migration sequence. Expired jobs are resumable.
create or replace function public.owner_claim_provisioning_job(p_tenant_id uuid, p_actor_id uuid, p_actor_email text)
returns jsonb language plpgsql security definer set search_path = public, auth, extensions
as $$
declare tenant_row public.tenants%rowtype; job_row public.provisioning_jobs%rowtype; token uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'Provisioning worker access is required'; end if;
  if not exists (select 1 from public.owner_staff where user_id = p_actor_id and is_active
      and role in ('platform_admin','provisioner')) then
    raise exception 'Provisioner role is required';
  end if;
  perform set_config('request.jwt.claim.sub', p_actor_id::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub',p_actor_id,'email',p_actor_email,'aal','aal2','role','authenticated')::text, true);
  if not public.owner_can_provision() then raise exception 'Provisioner role and MFA are required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text, 91824));
  select * into tenant_row from public.tenants where id = p_tenant_id for update;
  if not found then raise exception 'Tenant was not found'; end if;
  if tenant_row.isolation_level <> 'database_per_tenant' then
    raise exception 'Only dedicated database per tenant provisioning is supported';
  end if;
  if tenant_row.status = 'active' and tenant_row.supabase_project_ref is not null then
    return jsonb_build_object('complete', true, 'slug', tenant_row.slug, 'step', 'complete');
  end if;
  if tenant_row.contact_email is null then raise exception 'A first tenant administrator email is required'; end if;

  select * into job_row from public.provisioning_jobs
    where tenant_id = p_tenant_id order by created_at desc limit 1 for update;
  if not found then raise exception 'Provisioning job was not found'; end if;
  if job_row.status = 'succeeded' then
    return jsonb_build_object('complete', true, 'slug', tenant_row.slug, 'step', 'complete');
  end if;
  if job_row.status = 'cancelled' then raise exception 'Cancelled provisioning jobs cannot be resumed'; end if;
  if job_row.status = 'running' and job_row.lease_expires_at > now() then
    return jsonb_build_object('busy', true, 'step', job_row.current_step, 'retry_after_seconds', 5);
  end if;

  token := extensions.gen_random_uuid();
  update public.provisioning_jobs set status = 'running', attempts = attempts + 1,
    started_at = coalesce(started_at, now()), error_code = null,
    lease_token = token, lease_expires_at = now() + interval '3 minutes'
  where id = job_row.id;
  update public.tenants set status = 'provisioning', updated_at = now()
  where id = p_tenant_id and status is distinct from 'provisioning';

  return jsonb_build_object(
    'busy', false, 'complete', false, 'tenant_id', tenant_row.id, 'job_id', job_row.id,
    'lease_token', token, 'name', tenant_row.name, 'slug', tenant_row.slug,
    'region', tenant_row.region, 'admin_email', tenant_row.contact_email,
    'project_ref', tenant_row.supabase_project_ref, 'supabase_url', tenant_row.supabase_url,
    'publishable_key', tenant_row.supabase_publishable_key,
    'step', job_row.current_step, 'step_index', job_row.step_index
  );
end
$$;

create or replace function public.owner_save_provisioning_progress(
  p_tenant_id uuid, p_job_id uuid, p_lease_token uuid, p_actor_id uuid, p_actor_email text,
  p_step text, p_step_index integer,
  p_project_ref text, p_supabase_url text, p_publishable_key text,
  p_job_status text, p_error_code text, p_release_lease boolean
) returns void language plpgsql security definer set search_path = public, auth
as $$
declare effective_step text;
begin
  if auth.role() <> 'service_role' then raise exception 'Provisioning worker access is required'; end if;
  if not exists (select 1 from public.owner_staff where user_id = p_actor_id and is_active
      and role in ('platform_admin','provisioner')) then
    raise exception 'Provisioner role is required';
  end if;
  perform set_config('request.jwt.claim.sub', p_actor_id::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub',p_actor_id,'email',p_actor_email,'aal','aal2','role','authenticated')::text, true);
  if not public.owner_can_provision() then raise exception 'Provisioner role and MFA are required'; end if;
  if p_step not in ('queued','creating_project','waiting_for_project','migrating','configuring_auth','inviting_admin','complete')
     or p_step_index < 0 or p_job_status not in ('running','failed','succeeded') then
    raise exception 'Invalid provisioning state';
  end if;
  if p_job_status = 'succeeded' and (p_step <> 'complete' or p_project_ref is null
     or p_supabase_url is null or p_publishable_key is null) then
    raise exception 'Tenant environment is incomplete';
  end if;

  effective_step := case when p_job_status = 'succeeded' then 'complete' else p_step end;
  update public.provisioning_jobs set
    status = p_job_status, current_step = effective_step, step_index = p_step_index,
    error_code = p_error_code,
    lease_token = case when p_release_lease or p_job_status <> 'running' then null else lease_token end,
    lease_expires_at = case when p_release_lease or p_job_status <> 'running' then null else now() + interval '3 minutes' end,
    completed_at = case when p_job_status = 'succeeded' then now() else null end
  where id = p_job_id and tenant_id = p_tenant_id and lease_token = p_lease_token;
  if not found then raise exception 'Provisioning lease expired; retry the tenant job'; end if;

  update public.tenants set
    status = case when p_job_status = 'succeeded' then 'active' when p_job_status = 'failed' then 'attention' else 'provisioning' end,
    provisioning_step = effective_step,
    supabase_project_ref = coalesce(p_project_ref, supabase_project_ref),
    supabase_url = coalesce(p_supabase_url, supabase_url),
    supabase_publishable_key = coalesce(p_publishable_key, supabase_publishable_key),
    updated_at = now()
  where id = p_tenant_id;
  perform public.append_owner_audit('provisioning.' || p_job_status,'tenant',p_tenant_id::text,
    jsonb_build_object('step',effective_step,'step_index',p_step_index,'error_code',p_error_code));
end
$$;

-- The browser gets only an active tenant's public project URL and publishable
-- key. Secrets, database passwords, contact records, and pending tenants stay private.
create or replace function public.resolve_tenant_runtime(p_slug text)
returns table(tenant_name text, supabase_url text, publishable_key text)
language sql stable security definer set search_path = public
as $$
  select t.name, t.supabase_url, t.supabase_publishable_key
  from public.tenants t
  where lower(t.slug) = lower(trim(p_slug))
    and t.status in ('trial','active')
    and t.supabase_url ~ '^https://[a-z0-9]{20}[.]supabase[.]co$'
    and t.supabase_publishable_key ~ '^sb_publishable_[A-Za-z0-9_-]+$'
  limit 1
$$;

revoke all on function public.owner_create_tenant(text,text,text,text,text,text,text) from public, anon;
revoke all on function public.owner_set_tenant_admin_email(uuid,text) from public, anon;
revoke all on function public.owner_claim_provisioning_job(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.owner_save_provisioning_progress(uuid,uuid,uuid,uuid,text,text,integer,text,text,text,text,text,boolean) from public, anon, authenticated;
revoke all on function public.resolve_tenant_runtime(text) from public;
grant execute on function public.owner_create_tenant(text,text,text,text,text,text,text) to authenticated;
grant execute on function public.owner_set_tenant_admin_email(uuid,text) to authenticated;
grant execute on function public.owner_claim_provisioning_job(uuid,uuid,text) to service_role;
grant execute on function public.owner_save_provisioning_progress(uuid,uuid,uuid,uuid,text,text,integer,text,text,text,text,text,boolean) to service_role;
grant execute on function public.resolve_tenant_runtime(text) to anon, authenticated;

comment on column public.tenants.supabase_publishable_key is 'Browser-safe Supabase publishable key. Never store secret/service-role keys in the owner database.';
comment on column public.provisioning_jobs.lease_token is 'Short-lived provisioning lease token; returned only to the authenticated Edge Function claim call.';
