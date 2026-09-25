-- Superseded legacy schema.
-- The application schema and stock ledger are created by the earlier business
-- management migration. Creating bigint `products`/`stock_movements` tables here
-- was incompatible with that UUID schema and installed a trigger referencing a
-- nonexistent `change` column. The replacement hardware catalogue is isolated in
-- the `hardware_catalog` schema by 20260925000000_hardware_catalog.sql.
DROP TRIGGER IF EXISTS trg_update_product_quantity ON public.stock_movements;
DROP FUNCTION IF EXISTS public.update_product_quantity();
