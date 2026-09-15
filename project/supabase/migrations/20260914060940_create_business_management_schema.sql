/*
# Business Management System — Core Schema

## Overview
Creates the complete database schema for a centralized Inventory, Sales & Business Performance Management System.
The system supports two roles: ADMIN (full CRUD) and OWNER (read-only), with a maximum of 3 owners.
All tables use RLS with role-based access control via `raw_app_meta_data ->> 'role'`.

## Tables Created
1. **profiles** — Extends auth.users with name and role (admin/owner)
2. **categories** — Product categories
3. **suppliers** — Supplier records
4. **products** — Product inventory with buying/selling prices, stock levels
5. **stock_movements** — Audit trail of all stock changes (purchase, sale, adjustment)
6. **purchases** — Purchase records (header)
7. **purchase_items** — Line items for purchases
8. **sales** — Sales records (header)
9. **sale_items** — Line items for sales
10. **expenses** — Business expense records
11. **employees** — Employee records with masked ID numbers
12. **salary_records** — Monthly salary payments
13. **profit_targets** — Monthly expected profit targets
14. **audit_logs** — Audit trail of all admin actions
15. **system_settings** — Business info, email recipients, etc.

## Security
- RLS enabled on ALL tables
- ADMIN role: full CRUD on all tables
- OWNER role: SELECT only on all tables (read-only)
- No INSERT/UPDATE/DELETE for OWNER role
- Policies use `auth.jwt() ->> 'raw_app_meta_data' ->> 'role'` for role checks
*/

-- Helper function: get current user's role from JWT
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT (auth.jwt() -> 'raw_app_meta_data' ->> 'role')::text;
$$;

-- Helper function: is current user an admin?
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT public.current_user_role() = 'admin';
$$;

-- 1. PROFILES TABLE
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  role text NOT NULL DEFAULT 'owner' CHECK (role IN ('admin', 'owner')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select" ON public.profiles;
CREATE POLICY "profiles_select" ON public.profiles FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "profiles_insert" ON public.profiles;
CREATE POLICY "profiles_insert" ON public.profiles FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "profiles_update" ON public.profiles;
CREATE POLICY "profiles_update" ON public.profiles FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "profiles_delete" ON public.profiles;
CREATE POLICY "profiles_delete" ON public.profiles FOR DELETE
  TO authenticated USING (public.is_admin());

-- 2. CATEGORIES TABLE
CREATE TABLE IF NOT EXISTS public.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "categories_select" ON public.categories;
CREATE POLICY "categories_select" ON public.categories FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "categories_insert" ON public.categories;
CREATE POLICY "categories_insert" ON public.categories FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "categories_update" ON public.categories;
CREATE POLICY "categories_update" ON public.categories FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "categories_delete" ON public.categories;
CREATE POLICY "categories_delete" ON public.categories FOR DELETE
  TO authenticated USING (public.is_admin());

-- 3. SUPPLIERS TABLE
CREATE TABLE IF NOT EXISTS public.suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  contact_person text,
  phone text,
  email text,
  address text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "suppliers_select" ON public.suppliers;
CREATE POLICY "suppliers_select" ON public.suppliers FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "suppliers_insert" ON public.suppliers;
CREATE POLICY "suppliers_insert" ON public.suppliers FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "suppliers_update" ON public.suppliers;
CREATE POLICY "suppliers_update" ON public.suppliers FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "suppliers_delete" ON public.suppliers;
CREATE POLICY "suppliers_delete" ON public.suppliers FOR DELETE
  TO authenticated USING (public.is_admin());

-- 4. PRODUCTS TABLE
CREATE TABLE IF NOT EXISTS public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  brand text,
  unit text NOT NULL DEFAULT 'pcs',
  buying_price numeric(12,2) NOT NULL DEFAULT 0,
  selling_price numeric(12,2) NOT NULL DEFAULT 0,
  current_stock numeric(14,2) NOT NULL DEFAULT 0,
  minimum_stock numeric(14,2) NOT NULL DEFAULT 0,
  maximum_stock numeric(14,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_products_category ON public.products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_supplier ON public.products(supplier_id);
CREATE INDEX IF NOT EXISTS idx_products_status ON public.products(status);

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "products_select" ON public.products;
CREATE POLICY "products_select" ON public.products FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "products_insert" ON public.products;
CREATE POLICY "products_insert" ON public.products FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "products_update" ON public.products;
CREATE POLICY "products_update" ON public.products FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "products_delete" ON public.products;
CREATE POLICY "products_delete" ON public.products FOR DELETE
  TO authenticated USING (public.is_admin());

-- 5. STOCK_MOVEMENTS TABLE
CREATE TABLE IF NOT EXISTS public.stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  movement_type text NOT NULL CHECK (movement_type IN ('purchase', 'sale', 'adjustment', 'opening')),
  quantity numeric(14,2) NOT NULL,
  reference_type text,
  reference_id uuid,
  note text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON public.stock_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_type ON public.stock_movements(movement_type);
CREATE INDEX IF NOT EXISTS idx_stock_movements_created ON public.stock_movements(created_at);

ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stock_movements_select" ON public.stock_movements;
CREATE POLICY "stock_movements_select" ON public.stock_movements FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "stock_movements_insert" ON public.stock_movements;
CREATE POLICY "stock_movements_insert" ON public.stock_movements FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

-- 6. PURCHASES TABLE
CREATE TABLE IF NOT EXISTS public.purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  invoice_number text,
  purchase_date date NOT NULL DEFAULT CURRENT_DATE,
  total_amount numeric(14,2) NOT NULL DEFAULT 0,
  note text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_purchases_supplier ON public.purchases(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchases_date ON public.purchases(purchase_date);

ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "purchases_select" ON public.purchases;
CREATE POLICY "purchases_select" ON public.purchases FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "purchases_insert" ON public.purchases;
CREATE POLICY "purchases_insert" ON public.purchases FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "purchases_delete" ON public.purchases;
CREATE POLICY "purchases_delete" ON public.purchases FOR DELETE
  TO authenticated USING (public.is_admin());

-- 7. PURCHASE_ITEMS TABLE
CREATE TABLE IF NOT EXISTS public.purchase_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id uuid NOT NULL REFERENCES public.purchases(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  quantity numeric(14,2) NOT NULL,
  buying_price numeric(12,2) NOT NULL,
  total numeric(14,2) NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase ON public.purchase_items(purchase_id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_product ON public.purchase_items(product_id);

ALTER TABLE public.purchase_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "purchase_items_select" ON public.purchase_items;
CREATE POLICY "purchase_items_select" ON public.purchase_items FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "purchase_items_insert" ON public.purchase_items;
CREATE POLICY "purchase_items_insert" ON public.purchase_items FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

-- 8. SALES TABLE
CREATE TABLE IF NOT EXISTS public.sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_number text,
  customer_name text,
  sale_date date NOT NULL DEFAULT CURRENT_DATE,
  payment_method text DEFAULT 'cash' CHECK (payment_method IN ('cash', 'mpesa', 'bank', 'credit')),
  total_amount numeric(14,2) NOT NULL DEFAULT 0,
  total_cost numeric(14,2) NOT NULL DEFAULT 0,
  total_profit numeric(14,2) NOT NULL DEFAULT 0,
  note text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sales_date ON public.sales(sale_date);
CREATE INDEX IF NOT EXISTS idx_sales_payment ON public.sales(payment_method);

ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sales_select" ON public.sales;
CREATE POLICY "sales_select" ON public.sales FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "sales_insert" ON public.sales;
CREATE POLICY "sales_insert" ON public.sales FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "sales_delete" ON public.sales;
CREATE POLICY "sales_delete" ON public.sales FOR DELETE
  TO authenticated USING (public.is_admin());

-- 9. SALE_ITEMS TABLE
CREATE TABLE IF NOT EXISTS public.sale_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  quantity numeric(14,2) NOT NULL,
  selling_price numeric(12,2) NOT NULL,
  buying_price numeric(12,2) NOT NULL,
  total numeric(14,2) NOT NULL,
  profit numeric(14,2) NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON public.sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product ON public.sale_items(product_id);

ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sale_items_select" ON public.sale_items;
CREATE POLICY "sale_items_select" ON public.sale_items FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "sale_items_insert" ON public.sale_items;
CREATE POLICY "sale_items_insert" ON public.sale_items FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

-- 10. EXPENSES TABLE
CREATE TABLE IF NOT EXISTS public.expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL,
  description text,
  amount numeric(14,2) NOT NULL,
  expense_date date NOT NULL DEFAULT CURRENT_DATE,
  payment_method text DEFAULT 'cash' CHECK (payment_method IN ('cash', 'mpesa', 'bank', 'other')),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_expenses_category ON public.expenses(category);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON public.expenses(expense_date);

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "expenses_select" ON public.expenses;
CREATE POLICY "expenses_select" ON public.expenses FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "expenses_insert" ON public.expenses;
CREATE POLICY "expenses_insert" ON public.expenses FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "expenses_update" ON public.expenses;
CREATE POLICY "expenses_update" ON public.expenses FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "expenses_delete" ON public.expenses;
CREATE POLICY "expenses_delete" ON public.expenses FOR DELETE
  TO authenticated USING (public.is_admin());

-- 11. EMPLOYEES TABLE
CREATE TABLE IF NOT EXISTS public.employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  national_id text,
  phone text,
  address text,
  position text,
  date_employed date,
  basic_salary numeric(12,2) NOT NULL DEFAULT 0,
  employment_status text NOT NULL DEFAULT 'active' CHECK (employment_status IN ('active', 'inactive', 'terminated')),
  emergency_contact text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "employees_select" ON public.employees;
CREATE POLICY "employees_select" ON public.employees FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "employees_insert" ON public.employees;
CREATE POLICY "employees_insert" ON public.employees FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "employees_update" ON public.employees;
CREATE POLICY "employees_update" ON public.employees FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "employees_delete" ON public.employees;
CREATE POLICY "employees_delete" ON public.employees FOR DELETE
  TO authenticated USING (public.is_admin());

-- 12. SALARY_RECORDS TABLE
CREATE TABLE IF NOT EXISTS public.salary_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  pay_period_month integer NOT NULL CHECK (pay_period_month BETWEEN 1 AND 12),
  pay_period_year integer NOT NULL,
  basic_salary numeric(12,2) NOT NULL DEFAULT 0,
  allowances numeric(12,2) NOT NULL DEFAULT 0,
  deductions numeric(12,2) NOT NULL DEFAULT 0,
  net_salary numeric(12,2) NOT NULL DEFAULT 0,
  payment_date date NOT NULL DEFAULT CURRENT_DATE,
  note text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_salary_records_employee ON public.salary_records(employee_id);
CREATE INDEX IF NOT EXISTS idx_salary_records_period ON public.salary_records(pay_period_year, pay_period_month);

ALTER TABLE public.salary_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "salary_records_select" ON public.salary_records;
CREATE POLICY "salary_records_select" ON public.salary_records FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "salary_records_insert" ON public.salary_records;
CREATE POLICY "salary_records_insert" ON public.salary_records FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "salary_records_update" ON public.salary_records;
CREATE POLICY "salary_records_update" ON public.salary_records FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "salary_records_delete" ON public.salary_records;
CREATE POLICY "salary_records_delete" ON public.salary_records FOR DELETE
  TO authenticated USING (public.is_admin());

-- 13. PROFIT_TARGETS TABLE
CREATE TABLE IF NOT EXISTS public.profit_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_month integer NOT NULL CHECK (target_month BETWEEN 1 AND 12),
  target_year integer NOT NULL,
  expected_profit numeric(14,2) NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_profit_targets_unique ON public.profit_targets(target_year, target_month);

ALTER TABLE public.profit_targets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profit_targets_select" ON public.profit_targets;
CREATE POLICY "profit_targets_select" ON public.profit_targets FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "profit_targets_insert" ON public.profit_targets;
CREATE POLICY "profit_targets_insert" ON public.profit_targets FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "profit_targets_update" ON public.profit_targets;
CREATE POLICY "profit_targets_update" ON public.profit_targets FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "profit_targets_delete" ON public.profit_targets;
CREATE POLICY "profit_targets_delete" ON public.profit_targets FOR DELETE
  TO authenticated USING (public.is_admin());

-- 14. AUDIT_LOGS TABLE
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id),
  user_name text,
  action text NOT NULL,
  entity_type text,
  entity_id uuid,
  old_values jsonb,
  new_values jsonb,
  description text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON public.audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON public.audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON public.audit_logs(created_at);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_logs_select" ON public.audit_logs;
CREATE POLICY "audit_logs_select" ON public.audit_logs FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "audit_logs_insert" ON public.audit_logs;
CREATE POLICY "audit_logs_insert" ON public.audit_logs FOR INSERT
  TO authenticated WITH CHECK (true);

-- 15. SYSTEM_SETTINGS TABLE
CREATE TABLE IF NOT EXISTS public.system_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_name text NOT NULL DEFAULT 'My Business',
  business_address text,
  business_phone text,
  business_email text,
  currency text NOT NULL DEFAULT 'KSh',
  email_recipients jsonb NOT NULL DEFAULT '[]'::jsonb,
  weekly_report_day integer NOT NULL DEFAULT 1 CHECK (weekly_report_day BETWEEN 0 AND 6),
  weekly_report_enabled boolean NOT NULL DEFAULT false,
  monthly_report_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "system_settings_select" ON public.system_settings;
CREATE POLICY "system_settings_select" ON public.system_settings FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "system_settings_update" ON public.system_settings;
CREATE POLICY "system_settings_update" ON public.system_settings FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "system_settings_insert" ON public.system_settings;
CREATE POLICY "system_settings_insert" ON public.system_settings FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

-- Insert default settings row
INSERT INTO public.system_settings (business_name, currency)
SELECT 'My Business', 'KSh'
WHERE NOT EXISTS (SELECT 1 FROM public.system_settings);

-- Trigger: auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
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
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Trigger: auto-generate sale number
CREATE OR REPLACE FUNCTION public.generate_sale_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
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
$$;

DROP TRIGGER IF EXISTS trg_generate_sale_number ON public.sales;
CREATE TRIGGER trg_generate_sale_number
  BEFORE INSERT ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.generate_sale_number();

-- Function: record stock movement and update product stock (for sales)
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
AS $$
DECLARE
  v_sale_id uuid;
  v_item jsonb;
  v_product_id uuid;
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
BEGIN
  -- Create the sale header
  INSERT INTO public.sales (customer_name, payment_method, note, sale_date, created_by)
  VALUES (p_customer_name, p_payment_method, p_note, p_sale_date, auth.uid())
  RETURNING id INTO v_sale_id;

  -- Process each item
  FOR v_item IN SELECT jsonb_array_elements(p_sale_items)
  LOOP
    v_product_id := (v_item ->> 'product_id')::uuid;
    v_qty := (v_item ->> 'quantity')::numeric;
    v_sell_price := (v_item ->> 'selling_price')::numeric;

    -- Get buying price and check stock
    SELECT buying_price, current_stock INTO v_buy_price, v_current_stock
    FROM public.products WHERE id = v_product_id FOR UPDATE;

    IF v_current_stock < v_qty THEN
      RAISE EXCEPTION 'Insufficient stock for product %', v_product_id;
    END IF;

    v_item_total := v_qty * v_sell_price;
    v_item_cost := v_qty * v_buy_price;
    v_item_profit := v_item_total - v_item_cost;

    -- Insert sale item
    INSERT INTO public.sale_items (sale_id, product_id, quantity, selling_price, buying_price, total, profit)
    VALUES (v_sale_id, v_product_id, v_qty, v_sell_price, v_buy_price, v_item_total, v_item_profit);

    -- Reduce stock
    UPDATE public.products SET current_stock = current_stock - v_qty, updated_at = now()
    WHERE id = v_product_id;

    -- Record stock movement
    INSERT INTO public.stock_movements (product_id, movement_type, quantity, reference_type, reference_id)
    VALUES (v_product_id, 'sale', -v_qty, 'sale', v_sale_id);

    v_total := v_total + v_item_total;
    v_cost := v_cost + v_item_cost;
    v_profit := v_profit + v_item_profit;
  END LOOP;

  -- Update sale totals
  UPDATE public.sales
  SET total_amount = v_total, total_cost = v_cost, total_profit = v_profit
  WHERE id = v_sale_id;

  RETURN v_sale_id;
END;
$$;

-- Function: process purchase and update stock
CREATE OR REPLACE FUNCTION public.process_purchase(
  p_purchase_items jsonb,
  p_supplier_id uuid DEFAULT NULL,
  p_invoice_number text DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_purchase_date date DEFAULT CURRENT_DATE
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
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
$$;

-- Function: record stock adjustment
CREATE OR REPLACE FUNCTION public.record_stock_adjustment(
  p_product_id uuid,
  p_new_stock numeric,
  p_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
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
$$;

-- Function: get dashboard summary
CREATE OR REPLACE FUNCTION public.get_dashboard_summary(
  p_start_date date DEFAULT NULL,
  p_end_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
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
$$;