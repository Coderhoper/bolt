-- Tenant staff access, live data refresh, employee identity documents and audit attribution.

-- Keep the tenant administrator separate from the limited staff role. Existing
-- read-only tenant members become users; Auth profiles remain shared identities.
DROP TRIGGER IF EXISTS audit_tenant_memberships ON public.tenant_memberships;
ALTER TABLE public.tenant_memberships DROP CONSTRAINT IF EXISTS tenant_memberships_role_check;
UPDATE public.tenant_memberships SET role = 'user' WHERE role = 'owner';
ALTER TABLE public.tenant_memberships
  ADD CONSTRAINT tenant_memberships_role_check CHECK (role IN ('admin', 'user'));

CREATE OR REPLACE FUNCTION public.enforce_tenant_user_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE active_users integer;
BEGIN
  IF NEW.role <> 'user' OR NEW.status <> 'active' THEN RETURN NEW; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text, 705414));
  IF TG_OP = 'UPDATE' AND OLD.role = 'user' AND OLD.status = 'active' THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO active_users
  FROM public.tenant_memberships membership
  WHERE membership.tenant_id = NEW.tenant_id
    AND membership.role = 'user'
    AND membership.status = 'active'
    AND membership.user_id <> NEW.user_id;

  IF active_users >= 5 THEN
    RAISE EXCEPTION 'This tenant already has five active users' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_tenant_user_limit() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS tenant_memberships_user_limit ON public.tenant_memberships;
CREATE TRIGGER tenant_memberships_user_limit
  BEFORE INSERT OR UPDATE OF role, status ON public.tenant_memberships
  FOR EACH ROW EXECUTE FUNCTION public.enforce_tenant_user_limit();

CREATE OR REPLACE FUNCTION public.admin_add_tenant_user(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE tenant_key uuid := public.current_tenant_id();
BEGIN
  IF tenant_key IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Tenant administrator access required' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id AND status = 'active') THEN
    RAISE EXCEPTION 'An active account is required';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tenant_memberships
    WHERE tenant_id = tenant_key AND user_id = p_user_id AND role = 'admin') THEN
    RAISE EXCEPTION 'An administrator account cannot be reassigned as a user';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(tenant_key::text, 705414));
  IF NOT EXISTS (SELECT 1 FROM public.tenant_memberships
    WHERE tenant_id = tenant_key AND user_id = p_user_id AND role = 'user' AND status = 'active')
    AND (SELECT count(*) FROM public.tenant_memberships
      WHERE tenant_id = tenant_key AND role = 'user' AND status = 'active') >= 5 THEN
    RAISE EXCEPTION 'This tenant already has five active users' USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.tenant_memberships(tenant_id, user_id, role, status)
  VALUES (tenant_key, p_user_id, 'user', 'active')
  ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = 'user', status = 'active';
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_tenant_user_status(p_user_id uuid, p_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE tenant_key uuid := public.current_tenant_id();
BEGIN
  IF tenant_key IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Tenant administrator access required' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('active', 'inactive') THEN RAISE EXCEPTION 'Invalid user status'; END IF;
  IF p_user_id = auth.uid() AND p_status = 'inactive' THEN
    RAISE EXCEPTION 'You cannot deactivate your own account';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenant_memberships
    WHERE tenant_id = tenant_key AND user_id = p_user_id AND role = 'user') THEN
    RAISE EXCEPTION 'The selected user is not a staff member';
  END IF;
  UPDATE public.tenant_memberships SET status = p_status
  WHERE tenant_id = tenant_key AND user_id = p_user_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_add_tenant_user(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_tenant_user_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_add_tenant_user(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_tenant_user_status(uuid, text) TO authenticated;

-- Staff can create sales only through the validated transaction RPC. All other
-- writes remain administrator-only under the existing RLS policies/functions.
CREATE OR REPLACE FUNCTION public.process_sale(
  p_sale_items jsonb,
  p_customer_name text DEFAULT NULL,
  p_payment_method text DEFAULT 'cash',
  p_note text DEFAULT NULL,
  p_sale_date date DEFAULT CURRENT_DATE
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NOT public.is_admin() AND NOT (
    public.current_tenant_id() IS NOT NULL AND public.current_user_role() = 'user'
  ) THEN
    RAISE EXCEPTION 'Sales access required' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_sale_items) <> 'array' OR jsonb_array_length(p_sale_items) = 0 THEN
    RAISE EXCEPTION 'At least one sale item is required';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_sale_items) item
    WHERE COALESCE((item->>'quantity')::numeric, 0) <= 0) THEN
    RAISE EXCEPTION 'Sale quantities must be positive';
  END IF;
  RETURN public.process_sale_unchecked(p_sale_items, p_customer_name, p_payment_method, p_note, p_sale_date);
END;
$$;
REVOKE ALL ON FUNCTION public.process_sale(jsonb, text, text, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_sale(jsonb, text, text, text, date) TO authenticated;

-- Attribute database-triggered audit rows to the actor's display name and keep
-- private identity, salary and customer values out of audit snapshots.
CREATE OR REPLACE FUNCTION public.redact_audit_snapshot(p_snapshot jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT COALESCE(jsonb_object_agg(entry.key, entry.value), '{}'::jsonb)
  FROM jsonb_each(COALESCE(p_snapshot, '{}'::jsonb)) AS entry
  WHERE entry.key !~* '(^|_)(name|email|phone|mobile|address|national.?id|salary|wage|pay|allowance|deduction|emergency|bank|account_number|id_document|passport|birth|ssn)(_|$)'
    AND entry.key <> 'business_name';
$$;
REVOKE ALL ON FUNCTION public.redact_audit_snapshot(jsonb) FROM PUBLIC, anon, authenticated;

UPDATE public.audit_logs
SET old_values = public.redact_audit_snapshot(old_values),
    new_values = public.redact_audit_snapshot(new_values)
WHERE old_values IS NOT NULL OR new_values IS NOT NULL;

CREATE OR REPLACE FUNCTION public.write_audit_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  old_row jsonb;
  new_row jsonb;
  record_id uuid;
  actor_id uuid := auth.uid();
  actor_name text;
  owner_tenant uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_row := public.redact_audit_snapshot(to_jsonb(OLD)); END IF;
  IF TG_OP <> 'DELETE' THEN new_row := public.redact_audit_snapshot(to_jsonb(NEW)); END IF;
  record_id := COALESCE(
    (new_row->>'id')::uuid, (old_row->>'id')::uuid,
    (new_row->>'user_id')::uuid, (old_row->>'user_id')::uuid
  );
  owner_tenant := COALESCE((new_row->>'tenant_id')::uuid, (old_row->>'tenant_id')::uuid,
                           public.current_tenant_id());
  IF owner_tenant IS NULL THEN RETURN NULL; END IF;

  SELECT COALESCE(NULLIF(btrim(profile.name), ''), NULLIF(account.email, ''), 'System')
    INTO actor_name
  FROM (SELECT actor_id AS id) actor
  LEFT JOIN auth.users account ON account.id = actor.id
  LEFT JOIN public.profiles profile ON profile.id = actor.id;
  actor_name := COALESCE(actor_name, 'System');

  INSERT INTO public.audit_logs(tenant_id, user_id, user_name, action, entity_type, entity_id,
    old_values, new_values, description)
  VALUES (owner_tenant, actor_id, actor_name, TG_OP || '_' || upper(TG_TABLE_NAME),
    TG_TABLE_NAME, record_id, old_row, new_row, TG_OP || ' ' || TG_TABLE_NAME);
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.write_audit_log() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER audit_tenant_memberships
  AFTER INSERT OR UPDATE OR DELETE ON public.tenant_memberships
  FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();
REVOKE INSERT, UPDATE, DELETE ON public.audit_logs FROM authenticated;

-- Employee email plus private front/back identity image object paths.
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS id_document_front_path text;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS id_document_back_path text;

-- Preserve the admin-only direct table access while allowing staff to use the
-- masked directory view for non-sensitive employee details.
GRANT SELECT ON public.employees TO authenticated;
DROP POLICY IF EXISTS "salary_records_select" ON public.salary_records;
DROP POLICY IF EXISTS salary_records_select ON public.salary_records;
CREATE POLICY salary_records_select ON public.salary_records FOR SELECT TO authenticated
  USING (public.is_admin());
CREATE OR REPLACE VIEW public.employee_directory AS
SELECT e.id, e.full_name,
       CASE WHEN e.national_id IS NULL THEN NULL
            WHEN length(regexp_replace(e.national_id, '\s', '', 'g')) <= 4 THEN '****'
            ELSE repeat('*', greatest(length(regexp_replace(e.national_id, '\s', '', 'g')) - 4, 0))
                 || right(regexp_replace(e.national_id, '\s', '', 'g'), 4) END AS national_id,
       CASE WHEN public.is_admin() THEN e.phone
            WHEN e.phone IS NULL THEN NULL
            ELSE '••••' || right(regexp_replace(e.phone, '\D', '', 'g'), 4) END AS phone,
       CASE WHEN public.is_admin() THEN e.address ELSE NULL END AS address,
       e.position, e.date_employed,
       CASE WHEN public.is_admin() THEN e.basic_salary ELSE NULL END AS basic_salary,
       e.employment_status,
       CASE WHEN public.is_admin() THEN e.emergency_contact ELSE NULL END AS emergency_contact,
       e.created_at, e.updated_at,
       CASE WHEN public.is_admin() OR e.email IS NULL THEN e.email
            ELSE left(split_part(e.email, '@', 1), 1) || '***@' || split_part(e.email, '@', 2) END AS email
FROM public.employees e
WHERE e.tenant_id = public.current_tenant_id() AND public.is_active_user();
REVOKE SELECT ON public.employee_directory FROM anon;
GRANT SELECT ON public.employee_directory TO authenticated;

CREATE OR REPLACE FUNCTION public.reject_duplicate_employee_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  tenant_key uuid := COALESCE(NEW.tenant_id, public.current_tenant_id());
  duplicate_kind text;
  new_email text := NULLIF(lower(btrim(NEW.email)), '');
  new_phone text := NULLIF(regexp_replace(NEW.phone, '\D', '', 'g'), '');
  new_national_id text := NULLIF(upper(regexp_replace(NEW.national_id, '[^[:alnum:]]', '', 'g')), '');
BEGIN
  IF tenant_key IS NULL THEN RETURN NEW; END IF;
  NEW.email := NULLIF(lower(btrim(NEW.email)), '');
  NEW.phone := NULLIF(btrim(NEW.phone), '');
  NEW.national_id := NULLIF(upper(btrim(NEW.national_id)), '');
  IF NULLIF(btrim(NEW.email), '') IS NOT NULL
    AND btrim(NEW.email) !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' THEN
    RAISE EXCEPTION 'Enter a valid employee email address';
  END IF;
  IF TG_OP = 'UPDATE'
     AND new_email IS NOT DISTINCT FROM NULLIF(lower(btrim(OLD.email)), '')
     AND new_phone IS NOT DISTINCT FROM NULLIF(regexp_replace(OLD.phone, '\D', '', 'g'), '')
     AND new_national_id IS NOT DISTINCT FROM NULLIF(upper(regexp_replace(OLD.national_id, '[^[:alnum:]]', '', 'g')), '') THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(tenant_key::text, 705415));
  SELECT CASE
    WHEN new_email IS NOT NULL AND lower(btrim(other.email)) = new_email THEN 'email'
    WHEN new_national_id IS NOT NULL
      AND upper(regexp_replace(other.national_id, '[^[:alnum:]]', '', 'g')) = new_national_id THEN 'national ID'
    WHEN new_phone IS NOT NULL AND regexp_replace(other.phone, '\D', '', 'g') = new_phone THEN 'phone number'
    WHEN new_phone IS NOT NULL AND length(new_phone) >= 9
      AND length(regexp_replace(other.phone, '\D', '', 'g')) >= 9
      AND right(regexp_replace(other.phone, '\D', '', 'g'), 9) = right(new_phone, 9) THEN 'phone number'
  END INTO duplicate_kind
  FROM public.employees other
  WHERE other.tenant_id = tenant_key AND other.id IS DISTINCT FROM NEW.id
    AND ((new_email IS NOT NULL AND lower(btrim(other.email)) = new_email)
      OR (new_national_id IS NOT NULL
        AND upper(regexp_replace(other.national_id, '[^[:alnum:]]', '', 'g')) = new_national_id)
      OR (new_phone IS NOT NULL AND (
        regexp_replace(other.phone, '\D', '', 'g') = new_phone
        OR (length(new_phone) >= 9 AND length(regexp_replace(other.phone, '\D', '', 'g')) >= 9
          AND right(regexp_replace(other.phone, '\D', '', 'g'), 9) = right(new_phone, 9))
      )))
  LIMIT 1;

  IF duplicate_kind IS NOT NULL THEN
    RAISE EXCEPTION 'Another employee already uses this %', duplicate_kind USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.reject_duplicate_employee_identity() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS employees_reject_duplicate_identity ON public.employees;
CREATE TRIGGER employees_reject_duplicate_identity
  BEFORE INSERT OR UPDATE OF email, phone, national_id ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.reject_duplicate_employee_identity();

-- Private identity documents are restricted to tenant administrators and use
-- tenant/employee/front and tenant/employee/back object paths.
INSERT INTO storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
VALUES ('employee-id-documents', 'employee-id-documents', false, 5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET
  public = false, file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

DROP POLICY IF EXISTS employee_id_documents_select ON storage.objects;
CREATE POLICY employee_id_documents_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'employee-id-documents' AND public.is_admin()
    AND (storage.foldername(name))[1] = COALESCE(public.current_tenant_id()::text, 'legacy'));
DROP POLICY IF EXISTS employee_id_documents_insert ON storage.objects;
CREATE POLICY employee_id_documents_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'employee-id-documents' AND public.is_admin()
    AND (storage.foldername(name))[1] = COALESCE(public.current_tenant_id()::text, 'legacy'));
DROP POLICY IF EXISTS employee_id_documents_update ON storage.objects;
CREATE POLICY employee_id_documents_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'employee-id-documents' AND public.is_admin()
    AND (storage.foldername(name))[1] = COALESCE(public.current_tenant_id()::text, 'legacy'))
  WITH CHECK (bucket_id = 'employee-id-documents' AND public.is_admin()
    AND (storage.foldername(name))[1] = COALESCE(public.current_tenant_id()::text, 'legacy'));
DROP POLICY IF EXISTS employee_id_documents_delete ON storage.objects;
CREATE POLICY employee_id_documents_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'employee-id-documents' AND public.is_admin()
    AND (storage.foldername(name))[1] = COALESCE(public.current_tenant_id()::text, 'legacy'));

-- Broadcast only a small invalidation signal. The client reloads records through
-- its tenant-scoped REST API, so private row data is never sent in the channel.
CREATE OR REPLACE FUNCTION public.broadcast_tenant_data_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  tenant_key uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    tenant_key := OLD.tenant_id;
  ELSE
    tenant_key := NEW.tenant_id;
  END IF;

  IF tenant_key IS NOT NULL THEN
    PERFORM realtime.send(
      jsonb_build_object('table', TG_TABLE_NAME, 'operation', TG_OP),
      'tenant-data-changed',
      'tenant:' || tenant_key::text,
      true
    );
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.broadcast_tenant_data_change() FROM PUBLIC, anon, authenticated;

-- Channel authorization is based on membership, not on a client-supplied
-- tenant header. A definer helper reads the membership tables, which are not
-- directly readable by authenticated users.
CREATE OR REPLACE FUNCTION public.can_receive_tenant_broadcast()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.tenant_memberships membership
    JOIN public.business_tenants tenant ON tenant.id = membership.tenant_id
    WHERE 'tenant:' || membership.tenant_id::text = realtime.topic()
      AND membership.user_id = auth.uid()
      AND membership.status = 'active'
      AND tenant.status = 'active'
  );
$$;
REVOKE ALL ON FUNCTION public.can_receive_tenant_broadcast() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_receive_tenant_broadcast() TO authenticated;

-- The restrictive policy also prevents a broader permissive policy on
-- realtime.messages from granting cross-tenant channel access.
DROP POLICY IF EXISTS tenant_channel_select ON realtime.messages;
CREATE POLICY tenant_channel_select ON realtime.messages
  FOR SELECT TO authenticated
  USING (public.can_receive_tenant_broadcast());
DROP POLICY IF EXISTS tenant_channel_select_guard ON realtime.messages;
CREATE POLICY tenant_channel_select_guard ON realtime.messages
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (realtime.topic() ~ '^tenant:[0-9a-fA-F-]{36}$'
    AND public.can_receive_tenant_broadcast());

-- Install invalidation triggers on the tenant's application data tables.
DO $$
DECLARE tenant_table text;
BEGIN
  FOREACH tenant_table IN ARRAY ARRAY[
    'tenant_memberships',
    'categories', 'subcategories', 'suppliers', 'supplier_products', 'products',
    'product_variants', 'stock_movements', 'purchases', 'purchase_items', 'sales',
    'sale_items', 'expenses', 'employees', 'salary_records', 'profit_targets',
    'audit_logs', 'system_settings', 'supplier_purchase_orders',
    'supplier_purchase_order_lines', 'supplier_asns', 'supplier_asn_lines',
    'receiving_documents', 'receiving_document_lines', 'automation_jobs',
    'automation_events', 'system_notifications', 'anomaly_flags', 'reconciliation_runs',
    'inbound_channel_routes', 'inbound_sender_allowlist', 'automation_settings',
    'supplier_scorecards'
  ] LOOP
    IF to_regclass(format('public.%I', tenant_table)) IS NOT NULL
      AND EXISTS (SELECT 1 FROM information_schema.columns column_info
        WHERE column_info.table_schema = 'public' AND column_info.table_name = tenant_table AND column_info.column_name = 'tenant_id') THEN
      EXECUTE format('DROP TRIGGER IF EXISTS tenant_data_broadcast ON public.%I', tenant_table);
      EXECUTE format('CREATE TRIGGER tenant_data_broadcast AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.broadcast_tenant_data_change()', tenant_table);
    END IF;
  END LOOP;
END;
$$;
