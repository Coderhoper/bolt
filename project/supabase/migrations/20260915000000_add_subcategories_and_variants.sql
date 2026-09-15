-- Migration: Add subcategories and product_variants, extend sale_items and stock_movements, update process_sale
-- Idempotent where practical

-- 1. Subcategories table
CREATE TABLE IF NOT EXISTS public.subcategories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  name text NOT NULL,
  description text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.subcategories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "subcategories_select" ON public.subcategories;
CREATE POLICY "subcategories_select" ON public.subcategories FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "subcategories_insert" ON public.subcategories;
CREATE POLICY "subcategories_insert" ON public.subcategories FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "subcategories_update" ON public.subcategories;
CREATE POLICY "subcategories_update" ON public.subcategories FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "subcategories_delete" ON public.subcategories;
CREATE POLICY "subcategories_delete" ON public.subcategories FOR DELETE
  TO authenticated USING (public.is_admin());

CREATE INDEX IF NOT EXISTS idx_subcategories_category ON public.subcategories(category_id);


-- 2. Product variants table
CREATE TABLE IF NOT EXISTS public.product_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  brand text,
  size text,
  specification text,
  unit text DEFAULT 'pcs',
  sku text,
  cost_price numeric(12,2) NOT NULL DEFAULT 0,
  selling_price numeric(12,2) NOT NULL DEFAULT 0,
  current_stock numeric(14,2) NOT NULL DEFAULT 0,
  reorder_level numeric(14,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "product_variants_select" ON public.product_variants;
CREATE POLICY "product_variants_select" ON public.product_variants FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "product_variants_insert" ON public.product_variants;
CREATE POLICY "product_variants_insert" ON public.product_variants FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "product_variants_update" ON public.product_variants;
CREATE POLICY "product_variants_update" ON public.product_variants FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "product_variants_delete" ON public.product_variants;
CREATE POLICY "product_variants_delete" ON public.product_variants FOR DELETE
  TO authenticated USING (public.is_admin());

CREATE INDEX IF NOT EXISTS idx_product_variants_product ON public.product_variants(product_id);
CREATE INDEX IF NOT EXISTS idx_product_variants_sku ON public.product_variants(sku);


-- 3. Allow products to reference subcategory (non-breaking add)
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS subcategory_id uuid REFERENCES public.subcategories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_products_subcategory ON public.products(subcategory_id);


-- 4. Extend sale_items to store variant reference and snapshot fields
ALTER TABLE public.sale_items
  ADD COLUMN IF NOT EXISTS product_variant_id uuid REFERENCES public.product_variants(id) ON DELETE SET NULL;

ALTER TABLE public.sale_items
  ADD COLUMN IF NOT EXISTS product_name text;

ALTER TABLE public.sale_items
  ADD COLUMN IF NOT EXISTS brand text;

ALTER TABLE public.sale_items
  ADD COLUMN IF NOT EXISTS size text;

ALTER TABLE public.sale_items
  ADD COLUMN IF NOT EXISTS unit_price numeric(12,2);

ALTER TABLE public.sale_items
  ADD COLUMN IF NOT EXISTS cost_price numeric(12,2);

CREATE INDEX IF NOT EXISTS idx_sale_items_variant ON public.sale_items(product_variant_id);


-- 5. Extend stock_movements to reference product_variant when applicable
ALTER TABLE public.stock_movements
  ADD COLUMN IF NOT EXISTS product_variant_id uuid REFERENCES public.product_variants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_stock_movements_variant ON public.stock_movements(product_variant_id);


-- 6. Replace process_sale function with variant-aware implementation
DROP FUNCTION IF EXISTS public.process_sale(jsonb, text, text, text, date);

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
$$;
