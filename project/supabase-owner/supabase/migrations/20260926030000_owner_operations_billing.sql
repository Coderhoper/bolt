-- Owner operations: inbox, billing records, training, support and telemetry.
-- Payment collection is deliberately not connected; gateway credentials are configured later.

CREATE SEQUENCE IF NOT EXISTS public.owner_invoice_number_seq;

CREATE TABLE IF NOT EXISTS public.billing_plans (
  plan_key text PRIMARY KEY CHECK (plan_key IN ('starter','growth','enterprise')),
  display_name text NOT NULL,
  business_size text NOT NULL DEFAULT 'small' CHECK (business_size IN ('small','medium','large')),
  size_description text,
  description text,
  amount numeric(12,2) CHECK (amount IS NULL OR amount >= 0),
  currency text NOT NULL DEFAULT 'KES' CHECK (currency ~ '^[A-Z]{3}$'),
  billing_interval text NOT NULL DEFAULT 'monthly' CHECK (billing_interval IN ('monthly','yearly')),
  seat_limit integer CHECK (seat_limit IS NULL OR seat_limit > 0),
  features jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(features) = 'array'),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.billing_plans(plan_key, display_name, business_size, description)
VALUES
  ('starter','Small Business','small','Small business package. Add pricing when billing is configured.'),
  ('growth','Medium Business','medium','Medium business package. Add pricing when billing is configured.'),
  ('enterprise','Large Business','large','Large business package. Add pricing when billing is configured.')
ON CONFLICT (plan_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.tenant_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE REFERENCES public.tenants(id) ON DELETE RESTRICT,
  plan_key text NOT NULL REFERENCES public.billing_plans(plan_key),
  status text NOT NULL DEFAULT 'trialing' CHECK (status IN ('trialing','active','past_due','paused','cancelled')),
  billing_interval text NOT NULL DEFAULT 'monthly' CHECK (billing_interval IN ('monthly','yearly')),
  period_start date,
  period_end date,
  provider text NOT NULL DEFAULT 'manual',
  provider_customer_id text,
  provider_subscription_id text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end IS NULL OR period_start IS NULL OR period_end >= period_start)
);

CREATE TABLE IF NOT EXISTS public.billing_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  invoice_number text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','past_due','paid','void')),
  currency text NOT NULL DEFAULT 'KES' CHECK (currency ~ '^[A-Z]{3}$'),
  subtotal numeric(12,2) NOT NULL CHECK (subtotal >= 0),
  tax numeric(12,2) NOT NULL DEFAULT 0 CHECK (tax >= 0),
  total numeric(12,2) GENERATED ALWAYS AS (subtotal + tax) STORED,
  line_items jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(line_items) = 'array'),
  notes text,
  issued_at timestamptz,
  due_at date,
  paid_at timestamptz,
  provider_invoice_id text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS billing_invoices_tenant_recent_idx
  ON public.billing_invoices(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS tenant_subscriptions_status_idx
  ON public.tenant_subscriptions(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.owner_inbox_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 2 AND 160),
  body text NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 5000),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','important','urgent')),
  is_active boolean NOT NULL DEFAULT true,
  expires_at timestamptz,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE INDEX IF NOT EXISTS owner_inbox_messages_tenant_recent_idx
  ON public.owner_inbox_messages(tenant_id, created_at DESC) WHERE is_active;

-- Tenant Auth IDs belong to the shared tenant project, so receipt IDs are not
-- constrained to auth.users in the Owner project.
CREATE TABLE IF NOT EXISTS public.owner_inbox_reads (
  message_id uuid NOT NULL REFERENCES public.owner_inbox_messages(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(message_id, user_id)
);
CREATE INDEX IF NOT EXISTS owner_inbox_reads_tenant_idx ON public.owner_inbox_reads(tenant_id, read_at DESC);

CREATE TABLE IF NOT EXISTS public.training_courses (
  course_id text PRIMARY KEY CHECK (course_id ~ '^[a-z0-9][a-z0-9_-]{1,79}$'),
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 2 AND 160),
  description text,
  is_required boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_response_at timestamptz;

CREATE TABLE IF NOT EXISTS public.support_ticket_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE RESTRICT,
  author_kind text NOT NULL CHECK (author_kind IN ('tenant','owner')),
  author_id uuid,
  author_email text,
  body text NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 5000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_ticket_messages_ticket_idx
  ON public.support_ticket_messages(ticket_id, created_at);

CREATE TABLE IF NOT EXISTS public.owner_meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 2 AND 160),
  purpose text NOT NULL CHECK (purpose IN ('onboarding','training','support','review','other')),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  timezone text NOT NULL DEFAULT 'Africa/Nairobi',
  provider text NOT NULL DEFAULT 'external',
  meeting_url text,
  attendee_name text,
  attendee_email text,
  agenda text,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','completed','cancelled','no_show')),
  outcome text,
  follow_up_at timestamptz,
  follow_up_note text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  outcome_recorded_at timestamptz,
  CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS owner_meetings_schedule_idx ON public.owner_meetings(starts_at, status);
CREATE INDEX IF NOT EXISTS owner_meetings_tenant_idx ON public.owner_meetings(tenant_id, starts_at DESC);

ALTER TABLE public.billing_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.owner_inbox_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.owner_inbox_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_ticket_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.owner_meetings ENABLE ROW LEVEL SECURITY;

CREATE POLICY billing_plans_mfa_read ON public.billing_plans FOR SELECT TO authenticated
  USING (public.owner_can_read());
CREATE POLICY tenant_subscriptions_mfa_read ON public.tenant_subscriptions FOR SELECT TO authenticated
  USING (public.owner_can_read());
CREATE POLICY billing_invoices_mfa_read ON public.billing_invoices FOR SELECT TO authenticated
  USING (public.owner_can_read());
CREATE POLICY owner_inbox_mfa_read ON public.owner_inbox_messages FOR SELECT TO authenticated
  USING (public.owner_can_read());
CREATE POLICY training_courses_mfa_read ON public.training_courses FOR SELECT TO authenticated
  USING (public.owner_can_read());
CREATE POLICY support_ticket_messages_mfa_read ON public.support_ticket_messages FOR SELECT TO authenticated
  USING (public.owner_can_read());
CREATE POLICY owner_meetings_mfa_read ON public.owner_meetings FOR SELECT TO authenticated
  USING (public.owner_can_read());

REVOKE ALL ON public.billing_plans, public.tenant_subscriptions, public.billing_invoices,
  public.owner_inbox_messages, public.owner_inbox_reads, public.training_courses,
  public.support_ticket_messages, public.owner_meetings FROM anon, authenticated;
GRANT SELECT ON public.billing_plans, public.tenant_subscriptions, public.billing_invoices,
  public.owner_inbox_messages, public.training_courses, public.support_ticket_messages TO authenticated;
GRANT SELECT ON public.owner_meetings TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.owner_invoice_number_seq TO authenticated;

CREATE OR REPLACE FUNCTION public.owner_update_tenant(
  p_tenant_id uuid, p_name text, p_plan text, p_region text,
  p_primary_contact text, p_contact_email text, p_status text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
BEGIN
  IF NOT public.owner_can_provision() THEN RAISE EXCEPTION 'Provisioner role and MFA are required'; END IF;
  IF length(trim(p_name)) NOT BETWEEN 2 AND 160 THEN RAISE EXCEPTION 'Tenant name is invalid'; END IF;
  IF p_plan NOT IN ('starter','growth','enterprise') THEN RAISE EXCEPTION 'Select a supported plan'; END IF;
  IF p_status NOT IN ('pending','trial','active','suspended','closed','attention') THEN
    RAISE EXCEPTION 'Select a supported tenant status';
  END IF;
  UPDATE public.tenants SET name=trim(p_name), plan=p_plan, region=trim(p_region),
    primary_contact=nullif(trim(p_primary_contact),''), contact_email=lower(nullif(trim(p_contact_email),'')),
    status=p_status, updated_at=now()
  WHERE id=p_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tenant was not found'; END IF;
  IF p_status='active' AND NOT EXISTS (SELECT 1 FROM public.tenants WHERE id=p_tenant_id AND supabase_project_ref IS NOT NULL) THEN
    RAISE EXCEPTION 'Provision the tenant before activating access';
  END IF;
  UPDATE public.tenant_subscriptions SET plan_key=p_plan,updated_at=now() WHERE tenant_id=p_tenant_id;
  PERFORM public.append_owner_audit('tenant.updated','tenant',p_tenant_id::text,
    jsonb_build_object('name',trim(p_name),'plan',p_plan,'status',p_status));
END $$;

CREATE OR REPLACE FUNCTION public.owner_set_platform_alert_status(p_alert_id uuid, p_status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
BEGIN
  IF public.owner_role() NOT IN ('platform_admin','provisioner','support') OR NOT public.owner_has_mfa() THEN
    RAISE EXCEPTION 'Support staff access and MFA are required';
  END IF;
  IF p_status NOT IN ('open','acknowledged','resolved') THEN RAISE EXCEPTION 'Invalid alert status'; END IF;
  UPDATE public.platform_alerts SET status=p_status,
    resolved_at=CASE WHEN p_status='resolved' THEN now() ELSE NULL END
  WHERE id=p_alert_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Alert was not found'; END IF;
  PERFORM public.append_owner_audit('alert.'||p_status,'platform_alert',p_alert_id::text,'{}'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.owner_save_training_course(
  p_course_id text, p_title text, p_description text, p_is_required boolean, p_is_active boolean
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
BEGIN
  IF NOT public.owner_can_provision() THEN RAISE EXCEPTION 'Provisioner role and MFA are required'; END IF;
  IF p_course_id !~ '^[a-z0-9][a-z0-9_-]{1,79}$' OR length(trim(p_title)) NOT BETWEEN 2 AND 160 THEN
    RAISE EXCEPTION 'Course ID or title is invalid';
  END IF;
  INSERT INTO public.training_courses(course_id,title,description,is_required,is_active,updated_at)
    VALUES (p_course_id,trim(p_title),nullif(trim(p_description),''),p_is_required,p_is_active,now())
  ON CONFLICT (course_id) DO UPDATE SET title=excluded.title,description=excluded.description,
    is_required=excluded.is_required,is_active=excluded.is_active,updated_at=now();
  PERFORM public.append_owner_audit('training.course_saved','training_course',p_course_id,
    jsonb_build_object('active',p_is_active,'required',p_is_required));
END $$;

CREATE OR REPLACE FUNCTION public.owner_set_training_enrollment(
  p_tenant_id uuid, p_course_id text, p_status text, p_progress integer
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
BEGIN
  IF NOT public.owner_can_provision() THEN RAISE EXCEPTION 'Provisioner role and MFA are required'; END IF;
  IF p_status NOT IN ('assigned','in_progress','completed','certified','stalled') OR p_progress NOT BETWEEN 0 AND 100 THEN
    RAISE EXCEPTION 'Training status or progress is invalid';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id=p_tenant_id) OR
     NOT EXISTS (SELECT 1 FROM public.training_courses WHERE course_id=p_course_id AND is_active) THEN
    RAISE EXCEPTION 'Select an active course and tenant';
  END IF;
  INSERT INTO public.training_enrollments(tenant_id,course_id,status,progress_percent,completed_at)
    VALUES (p_tenant_id,p_course_id,p_status,p_progress,
      CASE WHEN p_status IN ('completed','certified') THEN now() ELSE NULL END)
  ON CONFLICT (tenant_id,course_id) DO UPDATE SET status=excluded.status,
    progress_percent=excluded.progress_percent,completed_at=excluded.completed_at;
  PERFORM public.append_owner_audit('training.enrollment_updated','training_enrollment',p_tenant_id::text,
    jsonb_build_object('course_id',p_course_id,'status',p_status,'progress_percent',p_progress));
END $$;

CREATE OR REPLACE FUNCTION public.owner_set_support_ticket(
  p_ticket_id uuid, p_status text, p_assigned_to uuid DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
BEGIN
  IF public.owner_role() NOT IN ('platform_admin','provisioner','support') OR NOT public.owner_has_mfa() THEN
    RAISE EXCEPTION 'Support staff access and MFA are required';
  END IF;
  IF p_status NOT IN ('open','in_progress','waiting','resolved','closed') THEN RAISE EXCEPTION 'Invalid ticket status'; END IF;
  UPDATE public.support_tickets SET status=p_status, assigned_to=coalesce(p_assigned_to,assigned_to), updated_at=now(),
    resolved_at=CASE WHEN p_status IN ('resolved','closed') THEN now() ELSE NULL END
  WHERE id=p_ticket_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Support ticket was not found'; END IF;
  PERFORM public.append_owner_audit('support.ticket_'||p_status,'support_ticket',p_ticket_id::text,
    jsonb_build_object('assigned_to',p_assigned_to));
END $$;

CREATE OR REPLACE FUNCTION public.owner_reply_support_ticket(p_ticket_id uuid, p_body text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
DECLARE message_key uuid;
BEGIN
  IF public.owner_role() NOT IN ('platform_admin','provisioner','support') OR NOT public.owner_has_mfa() THEN
    RAISE EXCEPTION 'Support staff access and MFA are required';
  END IF;
  IF length(trim(p_body)) NOT BETWEEN 1 AND 5000 THEN RAISE EXCEPTION 'Reply must be 1 to 5000 characters'; END IF;
  INSERT INTO public.support_ticket_messages(ticket_id,author_kind,author_id,author_email,body)
    VALUES(p_ticket_id,'owner',auth.uid(),auth.jwt()->>'email',trim(p_body)) RETURNING id INTO message_key;
  UPDATE public.support_tickets SET last_response_at=now(),updated_at=now() WHERE id=p_ticket_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Support ticket was not found'; END IF;
  PERFORM public.append_owner_audit('support.ticket_replied','support_ticket',p_ticket_id::text,'{}'::jsonb);
  RETURN message_key;
END $$;

CREATE OR REPLACE FUNCTION public.owner_save_billing_plan(
  p_plan_key text, p_display_name text, p_business_size text, p_size_description text,
  p_description text, p_amount numeric,
  p_currency text, p_interval text, p_seat_limit integer, p_features jsonb, p_is_active boolean
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
BEGIN
  IF public.owner_role() <> 'platform_admin' OR NOT public.owner_has_mfa() THEN RAISE EXCEPTION 'Platform administrator and MFA are required'; END IF;
  IF p_plan_key NOT IN ('starter','growth','enterprise') OR length(trim(p_display_name)) NOT BETWEEN 2 AND 100 OR p_business_size NOT IN ('small','medium','large') THEN RAISE EXCEPTION 'Plan details are invalid'; END IF;
  IF p_amount IS NOT NULL AND p_amount < 0 OR p_currency !~ '^[A-Z]{3}$' OR p_interval NOT IN ('monthly','yearly') THEN RAISE EXCEPTION 'Price, currency or interval is invalid'; END IF;
  IF p_seat_limit IS NOT NULL AND p_seat_limit < 1 THEN RAISE EXCEPTION 'Seat limit must be positive'; END IF;
  IF jsonb_typeof(p_features) <> 'array' THEN RAISE EXCEPTION 'Plan features must be a list'; END IF;
  INSERT INTO public.billing_plans(plan_key,display_name,business_size,size_description,description,amount,currency,billing_interval,seat_limit,features,is_active,updated_at)
    VALUES(p_plan_key,trim(p_display_name),p_business_size,nullif(trim(p_size_description),''),nullif(trim(p_description),''),p_amount,p_currency,p_interval,p_seat_limit,p_features,p_is_active,now())
  ON CONFLICT(plan_key) DO UPDATE SET display_name=excluded.display_name,business_size=excluded.business_size,
    size_description=excluded.size_description,description=excluded.description,
    amount=excluded.amount,currency=excluded.currency,billing_interval=excluded.billing_interval,
    seat_limit=excluded.seat_limit,features=excluded.features,is_active=excluded.is_active,updated_at=now();
  PERFORM public.append_owner_audit('billing.plan_saved','billing_plan',p_plan_key,
    jsonb_build_object('amount',p_amount,'currency',p_currency,'interval',p_interval,'active',p_is_active));
END $$;

CREATE OR REPLACE FUNCTION public.owner_save_subscription(
  p_tenant_id uuid, p_plan_key text, p_status text, p_billing_interval text,
  p_period_start date, p_period_end date, p_notes text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
DECLARE subscription_key uuid;
BEGIN
  IF NOT public.owner_can_provision() THEN RAISE EXCEPTION 'Provisioner role and MFA are required'; END IF;
  IF p_status NOT IN ('trialing','active','past_due','paused','cancelled') OR p_billing_interval NOT IN ('monthly','yearly') THEN RAISE EXCEPTION 'Subscription details are invalid'; END IF;
  IF p_period_start IS NOT NULL AND p_period_end IS NOT NULL AND p_period_end < p_period_start THEN RAISE EXCEPTION 'Period end must be after period start'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id=p_tenant_id) OR NOT EXISTS (SELECT 1 FROM public.billing_plans WHERE plan_key=p_plan_key AND is_active) THEN
    RAISE EXCEPTION 'Select an active billing plan and tenant';
  END IF;
  INSERT INTO public.tenant_subscriptions(tenant_id,plan_key,status,billing_interval,period_start,period_end,notes,updated_at)
    VALUES(p_tenant_id,p_plan_key,p_status,p_billing_interval,p_period_start,p_period_end,nullif(trim(p_notes),''),now())
  ON CONFLICT(tenant_id) DO UPDATE SET plan_key=excluded.plan_key,status=excluded.status,
    billing_interval=excluded.billing_interval,period_start=excluded.period_start,period_end=excluded.period_end,
    notes=excluded.notes,updated_at=now()
  RETURNING id INTO subscription_key;
  UPDATE public.tenants SET plan=p_plan_key,updated_at=now() WHERE id=p_tenant_id;
  PERFORM public.append_owner_audit('billing.subscription_saved','tenant',p_tenant_id::text,
    jsonb_build_object('plan',p_plan_key,'status',p_status));
  RETURN subscription_key;
END $$;

CREATE OR REPLACE FUNCTION public.owner_create_invoice(
  p_tenant_id uuid, p_currency text, p_subtotal numeric, p_tax numeric,
  p_due_at date, p_line_items jsonb, p_notes text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
DECLARE invoice_key uuid; invoice_no text;
BEGIN
  IF NOT public.owner_can_provision() THEN RAISE EXCEPTION 'Provisioner role and MFA are required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id=p_tenant_id) THEN RAISE EXCEPTION 'Tenant was not found'; END IF;
  IF p_currency !~ '^[A-Z]{3}$' OR p_subtotal < 0 OR p_tax < 0 OR jsonb_typeof(p_line_items) <> 'array' THEN RAISE EXCEPTION 'Invoice data is invalid'; END IF;
  invoice_no := 'INV-' || to_char(current_date,'YYYYMM') || '-' || lpad(nextval('public.owner_invoice_number_seq')::text,5,'0');
  INSERT INTO public.billing_invoices(tenant_id,invoice_number,currency,subtotal,tax,line_items,notes,due_at,created_by)
    VALUES(p_tenant_id,invoice_no,p_currency,p_subtotal,p_tax,p_line_items,nullif(trim(p_notes),''),p_due_at,auth.uid())
    RETURNING id INTO invoice_key;
  PERFORM public.append_owner_audit('billing.invoice_created','billing_invoice',invoice_key::text,
    jsonb_build_object('invoice_number',invoice_no,'tenant_id',p_tenant_id,'total',p_subtotal+p_tax));
  RETURN invoice_key;
END $$;

CREATE OR REPLACE FUNCTION public.owner_set_invoice_status(p_invoice_id uuid, p_status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
DECLARE old_status text;
BEGIN
  IF NOT public.owner_can_provision() THEN RAISE EXCEPTION 'Provisioner role and MFA are required'; END IF;
  IF p_status NOT IN ('open','paid','void') THEN RAISE EXCEPTION 'Invoice status is invalid'; END IF;
  SELECT status INTO old_status FROM public.billing_invoices WHERE id=p_invoice_id FOR UPDATE;
  IF old_status IS NULL THEN RAISE EXCEPTION 'Invoice was not found'; END IF;
  IF old_status='paid' OR old_status='void' THEN RAISE EXCEPTION 'A paid or void invoice cannot be changed'; END IF;
  UPDATE public.billing_invoices SET status=p_status,
    issued_at=CASE WHEN p_status='open' THEN coalesce(issued_at,now()) ELSE issued_at END,
    paid_at=CASE WHEN p_status='paid' THEN now() ELSE NULL END,updated_at=now()
  WHERE id=p_invoice_id;
  PERFORM public.append_owner_audit('billing.invoice_'||p_status,'billing_invoice',p_invoice_id::text,'{}'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.owner_send_tenant_message(
  p_tenant_id uuid, p_title text, p_body text, p_priority text, p_expires_at timestamptz
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
DECLARE message_key uuid;
BEGIN
  IF NOT public.owner_can_provision() THEN RAISE EXCEPTION 'Provisioner role and MFA are required'; END IF;
  IF length(trim(p_title)) NOT BETWEEN 2 AND 160 OR length(trim(p_body)) NOT BETWEEN 1 AND 5000 THEN RAISE EXCEPTION 'Message title or body is invalid'; END IF;
  IF p_priority NOT IN ('normal','important','urgent') THEN RAISE EXCEPTION 'Message priority is invalid'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id=p_tenant_id AND status='active') THEN RAISE EXCEPTION 'An active tenant is required'; END IF;
  INSERT INTO public.owner_inbox_messages(tenant_id,title,body,priority,expires_at,created_by)
    VALUES(p_tenant_id,trim(p_title),trim(p_body),p_priority,p_expires_at,auth.uid()) RETURNING id INTO message_key;
  PERFORM public.append_owner_audit('tenant.inbox_message_sent','tenant',p_tenant_id::text,
    jsonb_build_object('message_id',message_key,'priority',p_priority));
  RETURN message_key;
END $$;

CREATE OR REPLACE FUNCTION public.owner_archive_tenant_message(p_message_id uuid, p_is_active boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
BEGIN
  IF NOT public.owner_can_provision() THEN RAISE EXCEPTION 'Provisioner role and MFA are required'; END IF;
  UPDATE public.owner_inbox_messages SET is_active=p_is_active,archived_at=CASE WHEN p_is_active THEN NULL ELSE now() END
  WHERE id=p_message_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Inbox message was not found'; END IF;
  PERFORM public.append_owner_audit('tenant.inbox_message_toggled','inbox_message',p_message_id::text,
    jsonb_build_object('active',p_is_active));
END $$;

CREATE OR REPLACE FUNCTION public.owner_record_tenant_metric(
  p_tenant_id uuid, p_metric_key text, p_increment numeric
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
DECLARE window_start timestamptz := date_trunc('hour',now());
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Telemetry service access is required'; END IF;
  IF p_metric_key !~ '^page\.[a-z0-9_-]{1,40}$' OR p_increment <= 0 OR p_increment > 1000 THEN RAISE EXCEPTION 'Invalid aggregate metric'; END IF;
  INSERT INTO public.tenant_metrics(tenant_id,metric_key,metric_value,period_start,period_seconds)
  VALUES(p_tenant_id,p_metric_key,p_increment,window_start,3600)
  ON CONFLICT(tenant_id,metric_key,period_start) DO UPDATE
    SET metric_value=least(public.tenant_metrics.metric_value+excluded.metric_value,10000);
END $$;

CREATE OR REPLACE FUNCTION public.owner_inbox_mark_read(p_tenant_id uuid, p_message_id uuid, p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Tenant bridge service access is required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.owner_inbox_messages WHERE id=p_message_id AND tenant_id=p_tenant_id AND is_active) THEN
    RAISE EXCEPTION 'Inbox message is unavailable';
  END IF;
  INSERT INTO public.owner_inbox_reads(message_id,tenant_id,user_id,read_at)
    VALUES(p_message_id,p_tenant_id,p_user_id,now())
  ON CONFLICT(message_id,user_id) DO UPDATE SET read_at=excluded.read_at;
END $$;

CREATE OR REPLACE FUNCTION public.owner_save_meeting(
  p_meeting_id uuid, p_tenant_id uuid, p_title text, p_purpose text,
  p_starts_at timestamptz, p_ends_at timestamptz, p_timezone text,
  p_provider text, p_meeting_url text, p_attendee_name text, p_attendee_email text, p_agenda text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
DECLARE meeting_key uuid;
BEGIN
  IF NOT public.owner_can_provision() THEN RAISE EXCEPTION 'Provisioner role and MFA are required'; END IF;
  IF length(trim(p_title)) NOT BETWEEN 2 AND 160 OR p_purpose NOT IN ('onboarding','training','support','review','other') THEN RAISE EXCEPTION 'Meeting title or purpose is invalid'; END IF;
  IF p_ends_at <= p_starts_at THEN RAISE EXCEPTION 'Meeting end time must be after the start time'; END IF;
  IF p_timezone IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name=p_timezone) THEN RAISE EXCEPTION 'Choose a valid IANA timezone'; END IF;
  IF p_meeting_url IS NOT NULL AND p_meeting_url !~ '^https://[^[:space:]]+$' THEN RAISE EXCEPTION 'Meeting URL must use HTTPS'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id=p_tenant_id) THEN RAISE EXCEPTION 'Tenant was not found'; END IF;
  IF p_meeting_id IS NULL THEN
    INSERT INTO public.owner_meetings(tenant_id,title,purpose,starts_at,ends_at,timezone,provider,meeting_url,attendee_name,attendee_email,agenda,created_by)
      VALUES(p_tenant_id,trim(p_title),p_purpose,p_starts_at,p_ends_at,coalesce(nullif(trim(p_timezone),''),'Africa/Nairobi'),coalesce(nullif(trim(p_provider),''),'external'),nullif(trim(p_meeting_url),''),nullif(trim(p_attendee_name),''),lower(nullif(trim(p_attendee_email),'')),nullif(trim(p_agenda),''),auth.uid())
      RETURNING id INTO meeting_key;
  ELSE
    UPDATE public.owner_meetings SET tenant_id=p_tenant_id,title=trim(p_title),purpose=p_purpose,starts_at=p_starts_at,ends_at=p_ends_at,
      timezone=coalesce(nullif(trim(p_timezone),''),'Africa/Nairobi'),provider=coalesce(nullif(trim(p_provider),''),'external'),meeting_url=nullif(trim(p_meeting_url),''),
      attendee_name=nullif(trim(p_attendee_name),''),attendee_email=lower(nullif(trim(p_attendee_email),'')),agenda=nullif(trim(p_agenda),''),updated_at=now()
    WHERE id=p_meeting_id RETURNING id INTO meeting_key;
    IF NOT FOUND THEN RAISE EXCEPTION 'Meeting was not found'; END IF;
  END IF;
  PERFORM public.append_owner_audit('meeting.scheduled','owner_meeting',meeting_key::text,jsonb_build_object('tenant_id',p_tenant_id,'purpose',p_purpose));
  RETURN meeting_key;
END $$;

CREATE OR REPLACE FUNCTION public.owner_record_meeting_outcome(
  p_meeting_id uuid, p_status text, p_outcome text, p_follow_up_at timestamptz, p_follow_up_note text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
BEGIN
  IF NOT public.owner_can_provision() THEN RAISE EXCEPTION 'Provisioner role and MFA are required'; END IF;
  IF p_status NOT IN ('completed','cancelled','no_show') THEN RAISE EXCEPTION 'Select a valid meeting outcome status'; END IF;
  IF p_status='completed' AND length(trim(p_outcome)) NOT BETWEEN 1 AND 5000 THEN RAISE EXCEPTION 'Record the meeting outcome'; END IF;
  UPDATE public.owner_meetings SET status=p_status,outcome=nullif(trim(p_outcome),''),follow_up_at=p_follow_up_at,
    follow_up_note=nullif(trim(p_follow_up_note),''),outcome_recorded_at=now(),updated_at=now()
  WHERE id=p_meeting_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Meeting was not found'; END IF;
  PERFORM public.append_owner_audit('meeting.outcome_recorded','owner_meeting',p_meeting_id::text,
    jsonb_build_object('status',p_status,'follow_up_at',p_follow_up_at));
END $$;

REVOKE ALL ON FUNCTION public.owner_update_tenant(uuid,text,text,text,text,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.owner_set_platform_alert_status(uuid,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.owner_save_training_course(text,text,text,boolean,boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.owner_set_training_enrollment(uuid,text,text,integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.owner_set_support_ticket(uuid,text,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.owner_reply_support_ticket(uuid,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.owner_save_billing_plan(text,text,text,text,text,numeric,text,text,integer,jsonb,boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.owner_save_subscription(uuid,text,text,text,date,date,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.owner_create_invoice(uuid,text,numeric,numeric,date,jsonb,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.owner_set_invoice_status(uuid,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.owner_send_tenant_message(uuid,text,text,text,timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.owner_archive_tenant_message(uuid,boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.owner_record_tenant_metric(uuid,text,numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.owner_inbox_mark_read(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.owner_save_meeting(uuid,uuid,text,text,timestamptz,timestamptz,text,text,text,text,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.owner_record_meeting_outcome(uuid,text,text,timestamptz,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_update_tenant(uuid,text,text,text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_set_platform_alert_status(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_save_training_course(text,text,text,boolean,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_set_training_enrollment(uuid,text,text,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_set_support_ticket(uuid,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_reply_support_ticket(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_save_billing_plan(text,text,text,text,text,numeric,text,text,integer,jsonb,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_save_subscription(uuid,text,text,text,date,date,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_create_invoice(uuid,text,numeric,numeric,date,jsonb,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_set_invoice_status(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_send_tenant_message(uuid,text,text,text,timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_archive_tenant_message(uuid,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_record_tenant_metric(uuid,text,numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.owner_inbox_mark_read(uuid,uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.owner_save_meeting(uuid,uuid,text,text,timestamptz,timestamptz,text,text,text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_record_meeting_outcome(uuid,text,text,timestamptz,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.audit_owner_operations_row()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE target_id text;
BEGIN
  target_id := coalesce(to_jsonb(NEW)->>'id',to_jsonb(OLD)->>'id',to_jsonb(NEW)->>'tenant_id',to_jsonb(OLD)->>'tenant_id');
  PERFORM public.append_owner_audit('owner_data.'||lower(tg_op)||'.'||tg_table_name,tg_table_name,target_id,'{}'::jsonb);
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'billing_plans','tenant_subscriptions','billing_invoices','owner_inbox_messages',
    'training_courses','support_ticket_messages','owner_meetings'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS owner_operations_audit ON public.%I',table_name);
    EXECUTE format('CREATE TRIGGER owner_operations_audit AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_owner_operations_row()',table_name);
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS owner_operations_audit ON public.support_tickets;
CREATE TRIGGER owner_operations_audit AFTER INSERT OR UPDATE OR DELETE ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.audit_owner_operations_row();

COMMENT ON TABLE public.billing_invoices IS 'Invoice ledger only. Payment collection is not enabled until a provider is configured.';
COMMENT ON TABLE public.tenant_metrics IS 'Aggregate utilization and technical metrics only; never store tenant business or personal data.';
