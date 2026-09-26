-- Set the requested package prices (KES per month) from smallest to largest.
-- Billing remains a manual ledger until a payment provider is configured.
UPDATE public.billing_plans SET amount = 20000, currency = 'KES', billing_interval = 'monthly',
  description = CASE WHEN description LIKE '%Add pricing when billing is configured%' THEN 'Monthly package for small businesses.' ELSE description END,
  updated_at = now()
WHERE plan_key = 'starter' AND amount IS NULL;
UPDATE public.billing_plans SET amount = 35000, currency = 'KES', billing_interval = 'monthly',
  description = CASE WHEN description LIKE '%Add pricing when billing is configured%' THEN 'Monthly package for medium businesses.' ELSE description END,
  updated_at = now()
WHERE plan_key = 'growth' AND amount IS NULL;
UPDATE public.billing_plans SET amount = 40000, currency = 'KES', billing_interval = 'monthly',
  description = CASE WHEN description LIKE '%Add pricing when billing is configured%' THEN 'Monthly package for large businesses.' ELSE description END,
  updated_at = now()
WHERE plan_key = 'enterprise' AND amount IS NULL;

-- Registering a tenant also assigns the selected business package as a trial
-- subscription, keeping the registry plan and billing ledger in sync.
CREATE OR REPLACE FUNCTION public.owner_create_tenant(
  p_name text, p_slug text, p_plan text, p_region text,
  p_primary_contact text, p_contact_email text, p_isolation_level text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
DECLARE tenant_key uuid;
BEGIN
  IF NOT public.owner_can_provision() THEN RAISE EXCEPTION 'Provisioner role and MFA are required'; END IF;
  IF p_isolation_level <> 'shared_database' THEN RAISE EXCEPTION 'New tenant onboarding must use the configured shared database'; END IF;
  IF nullif(trim(p_contact_email),'') IS NULL OR trim(p_contact_email) !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' THEN
    RAISE EXCEPTION 'A valid first tenant administrator email is required';
  END IF;
  IF p_region NOT IN ('africa-east','africa-south','eu-west','us-east') THEN RAISE EXCEPTION 'Choose a supported tenant region'; END IF;
  IF p_plan NOT IN ('starter','growth','enterprise') OR NOT EXISTS (
    SELECT 1 FROM public.billing_plans WHERE plan_key=p_plan AND is_active
  ) THEN RAISE EXCEPTION 'Choose an active business package'; END IF;
  INSERT INTO public.tenants(name,slug,plan,region,primary_contact,contact_email,isolation_level,created_by)
    VALUES(trim(p_name),lower(trim(p_slug)),p_plan,p_region,nullif(trim(p_primary_contact),''),lower(trim(p_contact_email)),'shared_database',auth.uid())
    RETURNING id INTO tenant_key;
  INSERT INTO public.provisioning_jobs(tenant_id,idempotency_key,requested_by)
    VALUES(tenant_key,'tenant:'||tenant_key::text,auth.uid());
  INSERT INTO public.tenant_subscriptions(tenant_id,plan_key,status,billing_interval)
    VALUES(tenant_key,p_plan,'trialing','monthly');
  PERFORM public.append_owner_audit('provisioning.queued','tenant',tenant_key::text,jsonb_build_object('job_kind','shared_database_tenant','plan',p_plan));
  RETURN tenant_key;
END $$;

-- Tenant user IDs belong to the shared tenant project's Auth service, not the
-- Owner project's auth.users table.
ALTER TABLE public.support_tickets ADD COLUMN IF NOT EXISTS created_by uuid;
CREATE INDEX IF NOT EXISTS support_tickets_created_by_recent_idx
  ON public.support_tickets(created_by, created_at DESC) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS support_ticket_messages_author_recent_idx
  ON public.support_ticket_messages(author_id, created_at DESC) WHERE author_kind='tenant';

CREATE OR REPLACE FUNCTION public.owner_create_tenant_ticket(
  p_tenant_id uuid, p_user_id uuid, p_author_email text, p_title text, p_body text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
DECLARE ticket_key uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Tenant bridge service access is required'; END IF;
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'Tenant user identity is required'; END IF;
  IF length(trim(p_title)) NOT BETWEEN 2 AND 160 OR length(trim(p_body)) NOT BETWEEN 1 AND 5000 THEN
    RAISE EXCEPTION 'Ticket title or message is invalid';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id=p_tenant_id AND status='active' AND supabase_project_ref IS NOT NULL) THEN
    RAISE EXCEPTION 'An active tenant environment is required';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 741852));
  IF (SELECT count(*) FROM public.support_tickets WHERE created_by=p_user_id AND created_at > now() - interval '1 hour') >= 10 THEN
    RAISE EXCEPTION 'Support request limit reached. Try again later.';
  END IF;
  INSERT INTO public.support_tickets(tenant_id,title,summary,status,severity,created_by)
    VALUES(p_tenant_id,trim(p_title),trim(p_body),'open','normal',p_user_id) RETURNING id INTO ticket_key;
  INSERT INTO public.support_ticket_messages(ticket_id,author_kind,author_id,author_email,body)
    VALUES(ticket_key,'tenant',p_user_id,lower(nullif(trim(p_author_email),'')),trim(p_body));
  RETURN ticket_key;
END $$;

CREATE OR REPLACE FUNCTION public.owner_add_tenant_ticket_reply(
  p_tenant_id uuid, p_ticket_id uuid, p_user_id uuid, p_author_email text, p_body text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
DECLARE message_key uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Tenant bridge service access is required'; END IF;
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'Tenant user identity is required'; END IF;
  IF length(trim(p_body)) NOT BETWEEN 1 AND 5000 THEN RAISE EXCEPTION 'Reply must be 1 to 5000 characters'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.support_tickets WHERE id=p_ticket_id AND tenant_id=p_tenant_id AND status NOT IN ('resolved','closed')) THEN
    RAISE EXCEPTION 'Open support ticket was not found';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 741852));
  IF (SELECT count(*) FROM public.support_ticket_messages WHERE author_id=p_user_id AND author_kind='tenant' AND created_at > now() - interval '1 hour') >= 30 THEN
    RAISE EXCEPTION 'Support reply limit reached. Try again later.';
  END IF;
  INSERT INTO public.support_ticket_messages(ticket_id,author_kind,author_id,author_email,body)
    VALUES(p_ticket_id,'tenant',p_user_id,lower(nullif(trim(p_author_email),'')),trim(p_body)) RETURNING id INTO message_key;
  UPDATE public.support_tickets SET updated_at=now(),last_response_at=now() WHERE id=p_ticket_id;
  RETURN message_key;
END $$;

CREATE OR REPLACE FUNCTION public.owner_report_tenant_alert(p_tenant_id uuid, p_code text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
DECLARE alert_title text; alert_summary text; alert_key uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Tenant bridge service access is required'; END IF;
  CASE p_code
    WHEN 'dashboard_load_failed' THEN
      alert_title := 'Tenant dashboard load failure'; alert_summary := 'An active tenant administrator reported that the business dashboard failed to load.';
    WHEN 'catalogue_unavailable' THEN
      alert_title := 'Tenant product catalogue unavailable'; alert_summary := 'An active tenant administrator reported a product catalogue loading problem.';
    WHEN 'sign_in_issue' THEN
      alert_title := 'Tenant sign-in issue'; alert_summary := 'An active tenant administrator reported a sign-in problem.';
    WHEN 'slow_response' THEN
      alert_title := 'Tenant application is responding slowly'; alert_summary := 'An active tenant administrator reported slow application responses.';
    ELSE RAISE EXCEPTION 'Unsupported technical alert category';
  END CASE;
  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id=p_tenant_id AND status='active' AND supabase_project_ref IS NOT NULL) THEN
    RAISE EXCEPTION 'An active tenant environment is required';
  END IF;
  SELECT id INTO alert_key FROM public.platform_alerts
    WHERE tenant_id=p_tenant_id AND category='technical' AND title=alert_title AND status <> 'resolved'
      AND created_at > now() - interval '1 hour'
    ORDER BY created_at DESC LIMIT 1;
  IF alert_key IS NOT NULL THEN RETURN alert_key; END IF;
  INSERT INTO public.platform_alerts(tenant_id,title,summary,severity,status,category)
    VALUES(p_tenant_id,alert_title,alert_summary,'warning','open','technical') RETURNING id INTO alert_key;
  RETURN alert_key;
END $$;

REVOKE ALL ON FUNCTION public.owner_create_tenant_ticket(uuid,uuid,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.owner_add_tenant_ticket_reply(uuid,uuid,uuid,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.owner_report_tenant_alert(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.owner_create_tenant_ticket(uuid,uuid,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.owner_add_tenant_ticket_reply(uuid,uuid,uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.owner_report_tenant_alert(uuid,text) TO service_role;
