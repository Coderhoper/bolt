-- Supplier purchase orders, advance shipment notices, and document-led receiving.
-- All operational rows inherit the authenticated tenant and are guarded by RLS.

CREATE TABLE IF NOT EXISTS public.supplier_purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id()
    REFERENCES public.business_tenants(id),
  order_number text NOT NULL,
  supplier_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending_approval', 'approved', 'sent', 'acknowledged',
      'partially_fulfilled', 'fulfilled', 'cancelled', 'disputed')),
  currency text NOT NULL DEFAULT 'KES',
  expected_delivery date,
  total_amount numeric(18, 2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  notes text,
  created_by uuid REFERENCES auth.users(id),
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, order_number),
  CONSTRAINT supplier_purchase_orders_tenant_supplier_fk
    FOREIGN KEY (tenant_id, supplier_id) REFERENCES public.suppliers(tenant_id, id)
);

CREATE INDEX IF NOT EXISTS idx_supplier_purchase_orders_tenant_status
  ON public.supplier_purchase_orders (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_purchase_orders_supplier
  ON public.supplier_purchase_orders (tenant_id, supplier_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.supplier_purchase_order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id()
    REFERENCES public.business_tenants(id),
  purchase_order_id uuid NOT NULL,
  line_no integer NOT NULL CHECK (line_no > 0),
  product_id uuid NOT NULL,
  description text,
  unit text,
  quantity_ordered numeric(18, 4) NOT NULL CHECK (quantity_ordered > 0),
  quantity_received numeric(18, 4) NOT NULL DEFAULT 0 CHECK (quantity_received >= 0),
  unit_price numeric(18, 4) NOT NULL CHECK (unit_price >= 0),
  line_total numeric(18, 2) NOT NULL CHECK (line_total >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (purchase_order_id, line_no),
  CONSTRAINT supplier_po_lines_tenant_order_fk
    FOREIGN KEY (tenant_id, purchase_order_id)
    REFERENCES public.supplier_purchase_orders(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT supplier_po_lines_tenant_product_fk
    FOREIGN KEY (tenant_id, product_id) REFERENCES public.products(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS public.supplier_asns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id()
    REFERENCES public.business_tenants(id),
  asn_number text NOT NULL,
  supplier_id uuid NOT NULL,
  purchase_order_id uuid,
  status text NOT NULL DEFAULT 'announced'
    CHECK (status IN ('announced', 'in_transit', 'arrived', 'receiving',
      'partially_received', 'received', 'cancelled', 'disputed')),
  expected_dispatch_date date,
  expected_arrival_date date,
  actual_arrival_at timestamptz,
  vehicle_reg text,
  driver_name text,
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, supplier_id, asn_number),
  CONSTRAINT supplier_asns_tenant_supplier_fk
    FOREIGN KEY (tenant_id, supplier_id) REFERENCES public.suppliers(tenant_id, id),
  CONSTRAINT supplier_asns_tenant_order_fk
    FOREIGN KEY (tenant_id, purchase_order_id)
    REFERENCES public.supplier_purchase_orders(tenant_id, id)
);

CREATE INDEX IF NOT EXISTS idx_supplier_asns_tenant_status
  ON public.supplier_asns (tenant_id, status, expected_arrival_date);

CREATE TABLE IF NOT EXISTS public.supplier_asn_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id()
    REFERENCES public.business_tenants(id),
  asn_id uuid NOT NULL,
  purchase_order_line_id uuid,
  line_no integer NOT NULL CHECK (line_no > 0),
  product_id uuid NOT NULL,
  description text NOT NULL,
  unit text,
  quantity_expected numeric(18, 4) NOT NULL CHECK (quantity_expected > 0),
  quantity_received numeric(18, 4) NOT NULL DEFAULT 0 CHECK (quantity_received >= 0),
  unit_price numeric(18, 4) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (asn_id, line_no),
  CONSTRAINT supplier_asn_lines_tenant_asn_fk
    FOREIGN KEY (tenant_id, asn_id) REFERENCES public.supplier_asns(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT supplier_asn_lines_tenant_po_line_fk
    FOREIGN KEY (tenant_id, purchase_order_line_id)
    REFERENCES public.supplier_purchase_order_lines(tenant_id, id),
  CONSTRAINT supplier_asn_lines_tenant_product_fk
    FOREIGN KEY (tenant_id, product_id) REFERENCES public.products(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS public.receiving_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id()
    REFERENCES public.business_tenants(id),
  supplier_id uuid NOT NULL,
  asn_id uuid,
  document_type text NOT NULL DEFAULT 'delivery_note'
    CHECK (document_type IN ('delivery_note', 'invoice', 'packing_slip', 'receipt', 'credit_note', 'unknown')),
  channel text NOT NULL DEFAULT 'web'
    CHECK (channel IN ('web', 'mobile', 'whatsapp', 'email', 'supplier_portal', 'api', 'scanner')),
  status text NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('pending_review', 'posted', 'rejected')),
  invoice_number text,
  storage_path text NOT NULL,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 20971520),
  notes text,
  purchase_id uuid,
  uploaded_by uuid REFERENCES auth.users(id) DEFAULT auth.uid(),
  posted_by uuid REFERENCES auth.users(id),
  posted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CONSTRAINT receiving_documents_tenant_supplier_fk
    FOREIGN KEY (tenant_id, supplier_id) REFERENCES public.suppliers(tenant_id, id),
  CONSTRAINT receiving_documents_tenant_asn_fk
    FOREIGN KEY (tenant_id, asn_id) REFERENCES public.supplier_asns(tenant_id, id),
  CONSTRAINT receiving_documents_tenant_purchase_fk
    FOREIGN KEY (tenant_id, purchase_id) REFERENCES public.purchases(tenant_id, id)
);

CREATE INDEX IF NOT EXISTS idx_receiving_documents_tenant_status
  ON public.receiving_documents (tenant_id, status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_receiving_documents_invoice
  ON public.receiving_documents (tenant_id, supplier_id, invoice_number)
  WHERE invoice_number IS NOT NULL AND invoice_number <> '';

CREATE TABLE IF NOT EXISTS public.receiving_document_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id()
    REFERENCES public.business_tenants(id),
  document_id uuid NOT NULL,
  asn_line_id uuid,
  purchase_order_line_id uuid,
  line_no integer NOT NULL CHECK (line_no > 0),
  product_id uuid NOT NULL,
  description text,
  quantity_received numeric(18, 4) NOT NULL CHECK (quantity_received > 0),
  unit_price numeric(18, 4) NOT NULL CHECK (unit_price >= 0),
  reason_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (document_id, line_no),
  CONSTRAINT receiving_lines_tenant_document_fk
    FOREIGN KEY (tenant_id, document_id)
    REFERENCES public.receiving_documents(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT receiving_lines_tenant_asn_line_fk
    FOREIGN KEY (tenant_id, asn_line_id) REFERENCES public.supplier_asn_lines(tenant_id, id),
  CONSTRAINT receiving_lines_tenant_po_line_fk
    FOREIGN KEY (tenant_id, purchase_order_line_id)
    REFERENCES public.supplier_purchase_order_lines(tenant_id, id),
  CONSTRAINT receiving_lines_tenant_product_fk
    FOREIGN KEY (tenant_id, product_id) REFERENCES public.products(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS public.supplier_asn_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id()
    REFERENCES public.business_tenants(id),
  asn_id uuid NOT NULL,
  from_status text,
  to_status text NOT NULL,
  actor uuid REFERENCES auth.users(id),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supplier_asn_history_tenant_asn_fk
    FOREIGN KEY (tenant_id, asn_id) REFERENCES public.supplier_asns(tenant_id, id) ON DELETE CASCADE
);

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'supplier_purchase_orders', 'supplier_purchase_order_lines', 'supplier_asns',
    'supplier_asn_lines', 'receiving_documents', 'receiving_document_lines',
    'supplier_asn_status_history'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_scope_restrictive ON public.%I', table_name);
    EXECUTE format('DROP TRIGGER IF EXISTS audit_%I ON public.%I', table_name, table_name);
    EXECUTE format(
      'CREATE POLICY tenant_scope_restrictive ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (tenant_id = public.current_tenant_id() AND public.is_active_user()) WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_active_user())',
      table_name
    );
    EXECUTE format('DROP POLICY IF EXISTS receiving_read ON public.%I', table_name);
    EXECUTE format(
      'CREATE POLICY receiving_read ON public.%I FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id() AND public.is_active_user())',
      table_name
    );
    EXECUTE format('DROP POLICY IF EXISTS receiving_admin_write ON public.%I', table_name);
    EXECUTE format(
      'CREATE POLICY receiving_admin_write ON public.%I FOR INSERT TO authenticated WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_admin())',
      table_name
    );
    EXECUTE format('DROP POLICY IF EXISTS receiving_admin_update ON public.%I', table_name);
    EXECUTE format(
      'CREATE POLICY receiving_admin_update ON public.%I FOR UPDATE TO authenticated USING (tenant_id = public.current_tenant_id() AND public.is_admin()) WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_admin())',
      table_name
    );
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', table_name);
    EXECUTE format('REVOKE DELETE ON public.%I FROM authenticated', table_name);
    EXECUTE format(
      'CREATE TRIGGER audit_%I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.write_audit_log()',
      table_name, table_name
    );
  END LOOP;
END;
$$;

-- ASN history is written only by its status trigger and cannot be edited through the API.
DROP POLICY IF EXISTS receiving_admin_write ON public.supplier_asn_status_history;
DROP POLICY IF EXISTS receiving_admin_update ON public.supplier_asn_status_history;
REVOKE INSERT, UPDATE, DELETE ON public.supplier_asn_status_history FROM anon, authenticated;
GRANT SELECT ON public.supplier_asn_status_history TO authenticated;

CREATE OR REPLACE FUNCTION public.write_supplier_asn_status_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
BEGIN
  IF TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.supplier_asn_status_history (tenant_id, asn_id, from_status, to_status, actor)
    VALUES (NEW.tenant_id, NEW.id, CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END,
      NEW.status, auth.uid());
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.write_supplier_asn_status_history() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS supplier_asn_status_history_write ON public.supplier_asns;
CREATE TRIGGER supplier_asn_status_history_write
AFTER INSERT OR UPDATE OF status ON public.supplier_asns
FOR EACH ROW EXECUTE FUNCTION public.write_supplier_asn_status_history();

-- Keep the existing app's private purchase/stock transaction as the source of
-- truth for inventory. These procedures only add the procurement workflow.
CREATE OR REPLACE FUNCTION public.create_supplier_purchase_order(
  p_order_number text,
  p_supplier_id uuid,
  p_expected_delivery date,
  p_notes text,
  p_lines jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_order_id uuid;
  v_line jsonb;
  v_line_no integer := 0;
  v_total numeric(18, 2) := 0;
  v_price numeric(18, 4);
  v_quantity numeric(18, 4);
  v_product public.products%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required'; END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Active business workspace required'; END IF;
  IF COALESCE(trim(p_order_number), '') = '' THEN RAISE EXCEPTION 'Order number is required'; END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'At least one order line is required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.suppliers WHERE id = p_supplier_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Supplier is unavailable in this workspace';
  END IF;

  INSERT INTO public.supplier_purchase_orders
    (tenant_id, order_number, supplier_id, expected_delivery, notes, created_by)
  VALUES (v_tenant, trim(p_order_number), p_supplier_id, p_expected_delivery, NULLIF(trim(p_notes), ''), auth.uid())
  RETURNING id INTO v_order_id;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    v_line_no := v_line_no + 1;
    v_quantity := COALESCE((v_line->>'quantity_ordered')::numeric, 0);
    v_price := COALESCE((v_line->>'unit_price')::numeric, -1);
    IF v_quantity <= 0 OR v_price < 0 THEN RAISE EXCEPTION 'Order quantities must be positive and prices cannot be negative'; END IF;
    SELECT * INTO v_product FROM public.products
      WHERE id = (v_line->>'product_id')::uuid AND tenant_id = v_tenant AND status = 'active';
    IF NOT FOUND THEN RAISE EXCEPTION 'An order product is unavailable in this workspace'; END IF;
    INSERT INTO public.supplier_purchase_order_lines
      (tenant_id, purchase_order_id, line_no, product_id, description, unit,
       quantity_ordered, unit_price, line_total)
    VALUES (v_tenant, v_order_id, v_line_no, v_product.id, v_product.name, v_product.unit,
      v_quantity, v_price, round(v_quantity * v_price, 2));
    v_total := v_total + round(v_quantity * v_price, 2);
  END LOOP;

  UPDATE public.supplier_purchase_orders SET total_amount = v_total, updated_at = now()
    WHERE id = v_order_id AND tenant_id = v_tenant;
  RETURN v_order_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_supplier_purchase_order(text, uuid, date, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_supplier_purchase_order(text, uuid, date, text, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_supplier_asn(
  p_asn_number text,
  p_purchase_order_id uuid,
  p_expected_arrival date,
  p_vehicle_reg text,
  p_driver_name text,
  p_notes text,
  p_lines jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_order public.supplier_purchase_orders%ROWTYPE;
  v_asn_id uuid;
  v_line jsonb;
  v_line_no integer := 0;
  v_quantity numeric(18, 4);
  v_order_line public.supplier_purchase_order_lines%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required'; END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Active business workspace required'; END IF;
  IF COALESCE(trim(p_asn_number), '') = '' THEN RAISE EXCEPTION 'Shipment number is required'; END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'At least one shipment line is required';
  END IF;
  SELECT * INTO v_order FROM public.supplier_purchase_orders
    WHERE id = p_purchase_order_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND OR v_order.status NOT IN ('approved', 'sent', 'acknowledged', 'partially_fulfilled') THEN
    RAISE EXCEPTION 'Select an approved purchase order that can receive a shipment';
  END IF;

  INSERT INTO public.supplier_asns
    (tenant_id, asn_number, supplier_id, purchase_order_id, expected_arrival_date,
     vehicle_reg, driver_name, notes, created_by)
  VALUES (v_tenant, trim(p_asn_number), v_order.supplier_id, v_order.id, p_expected_arrival,
    NULLIF(trim(p_vehicle_reg), ''), NULLIF(trim(p_driver_name), ''), NULLIF(trim(p_notes), ''), auth.uid())
  RETURNING id INTO v_asn_id;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    v_line_no := v_line_no + 1;
    v_quantity := COALESCE((v_line->>'quantity_expected')::numeric, 0);
    IF v_quantity <= 0 THEN RAISE EXCEPTION 'Shipment quantities must be positive'; END IF;
    SELECT * INTO v_order_line FROM public.supplier_purchase_order_lines
      WHERE id = (v_line->>'purchase_order_line_id')::uuid
        AND tenant_id = v_tenant AND purchase_order_id = v_order.id;
    IF NOT FOUND THEN RAISE EXCEPTION 'A shipment line does not belong to this purchase order'; END IF;
    INSERT INTO public.supplier_asn_lines
      (tenant_id, asn_id, purchase_order_line_id, line_no, product_id, description,
       unit, quantity_expected, unit_price)
    VALUES (v_tenant, v_asn_id, v_order_line.id, v_line_no, v_order_line.product_id,
      v_order_line.description, v_order_line.unit, v_quantity, v_order_line.unit_price);
  END LOOP;
  RETURN v_asn_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_supplier_asn(text, uuid, date, text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_supplier_asn(text, uuid, date, text, text, text, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.save_receiving_document_review(
  p_document_id uuid,
  p_lines jsonb
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_document public.receiving_documents%ROWTYPE;
  v_line jsonb;
  v_line_no integer := 0;
  v_quantity numeric(18, 4);
  v_price numeric(18, 4);
  v_product public.products%ROWTYPE;
  v_asn_line public.supplier_asn_lines%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required'; END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Active business workspace required'; END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'At least one reviewed product line is required';
  END IF;
  SELECT * INTO v_document FROM public.receiving_documents
    WHERE id = p_document_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND OR v_document.status <> 'pending_review' THEN
    RAISE EXCEPTION 'Only pending documents can be reviewed';
  END IF;

  DELETE FROM public.receiving_document_lines
    WHERE document_id = v_document.id AND tenant_id = v_tenant;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    v_line_no := v_line_no + 1;
    v_quantity := COALESCE((v_line->>'quantity_received')::numeric, 0);
    v_price := COALESCE((v_line->>'unit_price')::numeric, -1);
    IF v_quantity <= 0 OR v_price < 0 THEN
      RAISE EXCEPTION 'Received quantities must be positive and unit costs cannot be negative';
    END IF;
    SELECT * INTO v_product FROM public.products
      WHERE id = (v_line->>'product_id')::uuid AND tenant_id = v_tenant AND status = 'active';
    IF NOT FOUND THEN RAISE EXCEPTION 'A selected product is unavailable in this workspace'; END IF;

    v_asn_line := NULL;
    IF NULLIF(v_line->>'asn_line_id', '') IS NOT NULL THEN
      SELECT * INTO v_asn_line FROM public.supplier_asn_lines line
        WHERE line.id = (v_line->>'asn_line_id')::uuid
          AND line.tenant_id = v_tenant AND line.asn_id = v_document.asn_id;
      IF NOT FOUND OR v_asn_line.product_id <> v_product.id THEN
        RAISE EXCEPTION 'A selected shipment line does not match this product and document';
      END IF;
    END IF;

    INSERT INTO public.receiving_document_lines
      (tenant_id, document_id, asn_line_id, purchase_order_line_id, line_no,
       product_id, description, quantity_received, unit_price)
    VALUES (v_tenant, v_document.id, v_asn_line.id, v_asn_line.purchase_order_line_id,
      v_line_no, v_product.id, v_product.name, v_quantity, v_price);
  END LOOP;
  RETURN v_line_no;
END;
$$;
REVOKE ALL ON FUNCTION public.save_receiving_document_review(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_receiving_document_review(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.post_receiving_document(p_document_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_document public.receiving_documents%ROWTYPE;
  v_purchase_id uuid;
  v_items jsonb;
  v_invoice_number text;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required'; END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Active business workspace required'; END IF;
  SELECT * INTO v_document FROM public.receiving_documents
    WHERE id = p_document_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Receiving document was not found'; END IF;
  IF v_document.status <> 'pending_review' THEN RAISE EXCEPTION 'This document has already been reviewed'; END IF;
  IF v_document.document_type = 'credit_note' THEN
    RAISE EXCEPTION 'Credit notes cannot be posted as positive stock receipts';
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
      'product_id', line.product_id,
      'quantity', line.quantity_received,
      'buying_price', line.unit_price
    ) ORDER BY line.line_no)
    INTO v_items
    FROM public.receiving_document_lines line
    WHERE line.tenant_id = v_tenant AND line.document_id = v_document.id;
  IF COALESCE(jsonb_array_length(v_items), 0) = 0 THEN
    RAISE EXCEPTION 'Add and review at least one product line before posting';
  END IF;

  IF v_document.invoice_number IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.purchases p
    WHERE p.tenant_id = v_tenant AND p.supplier_id = v_document.supplier_id
      AND p.invoice_number = v_document.invoice_number
  ) THEN
    RAISE EXCEPTION 'This supplier invoice number has already been posted';
  END IF;

  v_invoice_number := NULLIF(trim(v_document.invoice_number), '');
  v_purchase_id := public.process_purchase(
    v_items,
    v_document.supplier_id,
    v_invoice_number,
    'Received from document ' || v_document.id::text,
    v_document.created_at::date,
    'credit',
    0
  );

  UPDATE public.receiving_documents SET status = 'posted', purchase_id = v_purchase_id,
      posted_by = auth.uid(), posted_at = now(), updated_at = now()
    WHERE id = v_document.id AND tenant_id = v_tenant;

  UPDATE public.supplier_asn_lines asn_line
    SET quantity_received = asn_line.quantity_received + received.quantity
    FROM (
      SELECT asn_line_id, SUM(quantity_received) AS quantity
      FROM public.receiving_document_lines
      WHERE tenant_id = v_tenant AND document_id = v_document.id AND asn_line_id IS NOT NULL
      GROUP BY asn_line_id
    ) received
    WHERE asn_line.id = received.asn_line_id AND asn_line.tenant_id = v_tenant;

  UPDATE public.supplier_purchase_order_lines po_line
    SET quantity_received = po_line.quantity_received + received.quantity
    FROM (
      SELECT purchase_order_line_id, SUM(quantity_received) AS quantity
      FROM public.receiving_document_lines
      WHERE tenant_id = v_tenant AND document_id = v_document.id AND purchase_order_line_id IS NOT NULL
      GROUP BY purchase_order_line_id
    ) received
    WHERE po_line.id = received.purchase_order_line_id AND po_line.tenant_id = v_tenant;

  IF v_document.asn_id IS NOT NULL THEN
    UPDATE public.supplier_asns a
      SET status = CASE
        WHEN NOT EXISTS (
          SELECT 1 FROM public.supplier_asn_lines l
          WHERE l.tenant_id = v_tenant AND l.asn_id = a.id
            AND l.quantity_received < l.quantity_expected
        ) THEN 'received'
        ELSE 'partially_received'
      END,
      actual_arrival_at = COALESCE(a.actual_arrival_at, now()), updated_at = now()
      WHERE a.id = v_document.asn_id AND a.tenant_id = v_tenant;

    UPDATE public.supplier_purchase_orders po
      SET status = CASE
        WHEN NOT EXISTS (
          SELECT 1 FROM public.supplier_purchase_order_lines l
          WHERE l.tenant_id = v_tenant AND l.purchase_order_id = po.id
            AND l.quantity_received < l.quantity_ordered
        ) THEN 'fulfilled'
        ELSE 'partially_fulfilled'
      END,
      updated_at = now()
      WHERE po.id = (SELECT a.purchase_order_id FROM public.supplier_asns a
        WHERE a.id = v_document.asn_id AND a.tenant_id = v_tenant)
        AND po.tenant_id = v_tenant;
  END IF;

  RETURN v_purchase_id;
END;
$$;
REVOKE ALL ON FUNCTION public.post_receiving_document(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_receiving_document(uuid) TO authenticated;

-- The uploaded source file is private and each object is rooted at its tenant UUID.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('receiving-documents', 'receiving-documents', false, 20971520,
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 20971520,
  allowed_mime_types = ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

DROP POLICY IF EXISTS receiving_documents_storage_read ON storage.objects;
CREATE POLICY receiving_documents_storage_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'receiving-documents'
    AND (storage.foldername(name))[1] = public.current_tenant_id()::text
    AND public.is_active_user());
DROP POLICY IF EXISTS receiving_documents_storage_insert ON storage.objects;
CREATE POLICY receiving_documents_storage_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'receiving-documents'
    AND (storage.foldername(name))[1] = public.current_tenant_id()::text
    AND public.is_admin());
DROP POLICY IF EXISTS receiving_documents_storage_delete ON storage.objects;
CREATE POLICY receiving_documents_storage_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'receiving-documents'
    AND (storage.foldername(name))[1] = public.current_tenant_id()::text
    AND public.is_admin());
