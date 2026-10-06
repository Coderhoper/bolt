-- Employee self-registration, sales-only data access, and printable receipts.

CREATE TABLE IF NOT EXISTS public.tenant_staff_registration_requests (
  tenant_id uuid NOT NULL REFERENCES public.business_tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users(id),
  PRIMARY KEY (tenant_id, user_id)
);
ALTER TABLE public.tenant_staff_registration_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tenant_staff_registration_requests FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.request_tenant_staff_registration()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  tenant_header text;
  tenant_key uuid;
  account_email text;
  account_confirmed_at timestamptz;
  member_status text;
  existing_request_status text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in to request employee access' USING ERRCODE = '42501'; END IF;
  tenant_header := current_setting('request.headers', true)::jsonb ->> 'x-tenant-id';
  IF tenant_header IS NULL OR tenant_header !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'A valid business workspace is required';
  END IF;
  tenant_key := tenant_header::uuid;
  IF NOT EXISTS (SELECT 1 FROM public.business_tenants tenant WHERE tenant.id = tenant_key AND tenant.status = 'active') THEN
    RAISE EXCEPTION 'This business workspace is unavailable';
  END IF;

  SELECT account.email, account.email_confirmed_at
    INTO account_email, account_confirmed_at
  FROM auth.users account WHERE account.id = auth.uid();
  IF account_email IS NULL OR account_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'Verify your email address before requesting employee access';
  END IF;
  SELECT membership.status INTO member_status
  FROM public.tenant_memberships membership
  WHERE membership.tenant_id = tenant_key AND membership.user_id = auth.uid();
  IF member_status = 'active' THEN RETURN 'active'; END IF;
  IF member_status = 'inactive' THEN RAISE EXCEPTION 'Your business account is inactive. Contact the administrator'; END IF;

  SELECT request.status INTO existing_request_status
  FROM public.tenant_staff_registration_requests request
  WHERE request.tenant_id = tenant_key AND request.user_id = auth.uid();
  IF existing_request_status = 'approved' THEN
    RAISE EXCEPTION 'The administrator must finish activating your employee account';
  END IF;

  INSERT INTO public.tenant_staff_registration_requests AS existing_request
    (tenant_id, user_id, status, requested_at, resolved_at, resolved_by)
  VALUES (tenant_key, auth.uid(), 'pending', now(), NULL, NULL)
  ON CONFLICT (tenant_id, user_id) DO UPDATE
    SET status = 'pending', requested_at = now(), resolved_at = NULL, resolved_by = NULL
    WHERE existing_request.status = 'rejected';
  RETURN 'pending';
END;
$$;
REVOKE ALL ON FUNCTION public.request_tenant_staff_registration() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_tenant_staff_registration() TO authenticated;

CREATE OR REPLACE FUNCTION public.list_tenant_staff_registration_requests()
RETURNS TABLE(user_id uuid, full_name text, email text, requested_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE tenant_key uuid := public.current_tenant_id();
BEGIN
  IF tenant_key IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Tenant administrator access required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT request.user_id, COALESCE(profile.name, split_part(account.email, '@', 1)), account.email, request.requested_at
  FROM public.tenant_staff_registration_requests request
  JOIN auth.users account ON account.id = request.user_id
  LEFT JOIN public.profiles profile ON profile.id = request.user_id
  WHERE request.tenant_id = tenant_key AND request.status = 'pending'
  ORDER BY request.requested_at;
END;
$$;
REVOKE ALL ON FUNCTION public.list_tenant_staff_registration_requests() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_tenant_staff_registration_requests() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_review_tenant_staff_registration(p_user_id uuid, p_decision text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  tenant_key uuid := public.current_tenant_id();
  request_status text;
BEGIN
  IF tenant_key IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Tenant administrator access required' USING ERRCODE = '42501';
  END IF;
  IF p_decision IS NULL OR p_decision NOT IN ('approve', 'reject') THEN RAISE EXCEPTION 'Choose approve or reject'; END IF;

  SELECT request.status INTO request_status
  FROM public.tenant_staff_registration_requests request
  WHERE request.tenant_id = tenant_key AND request.user_id = p_user_id
  FOR UPDATE;
  IF request_status IS DISTINCT FROM 'pending' THEN RAISE EXCEPTION 'This employee request is no longer pending'; END IF;

  IF p_decision = 'approve' THEN
    PERFORM public.admin_add_tenant_user(p_user_id);
    UPDATE public.tenant_staff_registration_requests
      SET status = 'approved', resolved_at = now(), resolved_by = auth.uid()
      WHERE tenant_id = tenant_key AND user_id = p_user_id;
  ELSE
    UPDATE public.tenant_staff_registration_requests
      SET status = 'rejected', resolved_at = now(), resolved_by = auth.uid()
      WHERE tenant_id = tenant_key AND user_id = p_user_id;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_review_tenant_staff_registration(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_review_tenant_staff_registration(uuid, text) TO authenticated;

-- Staff can call the sale flow, but cannot choose sale prices or inspect other
-- business tables. Product information needed by the form is returned by RPC.
CREATE OR REPLACE FUNCTION public.get_sale_catalog()
RETURNS TABLE(id uuid, name text, catalog_sku text, unit text, selling_price numeric, current_stock numeric, catalog_variant_id bigint, buying_price numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE tenant_key uuid := public.current_tenant_id();
BEGIN
  IF tenant_key IS NULL OR NOT (
    public.is_admin() OR public.current_user_role() = 'user'
  ) THEN
    RAISE EXCEPTION 'Sales access required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT product.id, product.name, product.catalog_sku, product.unit,
         product.selling_price, product.current_stock, product.catalog_variant_id,
         CASE WHEN public.is_admin() THEN product.buying_price ELSE NULL::numeric END
  FROM public.products product
  WHERE product.tenant_id = tenant_key AND product.status = 'active'
    AND product.catalog_variant_id IS NOT NULL
  ORDER BY product.name;
END;
$$;
REVOKE ALL ON FUNCTION public.get_sale_catalog() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sale_catalog() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_sales()
RETURNS TABLE(id uuid, sale_number text, customer_name text, sale_date date,
              payment_method text, total_amount numeric, created_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE tenant_key uuid := public.current_tenant_id();
BEGIN
  IF tenant_key IS NULL OR NOT (public.is_admin() OR public.current_user_role() = 'user') THEN
    RAISE EXCEPTION 'Sales access required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT sale.id, sale.sale_number, sale.customer_name, sale.sale_date,
         sale.payment_method, sale.total_amount, sale.created_at
  FROM public.sales sale
  WHERE sale.tenant_id = tenant_key
    AND (public.is_admin() OR sale.created_by = auth.uid())
  ORDER BY sale.created_at DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_sales() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_sales() TO authenticated;

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS receipt_business_name text;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS receipt_business_address text;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS receipt_business_phone text;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS receipt_business_email text;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS receipt_currency text;

-- Normalize item data from the client and snapshot the current server price.
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
DECLARE
  tenant_key uuid := public.current_tenant_id();
  item jsonb;
  product_id uuid;
  quantity numeric;
  unit_price numeric;
  normalized_items jsonb := '[]'::jsonb;
  sale_id uuid;
  business_row public.system_settings%ROWTYPE;
  business_fallback text;
BEGIN
  IF tenant_key IS NULL OR NOT (public.is_admin() OR public.current_user_role() = 'user') THEN
    RAISE EXCEPTION 'Sales access required' USING ERRCODE = '42501';
  END IF;
  IF p_sale_items IS NULL OR jsonb_typeof(p_sale_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Sale items must be a list';
  END IF;
  IF jsonb_array_length(p_sale_items) = 0 OR jsonb_array_length(p_sale_items) > 100 THEN
    RAISE EXCEPTION 'Add between one and 100 sale items';
  END IF;
  IF p_payment_method NOT IN ('cash', 'mpesa', 'bank', 'credit') THEN
    RAISE EXCEPTION 'Choose a valid payment method';
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(p_sale_items) LOOP
    product_id := NULLIF(item ->> 'product_id', '')::uuid;
    quantity := NULLIF(item ->> 'quantity', '')::numeric;
    IF product_id IS NULL OR quantity IS NULL OR quantity <= 0 THEN
      RAISE EXCEPTION 'Select products and enter positive quantities';
    END IF;
    SELECT product.selling_price INTO unit_price
    FROM public.products product
    WHERE product.id = product_id AND product.tenant_id = tenant_key
      AND product.status = 'active' AND product.catalog_variant_id IS NOT NULL
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'A selected catalogue product is unavailable'; END IF;
    normalized_items := normalized_items || jsonb_build_array(jsonb_build_object(
      'product_id', product_id, 'quantity', quantity, 'selling_price', unit_price
    ));
  END LOOP;

  sale_id := public.process_sale_unchecked(
    normalized_items, NULLIF(btrim(p_customer_name), ''), p_payment_method,
    NULLIF(btrim(p_note), ''), COALESCE(p_sale_date, CURRENT_DATE)
  );
  SELECT * INTO business_row FROM public.system_settings settings
  WHERE settings.tenant_id = tenant_key ORDER BY settings.updated_at DESC LIMIT 1;
  SELECT tenant.name INTO business_fallback
  FROM public.business_tenants tenant WHERE tenant.id = tenant_key;
  UPDATE public.sales SET
    receipt_business_name = COALESCE(NULLIF(btrim(business_row.business_name), ''), business_fallback, 'Business'),
    receipt_business_address = business_row.business_address,
    receipt_business_phone = business_row.business_phone,
    receipt_business_email = business_row.business_email,
    receipt_currency = COALESCE(NULLIF(btrim(business_row.currency), ''), 'KSh')
  WHERE id = sale_id AND tenant_id = tenant_key;
  RETURN sale_id;
END;
$$;
REVOKE ALL ON FUNCTION public.process_sale(jsonb, text, text, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_sale(jsonb, text, text, text, date) TO authenticated;

-- Receipt details expose sale prices and names only; totals, items, and sale
-- number remain in the normal sales ledger as the retained copy.
CREATE OR REPLACE FUNCTION public.get_sale_receipt(p_sale_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  tenant_key uuid := public.current_tenant_id();
  sale_row public.sales%ROWTYPE;
  business_row public.system_settings%ROWTYPE;
  business_fallback text;
  item_rows jsonb;
BEGIN
  IF tenant_key IS NULL OR NOT (public.is_admin() OR public.current_user_role() = 'user') THEN
    RAISE EXCEPTION 'Sales access required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO sale_row FROM public.sales sale
  WHERE sale.id = p_sale_id AND sale.tenant_id = tenant_key
    AND (public.is_admin() OR sale.created_by = auth.uid());
  IF NOT FOUND THEN RAISE EXCEPTION 'Sale receipt not found' USING ERRCODE = 'P0002'; END IF;

  SELECT * INTO business_row FROM public.system_settings settings
  WHERE settings.tenant_id = tenant_key ORDER BY settings.updated_at DESC LIMIT 1;
  SELECT tenant.name INTO business_fallback
  FROM public.business_tenants tenant WHERE tenant.id = tenant_key;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'name', COALESCE(NULLIF(btrim(item.product_name), ''), product.name, 'Item'),
      'sku', product.catalog_sku,
      'quantity', item.quantity,
      'unit_price', item.selling_price,
      'total', item.total
    ) ORDER BY item.created_at, item.id), '[]'::jsonb)
    INTO item_rows
  FROM public.sale_items item
  LEFT JOIN public.products product ON product.id = item.product_id AND product.tenant_id = tenant_key
  WHERE item.sale_id = sale_row.id AND item.tenant_id = tenant_key;

  RETURN jsonb_build_object(
    'business', jsonb_build_object(
      'name', COALESCE(NULLIF(btrim(sale_row.receipt_business_name), ''), NULLIF(btrim(business_row.business_name), ''), business_fallback, 'Business'),
      'address', COALESCE(sale_row.receipt_business_address, business_row.business_address),
      'phone', COALESCE(sale_row.receipt_business_phone, business_row.business_phone),
      'email', COALESCE(sale_row.receipt_business_email, business_row.business_email),
      'currency', COALESCE(NULLIF(btrim(sale_row.receipt_currency), ''), NULLIF(btrim(business_row.currency), ''), 'KSh')
    ),
    'sale', jsonb_build_object(
      'id', sale_row.id,
      'number', COALESCE(sale_row.sale_number, sale_row.id::text),
      'date', sale_row.sale_date,
      'customer', COALESCE(NULLIF(btrim(sale_row.customer_name), ''), 'Walk-in'),
      'payment_method', sale_row.payment_method,
      'total', sale_row.total_amount,
      'created_at', sale_row.created_at
    ),
    'items', item_rows
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_sale_receipt(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sale_receipt(uuid) TO authenticated;

-- Keep the UI-only role boundary enforceable through PostgREST table reads.
-- Restrictive policies combine with existing policies, including tenant scope.
DO $$
DECLARE relation_name text;
BEGIN
  FOR relation_name IN
    SELECT DISTINCT columns.table_name
    FROM information_schema.columns columns
    JOIN information_schema.tables tables
      ON tables.table_schema = columns.table_schema AND tables.table_name = columns.table_name
    WHERE columns.table_schema = 'public' AND columns.column_name = 'tenant_id'
      AND tables.table_type = 'BASE TABLE'
      AND columns.table_name NOT IN ('sales', 'sale_items')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS staff_read_only_admin ON public.%I', relation_name);
    EXECUTE format(
      'CREATE POLICY staff_read_only_admin ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING (public.is_admin())',
      relation_name
    );
  END LOOP;
END;
$$;

DROP POLICY IF EXISTS staff_sales_read_scope ON public.sales;
CREATE POLICY staff_sales_read_scope ON public.sales
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS staff_sale_items_read_scope ON public.sale_items;
CREATE POLICY staff_sale_items_read_scope ON public.sale_items
  AS RESTRICTIVE FOR SELECT TO authenticated
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
WHERE e.tenant_id = public.current_tenant_id() AND public.is_admin();
REVOKE SELECT ON public.employee_directory FROM anon;
GRANT SELECT ON public.employee_directory TO authenticated;

CREATE OR REPLACE VIEW public.hardware_catalog_variants AS
SELECT v.id, v.sku, v.barcode, p.name AS product_name, p.description AS product_description,
       s.name AS subcategory, c.name AS category, v.brand, v.size_specification,
       v.unit, v.description AS variant_description, v.cost_price, v.selling_price,
       v.active
FROM hardware_catalog.product_variants v
JOIN hardware_catalog.products p ON p.id = v.product_id
JOIN hardware_catalog.subcategories s ON s.id = p.subcategory_id
JOIN hardware_catalog.categories c ON c.id = s.category_id
WHERE v.active AND p.active AND s.active AND c.active AND public.is_admin();

-- The older dashboard RPC returned purchases, costs, salaries, and stock value
-- to any active staff member despite the new sales-only role.
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
  IF tenant_key IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Tenant administrator access required' USING ERRCODE = '42501';
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
    FROM public.profit_targets WHERE tenant_id = tenant_key
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
NOTIFY pgrst, 'reload schema';
