-- New tenant environments use the already configured tenant Supabase project.
-- Existing tenants with a saved dedicated project reference keep their routing.

ALTER TABLE public.tenants
  ALTER COLUMN isolation_level SET DEFAULT 'shared_database';

ALTER TABLE public.tenants
  DROP CONSTRAINT IF EXISTS tenants_isolation_level_check;
ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_isolation_level_check
  CHECK (isolation_level IN ('database_per_tenant', 'schema_per_tenant', 'shared_database'));

-- The project reference is intentionally shared by multiple tenant rows.
DROP INDEX IF EXISTS public.tenants_supabase_project_ref_unique;
CREATE INDEX IF NOT EXISTS tenants_supabase_project_ref_idx
  ON public.tenants(supabase_project_ref) WHERE supabase_project_ref IS NOT NULL;

-- Failed and queued tenants have no established database to preserve. Move them
-- to shared mode so resuming the job attaches them to the existing project.
UPDATE public.tenants
SET isolation_level = 'shared_database', updated_at = now()
WHERE supabase_project_ref IS NULL;

CREATE OR REPLACE FUNCTION public.owner_create_tenant(
  p_name text, p_slug text, p_plan text, p_region text,
  p_primary_contact text, p_contact_email text, p_isolation_level text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
DECLARE tenant_key uuid;
BEGIN
  IF NOT public.owner_can_provision() THEN RAISE EXCEPTION 'Provisioner role and MFA are required'; END IF;
  IF p_isolation_level <> 'shared_database' THEN
    RAISE EXCEPTION 'New tenant onboarding must use the configured shared database';
  END IF;
  IF nullif(trim(p_contact_email), '') IS NULL
     OR trim(p_contact_email) !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' THEN
    RAISE EXCEPTION 'A valid first tenant administrator email is required';
  END IF;
  IF p_region NOT IN ('africa-east','africa-south','eu-west','us-east') THEN
    RAISE EXCEPTION 'Choose a supported tenant region';
  END IF;
  INSERT INTO public.tenants(name, slug, plan, region, primary_contact, contact_email, isolation_level, created_by)
  VALUES (trim(p_name), lower(trim(p_slug)), p_plan, p_region,
    nullif(trim(p_primary_contact),''), lower(trim(p_contact_email)), 'shared_database', auth.uid())
  RETURNING id INTO tenant_key;
  INSERT INTO public.provisioning_jobs(tenant_id, idempotency_key, requested_by)
  VALUES (tenant_key, 'tenant:' || tenant_key::text, auth.uid());
  PERFORM public.append_owner_audit('provisioning.queued','tenant',tenant_key::text,jsonb_build_object('job_kind','shared_database_tenant'));
  RETURN tenant_key;
END
$$;

CREATE OR REPLACE FUNCTION public.owner_claim_provisioning_job(p_tenant_id uuid, p_actor_id uuid, p_actor_email text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, extensions
AS $$
DECLARE tenant_row public.tenants%rowtype; job_row public.provisioning_jobs%rowtype; token uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Provisioning worker access is required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.owner_staff WHERE user_id = p_actor_id AND is_active
      AND role IN ('platform_admin','provisioner')) THEN
    RAISE EXCEPTION 'Provisioner role is required';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', p_actor_id::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub',p_actor_id,'email',p_actor_email,'aal','aal2','role','authenticated')::text, true);
  IF NOT public.owner_can_provision() THEN RAISE EXCEPTION 'Provisioner role and MFA are required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant_id::text, 91824));
  SELECT * INTO tenant_row FROM public.tenants WHERE id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tenant was not found'; END IF;
  IF tenant_row.status = 'active' AND tenant_row.supabase_project_ref IS NOT NULL THEN
    RETURN jsonb_build_object('complete', true, 'slug', tenant_row.slug, 'step', 'complete');
  END IF;
  IF tenant_row.isolation_level <> 'shared_database' THEN
    RAISE EXCEPTION 'This tenant is not configured for shared database onboarding';
  END IF;
  IF tenant_row.contact_email IS NULL THEN RAISE EXCEPTION 'A first tenant administrator email is required'; END IF;

  SELECT * INTO job_row FROM public.provisioning_jobs
    WHERE tenant_id = p_tenant_id ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Provisioning job was not found'; END IF;
  IF job_row.status = 'succeeded' THEN
    RETURN jsonb_build_object('complete', true, 'slug', tenant_row.slug, 'step', 'complete');
  END IF;
  IF job_row.status = 'cancelled' THEN RAISE EXCEPTION 'Cancelled provisioning jobs cannot be resumed'; END IF;
  IF job_row.status = 'running' AND job_row.lease_expires_at > now() THEN
    RETURN jsonb_build_object('busy', true, 'step', job_row.current_step, 'retry_after_seconds', 5);
  END IF;

  token := extensions.gen_random_uuid();
  UPDATE public.provisioning_jobs SET status = 'running', attempts = attempts + 1,
    started_at = coalesce(started_at, now()), error_code = null,
    lease_token = token, lease_expires_at = now() + interval '3 minutes'
  WHERE id = job_row.id;
  UPDATE public.tenants SET status = 'provisioning', updated_at = now()
  WHERE id = p_tenant_id AND status IS DISTINCT FROM 'provisioning';

  RETURN jsonb_build_object(
    'busy', false, 'complete', false, 'tenant_id', tenant_row.id, 'job_id', job_row.id,
    'lease_token', token, 'name', tenant_row.name, 'slug', tenant_row.slug,
    'region', tenant_row.region, 'admin_email', tenant_row.contact_email,
    'project_ref', tenant_row.supabase_project_ref, 'supabase_url', tenant_row.supabase_url,
    'publishable_key', tenant_row.supabase_publishable_key,
    'isolation_level', tenant_row.isolation_level,
    'step', job_row.current_step, 'step_index', job_row.step_index
  );
END
$$;

CREATE OR REPLACE FUNCTION public.owner_save_provisioning_progress(
  p_tenant_id uuid, p_job_id uuid, p_lease_token uuid, p_actor_id uuid, p_actor_email text,
  p_step text, p_step_index integer,
  p_project_ref text, p_supabase_url text, p_publishable_key text,
  p_job_status text, p_error_code text, p_release_lease boolean
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
DECLARE effective_step text;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Provisioning worker access is required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.owner_staff WHERE user_id = p_actor_id AND is_active
      AND role IN ('platform_admin','provisioner')) THEN
    RAISE EXCEPTION 'Provisioner role is required';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', p_actor_id::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub',p_actor_id,'email',p_actor_email,'aal','aal2','role','authenticated')::text, true);
  IF NOT public.owner_can_provision() THEN RAISE EXCEPTION 'Provisioner role and MFA are required'; END IF;
  IF p_step NOT IN ('queued','creating_project','connecting_shared_database','waiting_for_project','migrating','configuring_auth','inviting_admin','complete')
     OR p_step_index < 0 OR p_job_status NOT IN ('running','failed','succeeded') THEN
    RAISE EXCEPTION 'Invalid provisioning state';
  END IF;
  IF p_job_status = 'succeeded' AND (p_step <> 'complete' OR p_project_ref IS NULL
     OR p_supabase_url IS NULL OR p_publishable_key IS NULL) THEN
    RAISE EXCEPTION 'Tenant environment is incomplete';
  END IF;

  effective_step := CASE WHEN p_job_status = 'succeeded' THEN 'complete' ELSE p_step END;
  UPDATE public.provisioning_jobs SET
    status = p_job_status, current_step = effective_step, step_index = p_step_index,
    error_code = p_error_code,
    lease_token = CASE WHEN p_release_lease OR p_job_status <> 'running' THEN NULL ELSE lease_token END,
    lease_expires_at = CASE WHEN p_release_lease OR p_job_status <> 'running' THEN NULL ELSE now() + interval '3 minutes' END,
    completed_at = CASE WHEN p_job_status = 'succeeded' THEN now() ELSE NULL END
  WHERE id = p_job_id AND tenant_id = p_tenant_id AND lease_token = p_lease_token;
  IF NOT FOUND THEN RAISE EXCEPTION 'Provisioning lease expired; retry the tenant job'; END IF;

  UPDATE public.tenants SET
    status = CASE WHEN p_job_status = 'succeeded' THEN 'active' WHEN p_job_status = 'failed' THEN 'attention' ELSE 'provisioning' END,
    provisioning_step = effective_step,
    supabase_project_ref = coalesce(p_project_ref, supabase_project_ref),
    supabase_url = coalesce(p_supabase_url, supabase_url),
    supabase_publishable_key = coalesce(p_publishable_key, supabase_publishable_key),
    updated_at = now()
  WHERE id = p_tenant_id;
  PERFORM public.append_owner_audit('provisioning.' || p_job_status,'tenant',p_tenant_id::text,
    jsonb_build_object('step',effective_step,'step_index',p_step_index,'error_code',p_error_code));
END
$$;

DROP FUNCTION IF EXISTS public.resolve_tenant_runtime(text);
CREATE FUNCTION public.resolve_tenant_runtime(p_slug text)
RETURNS TABLE(tenant_id uuid, tenant_name text, supabase_url text, publishable_key text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE WHEN t.isolation_level = 'shared_database' THEN t.id ELSE NULL END,
         t.name, t.supabase_url, t.supabase_publishable_key
  FROM public.tenants t
  WHERE lower(t.slug) = lower(trim(p_slug))
    AND t.status IN ('trial','active')
    AND t.supabase_url ~ '^https://[a-z0-9]{20}[.]supabase[.]co$'
    AND t.supabase_publishable_key ~ '^sb_publishable_[A-Za-z0-9_-]+$'
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.resolve_tenant_runtime(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_tenant_runtime(text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
