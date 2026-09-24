-- Create products table and stock movements with trigger to auto-update quantity
CREATE TABLE IF NOT EXISTS products (
  id bigserial PRIMARY KEY,
  name text NOT NULL,
  sku text,
  price numeric(12,2),
  quantity integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id bigserial PRIMARY KEY,
  product_id bigint NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  change integer NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Trigger function: update product quantity on insert into stock_movements
CREATE OR REPLACE FUNCTION public.update_product_quantity()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE products
  SET quantity = COALESCE(products.quantity, 0) + NEW.change
  WHERE id = NEW.product_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_update_product_quantity ON stock_movements;
CREATE TRIGGER trg_update_product_quantity
AFTER INSERT ON stock_movements
FOR EACH ROW
EXECUTE PROCEDURE public.update_product_quantity();

-- Optional: prevent negative quantity (enforce at application level or add another trigger/constraint)
