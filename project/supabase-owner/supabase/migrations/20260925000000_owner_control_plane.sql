-- Dedicated OWNER Supabase project only. Never apply this migration to a tenant DB.
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.owner_staff (
  user_id uuid primary key references auth.users(id) on delete restrict,
  role text not null check (role in ('platform_admin','provisioner','support','analyst','auditor')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 160),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  plan text not null default 'starter' check (plan in ('starter','growth','enterprise')),
  region text not null default 'africa-east',
  isolation_level text not null default 'database_per_tenant' check (isolation_level in ('database_per_tenant','schema_per_tenant')),
  status text not null default 'pending' check (status in ('pending','provisioning','training','trial','active','suspended','attention','closed')),
  primary_contact text,
  contact_email text,
  hypercare_until timestamptz,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.provisioning_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  status text not null default 'queued' check (status in ('queued','running','succeeded','failed','cancelled')),
  idempotency_key text not null unique,
  requested_by uuid not null default auth.uid(),
  attempts integer not null default 0 check (attempts >= 0),
  error_code text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

-- Telemetry is intentionally numeric and aggregate-only; no payload/user columns.
create table if not exists public.tenant_metrics (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  metric_key text not null check (metric_key ~ '^[a-z][a-z0-9_.-]{0,79}$'),
  metric_value numeric not null,
  period_start timestamptz not null,
  period_seconds integer not null check (period_seconds > 0),
  created_at timestamptz not null default now(),
  unique (tenant_id, metric_key, period_start)
);

create table if not exists public.platform_alerts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete restrict,
  title text not null,
  summary text,
  severity text not null default 'warning' check (severity in ('info','warning','critical')),
  status text not null default 'open' check (status in ('open','acknowledged','resolved')),
  category text not null default 'technical' check (category in ('technical','tenant_insight')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  title text not null,
  summary text,
  status text not null default 'open' check (status in ('open','in_progress','waiting','resolved','closed')),
  severity text not null default 'normal' check (severity in ('normal','high','critical')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.training_enrollments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  course_id text not null,
  status text not null default 'assigned' check (status in ('assigned','in_progress','completed','certified','stalled')),
  progress_percent integer not null default 0 check (progress_percent between 0 and 100),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, course_id)
);

create table if not exists public.owner_audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid,
  actor_email text,
  action text not null,
  target_type text not null,
  target_id text,
  details jsonb not null default '{}'::jsonb,
  previous_hash text,
  record_hash text not null,
  created_at timestamptz not null default now()
);

create or replace function public.owner_role()
returns text language sql stable security definer set search_path = public, auth
as $$ select role from public.owner_staff where user_id = auth.uid() and is_active $$;

create or replace function public.owner_is_staff()
returns boolean language sql stable security definer set search_path = public, auth
as $$ select exists (select 1 from public.owner_staff where user_id = auth.uid() and is_active) $$;

create or replace function public.owner_has_mfa()
returns boolean language sql stable
as $$ select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2' $$;

create or replace function public.owner_can_read()
returns boolean language sql stable security definer set search_path = public, auth
as $$ select public.owner_is_staff() and public.owner_has_mfa() $$;

create or replace function public.owner_can_provision()
returns boolean language sql stable security definer set search_path = public, auth
as $$ select public.owner_has_mfa() and public.owner_role() in ('platform_admin','provisioner') $$;

create or replace function public.append_owner_audit(
  p_action text, p_target_type text, p_target_id text, p_details jsonb default '{}'::jsonb
) returns bigint language plpgsql security definer set search_path = public, auth, extensions
as $$
declare prior text; new_id bigint; payload jsonb; digest_value text; event_time timestamptz;
begin
  perform pg_advisory_xact_lock(91823301);
  select record_hash into prior from public.owner_audit_log order by id desc limit 1;
  event_time := clock_timestamp();
  payload := jsonb_build_object(
    'actor_id', auth.uid(), 'actor_email', auth.jwt() ->> 'email',
    'action', p_action, 'target_type', p_target_type, 'target_id', p_target_id,
    'details', coalesce(p_details, '{}'::jsonb), 'previous_hash', prior, 'created_at', event_time
  );
  digest_value := encode(extensions.digest(coalesce(prior, '') || payload::text, 'sha256'), 'hex');
  insert into public.owner_audit_log(actor_id, actor_email, action, target_type, target_id, details, previous_hash, record_hash, created_at)
  values (auth.uid(), auth.jwt() ->> 'email', p_action, p_target_type, p_target_id, coalesce(p_details, '{}'::jsonb), prior, digest_value, event_time)
  returning id into new_id;
  return new_id;
end $$;

create or replace function public.prevent_owner_audit_mutation()
returns trigger language plpgsql set search_path = public
as $$ begin raise exception 'Owner audit records are append-only'; end $$;
drop trigger if exists owner_audit_immutable on public.owner_audit_log;
create trigger owner_audit_immutable before update or delete on public.owner_audit_log
for each row execute function public.prevent_owner_audit_mutation();

create or replace function public.audit_tenant_registry_change()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.append_owner_audit('tenant.created','tenant',new.id::text,jsonb_build_object('name',new.name,'slug',new.slug,'plan',new.plan,'region',new.region,'status',new.status));
    return new;
  end if;
  perform public.append_owner_audit('tenant.updated','tenant',new.id::text,jsonb_build_object('changed_fields', (select jsonb_agg(key) from jsonb_each(to_jsonb(new)) where to_jsonb(old) -> key is distinct from value)));
  return new;
end $$;
drop trigger if exists tenant_registry_audit on public.tenants;
create trigger tenant_registry_audit after insert or update on public.tenants
for each row execute function public.audit_tenant_registry_change();

create or replace function public.owner_create_tenant(
  p_name text, p_slug text, p_plan text, p_region text,
  p_primary_contact text, p_contact_email text, p_isolation_level text
) returns uuid language plpgsql security definer set search_path = public, auth
as $$
declare tenant_key uuid;
begin
  if not public.owner_can_provision() then raise exception 'Provisioner role and MFA are required'; end if;
  insert into public.tenants(name, slug, plan, region, primary_contact, contact_email, isolation_level, created_by)
  values (trim(p_name), lower(trim(p_slug)), p_plan, p_region, nullif(trim(p_primary_contact),''), nullif(trim(p_contact_email),''), p_isolation_level, auth.uid())
  returning id into tenant_key;
  insert into public.provisioning_jobs(tenant_id, idempotency_key, requested_by)
  values (tenant_key, 'tenant:' || tenant_key::text, auth.uid());
  perform public.append_owner_audit('provisioning.queued','tenant',tenant_key::text,jsonb_build_object('job_kind','tenant_environment'));
  return tenant_key;
end $$;

create or replace function public.verify_owner_audit_chain()
returns boolean language plpgsql stable security definer set search_path = public, extensions
as $$
declare row_item record; prior text := null; expected text;
begin
  if not public.owner_can_read() then raise exception 'MFA owner staff access is required'; end if;
  for row_item in select * from public.owner_audit_log order by id loop
    if row_item.previous_hash is distinct from prior then return false; end if;
    expected := encode(extensions.digest(coalesce(prior, '') || jsonb_build_object(
      'actor_id', row_item.actor_id, 'actor_email', row_item.actor_email, 'action', row_item.action,
      'target_type', row_item.target_type, 'target_id', row_item.target_id, 'details', row_item.details,
      'previous_hash', prior, 'created_at', row_item.created_at
    )::text, 'sha256'), 'hex');
    if row_item.record_hash is distinct from expected then return false; end if;
    prior := row_item.record_hash;
  end loop;
  return true;
end $$;

alter table public.owner_staff enable row level security;
alter table public.tenants enable row level security;
alter table public.provisioning_jobs enable row level security;
alter table public.tenant_metrics enable row level security;
alter table public.platform_alerts enable row level security;
alter table public.support_tickets enable row level security;
alter table public.training_enrollments enable row level security;
alter table public.owner_audit_log enable row level security;

create policy "owner staff can view own access" on public.owner_staff for select to authenticated using (user_id = auth.uid() and is_active);
create policy "mfa staff read tenants" on public.tenants for select to authenticated using (public.owner_can_read());
create policy "provisioners create tenant records" on public.tenants for insert to authenticated with check (public.owner_can_provision() and created_by = auth.uid());
create policy "mfa staff read provisioning jobs" on public.provisioning_jobs for select to authenticated using (public.owner_can_read());
create policy "mfa staff read aggregate metrics" on public.tenant_metrics for select to authenticated using (public.owner_can_read());
create policy "mfa staff read platform alerts" on public.platform_alerts for select to authenticated using (public.owner_can_read());
create policy "mfa staff read support tickets" on public.support_tickets for select to authenticated using (public.owner_can_read());
create policy "mfa staff read training progress" on public.training_enrollments for select to authenticated using (public.owner_can_read());
create policy "mfa staff read audit" on public.owner_audit_log for select to authenticated using (public.owner_can_read());

revoke all on public.owner_staff, public.tenants, public.provisioning_jobs, public.tenant_metrics, public.platform_alerts, public.support_tickets, public.training_enrollments, public.owner_audit_log from anon, authenticated;
grant select on public.owner_staff to authenticated;
grant select on public.tenants, public.provisioning_jobs, public.tenant_metrics, public.platform_alerts, public.support_tickets, public.training_enrollments, public.owner_audit_log to authenticated;
revoke all on function public.append_owner_audit(text,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.owner_create_tenant(text,text,text,text,text,text,text) from public, anon;
revoke all on function public.verify_owner_audit_chain() from public, anon;
grant execute on function public.owner_create_tenant(text,text,text,text,text,text,text) to authenticated;
grant execute on function public.verify_owner_audit_chain() to authenticated;

comment on table public.tenant_metrics is 'Aggregated numeric tenant telemetry only. Never place tenant business rows or personal data here.';
comment on table public.owner_staff is 'Owner-plane staff identities and least-privilege roles; provision through trusted administration only.';
comment on table public.owner_audit_log is 'Append-only tamper-evident owner control-plane audit chain.';
