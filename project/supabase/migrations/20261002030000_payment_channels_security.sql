-- Phase 1: tenant-isolated payment schema and least-privilege access.
-- The tenant payment ledger already exists in 20261002020000. This migration
-- completes it additively without reusing an existing migration version.

-- Keep the legacy encrypted text field for the currently deployed gateway;
-- new credential writers can persist ciphertext as bytes in this column.
ALTER TABLE public.payment_provider_credentials
  ADD COLUMN IF NOT EXISTS credentials_ciphertext bytea;
COMMENT ON COLUMN public.payment_provider_credentials.credentials_ciphertext IS
  'UTF-8 bytes of the AES-GCM ciphertext envelope; never plaintext.';

-- Callback payloads are stored in the append-only event ledger, never emitted
-- to application logs. Access to this table is restricted below.
ALTER TABLE public.payment_webhook_events
  ADD COLUMN IF NOT EXISTS raw_body jsonb;

-- Payment context used for shift close-out and stock/payment traceability.
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS shift_id uuid;

-- KES payments use whole shillings. NOT VALID preserves existing records while
-- enforcing the rule for all new rows and updates.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payments_amount_whole_kes_check'
      AND conrelid = 'public.payments'::regclass
  ) THEN
    ALTER TABLE public.payments
      ADD CONSTRAINT payments_amount_whole_kes_check
      CHECK (amount > 0 AND amount = trunc(amount)) NOT VALID;
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.payment_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id()
    REFERENCES public.business_tenants(id) ON DELETE CASCADE,
  original_payment_id uuid NOT NULL,
  refund_payment_id uuid,
  amount bigint NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'KES' CHECK (currency = 'KES'),
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','PROCESSING','SUCCESS','FAILED','CANCELLED','REVIEW_REQUIRED')),
  idempotency_key text NOT NULL,
  reason text,
  initiated_by uuid NOT NULL REFERENCES auth.users(id),
  approved_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  CONSTRAINT payment_refunds_original_payment_fk
    FOREIGN KEY (tenant_id, original_payment_id)
    REFERENCES public.payments(tenant_id, id),
  CONSTRAINT payment_refunds_refund_payment_fk
    FOREIGN KEY (tenant_id, refund_payment_id)
    REFERENCES public.payments(tenant_id, id)
);

-- credit_customers is the existing customer-facing credit record. This table
-- gives each such record a tenant-scoped account identity without duplicating
-- its established limit and balance columns.
CREATE TABLE IF NOT EXISTS public.customer_credit_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id()
    REFERENCES public.business_tenants(id) ON DELETE CASCADE,
  credit_customer_id uuid NOT NULL,
  currency text NOT NULL DEFAULT 'KES' CHECK (currency = 'KES'),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','CLOSED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, credit_customer_id),
  CONSTRAINT customer_credit_accounts_customer_fk
    FOREIGN KEY (tenant_id, credit_customer_id)
    REFERENCES public.credit_customers(tenant_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.payment_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id()
    REFERENCES public.business_tenants(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('MPESA','CASH','BANK_TRANSFER','CHEQUE')),
  business_date date NOT NULL,
  currency text NOT NULL DEFAULT 'KES' CHECK (currency = 'KES'),
  expected_amount bigint NOT NULL DEFAULT 0 CHECK (expected_amount >= 0),
  settled_amount bigint NOT NULL DEFAULT 0 CHECK (settled_amount >= 0),
  variance_amount bigint GENERATED ALWAYS AS (settled_amount - expected_amount) STORED,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','RECONCILED','DISPUTED')),
  notes text,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  reviewed_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, provider, business_date)
);

CREATE INDEX IF NOT EXISTS payments_tenant_created_idx
  ON public.payments (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payments_provider_ref_idx
  ON public.payments (provider_ref);
CREATE INDEX IF NOT EXISTS payments_sale_id_idx
  ON public.payments (sale_id);
CREATE INDEX IF NOT EXISTS payments_shift_id_idx
  ON public.payments (shift_id);
CREATE INDEX IF NOT EXISTS payments_tenant_channel_idx
  ON public.payments (tenant_id, channel);
CREATE INDEX IF NOT EXISTS payment_webhook_events_provider_received_idx
  ON public.payment_webhook_events (provider, received_at DESC);
CREATE INDEX IF NOT EXISTS payment_refunds_tenant_created_idx
  ON public.payment_refunds (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payment_reconciliations_tenant_date_idx
  ON public.payment_reconciliations (tenant_id, business_date DESC);

-- The application schema calls its stock ledger stock_movements. Support the
-- stock_moves name too if a deployment has that legacy table instead.
DO $$
DECLARE
  table_name text;
  constraint_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['stock_moves', 'stock_movements'] LOOP
    IF to_regclass(format('public.%I', table_name)) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS payment_id uuid',
      table_name
    );
    constraint_name := table_name || '_payment_id_fkey';
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = constraint_name
        AND conrelid = to_regclass(format('public.%I', table_name))
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (payment_id) REFERENCES public.payments(id)',
        table_name, constraint_name
      );
    END IF;

    constraint_name := table_name || '_tenant_payment_id_fkey';
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = constraint_name
        AND conrelid = to_regclass(format('public.%I', table_name))
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (tenant_id, payment_id) REFERENCES public.payments(tenant_id, id)',
        table_name, constraint_name
      );
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_customer_credit_account()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  INSERT INTO public.customer_credit_accounts (tenant_id, credit_customer_id, status)
  VALUES (
    NEW.tenant_id,
    NEW.id,
    CASE NEW.status
      WHEN 'active' THEN 'ACTIVE'
      WHEN 'suspended' THEN 'SUSPENDED'
      ELSE 'CLOSED'
    END
  )
  ON CONFLICT (tenant_id, credit_customer_id) DO UPDATE
    SET status = EXCLUDED.status, updated_at = now();
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_customer_credit_account() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS customer_credit_accounts_sync ON public.credit_customers;
CREATE TRIGGER customer_credit_accounts_sync
  AFTER INSERT OR UPDATE OF status ON public.credit_customers
  FOR EACH ROW EXECUTE FUNCTION public.sync_customer_credit_account();

CREATE OR REPLACE FUNCTION public.sync_payment_refund_record()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NEW.refund_for_payment_id IS NULL OR NEW.amount <> trunc(NEW.amount) THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.payment_refunds (
    tenant_id, original_payment_id, refund_payment_id, amount, currency,
    status, idempotency_key, reason, initiated_by, created_at, confirmed_at
  )
  VALUES (
    NEW.tenant_id, NEW.refund_for_payment_id, NEW.id, NEW.amount::bigint, 'KES',
    NEW.status, NEW.idempotency_key, NEW.notes, NEW.initiated_by, NEW.created_at, NEW.confirmed_at
  )
  ON CONFLICT (tenant_id, idempotency_key) DO UPDATE
    SET status = EXCLUDED.status, confirmed_at = EXCLUDED.confirmed_at;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_payment_refund_record() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS payments_sync_refund_record ON public.payments;
CREATE TRIGGER payments_sync_refund_record
  AFTER INSERT OR UPDATE OF status ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.sync_payment_refund_record();

ALTER TABLE public.payment_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_provider_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_credit_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_reconciliations ENABLE ROW LEVEL SECURITY;

-- Restrictive policies make tenant scope mandatory even if a later migration
-- adds another permissive policy to one of these tables.
DROP POLICY IF EXISTS tenant_isolation_payment_channels ON public.payment_channels;
CREATE POLICY tenant_isolation_payment_channels ON public.payment_channels
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_active_user())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_active_user());
DROP POLICY IF EXISTS payment_channels_tenant_read ON public.payment_channels;
CREATE POLICY payment_channels_tenant_read ON public.payment_channels
  FOR SELECT TO authenticated USING (public.is_active_user());

DROP POLICY IF EXISTS tenant_isolation_payment_provider_credentials ON public.payment_provider_credentials;
CREATE POLICY tenant_isolation_payment_provider_credentials ON public.payment_provider_credentials
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_admin())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_admin());
DROP POLICY IF EXISTS payment_provider_credentials_tenant_admin_read ON public.payment_provider_credentials;
CREATE POLICY payment_provider_credentials_tenant_admin_read ON public.payment_provider_credentials
  FOR SELECT TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS tenant_isolation_payments ON public.payments;
CREATE POLICY tenant_isolation_payments ON public.payments
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_active_user())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_active_user());
DROP POLICY IF EXISTS payments_tenant_read ON public.payments;
CREATE POLICY payments_tenant_read ON public.payments
  FOR SELECT TO authenticated USING (public.is_active_user());

DROP POLICY IF EXISTS tenant_isolation_payment_webhook_events ON public.payment_webhook_events;
CREATE POLICY tenant_isolation_payment_webhook_events ON public.payment_webhook_events
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_admin())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_admin());
DROP POLICY IF EXISTS payment_webhook_events_tenant_admin_read ON public.payment_webhook_events;
CREATE POLICY payment_webhook_events_tenant_admin_read ON public.payment_webhook_events
  FOR SELECT TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS tenant_isolation_payment_refunds ON public.payment_refunds;
CREATE POLICY tenant_isolation_payment_refunds ON public.payment_refunds
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_active_user())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_active_user());
DROP POLICY IF EXISTS payment_refunds_tenant_read ON public.payment_refunds;
CREATE POLICY payment_refunds_tenant_read ON public.payment_refunds
  FOR SELECT TO authenticated USING (public.is_active_user());

DROP POLICY IF EXISTS tenant_isolation_customer_credit_accounts ON public.customer_credit_accounts;
CREATE POLICY tenant_isolation_customer_credit_accounts ON public.customer_credit_accounts
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_active_user())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_active_user());
DROP POLICY IF EXISTS customer_credit_accounts_admin_read ON public.customer_credit_accounts;
CREATE POLICY customer_credit_accounts_admin_read ON public.customer_credit_accounts
  FOR SELECT TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS tenant_isolation_payment_reconciliations ON public.payment_reconciliations;
CREATE POLICY tenant_isolation_payment_reconciliations ON public.payment_reconciliations
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_admin())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_admin());
DROP POLICY IF EXISTS payment_reconciliations_admin_read ON public.payment_reconciliations;
CREATE POLICY payment_reconciliations_admin_read ON public.payment_reconciliations
  FOR SELECT TO authenticated USING (public.is_admin());

-- No browser client can write payment state or payment provider secrets.
REVOKE ALL ON public.payment_channels, public.payment_provider_credentials,
  public.payments, public.payment_webhook_events, public.payment_refunds,
  public.customer_credit_accounts, public.payment_reconciliations
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.payment_channels, public.payments,
  public.payment_refunds, public.customer_credit_accounts,
  public.payment_reconciliations TO authenticated;
GRANT SELECT ON public.payment_provider_credentials TO authenticated;
REVOKE SELECT ON public.payment_webhook_events FROM authenticated;

-- Edge Functions use service_role. Restrict payments to immutable inserts and
-- status/provider response updates; webhook records are append-only.
REVOKE ALL ON public.payments FROM service_role;
GRANT SELECT, INSERT ON public.payments TO service_role;
GRANT UPDATE (status, provider_response) ON public.payments TO service_role;

REVOKE ALL ON public.payment_webhook_events FROM service_role;
GRANT SELECT, INSERT ON public.payment_webhook_events TO service_role;

REVOKE ALL ON public.payment_provider_credentials FROM service_role;
GRANT SELECT, INSERT ON public.payment_provider_credentials TO service_role;
GRANT UPDATE (tenant_id, provider, environment, credentials_encrypted, credentials_ciphertext,
  verified, verified_at, updated_at) ON public.payment_provider_credentials TO service_role;

GRANT ALL ON public.payment_refunds, public.customer_credit_accounts,
  public.payment_reconciliations TO service_role;

CREATE OR REPLACE FUNCTION public.enforce_payment_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    (OLD.status = 'PENDING' AND NEW.status IN ('PROCESSING','SUCCESS','FAILED','CANCELLED','TIMEOUT','REVIEW_REQUIRED'))
    OR (OLD.status = 'PROCESSING' AND NEW.status IN ('SUCCESS','FAILED','CANCELLED','TIMEOUT','REVIEW_REQUIRED'))
    OR (OLD.status = 'FAILED' AND NEW.status IN ('PROCESSING','REVIEW_REQUIRED'))
  ) THEN
    RAISE EXCEPTION 'Invalid payment status transition: % to %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_payment_status_transition() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS payments_status_transition_guard ON public.payments;
CREATE TRIGGER payments_status_transition_guard
  BEFORE UPDATE OF status ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_payment_status_transition();

CREATE OR REPLACE FUNCTION public.prevent_payment_payload_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Payment ledger rows cannot be deleted' USING ERRCODE = '42501';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['status','provider_response']) IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status','provider_response']) THEN
    RAISE EXCEPTION 'Only payment status and provider_response may be updated'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.prevent_payment_payload_mutation() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS payments_immutable_payload_guard ON public.payments;
CREATE TRIGGER payments_immutable_payload_guard
  BEFORE UPDATE OR DELETE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.prevent_payment_payload_mutation();

CREATE OR REPLACE FUNCTION public.prevent_payment_webhook_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'Payment webhook events are append-only' USING ERRCODE = '42501';
END;
$$;
REVOKE ALL ON FUNCTION public.prevent_payment_webhook_event_mutation() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS payment_webhook_events_append_only ON public.payment_webhook_events;
CREATE TRIGGER payment_webhook_events_append_only
  BEFORE UPDATE OR DELETE ON public.payment_webhook_events
  FOR EACH ROW EXECUTE FUNCTION public.prevent_payment_webhook_event_mutation();

-- Record only the tenant, row ID, table, and operation. Never copy payment
-- payloads, credentials, phone numbers, or other row contents to the audit log.
CREATE OR REPLACE FUNCTION public.audit_payment_schema_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  row_data jsonb;
  tenant_key uuid;
  record_key uuid;
BEGIN
  row_data := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  tenant_key := NULLIF(row_data ->> 'tenant_id', '')::uuid;
  record_key := NULLIF(row_data ->> 'id', '')::uuid;
  IF tenant_key IS NULL THEN
    RAISE EXCEPTION 'Payment mutations require a tenant ID';
  END IF;

  INSERT INTO public.audit_logs
    (tenant_id, user_id, user_name, action, entity_type, entity_id, description)
  VALUES
    (tenant_key, auth.uid(), 'System', TG_OP || '_' || upper(TG_TABLE_NAME),
     TG_TABLE_NAME, record_key, TG_OP || ' ' || TG_TABLE_NAME || ' row');

  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.audit_payment_schema_mutation() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'payment_channels', 'payment_provider_credentials', 'payments',
    'payment_webhook_events', 'payment_refunds', 'customer_credit_accounts',
    'payment_reconciliations'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS payment_audit_mutation ON public.%I', table_name);
    EXECUTE format(
      'CREATE TRIGGER payment_audit_mutation AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_payment_schema_mutation()',
      table_name
    );
  END LOOP;
END;
$$;

-- Seed account identities for existing credit customers and mirror historical
-- M-Pesa refunds already represented by outbound rows in the payments ledger.
INSERT INTO public.customer_credit_accounts (tenant_id, credit_customer_id, status)
SELECT c.tenant_id, c.id,
  CASE c.status WHEN 'active' THEN 'ACTIVE' WHEN 'suspended' THEN 'SUSPENDED' ELSE 'CLOSED' END
FROM public.credit_customers c
ON CONFLICT (tenant_id, credit_customer_id) DO NOTHING;

UPDATE public.payment_provider_credentials
SET credentials_ciphertext = convert_to(credentials_encrypted, 'UTF8')
WHERE credentials_ciphertext IS NULL AND credentials_encrypted IS NOT NULL;

INSERT INTO public.payment_refunds (
  tenant_id, original_payment_id, refund_payment_id, amount, currency,
  status, idempotency_key, reason, initiated_by, created_at, confirmed_at
)
SELECT p.tenant_id, p.refund_for_payment_id, p.id, p.amount::bigint, 'KES',
  p.status, p.idempotency_key, p.notes, p.initiated_by, p.created_at, p.confirmed_at
FROM public.payments p
WHERE p.refund_for_payment_id IS NOT NULL
  AND p.amount = trunc(p.amount)
ON CONFLICT (tenant_id, idempotency_key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
