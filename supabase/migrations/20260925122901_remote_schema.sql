SET local check_function_bodies = off;

CREATE TABLE "public"."audit_logs" (
  "id"          uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "user_id"     uuid,
  "user_name"   text,
  "action"      text                     NOT NULL,
  "entity_type" text,
  "entity_id"   uuid,
  "old_values"  jsonb,
  "new_values"  jsonb,
  "description" text,
  "created_at"  timestamp with time zone DEFAULT now(),
  CONSTRAINT "audit_logs_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."audit_logs"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."categories" (
  "id"          uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "name"        text                     NOT NULL,
  "description" text,
  "created_at"  timestamp with time zone DEFAULT now(),
  "updated_at"  timestamp with time zone DEFAULT now(),
  CONSTRAINT "categories_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."categories"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."employees" (
  "id"                uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "full_name"         text                     NOT NULL,
  "national_id"       text,
  "phone"             text,
  "address"           text,
  "position"          text,
  "date_employed"     date,
  "basic_salary"      numeric(12,2)            NOT NULL DEFAULT 0,
  "employment_status" text                     NOT NULL DEFAULT 'active'::text,
  "emergency_contact" text,
  "created_at"        timestamp with time zone DEFAULT now(),
  "updated_at"        timestamp with time zone DEFAULT now(),
  CONSTRAINT "employees_employment_status_check" CHECK ((employment_status = ANY (ARRAY['active'::text, 'inactive'::text, 'terminated'::text]))),
  CONSTRAINT "employees_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."employees"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."expenses" (
  "id"             uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "category"       text                     NOT NULL,
  "description"    text,
  "amount"         numeric(14,2)            NOT NULL,
  "expense_date"   date                     NOT NULL DEFAULT CURRENT_DATE,
  "payment_method" text                     DEFAULT 'cash'::text,
  "created_by"     uuid,
  "created_at"     timestamp with time zone DEFAULT now(),
  CONSTRAINT "expenses_payment_method_check" CHECK ((payment_method = ANY (ARRAY['cash'::text, 'mpesa'::text, 'bank'::text, 'other'::text]))),
  CONSTRAINT "expenses_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."expenses"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."product_variants" (
  "id"            uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "product_id"    uuid                     NOT NULL,
  "brand"         text,
  "size"          text,
  "specification" text,
  "unit"          text                     DEFAULT 'pcs'::text,
  "sku"           text,
  "cost_price"    numeric(12,2)            NOT NULL DEFAULT 0,
  "selling_price" numeric(12,2)            NOT NULL DEFAULT 0,
  "current_stock" numeric(14,2)            NOT NULL DEFAULT 0,
  "reorder_level" numeric(14,2)            NOT NULL DEFAULT 0,
  "status"        text                     NOT NULL DEFAULT 'active'::text,
  "created_at"    timestamp with time zone DEFAULT now(),
  "updated_at"    timestamp with time zone DEFAULT now(),
  CONSTRAINT "product_variants_pkey" PRIMARY KEY (id),
  CONSTRAINT "product_variants_status_check" CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text])))
);

ALTER TABLE "public"."product_variants"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."products" (
  "id"             uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "name"           text                     NOT NULL,
  "category_id"    uuid,
  "supplier_id"    uuid,
  "brand"          text,
  "unit"           text                     NOT NULL DEFAULT 'pcs'::text,
  "buying_price"   numeric(12,2)            NOT NULL DEFAULT 0,
  "selling_price"  numeric(12,2)            NOT NULL DEFAULT 0,
  "current_stock"  numeric(14,2)            NOT NULL DEFAULT 0,
  "minimum_stock"  numeric(14,2)            NOT NULL DEFAULT 0,
  "maximum_stock"  numeric(14,2)            NOT NULL DEFAULT 0,
  "status"         text                     NOT NULL DEFAULT 'active'::text,
  "created_at"     timestamp with time zone DEFAULT now(),
  "updated_at"     timestamp with time zone DEFAULT now(),
  "subcategory_id" uuid,
  CONSTRAINT "products_pkey" PRIMARY KEY (id),
  CONSTRAINT "products_status_check" CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text])))
);

ALTER TABLE "public"."products"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."profiles" (
  "id"         uuid                     NOT NULL,
  "name"       text                     NOT NULL,
  "role"       text                     NOT NULL DEFAULT 'owner'::text,
  "status"     text                     NOT NULL DEFAULT 'active'::text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  CONSTRAINT "profiles_pkey" PRIMARY KEY (id),
  CONSTRAINT "profiles_role_check" CHECK ((role = ANY (ARRAY['admin'::text, 'owner'::text]))),
  CONSTRAINT "profiles_status_check" CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text])))
);

ALTER TABLE "public"."profiles"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."profit_targets" (
  "id"              uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "target_month"    integer                  NOT NULL,
  "target_year"     integer                  NOT NULL,
  "expected_profit" numeric(14,2)            NOT NULL DEFAULT 0,
  "created_at"      timestamp with time zone DEFAULT now(),
  "updated_at"      timestamp with time zone DEFAULT now(),
  CONSTRAINT "profit_targets_pkey" PRIMARY KEY (id),
  CONSTRAINT "profit_targets_target_month_check" CHECK (((target_month >= 1) AND (target_month <= 12)))
);

ALTER TABLE "public"."profit_targets"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."purchase_items" (
  "id"           uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "purchase_id"  uuid                     NOT NULL,
  "product_id"   uuid                     NOT NULL,
  "quantity"     numeric(14,2)            NOT NULL,
  "buying_price" numeric(12,2)            NOT NULL,
  "total"        numeric(14,2)            NOT NULL,
  "created_at"   timestamp with time zone DEFAULT now(),
  CONSTRAINT "purchase_items_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."purchase_items"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."purchases" (
  "id"             uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "supplier_id"    uuid,
  "invoice_number" text,
  "purchase_date"  date                     NOT NULL DEFAULT CURRENT_DATE,
  "total_amount"   numeric(14,2)            NOT NULL DEFAULT 0,
  "note"           text,
  "created_by"     uuid,
  "created_at"     timestamp with time zone DEFAULT now(),
  CONSTRAINT "purchases_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."purchases"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."salary_records" (
  "id"               uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "employee_id"      uuid                     NOT NULL,
  "pay_period_month" integer                  NOT NULL,
  "pay_period_year"  integer                  NOT NULL,
  "basic_salary"     numeric(12,2)            NOT NULL DEFAULT 0,
  "allowances"       numeric(12,2)            NOT NULL DEFAULT 0,
  "deductions"       numeric(12,2)            NOT NULL DEFAULT 0,
  "net_salary"       numeric(12,2)            NOT NULL DEFAULT 0,
  "payment_date"     date                     NOT NULL DEFAULT CURRENT_DATE,
  "note"             text,
  "created_by"       uuid,
  "created_at"       timestamp with time zone DEFAULT now(),
  CONSTRAINT "salary_records_pay_period_month_check" CHECK (((pay_period_month >= 1) AND (pay_period_month <= 12))),
  CONSTRAINT "salary_records_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."salary_records"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."sale_items" (
  "id"                 uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "sale_id"            uuid                     NOT NULL,
  "product_id"         uuid                     NOT NULL,
  "quantity"           numeric(14,2)            NOT NULL,
  "selling_price"      numeric(12,2)            NOT NULL,
  "buying_price"       numeric(12,2)            NOT NULL,
  "total"              numeric(14,2)            NOT NULL,
  "profit"             numeric(14,2)            NOT NULL,
  "created_at"         timestamp with time zone DEFAULT now(),
  "product_variant_id" uuid,
  "product_name"       text,
  "brand"              text,
  "size"               text,
  "unit_price"         numeric(12,2),
  "cost_price"         numeric(12,2),
  CONSTRAINT "sale_items_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."sale_items"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."sales" (
  "id"             uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "sale_number"    text,
  "customer_name"  text,
  "sale_date"      date                     NOT NULL DEFAULT CURRENT_DATE,
  "payment_method" text                     DEFAULT 'cash'::text,
  "total_amount"   numeric(14,2)            NOT NULL DEFAULT 0,
  "total_cost"     numeric(14,2)            NOT NULL DEFAULT 0,
  "total_profit"   numeric(14,2)            NOT NULL DEFAULT 0,
  "note"           text,
  "created_by"     uuid,
  "created_at"     timestamp with time zone DEFAULT now(),
  CONSTRAINT "sales_payment_method_check" CHECK ((payment_method = ANY (ARRAY['cash'::text, 'mpesa'::text, 'bank'::text, 'credit'::text]))),
  CONSTRAINT "sales_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."sales"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."stock_movements" (
  "id"                 uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "product_id"         uuid                     NOT NULL,
  "movement_type"      text                     NOT NULL,
  "quantity"           numeric(14,2)            NOT NULL,
  "reference_type"     text,
  "reference_id"       uuid,
  "note"               text,
  "created_by"         uuid,
  "created_at"         timestamp with time zone DEFAULT now(),
  "product_variant_id" uuid,
  CONSTRAINT "stock_movements_movement_type_check" CHECK ((movement_type = ANY (ARRAY['purchase'::text, 'sale'::text, 'adjustment'::text, 'opening'::text]))),
  CONSTRAINT "stock_movements_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."stock_movements"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."subcategories" (
  "id"          uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "category_id" uuid,
  "name"        text                     NOT NULL,
  "description" text,
  "created_at"  timestamp with time zone DEFAULT now(),
  "updated_at"  timestamp with time zone DEFAULT now(),
  CONSTRAINT "subcategories_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."subcategories"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."suppliers" (
  "id"             uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "name"           text                     NOT NULL,
  "contact_person" text,
  "phone"          text,
  "email"          text,
  "address"        text,
  "created_at"     timestamp with time zone DEFAULT now(),
  "updated_at"     timestamp with time zone DEFAULT now(),
  CONSTRAINT "suppliers_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."suppliers"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."system_settings" (
  "id"                     uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "business_name"          text                     NOT NULL DEFAULT 'My Business'::text,
  "business_address"       text,
  "business_phone"         text,
  "business_email"         text,
  "currency"               text                     NOT NULL DEFAULT 'KSh'::text,
  "email_recipients"       jsonb                    NOT NULL DEFAULT '[]'::jsonb,
  "weekly_report_day"      integer                  NOT NULL DEFAULT 1,
  "weekly_report_enabled"  boolean                  NOT NULL DEFAULT false,
  "monthly_report_enabled" boolean                  NOT NULL DEFAULT false,
  "updated_at"             timestamp with time zone DEFAULT now(),
  CONSTRAINT "system_settings_pkey" PRIMARY KEY (id),
  CONSTRAINT "system_settings_weekly_report_day_check" CHECK (((weekly_report_day >= 0) AND (weekly_report_day <= 6)))
);

ALTER TABLE "public"."system_settings"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.current_user_role()
  RETURNS text
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  AS $function$
  SELECT (auth.jwt() -> 'raw_app_meta_data' ->> 'role')::text;
$function$;

CREATE OR REPLACE FUNCTION public.generate_sale_number()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  AS $function$
DECLARE
  v_count integer;
  v_new_number text;
BEGIN
  SELECT COUNT(*) INTO v_count FROM public.sales
  WHERE sale_date = NEW.sale_date;

  v_new_number := 'SAL-' || to_char(NEW.sale_date, 'YYYYMMDD') || '-' || LPAD((v_count + 1)::text, 4, '0');
  NEW.sale_number := COALESCE(NEW.sale_number, v_new_number);
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_dashboard_summary (
  p_start_date date DEFAULT NULL::date,
  p_end_date   date DEFAULT NULL::date
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  AS $function$
DECLARE
  v_start date := COALESCE(p_start_date, date_trunc('month', CURRENT_DATE)::date);
  v_end date := COALESCE(p_end_date, CURRENT_DATE);
  v_result jsonb;
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
  SELECT COALESCE(SUM(total_amount), 0) INTO v_total_sales
  FROM public.sales WHERE sale_date BETWEEN v_start AND v_end;

  SELECT COALESCE(SUM(total_amount), 0) INTO v_total_purchases
  FROM public.purchases WHERE purchase_date BETWEEN v_start AND v_end;

  SELECT COALESCE(SUM(amount), 0) INTO v_total_expenses
  FROM public.expenses WHERE expense_date BETWEEN v_start AND v_end;

  SELECT COALESCE(SUM(total_cost), 0) INTO v_total_cogs
  FROM public.sales WHERE sale_date BETWEEN v_start AND v_end;

  v_gross_profit := v_total_sales - v_total_cogs;
  v_net_profit := v_gross_profit - v_total_expenses;

  SELECT COALESCE(SUM(current_stock * buying_price), 0) INTO v_stock_value
  FROM public.products WHERE status = 'active';

  SELECT COUNT(*) INTO v_low_stock_count
  FROM public.products WHERE current_stock <= minimum_stock AND status = 'active';

  SELECT COUNT(*) INTO v_total_products FROM public.products WHERE status = 'active';

  SELECT COUNT(*) INTO v_total_employees FROM public.employees WHERE employment_status = 'active';

  SELECT COALESCE(expected_profit, 0) INTO v_monthly_expected
  FROM public.profit_targets
  WHERE target_year = EXTRACT(YEAR FROM CURRENT_DATE)::int
    AND target_month = EXTRACT(MONTH FROM CURRENT_DATE)::int;

  v_deficit := v_monthly_expected - v_net_profit;

  v_result := jsonb_build_object(
    'total_sales', v_total_sales,
    'total_purchases', v_total_purchases,
    'total_expenses', v_total_expenses,
    'total_cogs', v_total_cogs,
    'gross_profit', v_gross_profit,
    'net_profit', v_net_profit,
    'stock_value', v_stock_value,
    'low_stock_count', v_low_stock_count,
    'total_products', v_total_products,
    'total_employees', v_total_employees,
    'expected_profit', v_monthly_expected,
    'deficit', v_deficit,
    'start_date', v_start,
    'end_date', v_end
  );

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  AS $function$
BEGIN
  INSERT INTO public.profiles (id, name, role, status)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data ->> 'role', 'owner'),
    'active'
  );
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.is_admin()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  AS $function$
  SELECT public.current_user_role() = 'admin';
$function$;

CREATE OR REPLACE FUNCTION public.process_purchase (
  p_purchase_items jsonb,
  p_supplier_id    uuid  DEFAULT NULL::uuid,
  p_invoice_number text  DEFAULT NULL::text,
  p_note           text  DEFAULT NULL::text,
  p_purchase_date  date  DEFAULT CURRENT_DATE
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  AS $function$
DECLARE
  v_purchase_id uuid;
  v_item jsonb;
  v_product_id uuid;
  v_qty numeric;
  v_buy_price numeric;
  v_total numeric := 0;
  v_item_total numeric;
BEGIN
  -- Create purchase header
  INSERT INTO public.purchases (supplier_id, invoice_number, purchase_date, note, created_by)
  VALUES (p_supplier_id, p_invoice_number, p_purchase_date, p_note, auth.uid())
  RETURNING id INTO v_purchase_id;

  -- Process each item
  FOR v_item IN SELECT jsonb_array_elements(p_purchase_items)
  LOOP
    v_product_id := (v_item ->> 'product_id')::uuid;
    v_qty := (v_item ->> 'quantity')::numeric;
    v_buy_price := (v_item ->> 'buying_price')::numeric;

    v_item_total := v_qty * v_buy_price;

    -- Insert purchase item
    INSERT INTO public.purchase_items (purchase_id, product_id, quantity, buying_price, total)
    VALUES (v_purchase_id, v_product_id, v_qty, v_buy_price, v_item_total);

    -- Increase stock
    UPDATE public.products SET current_stock = current_stock + v_qty, updated_at = now()
    WHERE id = v_product_id;

    -- Record stock movement
    INSERT INTO public.stock_movements (product_id, movement_type, quantity, reference_type, reference_id)
    VALUES (v_product_id, 'purchase', v_qty, 'purchase', v_purchase_id);

    -- Update buying price on product
    UPDATE public.products SET buying_price = v_buy_price, updated_at = now()
    WHERE id = v_product_id;

    v_total := v_total + v_item_total;
  END LOOP;

  -- Update purchase total
  UPDATE public.purchases SET total_amount = v_total WHERE id = v_purchase_id;

  RETURN v_purchase_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.process_sale (
  p_sale_items     jsonb,
  p_customer_name  text  DEFAULT NULL::text,
  p_payment_method text  DEFAULT 'cash'::text,
  p_note           text  DEFAULT NULL::text,
  p_sale_date      date  DEFAULT CURRENT_DATE
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  AS $function$
DECLARE
  v_sale_id uuid;
  v_item jsonb;
  v_product_id uuid;
  v_variant_id uuid;
  v_qty numeric;
  v_sell_price numeric;
  v_buy_price numeric;
  v_total numeric := 0;
  v_cost numeric := 0;
  v_profit numeric := 0;
  v_item_total numeric;
  v_item_cost numeric;
  v_item_profit numeric;
  v_current_stock numeric;
  v_product_name text;
  v_brand text;
  v_size text;
BEGIN
  -- Create the sale header
  INSERT INTO public.sales (customer_name, payment_method, note, sale_date, created_by)
  VALUES (p_customer_name, p_payment_method, p_note, p_sale_date, auth.uid())
  RETURNING id INTO v_sale_id;

  -- Process each item
  FOR v_item IN SELECT jsonb_array_elements(p_sale_items)
  LOOP
    -- prefer variant_id if provided
    v_variant_id := (v_item ->> 'product_variant_id')::uuid;
    IF v_variant_id IS NOT NULL THEN
      -- lock variant row
      SELECT id, product_id, selling_price, cost_price, current_stock, brand, size
      INTO v_variant_id, v_product_id, v_sell_price, v_buy_price, v_current_stock, v_brand, v_size
      FROM public.product_variants WHERE id = v_variant_id FOR UPDATE;

      IF v_variant_id IS NULL THEN
        RAISE EXCEPTION 'Invalid product variant';
      END IF;

      v_qty := (v_item ->> 'quantity')::numeric;
      IF v_current_stock < v_qty THEN
        RAISE EXCEPTION 'Insufficient stock for variant %', v_variant_id;
      END IF;

      v_item_total := v_qty * v_sell_price;
      v_item_cost := v_qty * v_buy_price;
      v_item_profit := v_item_total - v_item_cost;

      -- Insert sale item with snapshot fields
      INSERT INTO public.sale_items (sale_id, product_id, product_variant_id, quantity, selling_price, buying_price, total, profit, product_name, brand, size, unit_price, cost_price)
      VALUES (v_sale_id, v_product_id, v_variant_id, v_qty, v_sell_price, v_buy_price, v_item_total, v_item_profit, (SELECT name FROM public.products WHERE id = v_product_id), v_brand, v_size, v_sell_price, v_buy_price);

      -- Reduce variant stock
      UPDATE public.product_variants SET current_stock = current_stock - v_qty, updated_at = now()
      WHERE id = v_variant_id;

      -- Reduce product aggregate stock if present (best-effort)
      UPDATE public.products SET current_stock = GREATEST(current_stock - v_qty, 0), updated_at = now()
      WHERE id = v_product_id;

      -- Record stock movement referencing variant
      INSERT INTO public.stock_movements (product_id, product_variant_id, movement_type, quantity, reference_type, reference_id)
      VALUES (v_product_id, v_variant_id, 'sale', -v_qty, 'sale', v_sale_id);

      v_total := v_total + v_item_total;
      v_cost := v_cost + v_item_cost;
      v_profit := v_profit + v_item_profit;

    ELSE
      -- Fallback to product-level processing (existing behaviour)
      v_product_id := (v_item ->> 'product_id')::uuid;
      v_qty := (v_item ->> 'quantity')::numeric;
      v_sell_price := (v_item ->> 'selling_price')::numeric;

      SELECT buying_price, current_stock, name INTO v_buy_price, v_current_stock, v_product_name
      FROM public.products WHERE id = v_product_id FOR UPDATE;

      IF v_current_stock < v_qty THEN
        RAISE EXCEPTION 'Insufficient stock for product %', v_product_id;
      END IF;

      v_item_total := v_qty * v_sell_price;
      v_item_cost := v_qty * v_buy_price;
      v_item_profit := v_item_total - v_item_cost;

      INSERT INTO public.sale_items (sale_id, product_id, quantity, selling_price, buying_price, total, profit, product_name, brand, size, unit_price, cost_price)
      VALUES (v_sale_id, v_product_id, v_qty, v_sell_price, v_buy_price, v_item_total, v_item_profit, v_product_name, NULL, NULL, v_sell_price, v_buy_price);

      UPDATE public.products SET current_stock = current_stock - v_qty, updated_at = now()
      WHERE id = v_product_id;

      INSERT INTO public.stock_movements (product_id, movement_type, quantity, reference_type, reference_id)
      VALUES (v_product_id, 'sale', -v_qty, 'sale', v_sale_id);

      v_total := v_total + v_item_total;
      v_cost := v_cost + v_item_cost;
      v_profit := v_profit + v_item_profit;
    END IF;
  END LOOP;

  -- Update sale totals
  UPDATE public.sales
  SET total_amount = v_total, total_cost = v_cost, total_profit = v_profit
  WHERE id = v_sale_id;

  RETURN v_sale_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_stock_adjustment (
  p_product_id uuid,
  p_new_stock  numeric,
  p_note       text    DEFAULT NULL::text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  AS $function$
DECLARE
  v_old_stock numeric;
  v_diff numeric;
BEGIN
  SELECT current_stock INTO v_old_stock FROM public.products WHERE id = p_product_id FOR UPDATE;

  v_diff := p_new_stock - v_old_stock;

  UPDATE public.products SET current_stock = p_new_stock, updated_at = now()
  WHERE id = p_product_id;

  INSERT INTO public.stock_movements (product_id, movement_type, quantity, reference_type, note)
  VALUES (p_product_id, 'adjustment', v_diff, 'adjustment', p_note);
END;
$function$;

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
  RETURNS event_trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'pg_catalog'
  AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

ALTER TABLE "public"."audit_logs"
  ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id);

ALTER TABLE "public"."expenses"
  ADD CONSTRAINT "expenses_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);

ALTER TABLE "public"."products"
  ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE SET NULL;

ALTER TABLE "public"."product_variants"
  ADD CONSTRAINT "product_variants_product_id_fkey" FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;

ALTER TABLE "public"."profiles"
  ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."purchase_items"
  ADD CONSTRAINT "purchase_items_product_id_fkey" FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;

ALTER TABLE "public"."purchases"
  ADD CONSTRAINT "purchases_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);

ALTER TABLE "public"."purchase_items"
  ADD CONSTRAINT "purchase_items_purchase_id_fkey" FOREIGN KEY (purchase_id) REFERENCES public.purchases(id) ON DELETE CASCADE;

ALTER TABLE "public"."salary_records"
  ADD CONSTRAINT "salary_records_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);

ALTER TABLE "public"."salary_records"
  ADD CONSTRAINT "salary_records_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;

ALTER TABLE "public"."sale_items"
  ADD CONSTRAINT "sale_items_product_id_fkey" FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;

ALTER TABLE "public"."sale_items"
  ADD CONSTRAINT "sale_items_product_variant_id_fkey" FOREIGN KEY (product_variant_id) REFERENCES public.product_variants(id) ON DELETE SET NULL;

ALTER TABLE "public"."sales"
  ADD CONSTRAINT "sales_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);

ALTER TABLE "public"."sale_items"
  ADD CONSTRAINT "sale_items_sale_id_fkey" FOREIGN KEY (sale_id) REFERENCES public.sales(id) ON DELETE CASCADE;

ALTER TABLE "public"."stock_movements"
  ADD CONSTRAINT "stock_movements_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);

ALTER TABLE "public"."stock_movements"
  ADD CONSTRAINT "stock_movements_product_id_fkey" FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;

ALTER TABLE "public"."stock_movements"
  ADD CONSTRAINT "stock_movements_product_variant_id_fkey" FOREIGN KEY (product_variant_id) REFERENCES public.product_variants(id) ON DELETE SET NULL;

ALTER TABLE "public"."subcategories"
  ADD CONSTRAINT "subcategories_category_id_fkey" FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE SET NULL;

ALTER TABLE "public"."products"
  ADD CONSTRAINT "products_supplier_id_fkey" FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE SET NULL;

ALTER TABLE "public"."purchases"
  ADD CONSTRAINT "purchases_supplier_id_fkey" FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE SET NULL;

CREATE INDEX idx_audit_logs_action ON public.audit_logs USING btree (action);

CREATE INDEX idx_audit_logs_created ON public.audit_logs USING btree (created_at);

CREATE INDEX idx_audit_logs_user ON public.audit_logs USING btree (user_id);

CREATE INDEX idx_expenses_category ON public.expenses USING btree (category);

CREATE INDEX idx_expenses_date ON public.expenses USING btree (expense_date);

CREATE INDEX idx_product_variants_product ON public.product_variants USING btree (product_id);

CREATE INDEX idx_product_variants_sku ON public.product_variants USING btree (sku);

CREATE INDEX idx_products_category ON public.products USING btree (category_id);

CREATE INDEX idx_products_status ON public.products USING btree (status);

CREATE INDEX idx_products_subcategory ON public.products USING btree (subcategory_id);

CREATE INDEX idx_products_supplier ON public.products USING btree (supplier_id);

CREATE UNIQUE INDEX idx_profit_targets_unique ON public.profit_targets USING btree (target_year, target_month);

CREATE INDEX idx_purchase_items_product ON public.purchase_items USING btree (product_id);

CREATE INDEX idx_purchase_items_purchase ON public.purchase_items USING btree (purchase_id);

CREATE INDEX idx_purchases_date ON public.purchases USING btree (purchase_date);

CREATE INDEX idx_purchases_supplier ON public.purchases USING btree (supplier_id);

CREATE INDEX idx_salary_records_employee ON public.salary_records USING btree (employee_id);

CREATE INDEX idx_salary_records_period ON public.salary_records USING btree (pay_period_year, pay_period_month);

CREATE INDEX idx_sale_items_product ON public.sale_items USING btree (product_id);

CREATE INDEX idx_sale_items_sale ON public.sale_items USING btree (sale_id);

CREATE INDEX idx_sale_items_variant ON public.sale_items USING btree (product_variant_id);

CREATE INDEX idx_sales_date ON public.sales USING btree (sale_date);

CREATE INDEX idx_sales_payment ON public.sales USING btree (payment_method);

CREATE INDEX idx_stock_movements_created ON public.stock_movements USING btree (created_at);

CREATE INDEX idx_stock_movements_product ON public.stock_movements USING btree (product_id);

CREATE INDEX idx_stock_movements_type ON public.stock_movements USING btree (movement_type);

CREATE INDEX idx_stock_movements_variant ON public.stock_movements USING btree (product_variant_id);

CREATE INDEX idx_subcategories_category ON public.subcategories USING btree (category_id);

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

CREATE TRIGGER trg_generate_sale_number
  BEFORE INSERT ON public.sales
  FOR EACH ROW
  EXECUTE FUNCTION public.generate_sale_number();

CREATE POLICY "audit_logs_insert" ON "public"."audit_logs"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (true);

CREATE POLICY "audit_logs_select" ON "public"."audit_logs"
  FOR SELECT
  TO "authenticated"
  USING (true);

CREATE POLICY "categories_delete" ON "public"."categories"
  FOR DELETE
  TO "authenticated"
  USING (public.is_admin());

CREATE POLICY "categories_insert" ON "public"."categories"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (public.is_admin());

CREATE POLICY "categories_select" ON "public"."categories"
  FOR SELECT
  TO "authenticated"
  USING (true);

CREATE POLICY "categories_update" ON "public"."categories"
  FOR UPDATE
  TO "authenticated"
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "employees_delete" ON "public"."employees"
  FOR DELETE
  TO "authenticated"
  USING (public.is_admin());

CREATE POLICY "employees_insert" ON "public"."employees"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (public.is_admin());

CREATE POLICY "employees_select" ON "public"."employees"
  FOR SELECT
  TO "authenticated"
  USING (true);

CREATE POLICY "employees_update" ON "public"."employees"
  FOR UPDATE
  TO "authenticated"
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "expenses_delete" ON "public"."expenses"
  FOR DELETE
  TO "authenticated"
  USING (public.is_admin());

CREATE POLICY "expenses_insert" ON "public"."expenses"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (public.is_admin());

CREATE POLICY "expenses_select" ON "public"."expenses"
  FOR SELECT
  TO "authenticated"
  USING (true);

CREATE POLICY "expenses_update" ON "public"."expenses"
  FOR UPDATE
  TO "authenticated"
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "product_variants_delete" ON "public"."product_variants"
  FOR DELETE
  TO "authenticated"
  USING (public.is_admin());

CREATE POLICY "product_variants_insert" ON "public"."product_variants"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (public.is_admin());

CREATE POLICY "product_variants_select" ON "public"."product_variants"
  FOR SELECT
  TO "authenticated"
  USING (true);

CREATE POLICY "product_variants_update" ON "public"."product_variants"
  FOR UPDATE
  TO "authenticated"
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "products_delete" ON "public"."products"
  FOR DELETE
  TO "authenticated"
  USING (public.is_admin());

CREATE POLICY "products_insert" ON "public"."products"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (public.is_admin());

CREATE POLICY "products_select" ON "public"."products"
  FOR SELECT
  TO "authenticated"
  USING (true);

CREATE POLICY "products_update" ON "public"."products"
  FOR UPDATE
  TO "authenticated"
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "profiles_delete" ON "public"."profiles"
  FOR DELETE
  TO "authenticated"
  USING (public.is_admin());

CREATE POLICY "profiles_insert" ON "public"."profiles"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (public.is_admin());

CREATE POLICY "profiles_select" ON "public"."profiles"
  FOR SELECT
  TO "authenticated"
  USING (true);

CREATE POLICY "profiles_update" ON "public"."profiles"
  FOR UPDATE
  TO "authenticated"
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "profit_targets_delete" ON "public"."profit_targets"
  FOR DELETE
  TO "authenticated"
  USING (public.is_admin());

CREATE POLICY "profit_targets_insert" ON "public"."profit_targets"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (public.is_admin());

CREATE POLICY "profit_targets_select" ON "public"."profit_targets"
  FOR SELECT
  TO "authenticated"
  USING (true);

CREATE POLICY "profit_targets_update" ON "public"."profit_targets"
  FOR UPDATE
  TO "authenticated"
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "purchase_items_insert" ON "public"."purchase_items"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (public.is_admin());

CREATE POLICY "purchase_items_select" ON "public"."purchase_items"
  FOR SELECT
  TO "authenticated"
  USING (true);

CREATE POLICY "purchases_delete" ON "public"."purchases"
  FOR DELETE
  TO "authenticated"
  USING (public.is_admin());

CREATE POLICY "purchases_insert" ON "public"."purchases"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (public.is_admin());

CREATE POLICY "purchases_select" ON "public"."purchases"
  FOR SELECT
  TO "authenticated"
  USING (true);

CREATE POLICY "salary_records_delete" ON "public"."salary_records"
  FOR DELETE
  TO "authenticated"
  USING (public.is_admin());

CREATE POLICY "salary_records_insert" ON "public"."salary_records"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (public.is_admin());

CREATE POLICY "salary_records_select" ON "public"."salary_records"
  FOR SELECT
  TO "authenticated"
  USING (true);

CREATE POLICY "salary_records_update" ON "public"."salary_records"
  FOR UPDATE
  TO "authenticated"
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "sale_items_insert" ON "public"."sale_items"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (public.is_admin());

CREATE POLICY "sale_items_select" ON "public"."sale_items"
  FOR SELECT
  TO "authenticated"
  USING (true);

CREATE POLICY "sales_delete" ON "public"."sales"
  FOR DELETE
  TO "authenticated"
  USING (public.is_admin());

CREATE POLICY "sales_insert" ON "public"."sales"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (public.is_admin());

CREATE POLICY "sales_select" ON "public"."sales"
  FOR SELECT
  TO "authenticated"
  USING (true);

CREATE POLICY "stock_movements_insert" ON "public"."stock_movements"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (public.is_admin());

CREATE POLICY "stock_movements_select" ON "public"."stock_movements"
  FOR SELECT
  TO "authenticated"
  USING (true);

CREATE POLICY "subcategories_delete" ON "public"."subcategories"
  FOR DELETE
  TO "authenticated"
  USING (public.is_admin());

CREATE POLICY "subcategories_insert" ON "public"."subcategories"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (public.is_admin());

CREATE POLICY "subcategories_select" ON "public"."subcategories"
  FOR SELECT
  TO "authenticated"
  USING (true);

CREATE POLICY "subcategories_update" ON "public"."subcategories"
  FOR UPDATE
  TO "authenticated"
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "suppliers_delete" ON "public"."suppliers"
  FOR DELETE
  TO "authenticated"
  USING (public.is_admin());

CREATE POLICY "suppliers_insert" ON "public"."suppliers"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (public.is_admin());

CREATE POLICY "suppliers_select" ON "public"."suppliers"
  FOR SELECT
  TO "authenticated"
  USING (true);

CREATE POLICY "suppliers_update" ON "public"."suppliers"
  FOR UPDATE
  TO "authenticated"
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "system_settings_insert" ON "public"."system_settings"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (public.is_admin());

CREATE POLICY "system_settings_select" ON "public"."system_settings"
  FOR SELECT
  TO "authenticated"
  USING (true);

CREATE POLICY "system_settings_update" ON "public"."system_settings"
  FOR UPDATE
  TO "authenticated"
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE EVENT TRIGGER "ensure_rls"
  ON ddl_command_end
  WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  EXECUTE FUNCTION "public"."rls_auto_enable"();

GRANT EXECUTE ON FUNCTION "public"."current_user_role"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."generate_sale_number"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_dashboard_summary"(date, date) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."handle_new_user"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."is_admin"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."process_purchase"(jsonb, uuid, text, text, date) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."process_sale"(jsonb, text, text, text, date) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."record_stock_adjustment"(uuid, numeric, text) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT EXECUTE ON FUNCTION "public"."rls_auto_enable"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."audit_logs" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."categories" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."employees" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."expenses" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."product_variants" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."products" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."profiles" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."profit_targets" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."purchase_items" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."purchases" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."salary_records" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."sale_items" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."sales" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."stock_movements" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."subcategories" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."suppliers" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."system_settings" TO "anon", "authenticated", "postgres", "service_role";
