-- Expose the hardware catalogue to the tenant app and enforce catalog-only inserts.
-- This migration is for the connected tenant database after 20260925150000_hardware_catalog.sql.
BEGIN;

CREATE OR REPLACE VIEW public.hardware_catalog_variants AS
SELECT v.id, v.sku, v.barcode, p.name AS product_name,
       p.description AS product_description, s.name AS subcategory,
       c.name AS category, v.brand, v.size_specification, v.unit,
       v.description AS variant_description, v.cost_price, v.selling_price, v.active
FROM hardware_catalog.product_variants v
JOIN hardware_catalog.products p ON p.id = v.product_id
JOIN hardware_catalog.subcategories s ON s.id = p.subcategory_id
JOIN hardware_catalog.categories c ON c.id = s.category_id
WHERE v.active AND p.active AND s.active AND c.active;
GRANT SELECT ON public.hardware_catalog_variants TO authenticated;
REVOKE INSERT ON public.products FROM anon;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS catalog_variant_id bigint,
  ADD COLUMN IF NOT EXISTS catalog_sku text,
  ADD COLUMN IF NOT EXISTS catalog_size_specification text;

CREATE UNIQUE INDEX IF NOT EXISTS products_catalog_variant_unique
  ON public.products(catalog_variant_id) WHERE catalog_variant_id IS NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'products_catalog_variant_fk'
      AND conrelid = 'public.products'::regclass
  ) THEN
    ALTER TABLE public.products ADD CONSTRAINT products_catalog_variant_fk
      FOREIGN KEY (catalog_variant_id)
      REFERENCES hardware_catalog.product_variants(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.enforce_catalog_product()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, hardware_catalog
AS $$
DECLARE catalog_item record;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.catalog_variant_id IS NULL THEN
    RAISE EXCEPTION 'Select a product from the hardware catalogue';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.catalog_variant_id IS NOT NULL
     AND NEW.catalog_variant_id IS NULL THEN
    RAISE EXCEPTION 'A product cannot be detached from its catalogue item';
  END IF;
  IF NEW.catalog_variant_id IS NOT NULL THEN
    SELECT p.name AS product_name, v.sku, v.brand, v.unit,
           v.size_specification, v.cost_price, v.selling_price,
           v.active AS variant_active, p.active AS product_active
    INTO catalog_item
    FROM hardware_catalog.product_variants v
    JOIN hardware_catalog.products p ON p.id = v.product_id
    WHERE v.id = NEW.catalog_variant_id;
    IF NOT FOUND OR NOT catalog_item.variant_active OR NOT catalog_item.product_active THEN
      RAISE EXCEPTION 'The selected hardware catalogue item is unavailable';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.catalog_variant_id IS DISTINCT FROM NEW.catalog_variant_id THEN
      RAISE EXCEPTION 'A product cannot be changed to a different catalogue item';
    END IF;
    IF TG_OP = 'UPDATE' AND (
      OLD.name IS DISTINCT FROM NEW.name OR OLD.brand IS DISTINCT FROM NEW.brand
      OR OLD.unit IS DISTINCT FROM NEW.unit OR OLD.catalog_sku IS DISTINCT FROM NEW.catalog_sku
      OR OLD.catalog_size_specification IS DISTINCT FROM NEW.catalog_size_specification
    ) THEN
      RAISE EXCEPTION 'Catalogue product name, brand, unit, and SKU are fixed';
    END IF;
    IF TG_OP = 'INSERT' THEN
      NEW.name := catalog_item.product_name;
      NEW.brand := catalog_item.brand;
      NEW.unit := catalog_item.unit;
      NEW.catalog_size_specification := catalog_item.size_specification;
      NEW.buying_price := COALESCE(NEW.buying_price, catalog_item.cost_price);
      NEW.selling_price := COALESCE(NEW.selling_price, catalog_item.selling_price);
    END IF;
    NEW.catalog_sku := catalog_item.sku;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS products_require_catalog_item ON public.products;
CREATE TRIGGER products_require_catalog_item
  BEFORE INSERT OR UPDATE OF catalog_variant_id, catalog_sku,
    catalog_size_specification, name, brand, unit
  ON public.products FOR EACH ROW
  EXECUTE FUNCTION public.enforce_catalog_product();
REVOKE ALL ON FUNCTION public.enforce_catalog_product() FROM PUBLIC, anon, authenticated;

COMMIT;
