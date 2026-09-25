-- Enforce active/admin authorization in the database, including SECURITY DEFINER RPCs.
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, auth
AS $$ SELECT role FROM public.profiles WHERE id = auth.uid() AND status = 'active'; $$;

CREATE OR REPLACE FUNCTION public.is_active_user()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, auth
AS $$ SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND status = 'active'); $$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, auth
AS $$ SELECT COALESCE(public.current_user_role(), '') = 'admin'; $$;

-- Remove this incompatible trigger from projects where the old migration ran already.
DROP TRIGGER IF EXISTS trg_update_product_quantity ON public.stock_movements;
DROP FUNCTION IF EXISTS public.update_product_quantity();

-- The trigger may only create ordinary owner accounts. Trusted admin creation is handled server-side.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE trusted_role text;
BEGIN
  trusted_role := CASE WHEN NEW.raw_app_meta_data ->> 'role' = 'admin' THEN 'admin' ELSE 'owner' END;
  INSERT INTO public.profiles (id, name, role, status)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data ->> 'name', split_part(NEW.email, '@', 1)), trusted_role, 'active');
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_owner_limit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE owner_count integer; needs_check boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    needs_check := true;
  ELSE
    needs_check := OLD.role IS DISTINCT FROM 'owner';
  END IF;
  IF NEW.role = 'owner' AND needs_check THEN
    PERFORM pg_advisory_xact_lock(74102591);
    SELECT count(*) INTO owner_count FROM public.profiles WHERE role = 'owner' AND id <> NEW.id;
    IF owner_count >= 3 THEN RAISE EXCEPTION 'Maximum 3 owners allowed'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS profiles_enforce_owner_limit ON public.profiles;
CREATE TRIGGER profiles_enforce_owner_limit BEFORE INSERT OR UPDATE OF role ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_owner_limit();

-- Restrict every authenticated SELECT policy to active accounts.
DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT schemaname, tablename, policyname FROM pg_policies
           WHERE schemaname = 'public' AND cmd = 'SELECT'
  LOOP
    EXECUTE format('DROP POLICY %I ON %I.%I', p.policyname, p.schemaname, p.tablename);
    EXECUTE format('CREATE POLICY %I ON %I.%I FOR SELECT TO authenticated USING (public.is_active_user())',
                   p.policyname, p.schemaname, p.tablename);
  END LOOP;
END $$;

-- Audit rows are trigger-owned; application roles cannot write or rewrite them.
DROP POLICY IF EXISTS audit_logs_insert ON public.audit_logs;
DROP POLICY IF EXISTS "audit_logs_insert" ON public.audit_logs;
REVOKE INSERT, UPDATE, DELETE ON public.audit_logs FROM authenticated;
DROP POLICY IF EXISTS audit_logs_select ON public.audit_logs;
DROP POLICY IF EXISTS "audit_logs_select" ON public.audit_logs;
CREATE POLICY audit_logs_select ON public.audit_logs FOR SELECT TO authenticated USING (public.is_admin());

-- Sale and purchase headers cannot be deleted because that would orphan stock and credit ledgers.
DROP POLICY IF EXISTS sales_delete ON public.sales;
DROP POLICY IF EXISTS "sales_delete" ON public.sales;
DROP POLICY IF EXISTS purchases_delete ON public.purchases;
DROP POLICY IF EXISTS "purchases_delete" ON public.purchases;
DROP POLICY IF EXISTS product_variants_insert ON public.product_variants;
DROP POLICY IF EXISTS "product_variants_insert" ON public.product_variants;
REVOKE INSERT ON public.product_variants FROM authenticated;

-- Record committed business changes in the database, in the same transaction.
CREATE OR REPLACE FUNCTION public.write_audit_log()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE old_row jsonb; new_row jsonb; record_id uuid; actor_email text;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_row := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN new_row := to_jsonb(NEW); END IF;
  record_id := COALESCE((new_row->>'id')::uuid, (old_row->>'id')::uuid);
  SELECT email INTO actor_email FROM auth.users WHERE id = auth.uid();
  INSERT INTO public.audit_logs(user_id, user_name, action, entity_type, entity_id, old_values, new_values, description)
  VALUES (auth.uid(), COALESCE(actor_email, 'System'), TG_OP || '_' || upper(TG_TABLE_NAME),
          TG_TABLE_NAME, record_id, old_row, new_row, TG_OP || ' ' || TG_TABLE_NAME);
  RETURN NULL;
END;
$$;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['products','stock_movements','purchases','purchase_items','sales','sale_items',
    'expenses','employees','salary_records','profit_targets','suppliers','product_variants',
    'categories','subcategories','system_settings','profiles'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS audit_%I ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER audit_%I AFTER INSERT OR UPDATE OR DELETE ON public.%I '
      'FOR EACH ROW EXECUTE FUNCTION public.write_audit_log()', t, t);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.write_audit_log() FROM PUBLIC, anon, authenticated;

-- Keep employee identifiers masked at the database boundary.
DROP POLICY IF EXISTS employees_select ON public.employees;
DROP POLICY IF EXISTS "employees_select" ON public.employees;
CREATE POLICY employees_select ON public.employees FOR SELECT TO authenticated
  USING (public.is_admin());
CREATE OR REPLACE VIEW public.employee_directory AS
SELECT id, full_name,
       CASE WHEN national_id IS NULL THEN NULL
            WHEN length(national_id) <= 4 THEN '****'
            ELSE repeat('*', length(national_id) - 4) || right(national_id, 4) END AS national_id,
       phone, address, position, date_employed, basic_salary, employment_status,
       emergency_contact, created_at, updated_at
FROM public.employees
WHERE public.is_active_user();
REVOKE SELECT ON public.employees FROM authenticated;
GRANT INSERT, UPDATE, DELETE ON public.employees TO authenticated;
GRANT SELECT ON public.employee_directory TO authenticated;

-- Expose the imported catalogue through a stable public-schema view.
CREATE OR REPLACE VIEW public.hardware_catalog_variants AS
SELECT v.id, v.sku, v.barcode, p.name AS product_name, p.description AS product_description,
       s.name AS subcategory, c.name AS category, v.brand, v.size_specification,
       v.unit, v.description AS variant_description, v.cost_price, v.selling_price,
       v.active
FROM hardware_catalog.product_variants v
JOIN hardware_catalog.products p ON p.id = v.product_id
JOIN hardware_catalog.subcategories s ON s.id = p.subcategory_id
JOIN hardware_catalog.categories c ON c.id = s.category_id
WHERE v.active AND p.active AND s.active AND c.active;
GRANT SELECT ON public.hardware_catalog_variants TO authenticated;

-- Each active inventory product must originate from one catalogue SKU.
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS catalog_variant_id bigint;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS catalog_sku text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS catalog_size_specification text;
CREATE UNIQUE INDEX IF NOT EXISTS products_catalog_variant_unique
  ON public.products(catalog_variant_id) WHERE catalog_variant_id IS NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_catalog_variant_fk'
                 AND conrelid = 'public.products'::regclass) THEN
    ALTER TABLE public.products ADD CONSTRAINT products_catalog_variant_fk
      FOREIGN KEY (catalog_variant_id) REFERENCES hardware_catalog.product_variants(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.enforce_catalog_product()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, hardware_catalog
AS $$
DECLARE c record;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.catalog_variant_id IS NULL THEN
    RAISE EXCEPTION 'Select a product from the hardware catalogue';
  END IF;
  IF NEW.catalog_variant_id IS NOT NULL THEN
    SELECT p.name AS product_name, v.sku, v.brand, v.unit, v.size_specification, v.cost_price, v.selling_price,
           v.active AS variant_active, p.active AS product_active
    INTO c
    FROM hardware_catalog.product_variants v
    JOIN hardware_catalog.products p ON p.id = v.product_id
    WHERE v.id = NEW.catalog_variant_id;
    IF NOT FOUND OR NOT c.variant_active OR NOT c.product_active THEN
      RAISE EXCEPTION 'The selected hardware catalogue item is unavailable';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.catalog_variant_id IS DISTINCT FROM NEW.catalog_variant_id THEN
      RAISE EXCEPTION 'A product cannot be changed to a different catalogue item';
    END IF;
    IF TG_OP = 'UPDATE' AND (OLD.name IS DISTINCT FROM NEW.name OR OLD.brand IS DISTINCT FROM NEW.brand
       OR OLD.unit IS DISTINCT FROM NEW.unit OR OLD.catalog_sku IS DISTINCT FROM NEW.catalog_sku
       OR OLD.catalog_size_specification IS DISTINCT FROM NEW.catalog_size_specification) THEN
      RAISE EXCEPTION 'Catalogue product name, brand, unit, and SKU are fixed';
    END IF;
    IF TG_OP = 'INSERT' THEN
      NEW.name := c.product_name;
      NEW.brand := c.brand;
      NEW.unit := c.unit;
      NEW.catalog_size_specification := c.size_specification;
      NEW.buying_price := COALESCE(NEW.buying_price, c.cost_price);
      NEW.selling_price := COALESCE(NEW.selling_price, c.selling_price);
    END IF;
    NEW.catalog_sku := c.sku;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS products_require_catalog_item ON public.products;
CREATE TRIGGER products_require_catalog_item
  BEFORE INSERT OR UPDATE OF catalog_variant_id, catalog_sku, catalog_size_specification,
    name, brand, unit, buying_price, selling_price
  ON public.products FOR EACH ROW EXECUTE FUNCTION public.enforce_catalog_product();
REVOKE ALL ON FUNCTION public.enforce_catalog_product() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_owner_limit() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_opening_stock()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.current_stock > 0 THEN
    INSERT INTO public.stock_movements(product_id, movement_type, quantity, reference_type, note, created_by)
    VALUES (NEW.id, 'opening', NEW.current_stock, 'opening', 'Opening inventory from catalogue selection', auth.uid());
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS products_record_opening_stock ON public.products;
CREATE TRIGGER products_record_opening_stock AFTER INSERT ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.record_opening_stock();
REVOKE ALL ON FUNCTION public.record_opening_stock() FROM PUBLIC, anon, authenticated;

-- Rename privileged implementations so clients cannot call them directly.
DO $$ BEGIN
  IF to_regprocedure('public.process_sale(jsonb,text,text,text,date)') IS NOT NULL
     AND to_regprocedure('public.process_sale_unchecked(jsonb,text,text,text,date)') IS NULL THEN
    ALTER FUNCTION public.process_sale(jsonb, text, text, text, date) RENAME TO process_sale_unchecked;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.process_sale_unchecked(jsonb, text, text, text, date) FROM PUBLIC, anon, authenticated;
DO $$ BEGIN
  IF to_regprocedure('public.process_purchase(jsonb,uuid,text,text,date,text,numeric)') IS NOT NULL
     AND to_regprocedure('public.process_purchase_unchecked(jsonb,uuid,text,text,date,text,numeric)') IS NULL THEN
    ALTER FUNCTION public.process_purchase(jsonb, uuid, text, text, date, text, numeric) RENAME TO process_purchase_unchecked;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.process_purchase_unchecked(jsonb, uuid, text, text, date, text, numeric) FROM PUBLIC, anon, authenticated;
DROP FUNCTION IF EXISTS public.process_purchase(jsonb, uuid, text, text, date);
DO $$ BEGIN
  IF to_regprocedure('public.record_stock_adjustment(uuid,numeric,text)') IS NOT NULL
     AND to_regprocedure('public.record_stock_adjustment_unchecked(uuid,numeric,text)') IS NULL THEN
    ALTER FUNCTION public.record_stock_adjustment(uuid, numeric, text) RENAME TO record_stock_adjustment_unchecked;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.record_stock_adjustment_unchecked(uuid, numeric, text) FROM PUBLIC, anon, authenticated;
DO $$ BEGIN
  IF to_regprocedure('public.record_supplier_payment(uuid,numeric,text)') IS NOT NULL
     AND to_regprocedure('public.record_supplier_payment_unchecked(uuid,numeric,text)') IS NULL THEN
    ALTER FUNCTION public.record_supplier_payment(uuid, numeric, text) RENAME TO record_supplier_payment_unchecked;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.record_supplier_payment_unchecked(uuid, numeric, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.process_sale(
  p_sale_items jsonb, p_customer_name text DEFAULT NULL, p_payment_method text DEFAULT 'cash',
  p_note text DEFAULT NULL, p_sale_date date DEFAULT CURRENT_DATE
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required'; END IF;
  IF jsonb_typeof(p_sale_items) <> 'array' OR jsonb_array_length(p_sale_items) = 0 THEN
    RAISE EXCEPTION 'At least one sale item is required';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_sale_items) i
             WHERE COALESCE((i->>'quantity')::numeric, 0) <= 0) THEN
    RAISE EXCEPTION 'Sale quantities must be positive';
  END IF;
  RETURN public.process_sale_unchecked(p_sale_items, p_customer_name, p_payment_method, p_note, p_sale_date);
END $$;
REVOKE ALL ON FUNCTION public.process_sale(jsonb, text, text, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_sale(jsonb, text, text, text, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.process_purchase(
  p_purchase_items jsonb, p_supplier_id uuid DEFAULT NULL, p_invoice_number text DEFAULT NULL,
  p_note text DEFAULT NULL, p_purchase_date date DEFAULT CURRENT_DATE,
  p_payment_status text DEFAULT 'paid', p_amount_paid numeric DEFAULT 0
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE expected_total numeric;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required'; END IF;
  IF jsonb_typeof(p_purchase_items) <> 'array' OR jsonb_array_length(p_purchase_items) = 0 THEN
    RAISE EXCEPTION 'At least one purchase item is required';
  END IF;
  IF p_payment_status NOT IN ('paid', 'partial', 'credit') OR COALESCE(p_amount_paid, -1) < 0 THEN
    RAISE EXCEPTION 'Invalid purchase payment details';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_purchase_items) i
             WHERE COALESCE((i->>'quantity')::numeric, 0) <= 0
                OR COALESCE((i->>'buying_price')::numeric, -1) < 0) THEN
    RAISE EXCEPTION 'Purchase quantities must be positive and prices cannot be negative';
  END IF;
  SELECT SUM((i->>'quantity')::numeric * (i->>'buying_price')::numeric)
    INTO expected_total FROM jsonb_array_elements(p_purchase_items) i;
  IF p_amount_paid > expected_total THEN RAISE EXCEPTION 'Amount paid exceeds purchase total'; END IF;
  RETURN public.process_purchase_unchecked(p_purchase_items, p_supplier_id, p_invoice_number,
    p_note, p_purchase_date, p_payment_status, p_amount_paid);
END $$;
REVOKE ALL ON FUNCTION public.process_purchase(jsonb, uuid, text, text, date, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_purchase(jsonb, uuid, text, text, date, text, numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_stock_adjustment(p_product_id uuid, p_new_stock numeric, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required'; END IF;
  IF p_new_stock IS NULL OR p_new_stock < 0 THEN RAISE EXCEPTION 'Stock cannot be negative'; END IF;
  PERFORM public.record_stock_adjustment_unchecked(p_product_id, p_new_stock, p_note);
END $$;
REVOKE ALL ON FUNCTION public.record_stock_adjustment(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_stock_adjustment(uuid, numeric, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_supplier_payment(p_supplier_id uuid, p_amount numeric, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Payment must be positive'; END IF;
  PERFORM public.record_supplier_payment_unchecked(p_supplier_id, p_amount, p_note);
END $$;
REVOKE ALL ON FUNCTION public.record_supplier_payment(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_supplier_payment(uuid, numeric, text) TO authenticated;

DO $$ BEGIN
  IF to_regprocedure('public.get_dashboard_summary(date,date)') IS NOT NULL
     AND to_regprocedure('public.get_dashboard_summary_unchecked(date,date)') IS NULL THEN
    ALTER FUNCTION public.get_dashboard_summary(date, date) RENAME TO get_dashboard_summary_unchecked;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.get_dashboard_summary_unchecked(date, date) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.get_dashboard_summary(p_start_date date DEFAULT NULL, p_end_date date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
BEGIN
  IF NOT public.is_active_user() THEN RAISE EXCEPTION 'Active account required'; END IF;
  -- Call the original report body after renaming it out of public reach.
  RETURN public.get_dashboard_summary_unchecked(p_start_date, p_end_date);
END $$;
REVOKE ALL ON FUNCTION public.get_dashboard_summary(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard_summary(date, date) TO authenticated;

REVOKE ALL ON FUNCTION public.process_sale_unchecked(jsonb, text, text, text, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.process_purchase_unchecked(jsonb, uuid, text, text, date, text, numeric) FROM PUBLIC, anon, authenticated;
