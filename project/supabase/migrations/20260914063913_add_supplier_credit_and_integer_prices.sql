/*
# Add supplier credit tracking, purchase payment status, and integer constraints

## Changes
1. Add `payment_status` column to `purchases` (paid, partial, credit) — tracks whether a purchase was paid in full, partially, or on credit
2. Add `amount_paid` column to `purchases` — how much has been paid so far
3. Add `credit_balance` column to `suppliers` — running total of outstanding credit owed to supplier
4. Add `profit_per_unit` column to `products` — auto-calculated as selling_price - buying_price
5. Update `process_purchase` function to accept payment_status and amount_paid, and update supplier credit_balance
6. Update `process_sale` function to use product's selling_price directly (no manual price entry)
7. Add supplier credit payment function to record payments toward credit balances
8. Add RLS policies for new columns (inherited from existing table policies)

## Security
- All new columns inherit existing RLS policies from their parent tables
- No new tables created, so no new policies needed
- The is_admin() check on existing policies covers the new columns
*/

-- Add payment_status to purchases
ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'paid' CHECK (payment_status IN ('paid', 'partial', 'credit'));

-- Add amount_paid to purchases
ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS amount_paid numeric(14,2) NOT NULL DEFAULT 0;

-- Add credit_balance to suppliers (outstanding credit owed)
ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS credit_balance numeric(14,2) NOT NULL DEFAULT 0;

-- Add profit_per_unit to products (auto-calculated)
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS profit_per_unit integer NOT NULL DEFAULT 0;

-- Auto-calculate profit_per_unit when buying_price or selling_price changes
CREATE OR REPLACE FUNCTION public.update_profit_per_unit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  NEW.profit_per_unit := (NEW.selling_price - NEW.buying_price)::integer;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_update_profit_per_unit ON public.products;
CREATE TRIGGER trg_update_profit_per_unit
  BEFORE INSERT OR UPDATE OF buying_price, selling_price ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.update_profit_per_unit();

-- Update process_purchase to handle payment status and supplier credit
CREATE OR REPLACE FUNCTION public.process_purchase(
  p_purchase_items jsonb,
  p_supplier_id uuid DEFAULT NULL,
  p_invoice_number text DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_purchase_date date DEFAULT CURRENT_DATE,
  p_payment_status text DEFAULT 'paid',
  p_amount_paid numeric DEFAULT 0
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_purchase_id uuid;
  v_item jsonb;
  v_product_id uuid;
  v_qty integer;
  v_buy_price integer;
  v_total integer := 0;
  v_item_total integer;
  v_credit_amount numeric;
BEGIN
  -- Create purchase header
  INSERT INTO public.purchases (supplier_id, invoice_number, purchase_date, note, created_by, payment_status, amount_paid)
  VALUES (p_supplier_id, p_invoice_number, p_purchase_date, p_note, auth.uid(), p_payment_status, p_amount_paid)
  RETURNING id INTO v_purchase_id;

  -- Process each item
  FOR v_item IN SELECT jsonb_array_elements(p_purchase_items)
  LOOP
    v_product_id := (v_item ->> 'product_id')::uuid;
    v_qty := (v_item ->> 'quantity')::integer;
    v_buy_price := (v_item ->> 'buying_price')::integer;

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

    -- Update buying price on product (triggers profit_per_unit recalculation)
    UPDATE public.products SET buying_price = v_buy_price, updated_at = now()
    WHERE id = v_product_id;

    v_total := v_total + v_item_total;
  END LOOP;

  -- Update purchase total
  UPDATE public.purchases SET total_amount = v_total WHERE id = v_purchase_id;

  -- Update supplier credit balance if purchase is on credit
  IF p_supplier_id IS NOT NULL THEN
    IF p_payment_status = 'credit' THEN
      v_credit_amount := v_total;
    ELSIF p_payment_status = 'partial' THEN
      v_credit_amount := v_total - p_amount_paid;
    ELSE
      v_credit_amount := 0;
    END IF;

    IF v_credit_amount > 0 THEN
      UPDATE public.suppliers
      SET credit_balance = credit_balance + v_credit_amount, updated_at = now()
      WHERE id = p_supplier_id;
    END IF;
  END IF;

  RETURN v_purchase_id;
END;
$$;

-- Update process_sale to use product's selling_price directly (no manual entry)
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
  v_qty integer;
  v_sell_price integer;
  v_buy_price integer;
  v_total integer := 0;
  v_cost integer := 0;
  v_profit integer := 0;
  v_item_total integer;
  v_item_cost integer;
  v_item_profit integer;
  v_current_stock integer;
BEGIN
  -- Create the sale header
  INSERT INTO public.sales (customer_name, payment_method, note, sale_date, created_by)
  VALUES (p_customer_name, p_payment_method, p_note, p_sale_date, auth.uid())
  RETURNING id INTO v_sale_id;

  -- Process each item
  FOR v_item IN SELECT jsonb_array_elements(p_sale_items)
  LOOP
    v_product_id := (v_item ->> 'product_id')::uuid;
    v_qty := (v_item ->> 'quantity')::integer;

    -- Get selling price and buying price from product (universal pricing)
    SELECT selling_price, buying_price, current_stock INTO v_sell_price, v_buy_price, v_current_stock
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

-- Function: record supplier credit payment
CREATE OR REPLACE FUNCTION public.record_supplier_payment(
  p_supplier_id uuid,
  p_amount numeric,
  p_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.suppliers
  SET credit_balance = GREATEST(0, credit_balance - p_amount), updated_at = now()
  WHERE id = p_supplier_id;
END;
$$;