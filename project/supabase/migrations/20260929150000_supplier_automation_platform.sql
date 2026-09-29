-- Automation, supplier lifecycle, reconciliation, notifications, and stock-ledger integrity.

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS supplier_code text,
  ADD COLUMN IF NOT EXISTS legal_name text,
  ADD COLUMN IF NOT EXISTS trading_name text,
  ADD COLUMN IF NOT EXISTS tax_id text,
  ADD COLUMN IF NOT EXISTS registration_no text,
  ADD COLUMN IF NOT EXISTS tier text NOT NULL DEFAULT 'TIER_1'
    CHECK (tier IN ('TIER_1', 'TIER_2', 'TIER_3')),
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'BLACKLISTED', 'ARCHIVED')),
  ADD COLUMN IF NOT EXISTS risk_score integer NOT NULL DEFAULT 0 CHECK (risk_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS payment_terms text,
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'KES',
  ADD COLUMN IF NOT EXISTS preferred_language text NOT NULL DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS suspended_reason text,
  ADD COLUMN IF NOT EXISTS blacklisted_reason text,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id);

UPDATE public.suppliers SET legal_name = name WHERE legal_name IS NULL;
ALTER TABLE public.suppliers ALTER COLUMN status SET DEFAULT 'PENDING';
CREATE UNIQUE INDEX IF NOT EXISTS suppliers_tenant_supplier_code_key
  ON public.suppliers (tenant_id, supplier_code) WHERE supplier_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS suppliers_tenant_status_idx ON public.suppliers (tenant_id, status);
CREATE INDEX IF NOT EXISTS suppliers_tenant_tax_id_idx ON public.suppliers (tenant_id, tax_id) WHERE tax_id IS NOT NULL;

ALTER TABLE public.receiving_documents
  DROP CONSTRAINT IF EXISTS receiving_documents_status_check,
  ADD CONSTRAINT receiving_documents_status_check CHECK (status IN (
    'uploaded', 'scanning', 'scan_failed', 'extracting', 'extracted', 'extraction_failed',
    'matching', 'matched', 'partially_matched', 'unmatched', 'reviewing', 'pending_review',
    'reviewed', 'posted', 'rejected', 'archived'
  ));
DROP INDEX IF EXISTS public.idx_receiving_documents_invoice;
CREATE INDEX IF NOT EXISTS receiving_documents_invoice_lookup_idx
  ON public.receiving_documents (tenant_id, supplier_id, invoice_number)
  WHERE invoice_number IS NOT NULL AND invoice_number <> '';

ALTER TABLE public.supplier_purchase_orders
  DROP CONSTRAINT IF EXISTS supplier_purchase_orders_status_check,
  ADD CONSTRAINT supplier_purchase_orders_status_check CHECK (status IN (
    'draft', 'pending_approval', 'approved', 'sent', 'acknowledged', 'partially_fulfilled',
    'fulfilled', 'closed', 'cancelled', 'disputed'
  ));
ALTER TABLE public.supplier_purchase_orders
  ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz;
ALTER TABLE public.supplier_asns
  DROP CONSTRAINT IF EXISTS supplier_asns_status_check,
  ADD CONSTRAINT supplier_asns_status_check CHECK (status IN (
    'announced', 'in_transit', 'arrived', 'receiving', 'partially_received', 'received',
    'cancelled', 'disputed', 'resolved'
  ));

CREATE OR REPLACE FUNCTION public.require_active_supplier_for_purchase_order()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.suppliers
    WHERE id = NEW.supplier_id AND tenant_id = NEW.tenant_id AND status = 'ACTIVE') THEN
    RAISE EXCEPTION 'Purchase orders can only be created for active suppliers';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.require_active_supplier_for_purchase_order() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS purchase_order_requires_active_supplier ON public.supplier_purchase_orders;
CREATE TRIGGER purchase_order_requires_active_supplier BEFORE INSERT ON public.supplier_purchase_orders
FOR EACH ROW EXECUTE FUNCTION public.require_active_supplier_for_purchase_order();

ALTER TABLE public.receiving_documents
  ADD COLUMN IF NOT EXISTS sha256 text,
  ADD COLUMN IF NOT EXISTS page_count integer,
  ADD COLUMN IF NOT EXISTS language text,
  ADD COLUMN IF NOT EXISTS duplicate_of uuid,
  ADD COLUMN IF NOT EXISTS uploader_user_agent text,
  ADD COLUMN IF NOT EXISTS processing_error text,
  ADD COLUMN IF NOT EXISTS confidence_overall numeric(5, 4);
DROP INDEX IF EXISTS public.receiving_documents_tenant_sha256_key;
CREATE INDEX IF NOT EXISTS receiving_documents_tenant_sha256_idx
  ON public.receiving_documents (tenant_id, sha256) WHERE sha256 IS NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'receiving_documents_duplicate_fk'
    AND conrelid = 'public.receiving_documents'::regclass) THEN
    ALTER TABLE public.receiving_documents ADD CONSTRAINT receiving_documents_duplicate_fk
      FOREIGN KEY (tenant_id, duplicate_of) REFERENCES public.receiving_documents(tenant_id, id);
  END IF;
END;
$$;

-- Serialize hash checks at insert time so concurrent uploads cannot bypass
-- tenant-scoped duplicate detection.
CREATE OR REPLACE FUNCTION public.mark_duplicate_receiving_document()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE v_existing uuid;
BEGIN
  IF NEW.sha256 IS NULL THEN
    NEW.duplicate_of := NULL;
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text || ':' || NEW.sha256, 43001));
  SELECT document.id INTO v_existing
  FROM public.receiving_documents document
  WHERE document.tenant_id = NEW.tenant_id AND document.sha256 = NEW.sha256
  ORDER BY document.created_at, document.id
  LIMIT 1;
  NEW.duplicate_of := v_existing;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.mark_duplicate_receiving_document() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS receiving_document_duplicate_check ON public.receiving_documents;
CREATE TRIGGER receiving_document_duplicate_check BEFORE INSERT ON public.receiving_documents
FOR EACH ROW EXECUTE FUNCTION public.mark_duplicate_receiving_document();

CREATE OR REPLACE FUNCTION public.try_parse_receiving_numeric(p_value text)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog AS $$
BEGIN
  IF p_value IS NULL OR trim(p_value) = '' THEN RETURN NULL; END IF;
  IF trim(p_value) !~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)$' THEN RETURN NULL; END IF;
  RETURN trim(p_value)::numeric(18, 4);
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.try_parse_receiving_numeric(text) FROM PUBLIC, anon, authenticated;

ALTER TABLE public.receiving_document_lines
  ALTER COLUMN product_id DROP NOT NULL,
  ALTER COLUMN quantity_received DROP NOT NULL,
  ALTER COLUMN unit_price DROP NOT NULL,
  DROP CONSTRAINT IF EXISTS receiving_document_lines_quantity_received_check,
  DROP CONSTRAINT IF EXISTS receiving_document_lines_unit_price_check,
  ADD COLUMN IF NOT EXISTS extracted_description text,
  ADD COLUMN IF NOT EXISTS supplier_sku text,
  ADD COLUMN IF NOT EXISTS extracted_unit text,
  ADD COLUMN IF NOT EXISTS confidence numeric(5, 4),
  ADD COLUMN IF NOT EXISTS match_method text CHECK (match_method IS NULL OR match_method IN (
    'SKU_EXACT', 'NAME_EXACT', 'NAME_FUZZY', 'EMBEDDING', 'HISTORICAL', 'MANUAL', 'NONE'
  )),
  ADD COLUMN IF NOT EXISTS match_confidence numeric(5, 4),
  ADD COLUMN IF NOT EXISTS decision text CHECK (decision IS NULL OR decision IN (
    'AUTO_MATCH', 'REVIEW', 'REVIEW_URGENT', 'UNMATCHED', 'REJECTED'
  )),
  ADD COLUMN IF NOT EXISTS variance_qty_pct numeric(8, 4),
  ADD COLUMN IF NOT EXISTS variance_price_pct numeric(8, 4),
  ADD COLUMN IF NOT EXISTS source_page integer,
  ADD COLUMN IF NOT EXISTS source_bbox jsonb,
  ADD COLUMN IF NOT EXISTS review_action text,
  ADD CONSTRAINT receiving_document_lines_quantity_check
    CHECK (quantity_received IS NULL OR quantity_received > 0),
  ADD CONSTRAINT receiving_document_lines_price_check
    CHECK (unit_price IS NULL OR unit_price >= 0),
  ADD CONSTRAINT receiving_document_lines_confidence_check
    CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  ADD CONSTRAINT receiving_document_lines_match_confidence_check
    CHECK (match_confidence IS NULL OR match_confidence BETWEEN 0 AND 1);

CREATE TABLE IF NOT EXISTS public.supplier_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.business_tenants(id),
  supplier_id uuid NOT NULL,
  name text NOT NULL,
  role text,
  email text,
  phone text,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CONSTRAINT supplier_contacts_tenant_supplier_fk
    FOREIGN KEY (tenant_id, supplier_id) REFERENCES public.suppliers(tenant_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS supplier_contacts_primary_key
  ON public.supplier_contacts (tenant_id, supplier_id) WHERE is_primary;

CREATE TABLE IF NOT EXISTS public.supplier_products (
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.business_tenants(id),
  supplier_id uuid NOT NULL,
  product_id uuid NOT NULL,
  supplier_sku text,
  unit text,
  conversion_factor numeric(18, 4) NOT NULL DEFAULT 1 CHECK (conversion_factor > 0),
  last_price numeric(18, 4) CHECK (last_price IS NULL OR last_price >= 0),
  last_price_at timestamptz,
  lead_time_days integer CHECK (lead_time_days IS NULL OR lead_time_days >= 0),
  is_preferred boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, supplier_id, product_id),
  CONSTRAINT supplier_products_tenant_supplier_fk
    FOREIGN KEY (tenant_id, supplier_id) REFERENCES public.suppliers(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT supplier_products_tenant_product_fk
    FOREIGN KEY (tenant_id, product_id) REFERENCES public.products(tenant_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS supplier_products_supplier_sku_key
  ON public.supplier_products (tenant_id, supplier_id, lower(supplier_sku))
  WHERE supplier_sku IS NOT NULL AND supplier_sku <> '';
CREATE INDEX IF NOT EXISTS supplier_products_sku_idx
  ON public.supplier_products (tenant_id, supplier_id, supplier_sku);
CREATE UNIQUE INDEX IF NOT EXISTS supplier_products_one_preferred_per_product
  ON public.supplier_products (tenant_id, product_id) WHERE is_preferred;

CREATE TABLE IF NOT EXISTS public.supplier_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.business_tenants(id),
  supplier_id uuid,
  actor uuid REFERENCES auth.users(id),
  action text NOT NULL,
  before_value jsonb,
  after_value jsonb,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supplier_audit_tenant_supplier_fk
    FOREIGN KEY (tenant_id, supplier_id) REFERENCES public.suppliers(tenant_id, id)
);
CREATE INDEX IF NOT EXISTS supplier_audit_supplier_idx
  ON public.supplier_audit (tenant_id, supplier_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.supplier_scorecards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.business_tenants(id),
  supplier_id uuid NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  on_time_pct numeric(5, 2),
  accuracy_pct numeric(5, 2),
  dispute_rate_pct numeric(5, 2),
  avg_response_hours numeric(10, 2),
  price_competitiveness numeric(5, 2),
  overall_rating numeric(3, 2),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, supplier_id, period_start, period_end),
  CONSTRAINT supplier_scorecards_tenant_supplier_fk
    FOREIGN KEY (tenant_id, supplier_id) REFERENCES public.suppliers(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.document_extractions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.business_tenants(id),
  document_id uuid NOT NULL,
  attempt_no integer NOT NULL DEFAULT 1 CHECK (attempt_no > 0),
  engine text NOT NULL,
  raw_text text,
  raw_tables jsonb,
  structured jsonb NOT NULL,
  confidence_overall numeric(5, 4),
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  model_version text,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, document_id, attempt_no),
  UNIQUE (tenant_id, id),
  CONSTRAINT document_extractions_tenant_document_fk
    FOREIGN KEY (tenant_id, document_id) REFERENCES public.receiving_documents(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS document_extractions_document_idx
  ON public.document_extractions (tenant_id, document_id, attempt_no DESC);

CREATE TABLE IF NOT EXISTS public.document_extraction_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.business_tenants(id),
  document_id uuid NOT NULL,
  attempt_no integer NOT NULL,
  engine text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, document_id, attempt_no),
  CONSTRAINT extraction_attempts_tenant_document_fk
    FOREIGN KEY (tenant_id, document_id) REFERENCES public.receiving_documents(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS document_extraction_attempts_document_idx
  ON public.document_extraction_attempts (tenant_id, document_id, attempt_no DESC);

CREATE TABLE IF NOT EXISTS public.document_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.business_tenants(id),
  document_id uuid NOT NULL,
  extraction_id uuid NOT NULL,
  line_no integer NOT NULL,
  extracted_description text,
  extracted_qty numeric(18, 4),
  extracted_unit text,
  extracted_unit_price numeric(18, 4),
  matched_product_id uuid,
  matched_supplier_sku text,
  match_method text NOT NULL CHECK (match_method IN (
    'SKU_EXACT', 'NAME_EXACT', 'NAME_FUZZY', 'EMBEDDING', 'HISTORICAL', 'MANUAL', 'NONE'
  )),
  match_confidence numeric(5, 4) NOT NULL CHECK (match_confidence BETWEEN 0 AND 1),
  decision text NOT NULL CHECK (decision IN ('AUTO_MATCH', 'REVIEW', 'REVIEW_URGENT', 'UNMATCHED', 'REJECTED')),
  variance_qty_pct numeric(8, 4),
  variance_price_pct numeric(8, 4),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_matches_tenant_document_fk
    FOREIGN KEY (tenant_id, document_id) REFERENCES public.receiving_documents(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT document_matches_tenant_extraction_fk
    FOREIGN KEY (tenant_id, extraction_id) REFERENCES public.document_extractions(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT document_matches_tenant_product_fk
    FOREIGN KEY (tenant_id, matched_product_id) REFERENCES public.products(tenant_id, id)
);
CREATE INDEX IF NOT EXISTS document_matches_document_idx ON public.document_matches (tenant_id, document_id, line_no);
CREATE INDEX IF NOT EXISTS document_matches_decision_idx ON public.document_matches (tenant_id, decision);

CREATE TABLE IF NOT EXISTS public.document_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.business_tenants(id),
  document_id uuid NOT NULL,
  reviewer_id uuid NOT NULL REFERENCES auth.users(id),
  action text NOT NULL CHECK (action IN (
    'APPROVE', 'CORRECT_PRODUCT', 'CORRECT_QTY', 'CORRECT_PRICE', 'REJECT_LINE',
    'MARK_NOT_RECEIVED', 'REQUEST_REUPLOAD', 'ESCALATE', 'HOLD', 'APPROVE_ALL'
  )),
  line_no integer,
  before_value jsonb,
  after_value jsonb,
  reason_code text,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_reviews_tenant_document_fk
    FOREIGN KEY (tenant_id, document_id) REFERENCES public.receiving_documents(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS document_reviews_document_idx ON public.document_reviews (tenant_id, document_id, created_at);

CREATE TABLE IF NOT EXISTS public.automation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.business_tenants(id),
  job_type text NOT NULL,
  source_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'dead_letter')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  run_after timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS automation_jobs_ready_idx
  ON public.automation_jobs (status, run_after, created_at) WHERE status IN ('queued', 'failed');
CREATE INDEX IF NOT EXISTS automation_jobs_tenant_idx
  ON public.automation_jobs (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.automation_settings (
  tenant_id uuid PRIMARY KEY DEFAULT public.current_tenant_id() REFERENCES public.business_tenants(id),
  ocr_provider text NOT NULL DEFAULT 'azure' CHECK (ocr_provider IN ('azure', 'paddle', 'manual')),
  llm_provider text NOT NULL DEFAULT 'openai' CHECK (llm_provider IN ('openai', 'anthropic', 'local', 'none')),
  auto_approve_enabled boolean NOT NULL DEFAULT false,
  auto_match_confidence numeric(5, 4) NOT NULL DEFAULT 0.97 CHECK (auto_match_confidence BETWEEN 0 AND 1),
  qty_tolerance_pct numeric(5, 2) NOT NULL DEFAULT 2 CHECK (qty_tolerance_pct BETWEEN 0 AND 100),
  price_tolerance_pct numeric(5, 2) NOT NULL DEFAULT 1 CHECK (price_tolerance_pct BETWEEN 0 AND 100),
  timezone text NOT NULL DEFAULT 'Africa/Nairobi',
  updated_by uuid REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.automation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.business_tenants(id),
  event_type text NOT NULL,
  producer text NOT NULL DEFAULT 'tenant-app',
  event_version integer NOT NULL DEFAULT 1,
  source_type text,
  source_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  UNIQUE (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS automation_events_tenant_idx ON public.automation_events (tenant_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS public.system_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.business_tenants(id),
  recipient_user_id uuid REFERENCES auth.users(id),
  channel text NOT NULL DEFAULT 'IN_APP' CHECK (channel IN ('EMAIL', 'SMS', 'WHATSAPP', 'PUSH', 'IN_APP', 'WEBHOOK')),
  severity text NOT NULL DEFAULT 'NORMAL' CHECK (severity IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
  template text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'SUPPRESSED')),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  scheduled_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS system_notifications_inbox_idx
  ON public.system_notifications (tenant_id, recipient_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.anomaly_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.business_tenants(id),
  severity text NOT NULL CHECK (severity IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
  category text NOT NULL,
  subject_type text NOT NULL,
  subject_id uuid NOT NULL,
  detected_at timestamptz NOT NULL DEFAULT now(),
  score numeric(5, 4),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED')),
  resolved_by uuid REFERENCES auth.users(id),
  resolved_at timestamptz,
  resolution text,
  UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS anomaly_open_subject_key
  ON public.anomaly_flags (tenant_id, category, subject_type, subject_id) WHERE status = 'OPEN';
CREATE INDEX IF NOT EXISTS anomaly_flags_tenant_status_idx
  ON public.anomaly_flags (tenant_id, status, detected_at DESC);
ALTER TABLE public.anomaly_flags ADD COLUMN IF NOT EXISTS last_notified_at timestamptz;

CREATE TABLE IF NOT EXISTS public.reconciliation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.business_tenants(id),
  report_date date NOT NULL,
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('running', 'completed', 'failed')),
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  error text,
  created_by uuid REFERENCES auth.users(id),
  UNIQUE (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS reconciliation_runs_tenant_date_idx
  ON public.reconciliation_runs (tenant_id, report_date DESC);

CREATE TABLE IF NOT EXISTS public.inbound_channel_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.business_tenants(id),
  channel text NOT NULL CHECK (channel IN ('WHATSAPP', 'EMAIL', 'SCANNER')),
  route_key text NOT NULL,
  supplier_id uuid,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, channel, route_key),
  UNIQUE (tenant_id, id),
  CONSTRAINT inbound_routes_tenant_supplier_fk
    FOREIGN KEY (tenant_id, supplier_id) REFERENCES public.suppliers(tenant_id, id)
);
CREATE INDEX IF NOT EXISTS inbound_routes_tenant_channel_idx
  ON public.inbound_channel_routes (tenant_id, channel, is_active);
CREATE UNIQUE INDEX IF NOT EXISTS inbound_routes_channel_key
  ON public.inbound_channel_routes (channel, route_key);

CREATE TABLE IF NOT EXISTS public.inbound_sender_allowlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.business_tenants(id),
  channel text NOT NULL CHECK (channel IN ('WHATSAPP', 'EMAIL')),
  sender_address text NOT NULL,
  supplier_id uuid,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, channel, sender_address),
  CONSTRAINT inbound_senders_tenant_supplier_fk
    FOREIGN KEY (tenant_id, supplier_id) REFERENCES public.suppliers(tenant_id, id)
);
CREATE TABLE IF NOT EXISTS public.inbound_sender_contexts (
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id() REFERENCES public.business_tenants(id),
  channel text NOT NULL CHECK (channel IN ('WHATSAPP', 'EMAIL')),
  sender_address text NOT NULL,
  supplier_id uuid,
  asn_id uuid,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, channel, sender_address),
  CONSTRAINT inbound_context_supplier_fk FOREIGN KEY (tenant_id, supplier_id) REFERENCES public.suppliers(tenant_id, id),
  CONSTRAINT inbound_context_asn_fk FOREIGN KEY (tenant_id, asn_id) REFERENCES public.supplier_asns(tenant_id, id)
);

ALTER TABLE public.system_settings ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Africa/Nairobi';

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'supplier_contacts', 'supplier_products', 'supplier_audit', 'supplier_scorecards',
    'document_extractions', 'document_extraction_attempts', 'document_matches', 'document_reviews',
    'automation_jobs', 'automation_settings', 'automation_events', 'system_notifications',
    'anomaly_flags', 'reconciliation_runs', 'inbound_channel_routes', 'inbound_sender_allowlist',
    'inbound_sender_contexts'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_scope_restrictive ON public.%I', table_name);
    EXECUTE format('CREATE POLICY tenant_scope_restrictive ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (tenant_id = public.current_tenant_id() AND public.is_active_user()) WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_active_user())', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_read ON public.%I', table_name);
    IF table_name = 'system_notifications' THEN
      EXECUTE format('CREATE POLICY tenant_read ON public.%I FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id() AND public.is_active_user() AND (recipient_user_id IS NULL OR recipient_user_id = auth.uid()))', table_name);
    ELSE
      EXECUTE format('CREATE POLICY tenant_read ON public.%I FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id() AND public.is_active_user())', table_name);
    END IF;
    EXECUTE format('DROP POLICY IF EXISTS tenant_admin_insert ON public.%I', table_name);
    EXECUTE format('CREATE POLICY tenant_admin_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_admin())', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_admin_update ON public.%I', table_name);
    EXECUTE format('CREATE POLICY tenant_admin_update ON public.%I FOR UPDATE TO authenticated USING (tenant_id = public.current_tenant_id() AND public.is_admin()) WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_admin())', table_name);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', table_name);
    EXECUTE format('REVOKE DELETE ON public.%I FROM authenticated', table_name);
  END LOOP;
END;
$$;

-- These records are append-only; write paths are database functions and triggers.
DROP POLICY IF EXISTS tenant_admin_insert ON public.supplier_audit;
DROP POLICY IF EXISTS tenant_admin_update ON public.supplier_audit;
REVOKE INSERT, UPDATE, DELETE ON public.supplier_audit FROM anon, authenticated;
DROP POLICY IF EXISTS tenant_admin_insert ON public.automation_events;
DROP POLICY IF EXISTS tenant_admin_update ON public.automation_events;
REVOKE INSERT, UPDATE, DELETE ON public.automation_events FROM anon, authenticated;
DROP POLICY IF EXISTS tenant_admin_insert ON public.document_reviews;
DROP POLICY IF EXISTS tenant_admin_update ON public.document_reviews;
REVOKE INSERT, UPDATE, DELETE ON public.document_reviews FROM anon, authenticated;
DROP POLICY IF EXISTS tenant_admin_insert ON public.reconciliation_runs;
DROP POLICY IF EXISTS tenant_admin_update ON public.reconciliation_runs;
REVOKE INSERT, UPDATE, DELETE ON public.reconciliation_runs FROM anon, authenticated;
REVOKE UPDATE ON public.receiving_documents FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.receiving_document_lines FROM anon, authenticated;
DROP POLICY IF EXISTS tenant_admin_update ON public.supplier_purchase_orders;
DROP POLICY IF EXISTS tenant_admin_update ON public.supplier_asns;
REVOKE UPDATE ON public.supplier_purchase_orders, public.supplier_asns FROM anon, authenticated;
DROP POLICY IF EXISTS tenant_admin_insert ON public.system_notifications;
DROP POLICY IF EXISTS tenant_admin_update ON public.system_notifications;
REVOKE INSERT, UPDATE, DELETE ON public.system_notifications FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.guard_supplier_status_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE change_reason text := current_setting('app.supplier_status_reason', true);
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF auth.uid() IS NOT NULL AND (NOT public.is_admin() OR COALESCE(trim(change_reason), '') = '') THEN
      RAISE EXCEPTION 'Supplier status changes require an administrator and a reason';
    END IF;
    INSERT INTO public.supplier_audit (tenant_id, supplier_id, actor, action, before_value, after_value, reason)
    VALUES (NEW.tenant_id, NEW.id, auth.uid(), 'STATUS_' || NEW.status,
      jsonb_build_object('status', OLD.status), jsonb_build_object('status', NEW.status),
      NULLIF(trim(change_reason), ''));
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_supplier_status_change() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS suppliers_status_audit ON public.suppliers;
CREATE TRIGGER suppliers_status_audit BEFORE UPDATE OF status ON public.suppliers
FOR EACH ROW EXECUTE FUNCTION public.guard_supplier_status_change();

CREATE OR REPLACE FUNCTION public.transition_supplier_status(
  p_supplier_id uuid,
  p_action text,
  p_reason text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_supplier public.suppliers%ROWTYPE;
  v_target text;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required'; END IF;
  IF COALESCE(trim(p_reason), '') = '' THEN RAISE EXCEPTION 'A reason is required'; END IF;
  SELECT * INTO v_supplier FROM public.suppliers WHERE id = p_supplier_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Supplier not found in this workspace'; END IF;
  v_target := CASE p_action
    WHEN 'approve' THEN 'ACTIVE'
    WHEN 'suspend' THEN 'SUSPENDED'
    WHEN 'blacklist' THEN 'BLACKLISTED'
    WHEN 'archive' THEN 'ARCHIVED'
    WHEN 'reactivate' THEN 'ACTIVE'
    ELSE NULL
  END;
  IF v_target IS NULL THEN RAISE EXCEPTION 'Unsupported supplier status action'; END IF;
  IF p_action = 'approve' AND v_supplier.status <> 'PENDING' THEN RAISE EXCEPTION 'Only pending suppliers can be approved'; END IF;
  IF p_action = 'suspend' AND v_supplier.status <> 'ACTIVE' THEN RAISE EXCEPTION 'Only active suppliers can be suspended'; END IF;
  IF p_action = 'blacklist' AND v_supplier.status NOT IN ('ACTIVE', 'SUSPENDED') THEN RAISE EXCEPTION 'Supplier cannot be blacklisted from its current state'; END IF;
  IF p_action = 'reactivate' AND v_supplier.status NOT IN ('SUSPENDED', 'BLACKLISTED') THEN RAISE EXCEPTION 'Only suspended or blacklisted suppliers can be reactivated'; END IF;
  IF p_action = 'archive' AND v_supplier.status = 'ACTIVE' THEN RAISE EXCEPTION 'Suspend an active supplier before archiving'; END IF;
  PERFORM set_config('app.supplier_status_reason', p_reason, true);
  UPDATE public.suppliers SET status = v_target,
    approved_by = CASE WHEN p_action = 'approve' THEN auth.uid() ELSE approved_by END,
    approved_at = CASE WHEN p_action = 'approve' THEN now() ELSE approved_at END,
    suspended_reason = CASE WHEN p_action = 'suspend' THEN p_reason WHEN v_target = 'ACTIVE' THEN NULL ELSE suspended_reason END,
    blacklisted_reason = CASE WHEN p_action = 'blacklist' THEN p_reason WHEN v_target = 'ACTIVE' THEN NULL ELSE blacklisted_reason END,
    updated_at = now()
  WHERE id = p_supplier_id AND tenant_id = v_tenant;
  RETURN v_target;
END;
$$;
REVOKE ALL ON FUNCTION public.transition_supplier_status(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transition_supplier_status(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.map_supplier_product(
  p_supplier_id uuid,
  p_product_id uuid,
  p_supplier_sku text,
  p_unit text,
  p_conversion_factor numeric,
  p_lead_time_days integer,
  p_is_preferred boolean
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE v_tenant uuid := public.current_tenant_id();
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required'; END IF;
  IF p_conversion_factor IS NULL OR p_conversion_factor <= 0 OR COALESCE(p_lead_time_days, 0) < 0 THEN
    RAISE EXCEPTION 'Conversion factor must be positive and lead time cannot be negative';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.suppliers WHERE id = p_supplier_id AND tenant_id = v_tenant AND status = 'ACTIVE') THEN
    RAISE EXCEPTION 'Only active suppliers can be mapped to products';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = p_product_id AND tenant_id = v_tenant AND status = 'active') THEN
    RAISE EXCEPTION 'Product not found in this workspace';
  END IF;
  IF COALESCE(p_is_preferred, false) THEN
    UPDATE public.supplier_products SET is_preferred = false, updated_at = now()
      WHERE tenant_id = v_tenant AND product_id = p_product_id AND supplier_id <> p_supplier_id AND is_preferred;
  END IF;
  INSERT INTO public.supplier_products
    (tenant_id, supplier_id, product_id, supplier_sku, unit, conversion_factor, lead_time_days, is_preferred)
  VALUES (v_tenant, p_supplier_id, p_product_id, NULLIF(trim(p_supplier_sku), ''),
    NULLIF(trim(p_unit), ''), p_conversion_factor, p_lead_time_days, COALESCE(p_is_preferred, false))
  ON CONFLICT (tenant_id, supplier_id, product_id) DO UPDATE SET
    supplier_sku = EXCLUDED.supplier_sku, unit = EXCLUDED.unit,
    conversion_factor = EXCLUDED.conversion_factor, lead_time_days = EXCLUDED.lead_time_days,
    is_preferred = EXCLUDED.is_preferred, updated_at = now();
  INSERT INTO public.supplier_audit (tenant_id, supplier_id, actor, action, after_value)
  VALUES (v_tenant, p_supplier_id, auth.uid(), 'PRODUCT_MAPPED',
    jsonb_build_object('product_id', p_product_id, 'supplier_sku', NULLIF(trim(p_supplier_sku), '')));
END;
$$;
REVOKE ALL ON FUNCTION public.map_supplier_product(uuid, uuid, text, text, numeric, integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.map_supplier_product(uuid, uuid, text, text, numeric, integer, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.transition_supplier_purchase_order(
  p_order_id uuid,
  p_action text,
  p_reason text DEFAULT NULL
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_order public.supplier_purchase_orders%ROWTYPE;
  v_target text;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required'; END IF;
  SELECT * INTO v_order FROM public.supplier_purchase_orders
    WHERE id = p_order_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Purchase order not found'; END IF;
  v_target := CASE p_action
    WHEN 'submit' THEN 'pending_approval' WHEN 'approve' THEN 'approved'
    WHEN 'send' THEN 'sent' WHEN 'acknowledge' THEN 'acknowledged'
    WHEN 'close' THEN 'closed' WHEN 'cancel' THEN 'cancelled' WHEN 'dispute' THEN 'disputed'
    WHEN 'resolve' THEN 'closed' ELSE NULL END;
  IF v_target IS NULL THEN RAISE EXCEPTION 'Unsupported purchase order action'; END IF;
  IF NOT (
    (p_action = 'submit' AND v_order.status = 'draft') OR
    (p_action = 'approve' AND v_order.status = 'pending_approval') OR
    (p_action = 'send' AND v_order.status = 'approved') OR
    (p_action = 'acknowledge' AND v_order.status = 'sent') OR
    (p_action = 'close' AND v_order.status = 'fulfilled') OR
    (p_action = 'cancel' AND v_order.status IN ('draft', 'pending_approval', 'approved', 'sent')) OR
    (p_action = 'dispute' AND v_order.status IN ('sent', 'acknowledged', 'partially_fulfilled', 'fulfilled')) OR
    (p_action = 'resolve' AND v_order.status = 'disputed')
  ) THEN RAISE EXCEPTION 'This purchase order cannot take that action from its current state'; END IF;
  IF p_action IN ('cancel', 'dispute', 'resolve') AND COALESCE(trim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'A reason is required for this action';
  END IF;
  UPDATE public.supplier_purchase_orders SET status = v_target,
    approved_by = CASE WHEN p_action = 'approve' THEN auth.uid() ELSE approved_by END,
    approved_at = CASE WHEN p_action = 'approve' THEN now() ELSE approved_at END,
    sent_at = CASE WHEN p_action = 'send' THEN now() ELSE sent_at END,
    acknowledged_at = CASE WHEN p_action = 'acknowledge' THEN now() ELSE acknowledged_at END,
    closed_at = CASE WHEN v_target = 'closed' THEN now() ELSE closed_at END,
    updated_at = now()
  WHERE id = p_order_id AND tenant_id = v_tenant;
  INSERT INTO public.automation_events (tenant_id, event_type, source_type, source_id, payload)
  VALUES (v_tenant, 'po.' || p_action, 'purchase_order', p_order_id,
    jsonb_build_object('from_status', v_order.status, 'to_status', v_target, 'reason', p_reason));
  RETURN v_target;
END;
$$;
REVOKE ALL ON FUNCTION public.transition_supplier_purchase_order(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transition_supplier_purchase_order(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.transition_supplier_asn(
  p_asn_id uuid,
  p_action text,
  p_reason text DEFAULT NULL
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_asn public.supplier_asns%ROWTYPE;
  v_target text;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required'; END IF;
  SELECT * INTO v_asn FROM public.supplier_asns WHERE id = p_asn_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Shipment notice not found'; END IF;
  v_target := CASE p_action WHEN 'transit' THEN 'in_transit' WHEN 'arrive' THEN 'arrived'
    WHEN 'cancel' THEN 'cancelled' WHEN 'dispute' THEN 'disputed' WHEN 'resolve' THEN 'resolved' ELSE NULL END;
  IF v_target IS NULL THEN RAISE EXCEPTION 'Unsupported shipment action'; END IF;
  IF NOT (
    (p_action = 'transit' AND v_asn.status = 'announced') OR
    (p_action = 'arrive' AND v_asn.status IN ('announced', 'in_transit')) OR
    (p_action = 'cancel' AND v_asn.status IN ('announced', 'in_transit')) OR
    (p_action = 'dispute' AND v_asn.status IN ('arrived', 'receiving', 'partially_received', 'received')) OR
    (p_action = 'resolve' AND v_asn.status = 'disputed')
  ) THEN RAISE EXCEPTION 'This shipment cannot take that action from its current state'; END IF;
  IF p_action IN ('cancel', 'dispute', 'resolve') AND COALESCE(trim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'A reason is required for this action';
  END IF;
  UPDATE public.supplier_asns SET status = v_target,
    actual_arrival_at = CASE WHEN p_action = 'arrive' THEN COALESCE(actual_arrival_at, now()) ELSE actual_arrival_at END,
    notes = CASE WHEN NULLIF(trim(p_reason), '') IS NULL THEN notes ELSE concat_ws(E'\n', notes, p_action || ': ' || p_reason) END,
    updated_at = now()
  WHERE id = p_asn_id AND tenant_id = v_tenant;
  INSERT INTO public.automation_events (tenant_id, event_type, source_type, source_id, payload)
  VALUES (v_tenant, 'asn.' || p_action, 'asn', p_asn_id,
    jsonb_build_object('from_status', v_asn.status, 'to_status', v_target, 'reason', p_reason));
  RETURN v_target;
END;
$$;
REVOKE ALL ON FUNCTION public.transition_supplier_asn(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transition_supplier_asn(uuid, text, text) TO authenticated;

-- Preserve the existing purchase/stock transaction while enforcing the new
-- supplier lifecycle for every purchase entry point in the app.
CREATE OR REPLACE FUNCTION public.process_purchase(
  p_purchase_items jsonb, p_supplier_id uuid DEFAULT NULL, p_invoice_number text DEFAULT NULL,
  p_note text DEFAULT NULL, p_purchase_date date DEFAULT CURRENT_DATE,
  p_payment_status text DEFAULT 'paid', p_amount_paid numeric DEFAULT 0
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE expected_total numeric;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required'; END IF;
  IF p_supplier_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.suppliers
      WHERE id = p_supplier_id AND tenant_id = public.current_tenant_id() AND status = 'ACTIVE') THEN
    RAISE EXCEPTION 'Purchases can only be recorded for active suppliers';
  END IF;
  IF jsonb_typeof(p_purchase_items) <> 'array' OR jsonb_array_length(p_purchase_items) = 0 THEN
    RAISE EXCEPTION 'At least one purchase item is required';
  END IF;
  IF p_payment_status NOT IN ('paid', 'partial', 'credit') OR COALESCE(p_amount_paid, -1) < 0 THEN
    RAISE EXCEPTION 'Invalid purchase payment details';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_purchase_items) item
      WHERE COALESCE((item->>'quantity')::numeric, 0) <= 0
        OR COALESCE((item->>'buying_price')::numeric, -1) < 0) THEN
    RAISE EXCEPTION 'Purchase quantities must be positive and prices cannot be negative';
  END IF;
  SELECT SUM((item->>'quantity')::numeric * (item->>'buying_price')::numeric)
    INTO expected_total FROM jsonb_array_elements(p_purchase_items) item;
  IF p_amount_paid > expected_total THEN RAISE EXCEPTION 'Amount paid exceeds purchase total'; END IF;
  RETURN public.process_purchase_unchecked(p_purchase_items, p_supplier_id, p_invoice_number,
    p_note, p_purchase_date, p_payment_status, p_amount_paid);
END;
$$;
REVOKE ALL ON FUNCTION public.process_purchase(jsonb, uuid, text, text, date, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_purchase(jsonb, uuid, text, text, date, text, numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.enqueue_document_processing(p_document_id uuid, p_reprocess boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_document public.receiving_documents%ROWTYPE;
  v_job_id uuid;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required'; END IF;
  SELECT * INTO v_document FROM public.receiving_documents
    WHERE id = p_document_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Document not found'; END IF;
  IF v_document.status IN ('posted', 'rejected', 'archived') THEN RAISE EXCEPTION 'This document cannot be processed'; END IF;
  IF v_document.duplicate_of IS NOT NULL THEN RAISE EXCEPTION 'A duplicate document is not sent for automatic extraction'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.automation_jobs WHERE tenant_id = v_tenant AND source_id = p_document_id
      AND job_type = 'document.process' AND status IN ('queued', 'running')
  ) THEN RAISE EXCEPTION 'Document processing is already queued'; END IF;
  INSERT INTO public.automation_jobs (tenant_id, job_type, source_id, payload, status, attempts, run_after)
  VALUES (v_tenant, 'document.process', p_document_id,
    jsonb_build_object('document_id', p_document_id), 'queued', 0, now())
  RETURNING id INTO v_job_id;
  UPDATE public.receiving_documents SET status = 'uploaded', processing_error = NULL, updated_at = now()
    WHERE id = p_document_id AND tenant_id = v_tenant;
  INSERT INTO public.automation_events (tenant_id, event_type, source_type, source_id, payload)
  VALUES (v_tenant, CASE WHEN p_reprocess THEN 'document.reprocess_requested' ELSE 'document.uploaded' END,
    'document', p_document_id, jsonb_build_object('job_id', v_job_id));
  RETURN v_job_id;
END;
$$;
REVOKE ALL ON FUNCTION public.enqueue_document_processing(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enqueue_document_processing(uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.claim_receiving_document_job(p_job_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE v_attempt integer;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required'; END IF;
  UPDATE public.automation_jobs SET status = 'running', attempts = attempts + 1,
    locked_at = now(), locked_by = auth.uid()::text, last_error = NULL
  WHERE id = p_job_id AND tenant_id = public.current_tenant_id()
    AND job_type = 'document.process' AND status IN ('queued', 'failed')
    AND run_after <= now() AND attempts < max_attempts
  RETURNING attempts INTO v_attempt;
  RETURN v_attempt IS NOT NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_receiving_document_job(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_receiving_document_job(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.save_document_extraction_result(
  p_document_id uuid,
  p_engine text,
  p_raw_text text,
  p_structured jsonb,
  p_confidence numeric,
  p_warnings jsonb,
  p_model_version text,
  p_duration_ms integer,
  p_lines jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, extensions AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_document public.receiving_documents%ROWTYPE;
  v_extraction_id uuid;
  v_attempt integer;
  v_line jsonb;
  v_line_no integer := 0;
  v_product_id uuid;
  v_qty numeric(18, 4);
  v_price numeric(18, 4);
  v_description text;
  v_supplier_sku text;
  v_method text;
  v_match_confidence numeric(5, 4);
  v_decision text;
  v_expected numeric(18, 4);
  v_expected_price numeric(18, 4);
  v_qty_variance numeric(8, 4);
  v_price_variance numeric(8, 4);
  v_asn_line_id uuid;
  v_po_line_id uuid;
  v_settings public.automation_settings%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required'; END IF;
  IF p_structured IS NULL OR jsonb_typeof(p_structured) <> 'object' THEN RAISE EXCEPTION 'Extraction output must be a JSON object'; END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN RAISE EXCEPTION 'Extraction lines must be an array'; END IF;
  IF jsonb_array_length(p_lines) > 500 THEN RAISE EXCEPTION 'A document may contain at most 500 extracted lines'; END IF;
  IF length(p_raw_text) > 100000 THEN RAISE EXCEPTION 'Extracted document text exceeds the storage limit'; END IF;
  SELECT * INTO v_document FROM public.receiving_documents
    WHERE id = p_document_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND OR v_document.status IN ('posted', 'rejected', 'archived') THEN
    RAISE EXCEPTION 'Document is unavailable for extraction';
  END IF;
  SELECT * INTO v_settings FROM public.automation_settings WHERE tenant_id = v_tenant;
  SELECT COALESCE(MAX(attempt_no), 0) + 1 INTO v_attempt FROM public.document_extractions
    WHERE tenant_id = v_tenant AND document_id = p_document_id;
  INSERT INTO public.document_extractions
    (tenant_id, document_id, attempt_no, engine, raw_text, structured, confidence_overall,
     warnings, model_version, duration_ms)
  VALUES (v_tenant, p_document_id, v_attempt, p_engine, p_raw_text, p_structured,
    LEAST(1, GREATEST(0, COALESCE(p_confidence, 0))), COALESCE(p_warnings, '[]'::jsonb),
    p_model_version, p_duration_ms)
  RETURNING id INTO v_extraction_id;

  DELETE FROM public.receiving_document_lines WHERE tenant_id = v_tenant AND document_id = p_document_id;
  DELETE FROM public.document_matches WHERE tenant_id = v_tenant AND document_id = p_document_id;
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    v_line_no := v_line_no + 1;
    v_description := NULLIF(trim(v_line->>'description'), '');
    v_supplier_sku := NULLIF(trim(v_line->>'supplier_sku'), '');
    v_qty := public.try_parse_receiving_numeric(v_line->>'quantity');
    v_price := public.try_parse_receiving_numeric(v_line->>'unit_price');
    IF v_qty <= 0 THEN v_qty := NULL; END IF;
    IF v_price < 0 THEN v_price := NULL; END IF;
    v_product_id := NULL;
    v_asn_line_id := NULL;
    v_po_line_id := NULL;
    v_method := 'NONE';
    v_match_confidence := 0;
    v_expected := NULL;
    v_expected_price := NULL;
    IF v_supplier_sku IS NOT NULL THEN
      SELECT sp.product_id, sp.last_price
        INTO v_product_id, v_expected_price
      FROM public.supplier_products sp
      JOIN public.products mapped_product ON mapped_product.tenant_id = sp.tenant_id
        AND mapped_product.id = sp.product_id AND mapped_product.status = 'active'
      WHERE sp.tenant_id = v_tenant AND sp.supplier_id = v_document.supplier_id
        AND lower(sp.supplier_sku) = lower(NULLIF(trim(v_line->>'supplier_sku'), ''))
      LIMIT 1;
      IF FOUND THEN v_method := 'SKU_EXACT'; v_match_confidence := 0.99; END IF;
    END IF;
    IF v_product_id IS NULL AND v_supplier_sku IS NOT NULL THEN
      SELECT p.id, p.buying_price INTO v_product_id, v_expected_price
      FROM public.products p WHERE p.tenant_id = v_tenant
        AND lower(COALESCE(p.catalog_sku, '')) = lower(v_supplier_sku) AND p.status = 'active' LIMIT 1;
      IF FOUND THEN v_method := 'SKU_EXACT'; v_match_confidence := 0.97; END IF;
    END IF;
    IF v_product_id IS NULL AND v_description IS NOT NULL THEN
      SELECT p.id, p.buying_price INTO v_product_id, v_expected_price
      FROM public.products p WHERE p.tenant_id = v_tenant AND p.status = 'active'
        AND lower(regexp_replace(trim(p.name), '[^a-zA-Z0-9]+', ' ', 'g')) =
            lower(regexp_replace(trim(v_description), '[^a-zA-Z0-9]+', ' ', 'g'))
      ORDER BY (p.supplier_id = v_document.supplier_id) DESC LIMIT 1;
      IF FOUND THEN v_method := 'NAME_EXACT'; v_match_confidence := 0.94; END IF;
    END IF;
    IF v_product_id IS NULL AND v_description IS NOT NULL THEN
      SELECT candidate.id, candidate.buying_price, candidate.confidence
        INTO v_product_id, v_expected_price, v_match_confidence
      FROM (
        SELECT p.id, p.buying_price,
          similarity(lower(regexp_replace(p.name, '[^a-zA-Z0-9]+', ' ', 'g')),
                     lower(regexp_replace(v_description, '[^a-zA-Z0-9]+', ' ', 'g'))) AS confidence,
          p.supplier_id
        FROM public.products p
        WHERE p.tenant_id = v_tenant AND p.status = 'active'
      ) candidate
      WHERE candidate.confidence >= 0.55
      ORDER BY candidate.confidence DESC, (candidate.supplier_id = v_document.supplier_id) DESC
      LIMIT 1;
      IF FOUND THEN v_method := 'NAME_FUZZY'; END IF;
    END IF;
    IF v_document.asn_id IS NOT NULL AND v_product_id IS NOT NULL THEN
      SELECT line.id, line.purchase_order_line_id, line.quantity_expected - line.quantity_received,
             line.unit_price
        INTO v_asn_line_id, v_po_line_id, v_expected, v_expected_price
      FROM public.supplier_asn_lines line
      WHERE line.tenant_id = v_tenant AND line.asn_id = v_document.asn_id AND line.product_id = v_product_id
        AND line.quantity_received < line.quantity_expected
      ORDER BY line.line_no LIMIT 1;
    END IF;
    v_qty_variance := CASE WHEN v_expected IS NOT NULL AND v_expected > 0 AND v_qty IS NOT NULL
      THEN round(abs(v_qty - v_expected) / v_expected * 100, 4) ELSE NULL END;
    v_price_variance := CASE WHEN v_expected_price IS NOT NULL AND v_expected_price > 0 AND v_price IS NOT NULL
      THEN round(abs(v_price - v_expected_price) / v_expected_price * 100, 4) ELSE NULL END;
    v_decision := CASE
      WHEN v_product_id IS NULL THEN 'UNMATCHED'
      WHEN v_match_confidence >= COALESCE(v_settings.auto_match_confidence, 0.97)
        AND (v_qty_variance IS NULL OR v_qty_variance <= COALESCE(v_settings.qty_tolerance_pct, 2))
        AND (v_price_variance IS NULL OR v_price_variance <= COALESCE(v_settings.price_tolerance_pct, 1))
        AND v_qty IS NOT NULL AND v_price IS NOT NULL THEN 'AUTO_MATCH'
      WHEN COALESCE(v_qty_variance, 0) > 10 OR COALESCE(v_price_variance, 0) > 5 THEN 'REVIEW_URGENT'
      ELSE 'REVIEW'
    END;

    INSERT INTO public.document_matches
      (tenant_id, document_id, extraction_id, line_no, extracted_description, extracted_qty,
       extracted_unit, extracted_unit_price, matched_product_id, matched_supplier_sku,
       match_method, match_confidence, decision, variance_qty_pct, variance_price_pct)
    VALUES (v_tenant, p_document_id, v_extraction_id, v_line_no, v_description, v_qty,
      NULLIF(v_line->>'unit', ''), v_price, v_product_id, v_supplier_sku,
      v_method, v_match_confidence, v_decision, v_qty_variance, v_price_variance);

    INSERT INTO public.receiving_document_lines
      (tenant_id, document_id, asn_line_id, purchase_order_line_id, line_no, product_id,
       description, quantity_received, unit_price, extracted_description, supplier_sku,
       extracted_unit, confidence, match_method, match_confidence, decision,
       variance_qty_pct, variance_price_pct, source_page, source_bbox)
    VALUES (v_tenant, p_document_id, v_asn_line_id, v_po_line_id, v_line_no, v_product_id,
      v_description, v_qty, v_price, v_description, v_supplier_sku, NULLIF(v_line->>'unit', ''),
      LEAST(1, GREATEST(0, COALESCE(public.try_parse_receiving_numeric(v_line->>'confidence'), 0))),
      v_method, v_match_confidence, v_decision, v_qty_variance, v_price_variance,
      CASE WHEN COALESCE(v_line->>'source_page', '') ~ '^[0-9]{1,5}$'
        THEN (v_line->>'source_page')::integer ELSE NULL END, v_line->'source_bbox');
  END LOOP;

  UPDATE public.receiving_documents SET
    status = CASE
      WHEN jsonb_array_length(p_lines) = 0 THEN 'unmatched'
      WHEN EXISTS (SELECT 1 FROM public.receiving_document_lines l WHERE l.tenant_id = v_tenant AND l.document_id = p_document_id AND l.decision = 'UNMATCHED') THEN 'unmatched'
      WHEN EXISTS (SELECT 1 FROM public.receiving_document_lines l WHERE l.tenant_id = v_tenant AND l.document_id = p_document_id AND l.decision IN ('REVIEW', 'REVIEW_URGENT')) THEN 'partially_matched'
      ELSE 'matched'
    END,
    invoice_number = COALESCE(invoice_number, NULLIF(trim(p_structured->>'invoice_number'), '')),
    language = COALESCE(language, NULLIF(trim(p_structured->>'language'), '')),
    confidence_overall = LEAST(1, GREATEST(0, COALESCE(p_confidence, 0))),
    processing_error = NULL, updated_at = now()
  WHERE id = p_document_id AND tenant_id = v_tenant;
  INSERT INTO public.automation_events (tenant_id, event_type, source_type, source_id, payload)
  VALUES (v_tenant, 'document.extracted', 'document', p_document_id,
    jsonb_build_object('extraction_id', v_extraction_id, 'engine', p_engine, 'line_count', v_line_no));
  RETURN v_extraction_id;
END;
$$;
REVOKE ALL ON FUNCTION public.save_document_extraction_result(uuid, text, text, jsonb, numeric, jsonb, text, integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_document_extraction_result(uuid, text, text, jsonb, numeric, jsonb, text, integer, jsonb) TO authenticated;

-- Extraction may create incomplete lines. Final review fills those values and
-- records an immutable decision trail before stock can be posted.
CREATE OR REPLACE FUNCTION public.save_receiving_document_review(
  p_document_id uuid,
  p_lines jsonb
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_document public.receiving_documents%ROWTYPE;
  v_line jsonb;
  v_old_line public.receiving_document_lines%ROWTYPE;
  v_line_no integer := 0;
  v_quantity numeric(18, 4);
  v_price numeric(18, 4);
  v_product public.products%ROWTYPE;
  v_asn_line public.supplier_asn_lines%ROWTYPE;
  v_po_line public.supplier_purchase_order_lines%ROWTYPE;
  v_action text;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required'; END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'At least one reviewed product line is required';
  END IF;
  SELECT * INTO v_document FROM public.receiving_documents
    WHERE id = p_document_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND OR v_document.status IN ('posted', 'rejected', 'archived') THEN
    RAISE EXCEPTION 'This document cannot be reviewed';
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    v_line_no := v_line_no + 1;
    SELECT * INTO v_old_line FROM public.receiving_document_lines
      WHERE tenant_id = v_tenant AND document_id = p_document_id AND line_no = v_line_no;
    v_action := COALESCE(NULLIF(v_line->>'review_action', ''), 'APPROVE');
    IF v_action NOT IN ('APPROVE', 'CORRECT_PRODUCT', 'CORRECT_QTY', 'CORRECT_PRICE', 'APPROVE_ALL') THEN
      RAISE EXCEPTION 'Unsupported line review action';
    END IF;
    IF v_action LIKE 'CORRECT_%' AND COALESCE(trim(v_line->>'reason_code'), '') = '' THEN
      RAISE EXCEPTION 'A reason code is required for each corrected line';
    END IF;
    INSERT INTO public.document_reviews
      (tenant_id, document_id, reviewer_id, action, line_no, before_value, after_value, reason_code, reason)
    VALUES (v_tenant, p_document_id, auth.uid(), v_action, v_line_no,
      CASE WHEN v_old_line.id IS NULL THEN NULL ELSE to_jsonb(v_old_line) END,
      jsonb_build_object('product_id', v_line->>'product_id',
        'quantity_received', v_line->>'quantity_received', 'unit_price', v_line->>'unit_price'),
      NULLIF(trim(v_line->>'reason_code'), ''), NULLIF(trim(v_line->>'reason'), ''));
  END LOOP;

  DELETE FROM public.receiving_document_lines
    WHERE tenant_id = v_tenant AND document_id = p_document_id;
  v_line_no := 0;
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
    v_po_line := NULL;
    IF NULLIF(v_line->>'asn_line_id', '') IS NOT NULL THEN
      SELECT * INTO v_asn_line FROM public.supplier_asn_lines line
        WHERE line.id = (v_line->>'asn_line_id')::uuid
          AND line.tenant_id = v_tenant AND line.asn_id = v_document.asn_id;
      IF NOT FOUND OR v_asn_line.product_id <> v_product.id THEN
        RAISE EXCEPTION 'A selected shipment line does not match this product and document';
      END IF;
      SELECT * INTO v_po_line FROM public.supplier_purchase_order_lines
        WHERE tenant_id = v_tenant AND id = v_asn_line.purchase_order_line_id;
    ELSIF NULLIF(v_line->>'purchase_order_line_id', '') IS NOT NULL THEN
      SELECT * INTO v_po_line FROM public.supplier_purchase_order_lines
        WHERE tenant_id = v_tenant AND id = (v_line->>'purchase_order_line_id')::uuid;
      IF NOT FOUND OR v_po_line.product_id <> v_product.id THEN
        RAISE EXCEPTION 'A selected purchase order line does not match this product';
      END IF;
    END IF;

    INSERT INTO public.receiving_document_lines
      (tenant_id, document_id, asn_line_id, purchase_order_line_id, line_no,
       product_id, description, quantity_received, unit_price, review_action)
    VALUES (v_tenant, v_document.id, v_asn_line.id, v_po_line.id, v_line_no,
      v_product.id, v_product.name, v_quantity, v_price,
      COALESCE(NULLIF(v_line->>'review_action', ''), 'APPROVE'));
  END LOOP;
  UPDATE public.receiving_documents SET status = 'reviewed', processing_error = NULL, updated_at = now()
    WHERE id = v_document.id AND tenant_id = v_tenant;
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
  IF NOT FOUND OR v_document.status <> 'reviewed' THEN
    RAISE EXCEPTION 'Complete and save a document review before posting';
  END IF;
  IF v_document.document_type = 'credit_note' THEN
    RAISE EXCEPTION 'Credit notes cannot be posted as positive stock receipts';
  END IF;
  IF v_document.duplicate_of IS NOT NULL THEN
    RAISE EXCEPTION 'A duplicate document cannot be posted as a receipt';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.document_reviews
    WHERE tenant_id = v_tenant AND document_id = p_document_id) THEN
    RAISE EXCEPTION 'A recorded reviewer approval is required before posting';
  END IF;
  IF EXISTS (SELECT 1 FROM public.receiving_document_lines
    WHERE tenant_id = v_tenant AND document_id = p_document_id
      AND (product_id IS NULL OR quantity_received IS NULL OR quantity_received <= 0 OR unit_price IS NULL OR unit_price < 0)) THEN
    RAISE EXCEPTION 'Every receipt line must have a product, positive quantity, and non-negative unit cost';
  END IF;
  SELECT jsonb_agg(jsonb_build_object('product_id', line.product_id,
      'quantity', line.quantity_received, 'buying_price', line.unit_price) ORDER BY line.line_no)
    INTO v_items FROM public.receiving_document_lines line
    WHERE line.tenant_id = v_tenant AND line.document_id = v_document.id;
  IF COALESCE(jsonb_array_length(v_items), 0) = 0 THEN
    RAISE EXCEPTION 'Add and review at least one product line before posting';
  END IF;
  IF v_document.invoice_number IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.purchases p WHERE p.tenant_id = v_tenant
      AND p.supplier_id = v_document.supplier_id AND p.invoice_number = v_document.invoice_number
  ) THEN RAISE EXCEPTION 'This supplier invoice number has already been posted'; END IF;

  v_invoice_number := NULLIF(trim(v_document.invoice_number), '');
  v_purchase_id := public.process_purchase(v_items, v_document.supplier_id, v_invoice_number,
    'Received from document ' || v_document.id::text, v_document.created_at::date, 'credit', 0);
  UPDATE public.receiving_documents SET status = 'posted', purchase_id = v_purchase_id,
    posted_by = auth.uid(), posted_at = now(), updated_at = now()
    WHERE id = v_document.id AND tenant_id = v_tenant;

  UPDATE public.supplier_asn_lines asn_line SET quantity_received = asn_line.quantity_received + received.quantity
    FROM (SELECT asn_line_id, SUM(quantity_received) AS quantity
      FROM public.receiving_document_lines WHERE tenant_id = v_tenant AND document_id = v_document.id
        AND asn_line_id IS NOT NULL GROUP BY asn_line_id) received
    WHERE asn_line.id = received.asn_line_id AND asn_line.tenant_id = v_tenant;
  UPDATE public.supplier_purchase_order_lines po_line SET quantity_received = po_line.quantity_received + received.quantity
    FROM (SELECT purchase_order_line_id, SUM(quantity_received) AS quantity
      FROM public.receiving_document_lines WHERE tenant_id = v_tenant AND document_id = v_document.id
        AND purchase_order_line_id IS NOT NULL GROUP BY purchase_order_line_id) received
    WHERE po_line.id = received.purchase_order_line_id AND po_line.tenant_id = v_tenant;
  INSERT INTO public.supplier_products
    (tenant_id, supplier_id, product_id, last_price, last_price_at)
  SELECT v_tenant, v_document.supplier_id, line.product_id, line.unit_price, now()
    FROM public.receiving_document_lines line
    WHERE line.tenant_id = v_tenant AND line.document_id = v_document.id AND line.product_id IS NOT NULL
  ON CONFLICT (tenant_id, supplier_id, product_id) DO UPDATE
    SET last_price = EXCLUDED.last_price, last_price_at = EXCLUDED.last_price_at, updated_at = now();

  IF v_document.asn_id IS NOT NULL THEN
    UPDATE public.supplier_asns a SET status = CASE WHEN NOT EXISTS (
        SELECT 1 FROM public.supplier_asn_lines l WHERE l.tenant_id = v_tenant AND l.asn_id = a.id
          AND l.quantity_received < l.quantity_expected) THEN 'received' ELSE 'partially_received' END,
      actual_arrival_at = COALESCE(a.actual_arrival_at, now()), updated_at = now()
      WHERE a.id = v_document.asn_id AND a.tenant_id = v_tenant;
    UPDATE public.supplier_purchase_orders po SET status = CASE WHEN NOT EXISTS (
        SELECT 1 FROM public.supplier_purchase_order_lines l WHERE l.tenant_id = v_tenant
          AND l.purchase_order_id = po.id AND l.quantity_received < l.quantity_ordered)
        THEN 'fulfilled' ELSE 'partially_fulfilled' END, updated_at = now()
      WHERE po.id = (SELECT a.purchase_order_id FROM public.supplier_asns a
        WHERE a.id = v_document.asn_id AND a.tenant_id = v_tenant) AND po.tenant_id = v_tenant;
  END IF;
  RETURN v_purchase_id;
END;
$$;
REVOKE ALL ON FUNCTION public.post_receiving_document(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_receiving_document(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_receiving_document_processing_state(
  p_document_id uuid,
  p_status text,
  p_error text DEFAULT NULL,
  p_page_count integer DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required'; END IF;
  IF p_status NOT IN ('scanning', 'extracting', 'extraction_failed', 'scan_failed') THEN
    RAISE EXCEPTION 'Unsupported document processing status';
  END IF;
  UPDATE public.receiving_documents SET status = p_status,
    processing_error = NULLIF(trim(p_error), ''),
    page_count = COALESCE(p_page_count, page_count), updated_at = now()
  WHERE id = p_document_id AND tenant_id = public.current_tenant_id()
    AND status NOT IN ('posted', 'rejected', 'archived');
  IF NOT FOUND THEN RAISE EXCEPTION 'Document is not available for processing'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.set_receiving_document_processing_state(uuid, text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_receiving_document_processing_state(uuid, text, text, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.reject_receiving_document(p_document_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required'; END IF;
  IF COALESCE(trim(p_reason), '') = '' THEN RAISE EXCEPTION 'A rejection reason is required'; END IF;
  UPDATE public.receiving_documents SET status = 'rejected', processing_error = NULL,
    updated_at = now()
  WHERE id = p_document_id AND tenant_id = public.current_tenant_id()
    AND status NOT IN ('posted', 'rejected', 'archived');
  IF NOT FOUND THEN RAISE EXCEPTION 'Document cannot be rejected'; END IF;
  INSERT INTO public.document_reviews
    (tenant_id, document_id, reviewer_id, action, reason_code, reason)
  VALUES (public.current_tenant_id(), p_document_id, auth.uid(), 'REQUEST_REUPLOAD', 'DOCUMENT_UNCLEAR', trim(p_reason));
END;
$$;
REVOKE ALL ON FUNCTION public.reject_receiving_document(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_receiving_document(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.run_tenant_reconciliation(p_tenant_id uuid, p_report_date date)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  v_run_id uuid;
  v_timezone text;
  v_chain jsonb;
  v_open_count integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.business_tenants WHERE id = p_tenant_id AND status = 'active') THEN
    RAISE EXCEPTION 'Workspace is not active';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant_id::text, 37104));
  SELECT COALESCE((SELECT settings.timezone FROM public.system_settings settings WHERE settings.tenant_id = p_tenant_id), 'Africa/Nairobi')
    INTO v_timezone;
  INSERT INTO public.reconciliation_runs (tenant_id, report_date, status)
    VALUES (p_tenant_id, p_report_date, 'running') RETURNING id INTO v_run_id;

  INSERT INTO public.anomaly_flags (tenant_id, severity, category, subject_type, subject_id, score, details)
  SELECT p_tenant_id,
    CASE WHEN abs(line.quantity_received - line.quantity_expected) / NULLIF(line.quantity_expected, 0) > 0.10 THEN 'HIGH' ELSE 'NORMAL' END,
    'quantity_variance', 'asn_line', line.id,
    abs(line.quantity_received - line.quantity_expected) / NULLIF(line.quantity_expected, 0),
    jsonb_build_object('expected', line.quantity_expected, 'received', line.quantity_received,
      'asn_id', line.asn_id, 'variance_pct', round(abs(line.quantity_received - line.quantity_expected) / NULLIF(line.quantity_expected, 0) * 100, 2))
  FROM public.supplier_asn_lines line
  JOIN public.supplier_asns a ON a.tenant_id = line.tenant_id AND a.id = line.asn_id
  WHERE line.tenant_id = p_tenant_id AND a.status IN ('received', 'disputed')
    AND line.quantity_expected > 0
    AND abs(line.quantity_received - line.quantity_expected) / line.quantity_expected > 0.02
  ON CONFLICT (tenant_id, category, subject_type, subject_id) WHERE status = 'OPEN'
  DO UPDATE SET severity = EXCLUDED.severity, score = EXCLUDED.score, details = EXCLUDED.details, detected_at = now();

  INSERT INTO public.anomaly_flags (tenant_id, severity, category, subject_type, subject_id, score, details)
  SELECT p_tenant_id,
    CASE WHEN abs(received.unit_price - asn.unit_price) / NULLIF(asn.unit_price, 0) > 0.05 THEN 'HIGH' ELSE 'NORMAL' END,
    'price_variance', 'receiving_line', received.id,
    abs(received.unit_price - asn.unit_price) / NULLIF(asn.unit_price, 0),
    jsonb_build_object('expected_price', asn.unit_price, 'received_price', received.unit_price,
      'asn_id', asn.asn_id, 'variance_pct', round(abs(received.unit_price - asn.unit_price) / NULLIF(asn.unit_price, 0) * 100, 2))
  FROM public.receiving_document_lines received
  JOIN public.supplier_asn_lines asn ON asn.tenant_id = received.tenant_id AND asn.id = received.asn_line_id
  JOIN public.receiving_documents document ON document.tenant_id = received.tenant_id AND document.id = received.document_id
  WHERE received.tenant_id = p_tenant_id AND document.status = 'posted'
    AND asn.unit_price > 0 AND received.unit_price IS NOT NULL
    AND abs(received.unit_price - asn.unit_price) / asn.unit_price > 0.01
  ON CONFLICT (tenant_id, category, subject_type, subject_id) WHERE status = 'OPEN'
  DO UPDATE SET severity = EXCLUDED.severity, score = EXCLUDED.score, details = EXCLUDED.details, detected_at = now();

  INSERT INTO public.anomaly_flags (tenant_id, severity, category, subject_type, subject_id, details)
  SELECT p_tenant_id, 'HIGH', 'off_hours_receiving', 'receiving_document', document.id,
    jsonb_build_object('posted_at', document.posted_at, 'timezone', v_timezone)
  FROM public.receiving_documents document
  WHERE document.tenant_id = p_tenant_id AND document.status = 'posted'
    AND (document.posted_at AT TIME ZONE v_timezone)::date = p_report_date
    AND (EXTRACT(HOUR FROM document.posted_at AT TIME ZONE v_timezone) >= 22
      OR EXTRACT(HOUR FROM document.posted_at AT TIME ZONE v_timezone) < 5)
  ON CONFLICT (tenant_id, category, subject_type, subject_id) WHERE status = 'OPEN'
  DO UPDATE SET details = EXCLUDED.details, detected_at = now();

  INSERT INTO public.anomaly_flags (tenant_id, severity, category, subject_type, subject_id, score, details)
  SELECT p_tenant_id, 'HIGH', 'low_extraction_confidence', 'receiving_document', document.id,
    document.confidence_overall, jsonb_build_object('confidence', document.confidence_overall)
  FROM public.receiving_documents document
  WHERE document.tenant_id = p_tenant_id AND document.status IN ('matched', 'partially_matched', 'unmatched')
    AND document.created_at::date = p_report_date AND document.confidence_overall < 0.6
  ON CONFLICT (tenant_id, category, subject_type, subject_id) WHERE status = 'OPEN'
  DO UPDATE SET score = EXCLUDED.score, details = EXCLUDED.details, detected_at = now();

  INSERT INTO public.anomaly_flags (tenant_id, severity, category, subject_type, subject_id, details)
  SELECT p_tenant_id, 'HIGH', 'adjustment_without_document', 'stock_movement', move.id,
    jsonb_build_object('product_id', move.product_id, 'quantity', move.quantity, 'created_at', move.created_at)
  FROM public.stock_movements move
  WHERE move.tenant_id = p_tenant_id AND move.movement_type = 'adjustment'
    AND move.created_at::date = p_report_date AND abs(move.quantity) >= 50
    AND (move.reference_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.receiving_documents document
      WHERE document.tenant_id = p_tenant_id AND document.purchase_id = move.reference_id AND document.status = 'posted'
    ))
  ON CONFLICT (tenant_id, category, subject_type, subject_id) WHERE status = 'OPEN'
  DO UPDATE SET details = EXCLUDED.details, detected_at = now();

  SELECT public.verify_stock_movement_chain(p_tenant_id) INTO v_chain;
  IF NOT COALESCE((v_chain->>'valid')::boolean, false) THEN
    INSERT INTO public.anomaly_flags (tenant_id, severity, category, subject_type, subject_id, details)
    VALUES (p_tenant_id, 'URGENT', 'stock_chain_broken', 'stock_ledger', p_tenant_id,
      COALESCE(v_chain, '{}'::jsonb))
    ON CONFLICT (tenant_id, category, subject_type, subject_id) WHERE status = 'OPEN'
    DO UPDATE SET details = EXCLUDED.details, detected_at = now();
  END IF;

  INSERT INTO public.system_notifications
    (tenant_id, recipient_user_id, channel, severity, template, title, body, payload)
  SELECT p_tenant_id, membership.user_id, 'IN_APP', anomaly.severity,
    'receiving-anomaly', 'Receiving exception detected',
    'A receiving control found an exception that needs review.',
    jsonb_build_object('anomaly_id', anomaly.id, 'category', anomaly.category, 'subject_type', anomaly.subject_type)
  FROM public.anomaly_flags anomaly
  JOIN public.tenant_memberships membership ON membership.tenant_id = anomaly.tenant_id
    AND membership.role = 'admin' AND membership.status = 'active'
  WHERE anomaly.tenant_id = p_tenant_id AND anomaly.status = 'OPEN' AND anomaly.last_notified_at IS NULL;
  UPDATE public.anomaly_flags SET last_notified_at = now()
    WHERE tenant_id = p_tenant_id AND status = 'OPEN' AND last_notified_at IS NULL;

  SELECT count(*) INTO v_open_count FROM public.anomaly_flags
    WHERE tenant_id = p_tenant_id AND status = 'OPEN';
  UPDATE public.reconciliation_runs SET status = 'completed', finished_at = now(),
    summary = jsonb_build_object('report_date', p_report_date, 'open_anomalies', v_open_count,
      'ledger_chain_valid', COALESCE((v_chain->>'valid')::boolean, false))
    WHERE id = v_run_id AND tenant_id = p_tenant_id;
  RETURN v_run_id;
EXCEPTION WHEN OTHERS THEN
  IF v_run_id IS NOT NULL THEN
    UPDATE public.reconciliation_runs SET status = 'failed', finished_at = now(), error = SQLERRM
      WHERE id = v_run_id AND tenant_id = p_tenant_id;
    RETURN v_run_id;
  END IF;
  RAISE;
END;
$$;
REVOKE ALL ON FUNCTION public.run_tenant_reconciliation(uuid, date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.run_receiving_reconciliation(p_report_date date DEFAULT CURRENT_DATE)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required'; END IF;
  RETURN public.run_tenant_reconciliation(public.current_tenant_id(), p_report_date);
END;
$$;
REVOKE ALL ON FUNCTION public.run_receiving_reconciliation(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.run_receiving_reconciliation(date) TO authenticated;

CREATE OR REPLACE FUNCTION public.resolve_anomaly(p_anomaly_id uuid, p_resolution text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required'; END IF;
  IF COALESCE(trim(p_resolution), '') = '' THEN RAISE EXCEPTION 'A resolution note is required'; END IF;
  UPDATE public.anomaly_flags SET status = 'RESOLVED', resolved_by = auth.uid(),
    resolved_at = now(), resolution = trim(p_resolution)
  WHERE id = p_anomaly_id AND tenant_id = public.current_tenant_id() AND status <> 'RESOLVED';
  IF NOT FOUND THEN RAISE EXCEPTION 'Open anomaly not found'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.resolve_anomaly(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_anomaly(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_system_notification_read(p_notification_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
BEGIN
  UPDATE public.system_notifications SET read_at = COALESCE(read_at, now())
  WHERE id = p_notification_id AND tenant_id = public.current_tenant_id()
    AND (recipient_user_id IS NULL OR recipient_user_id = auth.uid());
  IF NOT FOUND THEN RAISE EXCEPTION 'Notification not found'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.mark_system_notification_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_system_notification_read(uuid) TO authenticated;

-- Chain every stock movement, including existing sale, purchase, and adjustment paths.
ALTER TABLE public.stock_movements ADD COLUMN IF NOT EXISTS prev_hash text;
ALTER TABLE public.stock_movements ADD COLUMN IF NOT EXISTS row_hash text;
DROP TRIGGER IF EXISTS stock_movement_chain_insert ON public.stock_movements;
DROP TRIGGER IF EXISTS stock_movement_immutable ON public.stock_movements;
DROP TRIGGER IF EXISTS audit_stock_movements ON public.stock_movements;

DO $$
DECLARE
  item record;
  previous_tenant uuid := NULL;
  previous_hash text := NULL;
  canonical_row text;
  calculated_hash text;
BEGIN
  FOR item IN SELECT * FROM public.stock_movements ORDER BY tenant_id, created_at, id LOOP
    IF previous_tenant IS DISTINCT FROM item.tenant_id THEN
      previous_tenant := item.tenant_id;
      previous_hash := NULL;
    END IF;
    canonical_row := (to_jsonb(item) - 'prev_hash' - 'row_hash')::text;
    calculated_hash := encode(extensions.digest(convert_to(COALESCE(previous_hash, '') || canonical_row, 'UTF8'), 'sha256'), 'hex');
    UPDATE public.stock_movements SET prev_hash = previous_hash, row_hash = calculated_hash WHERE id = item.id;
    previous_hash := calculated_hash;
  END LOOP;
END;
$$;
CREATE TRIGGER audit_stock_movements AFTER INSERT ON public.stock_movements
FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();

CREATE OR REPLACE FUNCTION public.chain_stock_movement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, extensions AS $$
DECLARE
  v_previous text;
  v_previous_at timestamptz;
  v_now timestamptz;
  v_canonical text;
BEGIN
  IF NEW.tenant_id IS NULL THEN RAISE EXCEPTION 'A tenant is required for stock movement integrity'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text, 197909));
  v_now := clock_timestamp();
  SELECT move.row_hash, move.created_at INTO v_previous, v_previous_at FROM public.stock_movements move
    WHERE move.tenant_id = NEW.tenant_id
    ORDER BY move.created_at DESC, move.id DESC LIMIT 1;
  NEW.created_at := GREATEST(v_now, COALESCE(v_previous_at + interval '1 microsecond', v_now));
  NEW.prev_hash := v_previous;
  v_canonical := (to_jsonb(NEW) - 'prev_hash' - 'row_hash')::text;
  NEW.row_hash := encode(extensions.digest(convert_to(COALESCE(v_previous, '') || v_canonical, 'UTF8'), 'sha256'), 'hex');
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION public.reject_stock_movement_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Stock movements are append-only';
END;
$$;
REVOKE ALL ON FUNCTION public.chain_stock_movement() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reject_stock_movement_mutation() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS stock_movement_chain_insert ON public.stock_movements;
CREATE TRIGGER stock_movement_chain_insert BEFORE INSERT ON public.stock_movements
FOR EACH ROW EXECUTE FUNCTION public.chain_stock_movement();
DROP TRIGGER IF EXISTS stock_movement_immutable ON public.stock_movements;
CREATE TRIGGER stock_movement_immutable BEFORE UPDATE OR DELETE ON public.stock_movements
FOR EACH ROW EXECUTE FUNCTION public.reject_stock_movement_mutation();
REVOKE UPDATE, DELETE ON public.stock_movements FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.verify_stock_movement_chain(p_tenant_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, extensions AS $$
DECLARE
  item record;
  previous_tenant uuid := NULL;
  previous_hash text := NULL;
  canonical_row text;
  calculated_hash text;
  movement_count bigint := 0;
  first_broken uuid := NULL;
BEGIN
  IF auth.uid() IS NOT NULL AND (NOT public.is_admin() OR p_tenant_id IS DISTINCT FROM public.current_tenant_id()) THEN
    RAISE EXCEPTION 'Administrator access required for the active workspace';
  END IF;
  FOR item IN SELECT * FROM public.stock_movements
    WHERE p_tenant_id IS NULL OR tenant_id = p_tenant_id
    ORDER BY tenant_id, created_at, id LOOP
    movement_count := movement_count + 1;
    IF previous_tenant IS DISTINCT FROM item.tenant_id THEN
      previous_tenant := item.tenant_id;
      previous_hash := NULL;
    END IF;
    canonical_row := (to_jsonb(item) - 'prev_hash' - 'row_hash')::text;
    calculated_hash := encode(extensions.digest(convert_to(COALESCE(previous_hash, '') || canonical_row, 'UTF8'), 'sha256'), 'hex');
    IF item.prev_hash IS DISTINCT FROM previous_hash OR item.row_hash IS DISTINCT FROM calculated_hash THEN
      first_broken := item.id;
      EXIT;
    END IF;
    previous_hash := item.row_hash;
  END LOOP;
  RETURN jsonb_build_object('valid', first_broken IS NULL, 'checked', movement_count, 'first_broken_id', first_broken);
END;
$$;
REVOKE ALL ON FUNCTION public.verify_stock_movement_chain(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_stock_movement_chain(uuid) TO authenticated, service_role;

-- Queue the initial scan and record a PII-minimized domain event on upload.
CREATE OR REPLACE FUNCTION public.enqueue_uploaded_receiving_document()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
BEGIN
  IF NEW.duplicate_of IS NOT NULL THEN
    INSERT INTO public.automation_events (tenant_id, event_type, source_type, source_id, payload)
    VALUES (NEW.tenant_id, 'document.duplicate_detected', 'document', NEW.id,
      jsonb_build_object('duplicate_of', NEW.duplicate_of, 'channel', NEW.channel));
    RETURN NEW;
  END IF;
  INSERT INTO public.automation_jobs (tenant_id, job_type, source_id, payload)
  VALUES (NEW.tenant_id, 'document.process', NEW.id, jsonb_build_object('document_id', NEW.id));
  INSERT INTO public.automation_events (tenant_id, event_type, source_type, source_id, payload)
  VALUES (NEW.tenant_id, 'document.uploaded', 'document', NEW.id,
    jsonb_build_object('channel', NEW.channel, 'document_type', NEW.document_type));
  INSERT INTO public.system_notifications (tenant_id, recipient_user_id, severity, template, title, body, payload)
  SELECT NEW.tenant_id, membership.user_id, 'NORMAL', 'document-received', 'Document received',
    'A supplier document was added to the receiving queue.', jsonb_build_object('document_id', NEW.id)
  FROM public.tenant_memberships membership
  WHERE membership.tenant_id = NEW.tenant_id AND membership.status = 'active' AND membership.role = 'admin';
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enqueue_uploaded_receiving_document() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS receiving_document_queue_on_upload ON public.receiving_documents;
CREATE TRIGGER receiving_document_queue_on_upload AFTER INSERT ON public.receiving_documents
FOR EACH ROW EXECUTE FUNCTION public.enqueue_uploaded_receiving_document();

CREATE OR REPLACE FUNCTION public.refresh_supplier_scorecards(p_period_start date, p_period_end date)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE v_tenant uuid := public.current_tenant_id(); v_count integer;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required'; END IF;
  IF p_period_start > p_period_end THEN RAISE EXCEPTION 'Period start must be before period end'; END IF;
  INSERT INTO public.supplier_scorecards
    (tenant_id, supplier_id, period_start, period_end, on_time_pct, accuracy_pct,
      dispute_rate_pct, avg_response_hours, price_competitiveness, overall_rating)
  WITH asn_summary AS (
    SELECT asn.supplier_id,
      COUNT(*) FILTER (WHERE asn.status IN ('received', 'partially_received')) AS eligible_asns,
      COUNT(*) FILTER (WHERE asn.status = 'received'
        AND asn.actual_arrival_at::date <= asn.expected_arrival_date) AS on_time_asns,
      COUNT(*) FILTER (WHERE asn.status = 'disputed') AS disputed_asns,
      COUNT(*) AS total_asns
    FROM public.supplier_asns asn
    WHERE asn.tenant_id = v_tenant AND asn.expected_arrival_date BETWEEN p_period_start AND p_period_end
    GROUP BY asn.supplier_id
  ), line_summary AS (
    SELECT asn.supplier_id, SUM(line.quantity_expected) AS expected_qty,
      SUM(LEAST(line.quantity_received, line.quantity_expected)) AS received_qty
    FROM public.supplier_asns asn
    JOIN public.supplier_asn_lines line ON line.tenant_id = asn.tenant_id AND line.asn_id = asn.id
    WHERE asn.tenant_id = v_tenant AND asn.expected_arrival_date BETWEEN p_period_start AND p_period_end
    GROUP BY asn.supplier_id
  ), response_summary AS (
    SELECT po.supplier_id,
      round(avg(EXTRACT(EPOCH FROM (po.acknowledged_at - po.sent_at)) / 3600.0), 2) AS avg_response_hours
    FROM public.supplier_purchase_orders po
    WHERE po.tenant_id = v_tenant AND po.sent_at IS NOT NULL AND po.acknowledged_at IS NOT NULL
      AND po.acknowledged_at::date BETWEEN p_period_start AND p_period_end
    GROUP BY po.supplier_id
  ), comparable_prices AS (
    SELECT product_id, supplier_id, last_price,
      min(last_price) OVER (PARTITION BY product_id) AS lowest_price
    FROM public.supplier_products
    WHERE tenant_id = v_tenant AND last_price > 0
      AND last_price_at::date BETWEEN p_period_start AND p_period_end
  ), price_summary AS (
    SELECT supplier_id, round(avg(lowest_price / last_price * 100), 2) AS price_competitiveness
    FROM comparable_prices GROUP BY supplier_id
  ), metrics AS (
    SELECT supplier.id AS supplier_id,
      CASE WHEN COALESCE(asn.eligible_asns, 0) = 0 THEN NULL
        ELSE round(100.0 * asn.on_time_asns / asn.eligible_asns, 2) END AS on_time_pct,
      CASE WHEN COALESCE(lines.expected_qty, 0) = 0 THEN NULL
        ELSE round(100.0 * lines.received_qty / lines.expected_qty, 2) END AS accuracy_pct,
      CASE WHEN COALESCE(asn.total_asns, 0) = 0 THEN NULL
        ELSE round(100.0 * asn.disputed_asns / asn.total_asns, 2) END AS dispute_rate_pct,
      response.avg_response_hours, prices.price_competitiveness
    FROM public.suppliers supplier
    LEFT JOIN asn_summary asn ON asn.supplier_id = supplier.id
    LEFT JOIN line_summary lines ON lines.supplier_id = supplier.id
    LEFT JOIN response_summary response ON response.supplier_id = supplier.id
    LEFT JOIN price_summary prices ON prices.supplier_id = supplier.id
    WHERE supplier.tenant_id = v_tenant AND supplier.status <> 'ARCHIVED'
  )
  SELECT v_tenant, metrics.supplier_id, p_period_start, p_period_end,
    metrics.on_time_pct, metrics.accuracy_pct, metrics.dispute_rate_pct,
    metrics.avg_response_hours, metrics.price_competitiveness,
    CASE WHEN metrics.on_time_pct IS NULL AND metrics.accuracy_pct IS NULL THEN NULL
      ELSE round((COALESCE(metrics.on_time_pct, 0) * 0.35 + COALESCE(metrics.accuracy_pct, 0) * 0.35
        + (100 - COALESCE(metrics.dispute_rate_pct, 0)) * 0.2
        + COALESCE(metrics.price_competitiveness, 0) * 0.1) / 20, 2) END
  FROM metrics
  ON CONFLICT (tenant_id, supplier_id, period_start, period_end) DO UPDATE SET
    on_time_pct = EXCLUDED.on_time_pct, accuracy_pct = EXCLUDED.accuracy_pct,
    dispute_rate_pct = EXCLUDED.dispute_rate_pct, avg_response_hours = EXCLUDED.avg_response_hours,
    price_competitiveness = EXCLUDED.price_competitiveness, overall_rating = EXCLUDED.overall_rating,
    created_at = now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.refresh_supplier_scorecards(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_supplier_scorecards(date, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.run_scheduled_receiving_reconciliation()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE tenant record; tenant_timezone text; local_time timestamp; run_count integer := 0;
BEGIN
  FOR tenant IN SELECT id FROM public.business_tenants WHERE status = 'active' LOOP
    SELECT COALESCE((SELECT settings.timezone FROM public.system_settings settings WHERE settings.tenant_id = tenant.id), 'Africa/Nairobi')
      INTO tenant_timezone;
    local_time := now() AT TIME ZONE tenant_timezone;
    IF EXTRACT(HOUR FROM local_time) = 18 AND EXTRACT(MINUTE FROM local_time) < 15 THEN
      PERFORM public.run_tenant_reconciliation(tenant.id, local_time::date);
      run_count := run_count + 1;
    END IF;
  END LOOP;
  RETURN run_count;
END;
$$;
REVOKE ALL ON FUNCTION public.run_scheduled_receiving_reconciliation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_scheduled_receiving_reconciliation() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    EXECUTE $schedule$
      SELECT cron.schedule('supplier-daily-reconciliation', '*/15 * * * *',
        'SELECT public.run_scheduled_receiving_reconciliation()')
    $schedule$;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Daily reconciliation was not scheduled automatically: %', SQLERRM;
END;
$$;
