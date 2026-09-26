-- Shared database tenancy for the tenant application.
-- This migration is applied to a clean, dedicated shared tenant project.
-- The existing general-management project is not modified or backfilled.

CREATE TABLE IF NOT EXISTS public.business_tenants (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tenant_memberships (
  tenant_id uuid NOT NULL REFERENCES public.business_tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('admin', 'owner')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);

ALTER TABLE public.business_tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_memberships ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.business_tenants, public.tenant_memberships FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  requested_tenant uuid;
  header_value text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;
  header_value := current_setting('request.headers', true)::jsonb ->> 'x-tenant-id';
  IF header_value IS NULL OR header_value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN NULL;
  END IF;
  requested_tenant := header_value::uuid;
  IF EXISTS (
    SELECT 1
    FROM public.tenant_memberships m
    JOIN public.business_tenants t ON t.id = m.tenant_id
    WHERE m.tenant_id = requested_tenant
      AND m.user_id = auth.uid()
      AND m.status = 'active'
      AND t.status = 'active'
  ) THEN
    RETURN requested_tenant;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT m.role
  FROM public.tenant_memberships m
  WHERE m.tenant_id = public.current_tenant_id()
    AND m.user_id = auth.uid()
    AND m.status = 'active'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_active_user()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, auth
AS $$ SELECT public.current_tenant_id() IS NOT NULL; $$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, auth
AS $$ SELECT COALESCE(public.current_user_role(), '') = 'admin'; $$;

CREATE OR REPLACE FUNCTION public.get_current_tenant_membership()
RETURNS TABLE(role text, status text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT m.role, m.status
  FROM public.tenant_memberships m
  WHERE m.tenant_id = public.current_tenant_id()
    AND m.user_id = auth.uid()
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.current_tenant_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_current_tenant_membership() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_tenant_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_current_tenant_membership() TO authenticated;

-- Profiles represent a shared Auth identity. Business permissions live in the
-- membership table, so profile reads are limited to the signed-in user.
DROP POLICY IF EXISTS profiles_select ON public.profiles;
DROP POLICY IF EXISTS "profiles_select" ON public.profiles;
CREATE POLICY profiles_select ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid());
DROP POLICY IF EXISTS profiles_insert ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert" ON public.profiles;
DROP POLICY IF EXISTS profiles_update ON public.profiles;
DROP POLICY IF EXISTS "profiles_update" ON public.profiles;
DROP POLICY IF EXISTS profiles_delete ON public.profiles;
DROP POLICY IF EXISTS "profiles_delete" ON public.profiles;
REVOKE INSERT, UPDATE, DELETE ON public.profiles FROM authenticated;

-- New users no longer receive a platform-wide admin role from user metadata.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  INSERT INTO public.profiles (id, name, role, status)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'name', split_part(NEW.email, '@', 1)),
    'owner',
    'active'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_enforce_owner_limit ON public.profiles;
REVOKE ALL ON FUNCTION public.enforce_owner_limit() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  table_name text;
  has_unassigned_rows boolean;
  table_names text[] := ARRAY[
    'categories', 'subcategories', 'suppliers', 'products', 'product_variants',
    'stock_movements', 'purchases', 'purchase_items', 'sales', 'sale_items',
    'expenses', 'employees', 'salary_records', 'profit_targets', 'audit_logs',
    'system_settings'
  ];
BEGIN
  -- Suppress historical audit triggers while installing tenant ownership.
  FOREACH table_name IN ARRAY table_names LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS audit_%I ON public.%I', table_name, table_name);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS tenant_id uuid', table_name);
    IF table_name = 'system_settings' THEN
      -- The original core migration inserts this generic placeholder row.
      -- Remove only its untouched default; customized rows require a clean project.
      DELETE FROM public.system_settings
      WHERE business_name = 'My Business'
        AND business_address IS NULL AND business_phone IS NULL AND business_email IS NULL
        AND currency = 'KSh' AND email_recipients = '[]'::jsonb
        AND weekly_report_day = 1 AND weekly_report_enabled = false
        AND monthly_report_enabled = false;
    END IF;
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I WHERE tenant_id IS NULL)', table_name)
      INTO has_unassigned_rows;
    IF has_unassigned_rows THEN
      RAISE EXCEPTION 'Table public.% contains business rows; onboard on a clean shared tenant project instead', table_name;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = table_name || '_tenant_id_fk'
        AND conrelid = format('public.%I', table_name)::regclass
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (tenant_id) REFERENCES public.business_tenants(id) NOT VALID',
        table_name, table_name || '_tenant_id_fk'
      );
    END IF;
    EXECUTE format(
      'ALTER TABLE public.%I ALTER COLUMN tenant_id SET DEFAULT public.current_tenant_id()',
      table_name
    );
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN tenant_id SET NOT NULL', table_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I(tenant_id)',
      'idx_' || table_name || '_tenant_id', table_name);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_scope_restrictive ON public.%I', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_scope_restrictive ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (tenant_id = public.current_tenant_id() AND public.is_active_user()) WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_active_user())',
      table_name
    );
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', table_name);
  END LOOP;

  -- Restore the audit triggers after tenant ownership columns are in place.
  FOREACH table_name IN ARRAY ARRAY[
    'products', 'stock_movements', 'purchases', 'purchase_items', 'sales', 'sale_items',
    'expenses', 'employees', 'salary_records', 'profit_targets', 'suppliers',
    'product_variants', 'categories', 'subcategories', 'system_settings'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER audit_%I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.write_audit_log()',
      table_name, table_name
    );
  END LOOP;
END;
$$;

ALTER TABLE public.categories VALIDATE CONSTRAINT categories_tenant_id_fk;
ALTER TABLE public.subcategories VALIDATE CONSTRAINT subcategories_tenant_id_fk;
ALTER TABLE public.suppliers VALIDATE CONSTRAINT suppliers_tenant_id_fk;
ALTER TABLE public.products VALIDATE CONSTRAINT products_tenant_id_fk;
ALTER TABLE public.product_variants VALIDATE CONSTRAINT product_variants_tenant_id_fk;
ALTER TABLE public.stock_movements VALIDATE CONSTRAINT stock_movements_tenant_id_fk;
ALTER TABLE public.purchases VALIDATE CONSTRAINT purchases_tenant_id_fk;
ALTER TABLE public.purchase_items VALIDATE CONSTRAINT purchase_items_tenant_id_fk;
ALTER TABLE public.sales VALIDATE CONSTRAINT sales_tenant_id_fk;
ALTER TABLE public.sale_items VALIDATE CONSTRAINT sale_items_tenant_id_fk;
ALTER TABLE public.expenses VALIDATE CONSTRAINT expenses_tenant_id_fk;
ALTER TABLE public.employees VALIDATE CONSTRAINT employees_tenant_id_fk;
ALTER TABLE public.salary_records VALIDATE CONSTRAINT salary_records_tenant_id_fk;
ALTER TABLE public.profit_targets VALIDATE CONSTRAINT profit_targets_tenant_id_fk;
ALTER TABLE public.audit_logs VALIDATE CONSTRAINT audit_logs_tenant_id_fk;
ALTER TABLE public.system_settings VALIDATE CONSTRAINT system_settings_tenant_id_fk;

-- Each parent can now be referenced only by a row from the same tenant.
CREATE UNIQUE INDEX IF NOT EXISTS categories_tenant_id_id_key ON public.categories(tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS subcategories_tenant_id_id_key ON public.subcategories(tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS suppliers_tenant_id_id_key ON public.suppliers(tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS products_tenant_id_id_key ON public.products(tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS product_variants_tenant_id_id_key ON public.product_variants(tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS purchases_tenant_id_id_key ON public.purchases(tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS sales_tenant_id_id_key ON public.sales(tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS employees_tenant_id_id_key ON public.employees(tenant_id, id);

DROP INDEX IF EXISTS public.idx_profit_targets_unique;
CREATE UNIQUE INDEX IF NOT EXISTS idx_profit_targets_unique
  ON public.profit_targets(tenant_id, target_year, target_month);
DROP INDEX IF EXISTS public.products_catalog_variant_unique;
CREATE UNIQUE INDEX IF NOT EXISTS products_catalog_variant_unique
  ON public.products(tenant_id, catalog_variant_id) WHERE catalog_variant_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS system_settings_tenant_unique
  ON public.system_settings(tenant_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subcategories_tenant_category_fk') THEN
    ALTER TABLE public.subcategories ADD CONSTRAINT subcategories_tenant_category_fk
      FOREIGN KEY (tenant_id, category_id) REFERENCES public.categories(tenant_id, id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_tenant_category_fk') THEN
    ALTER TABLE public.products ADD CONSTRAINT products_tenant_category_fk
      FOREIGN KEY (tenant_id, category_id) REFERENCES public.categories(tenant_id, id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_tenant_subcategory_fk') THEN
    ALTER TABLE public.products ADD CONSTRAINT products_tenant_subcategory_fk
      FOREIGN KEY (tenant_id, subcategory_id) REFERENCES public.subcategories(tenant_id, id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_tenant_supplier_fk') THEN
    ALTER TABLE public.products ADD CONSTRAINT products_tenant_supplier_fk
      FOREIGN KEY (tenant_id, supplier_id) REFERENCES public.suppliers(tenant_id, id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_variants_tenant_product_fk') THEN
    ALTER TABLE public.product_variants ADD CONSTRAINT product_variants_tenant_product_fk
      FOREIGN KEY (tenant_id, product_id) REFERENCES public.products(tenant_id, id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_movements_tenant_product_fk') THEN
    ALTER TABLE public.stock_movements ADD CONSTRAINT stock_movements_tenant_product_fk
      FOREIGN KEY (tenant_id, product_id) REFERENCES public.products(tenant_id, id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_movements_tenant_variant_fk') THEN
    ALTER TABLE public.stock_movements ADD CONSTRAINT stock_movements_tenant_variant_fk
      FOREIGN KEY (tenant_id, product_variant_id) REFERENCES public.product_variants(tenant_id, id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchases_tenant_supplier_fk') THEN
    ALTER TABLE public.purchases ADD CONSTRAINT purchases_tenant_supplier_fk
      FOREIGN KEY (tenant_id, supplier_id) REFERENCES public.suppliers(tenant_id, id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_items_tenant_purchase_fk') THEN
    ALTER TABLE public.purchase_items ADD CONSTRAINT purchase_items_tenant_purchase_fk
      FOREIGN KEY (tenant_id, purchase_id) REFERENCES public.purchases(tenant_id, id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_items_tenant_product_fk') THEN
    ALTER TABLE public.purchase_items ADD CONSTRAINT purchase_items_tenant_product_fk
      FOREIGN KEY (tenant_id, product_id) REFERENCES public.products(tenant_id, id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sale_items_tenant_sale_fk') THEN
    ALTER TABLE public.sale_items ADD CONSTRAINT sale_items_tenant_sale_fk
      FOREIGN KEY (tenant_id, sale_id) REFERENCES public.sales(tenant_id, id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sale_items_tenant_product_fk') THEN
    ALTER TABLE public.sale_items ADD CONSTRAINT sale_items_tenant_product_fk
      FOREIGN KEY (tenant_id, product_id) REFERENCES public.products(tenant_id, id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sale_items_tenant_variant_fk') THEN
    ALTER TABLE public.sale_items ADD CONSTRAINT sale_items_tenant_variant_fk
      FOREIGN KEY (tenant_id, product_variant_id) REFERENCES public.product_variants(tenant_id, id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'salary_records_tenant_employee_fk') THEN
    ALTER TABLE public.salary_records ADD CONSTRAINT salary_records_tenant_employee_fk
      FOREIGN KEY (tenant_id, employee_id) REFERENCES public.employees(tenant_id, id) NOT VALID;
  END IF;
END;
$$;

ALTER TABLE public.subcategories VALIDATE CONSTRAINT subcategories_tenant_category_fk;
ALTER TABLE public.products VALIDATE CONSTRAINT products_tenant_category_fk;
ALTER TABLE public.products VALIDATE CONSTRAINT products_tenant_subcategory_fk;
ALTER TABLE public.products VALIDATE CONSTRAINT products_tenant_supplier_fk;
ALTER TABLE public.product_variants VALIDATE CONSTRAINT product_variants_tenant_product_fk;
ALTER TABLE public.stock_movements VALIDATE CONSTRAINT stock_movements_tenant_product_fk;
ALTER TABLE public.stock_movements VALIDATE CONSTRAINT stock_movements_tenant_variant_fk;
ALTER TABLE public.purchases VALIDATE CONSTRAINT purchases_tenant_supplier_fk;
ALTER TABLE public.purchase_items VALIDATE CONSTRAINT purchase_items_tenant_purchase_fk;
ALTER TABLE public.purchase_items VALIDATE CONSTRAINT purchase_items_tenant_product_fk;
ALTER TABLE public.sale_items VALIDATE CONSTRAINT sale_items_tenant_sale_fk;
ALTER TABLE public.sale_items VALIDATE CONSTRAINT sale_items_tenant_product_fk;
ALTER TABLE public.sale_items VALIDATE CONSTRAINT sale_items_tenant_variant_fk;
ALTER TABLE public.salary_records VALIDATE CONSTRAINT salary_records_tenant_employee_fk;

CREATE OR REPLACE FUNCTION public.enforce_tenant_row_scope()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE selected_tenant uuid;
BEGIN
  -- Trusted migrations and service-role maintenance may manage tenant routing.
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  selected_tenant := public.current_tenant_id();
  IF selected_tenant IS NULL THEN RAISE EXCEPTION 'Active tenant membership required'; END IF;
  IF NEW.tenant_id IS NULL THEN NEW.tenant_id := selected_tenant; END IF;
  IF NEW.tenant_id <> selected_tenant THEN
    RAISE EXCEPTION 'The selected tenant does not match this request';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.tenant_id IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'Tenant ownership cannot be changed';
  END IF;
  RETURN NEW;
END;
$$;
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'categories', 'subcategories', 'suppliers', 'products', 'product_variants',
    'stock_movements', 'purchases', 'purchase_items', 'sales', 'sale_items',
    'expenses', 'employees', 'salary_records', 'profit_targets', 'audit_logs',
    'system_settings'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS enforce_tenant_row_scope ON public.%I', table_name);
    EXECUTE format(
      'CREATE TRIGGER enforce_tenant_row_scope BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.enforce_tenant_row_scope()',
      table_name
    );
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_tenant_row_scope() FROM PUBLIC, anon, authenticated;

-- Profile roles are global; tenant roles must be read from memberships.
CREATE OR REPLACE VIEW public.employee_directory AS
SELECT e.id, e.full_name,
       CASE WHEN e.national_id IS NULL THEN NULL
            WHEN length(e.national_id) <= 4 THEN '****'
            ELSE repeat('*', length(e.national_id) - 4) || right(e.national_id, 4) END AS national_id,
       e.phone, e.address, e.position, e.date_employed, e.basic_salary,
       e.employment_status, e.emergency_contact, e.created_at, e.updated_at
FROM public.employees e
WHERE e.tenant_id = public.current_tenant_id()
  AND public.is_active_user();
REVOKE SELECT ON public.employees FROM authenticated;
GRANT SELECT ON public.employee_directory TO authenticated;

-- Security-definer report bypasses table RLS, so it must filter explicitly.
CREATE OR REPLACE FUNCTION public.get_dashboard_summary(p_start_date date DEFAULT NULL, p_end_date date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  tenant_key uuid := public.current_tenant_id();
  v_start date := COALESCE(p_start_date, date_trunc('month', CURRENT_DATE)::date);
  v_end date := COALESCE(p_end_date, CURRENT_DATE);
  v_total_sales numeric;
  v_total_purchases numeric;
  v_total_expenses numeric;
  v_total_cogs numeric;
  v_gross_profit numeric;
  v_net_profit numeric;
  v_stock_value numeric;
  v_low_stock_count integer;
  v_total_products integer;
  v_total_employees integer;
  v_monthly_expected numeric;
  v_deficit numeric;
BEGIN
  IF tenant_key IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Active tenant membership required';
  END IF;
  SELECT COALESCE(SUM(total_amount), 0) INTO v_total_sales
    FROM public.sales WHERE tenant_id = tenant_key AND sale_date BETWEEN v_start AND v_end;
  SELECT COALESCE(SUM(total_amount), 0) INTO v_total_purchases
    FROM public.purchases WHERE tenant_id = tenant_key AND purchase_date BETWEEN v_start AND v_end;
  SELECT COALESCE(SUM(amount), 0) INTO v_total_expenses
    FROM public.expenses WHERE tenant_id = tenant_key AND expense_date BETWEEN v_start AND v_end;
  SELECT COALESCE(SUM(total_cost), 0) INTO v_total_cogs
    FROM public.sales WHERE tenant_id = tenant_key AND sale_date BETWEEN v_start AND v_end;
  v_gross_profit := v_total_sales - v_total_cogs;
  v_net_profit := v_gross_profit - v_total_expenses;
  SELECT COALESCE(SUM(current_stock * buying_price), 0) INTO v_stock_value
    FROM public.products WHERE tenant_id = tenant_key AND status = 'active';
  SELECT COUNT(*) INTO v_low_stock_count
    FROM public.products WHERE tenant_id = tenant_key AND current_stock <= minimum_stock AND status = 'active';
  SELECT COUNT(*) INTO v_total_products
    FROM public.products WHERE tenant_id = tenant_key AND status = 'active';
  SELECT COUNT(*) INTO v_total_employees
    FROM public.employees WHERE tenant_id = tenant_key AND employment_status = 'active';
  SELECT COALESCE(expected_profit, 0) INTO v_monthly_expected
    FROM public.profit_targets
    WHERE tenant_id = tenant_key
      AND target_year = EXTRACT(YEAR FROM CURRENT_DATE)::int
      AND target_month = EXTRACT(MONTH FROM CURRENT_DATE)::int;
  v_deficit := v_monthly_expected - v_net_profit;
  RETURN jsonb_build_object(
    'total_sales', v_total_sales, 'total_purchases', v_total_purchases,
    'total_expenses', v_total_expenses, 'total_cogs', v_total_cogs,
    'gross_profit', v_gross_profit, 'net_profit', v_net_profit,
    'stock_value', v_stock_value, 'low_stock_count', v_low_stock_count,
    'total_products', v_total_products, 'total_employees', v_total_employees,
    'expected_profit', v_monthly_expected, 'deficit', v_deficit,
    'start_date', v_start, 'end_date', v_end
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_dashboard_summary(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard_summary(date, date) TO authenticated;

-- Audit records inherit the owning business from the changed row.
CREATE OR REPLACE FUNCTION public.write_audit_log()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  old_row jsonb;
  new_row jsonb;
  record_id uuid;
  actor_email text;
  owner_tenant uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_row := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN new_row := to_jsonb(NEW); END IF;
  record_id := COALESCE((new_row->>'id')::uuid, (old_row->>'id')::uuid);
  owner_tenant := COALESCE((new_row->>'tenant_id')::uuid, (old_row->>'tenant_id')::uuid,
                           public.current_tenant_id());
  -- User creation is global to the shared Auth project and may have no tenant context.
  IF owner_tenant IS NULL THEN RETURN NULL; END IF;
  SELECT email INTO actor_email FROM auth.users WHERE id = auth.uid();
  INSERT INTO public.audit_logs(tenant_id, user_id, user_name, action, entity_type, entity_id,
    old_values, new_values, description)
  VALUES (owner_tenant, auth.uid(), COALESCE(actor_email, 'System'), TG_OP || '_' || upper(TG_TABLE_NAME),
    TG_TABLE_NAME, record_id, old_row, new_row, TG_OP || ' ' || TG_TABLE_NAME);
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.write_audit_log() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS audit_tenant_memberships ON public.tenant_memberships;
CREATE TRIGGER audit_tenant_memberships
AFTER INSERT OR UPDATE OR DELETE ON public.tenant_memberships
FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();
