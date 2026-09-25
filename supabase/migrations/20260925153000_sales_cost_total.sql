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
  v_sale_id uuid;
  v_item jsonb;
  v_product_id uuid;
  v_quantity numeric;
  v_product_name text;
  v_brand text;
  v_buying_price numeric;
  v_selling_price numeric;
  v_stock numeric;
  v_line_total numeric;
  v_line_cost numeric;
  v_total numeric := 0;
  v_cost numeric := 0;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only administrators can record sales';
  END IF;
  IF p_sale_items IS NULL OR jsonb_typeof(p_sale_items) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_sale_items) = 0 THEN
    RAISE EXCEPTION 'At least one sale item is required';
  END IF;

  INSERT INTO public.sales (customer_name, payment_method, note, sale_date, created_by)
  VALUES (p_customer_name, COALESCE(p_payment_method, 'cash'), p_note,
          COALESCE(p_sale_date, CURRENT_DATE), auth.uid())
  RETURNING id INTO v_sale_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_sale_items) AS entries(value)
  LOOP
    IF NULLIF(v_item->>'product_variant_id', '') IS NOT NULL
       OR NULLIF(v_item->>'selling_price', '') IS NOT NULL THEN
      RAISE EXCEPTION 'Sales accept catalogue inventory IDs and quantities only';
    END IF;
    v_product_id := NULLIF(v_item->>'product_id', '')::uuid;
    v_quantity := NULLIF(v_item->>'quantity', '')::numeric;
    IF v_product_id IS NULL OR v_quantity IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'Each sale item needs a product and a positive quantity';
    END IF;

    SELECT p.name, p.brand, p.buying_price, p.selling_price, p.current_stock
      INTO v_product_name, v_brand, v_buying_price, v_selling_price, v_stock
      FROM public.products p
     WHERE p.id = v_product_id
       AND p.status = 'active'
       AND p.catalog_variant_id IS NOT NULL
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product % is not an active catalogue inventory item', v_product_id;
    END IF;
    IF v_stock < v_quantity THEN
      RAISE EXCEPTION 'Insufficient stock for % (available %, requested %)',
        v_product_name, v_stock, v_quantity;
    END IF;

    v_line_total := v_quantity * v_selling_price;
    v_line_cost := v_quantity * v_buying_price;
    INSERT INTO public.sale_items
      (sale_id, product_id, quantity, selling_price, buying_price, total, profit,
       product_name, brand, unit_price, cost_price)
    VALUES
      (v_sale_id, v_product_id, v_quantity, v_selling_price, v_buying_price,
       v_line_total, v_line_total - v_line_cost, v_product_name, v_brand,
       v_selling_price, v_buying_price);

    UPDATE public.products
       SET current_stock = current_stock - v_quantity,
           updated_at = now()
     WHERE id = v_product_id;

    INSERT INTO public.stock_movements
      (product_id, movement_type, quantity, reference_type, reference_id, created_by)
    VALUES
      (v_product_id, 'sale', -v_quantity, 'sale', v_sale_id, auth.uid());

    v_total := v_total + v_line_total;
    v_cost := v_cost + v_line_cost;
  END LOOP;

  UPDATE public.sales
     SET total_amount = v_total,
         total_cost = v_cost,
         total_profit = v_total - v_cost
   WHERE id = v_sale_id;
  RETURN v_sale_id;
END;
$$;
