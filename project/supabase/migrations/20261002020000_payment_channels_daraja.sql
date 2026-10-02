-- Tenant-scoped payment ledger and Daraja support. Provider credentials are
-- AES-GCM encrypted by the payment-gateway Edge Function before persistence.

CREATE TABLE IF NOT EXISTS public.payment_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id()
    REFERENCES public.business_tenants(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('CASH','MPESA_STK','MPESA_B2C','CREDIT','BANK_TRANSFER','CHEQUE')),
  enabled boolean NOT NULL DEFAULT false,
  display_name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, channel)
);

CREATE TABLE IF NOT EXISTS public.payment_provider_credentials (
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id()
    REFERENCES public.business_tenants(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('MPESA')),
  environment text NOT NULL DEFAULT 'sandbox' CHECK (environment IN ('sandbox','production')),
  credentials_encrypted text NOT NULL,
  verified boolean NOT NULL DEFAULT false,
  verified_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, provider)
);

CREATE TABLE IF NOT EXISTS public.credit_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id()
    REFERENCES public.business_tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  phone text,
  email text,
  credit_limit numeric(14,2) NOT NULL CHECK (credit_limit >= 0),
  current_balance numeric(14,2) NOT NULL DEFAULT 0 CHECK (current_balance >= 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','closed')),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'paid'
    CHECK (payment_status IN ('paid','partial','credit','pending','failed')),
  ADD COLUMN IF NOT EXISTS payment_reference text,
  ADD COLUMN IF NOT EXISTS credit_customer_id uuid;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_tenant_credit_customer_fk') THEN
    ALTER TABLE public.sales ADD CONSTRAINT sales_tenant_credit_customer_fk
      FOREIGN KEY (tenant_id, credit_customer_id)
      REFERENCES public.credit_customers(tenant_id, id) NOT VALID;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id()
    REFERENCES public.business_tenants(id) ON DELETE CASCADE,
  sale_id uuid,
  refund_for_payment_id uuid,
  purchase_id uuid,
  credit_customer_id uuid,
  supplier_id uuid,
  channel text NOT NULL CHECK (channel IN ('MPESA_STK','MPESA_B2C','CASH','CREDIT','BANK_TRANSFER','CHEQUE')),
  direction text NOT NULL DEFAULT 'INBOUND' CHECK (direction IN ('INBOUND','OUTBOUND')),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  amount_tendered numeric(14,2),
  change_due numeric(14,2) NOT NULL DEFAULT 0 CHECK (change_due >= 0),
  currency text NOT NULL DEFAULT 'KES',
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','PROCESSING','SUCCESS','FAILED','CANCELLED','TIMEOUT','REVIEW_REQUIRED')),
  customer_phone text,
  provider text,
  provider_ref text,
  provider_receipt text,
  provider_response jsonb,
  callback_token_hash text,
  initiated_by uuid NOT NULL REFERENCES auth.users(id),
  confirmed_at timestamptz,
  failure_reason text,
  idempotency_key text NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key),
  UNIQUE (tenant_id, id),
  CONSTRAINT payments_sale_tenant_fk FOREIGN KEY (tenant_id, sale_id) REFERENCES public.sales(tenant_id, id),
  CONSTRAINT payments_purchase_tenant_fk FOREIGN KEY (tenant_id, purchase_id) REFERENCES public.purchases(tenant_id, id),
  CONSTRAINT payments_customer_tenant_fk FOREIGN KEY (tenant_id, credit_customer_id) REFERENCES public.credit_customers(tenant_id, id),
  CONSTRAINT payments_supplier_tenant_fk FOREIGN KEY (tenant_id, supplier_id) REFERENCES public.suppliers(tenant_id, id),
  CONSTRAINT payments_refund_tenant_fk FOREIGN KEY (tenant_id, refund_for_payment_id) REFERENCES public.payments(tenant_id, id),
  CONSTRAINT payments_refund_channel_check CHECK (refund_for_payment_id IS NULL OR
    (sale_id IS NOT NULL AND channel='MPESA_B2C' AND direction='OUTBOUND'))
);

CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_ref_unique
  ON public.payments(provider, provider_ref) WHERE provider_ref IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS payments_callback_token_unique
  ON public.payments(callback_token_hash) WHERE callback_token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS payments_tenant_created_idx ON public.payments(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payments_sale_idx ON public.payments(tenant_id, sale_id);
CREATE INDEX IF NOT EXISTS payments_purchase_idx ON public.payments(tenant_id, purchase_id);
CREATE INDEX IF NOT EXISTS payments_refund_idx ON public.payments(tenant_id, refund_for_payment_id, status);
CREATE INDEX IF NOT EXISTS payments_status_idx ON public.payments(tenant_id, status);
CREATE INDEX IF NOT EXISTS credit_customers_tenant_name_idx ON public.credit_customers(tenant_id, lower(name));

CREATE TABLE IF NOT EXISTS public.payment_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.business_tenants(id) ON DELETE CASCADE,
  provider text NOT NULL,
  event_type text NOT NULL,
  provider_ref text,
  result_code text,
  processed boolean NOT NULL DEFAULT false,
  error text,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payment_webhook_events_tenant_received_idx
  ON public.payment_webhook_events(tenant_id, received_at DESC);

ALTER TABLE public.payment_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_provider_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payment_channels, public.payment_provider_credentials,
  public.credit_customers, public.payments, public.payment_webhook_events FROM anon, authenticated;
GRANT ALL ON public.payment_channels, public.credit_customers, public.payments TO service_role;
GRANT ALL ON public.payment_provider_credentials, public.payment_webhook_events TO service_role;

DO $$
DECLARE tenant_row record;
BEGIN
  FOR tenant_row IN SELECT id FROM public.business_tenants LOOP
    INSERT INTO public.payment_channels(tenant_id, channel, enabled, display_name, sort_order)
    VALUES
      (tenant_row.id,'CASH',true,'Cash',1),
      (tenant_row.id,'MPESA_STK',false,'M-Pesa STK Push',2),
      (tenant_row.id,'CREDIT',true,'Customer credit',3),
      (tenant_row.id,'BANK_TRANSFER',true,'Bank transfer',4),
      (tenant_row.id,'CHEQUE',false,'Cheque',5),
      (tenant_row.id,'MPESA_B2C',false,'M-Pesa supplier payment',6)
    ON CONFLICT (tenant_id,channel) DO NOTHING;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.seed_tenant_payment_channels()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  INSERT INTO public.payment_channels(tenant_id,channel,enabled,display_name,sort_order)
  VALUES (NEW.id,'CASH',true,'Cash',1),(NEW.id,'MPESA_STK',false,'M-Pesa STK Push',2),
    (NEW.id,'CREDIT',true,'Customer credit',3),(NEW.id,'BANK_TRANSFER',true,'Bank transfer',4),
    (NEW.id,'CHEQUE',false,'Cheque',5),(NEW.id,'MPESA_B2C',false,'M-Pesa supplier payment',6)
  ON CONFLICT(tenant_id,channel) DO NOTHING;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS seed_tenant_payment_channels_after_insert ON public.business_tenants;
CREATE TRIGGER seed_tenant_payment_channels_after_insert AFTER INSERT ON public.business_tenants
  FOR EACH ROW EXECUTE FUNCTION public.seed_tenant_payment_channels();
REVOKE ALL ON FUNCTION public.seed_tenant_payment_channels() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.get_payment_channels()
RETURNS TABLE(channel text, enabled boolean, display_name text, sort_order integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth
AS $$
  SELECT c.channel, c.enabled, c.display_name, c.sort_order
  FROM public.payment_channels c
  WHERE c.tenant_id = public.current_tenant_id()
    AND public.is_active_user()
  ORDER BY c.sort_order, c.channel;
$$;
REVOKE ALL ON FUNCTION public.get_payment_channels() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_payment_channels() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_payment_channel(p_channel text, p_enabled boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501'; END IF;
  IF p_channel NOT IN ('CASH','MPESA_STK','MPESA_B2C','CREDIT','BANK_TRANSFER','CHEQUE') THEN
    RAISE EXCEPTION 'Unsupported payment channel';
  END IF;
  IF p_channel='CASH' AND NOT p_enabled THEN RAISE EXCEPTION 'Cash checkout must remain available'; END IF;
  IF p_channel IN ('MPESA_STK','MPESA_B2C') AND p_enabled AND NOT EXISTS (
    SELECT 1 FROM public.payment_provider_credentials c
    WHERE c.tenant_id = public.current_tenant_id() AND c.provider = 'MPESA' AND c.verified
  ) THEN RAISE EXCEPTION 'Save M-Pesa credentials before enabling this channel'; END IF;
  UPDATE public.payment_channels SET enabled = p_enabled, updated_at = now()
  WHERE tenant_id = public.current_tenant_id() AND channel = p_channel;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment channel is not configured'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_set_payment_channel(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_payment_channel(text, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_create_credit_customer(
  p_name text, p_phone text, p_email text, p_credit_limit numeric
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE customer_id uuid;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501'; END IF;
  IF NULLIF(btrim(p_name),'') IS NULL OR p_credit_limit IS NULL OR p_credit_limit < 0 THEN
    RAISE EXCEPTION 'Enter a customer name and a non-negative credit limit';
  END IF;
  INSERT INTO public.credit_customers(tenant_id,name,phone,email,credit_limit,created_by)
  VALUES (public.current_tenant_id(),btrim(p_name),NULLIF(btrim(p_phone),''),NULLIF(lower(btrim(p_email)),''),p_credit_limit,auth.uid())
  RETURNING id INTO customer_id;
  RETURN customer_id;
END $$;
REVOKE ALL ON FUNCTION public.admin_create_credit_customer(text,text,text,numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_credit_customer(text,text,text,numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_credit_customers()
RETURNS TABLE(id uuid,name text,credit_limit numeric,current_balance numeric,status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
  SELECT c.id,c.name,c.credit_limit,c.current_balance,c.status
  FROM public.credit_customers c
  WHERE c.tenant_id = public.current_tenant_id() AND public.is_active_user()
    AND (public.is_admin() OR c.status = 'active')
  ORDER BY c.name;
$$;
REVOKE ALL ON FUNCTION public.get_credit_customers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_credit_customers() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_credit_customers()
RETURNS TABLE(id uuid,name text,phone text,credit_limit numeric,current_balance numeric,status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,auth AS $$
  SELECT c.id,c.name,c.phone,c.credit_limit,c.current_balance,c.status
  FROM public.credit_customers c
  WHERE c.tenant_id=public.current_tenant_id() AND public.is_admin()
  ORDER BY c.name;
$$;
REVOKE ALL ON FUNCTION public.admin_get_credit_customers() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_get_credit_customers() TO authenticated;

CREATE OR REPLACE FUNCTION public.process_sale_with_payment(
  p_sale_items jsonb,
  p_customer_name text DEFAULT NULL,
  p_payment_method text DEFAULT 'cash',
  p_note text DEFAULT NULL,
  p_sale_date date DEFAULT CURRENT_DATE,
  p_credit_customer_id uuid DEFAULT NULL,
  p_amount_tendered numeric DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  tenant_key uuid := public.current_tenant_id();
  item jsonb;
  product_id uuid;
  quantity numeric;
  unit_price numeric;
  sale_total numeric := 0;
  normalized_items jsonb := '[]'::jsonb;
  new_sale_id uuid;
  customer_row public.credit_customers%ROWTYPE;
  business_row public.system_settings%ROWTYPE;
  business_fallback text;
  channel_key text;
  initial_status text;
  sale_payment_status text;
BEGIN
  IF tenant_key IS NULL OR NOT (public.is_admin() OR public.current_user_role() = 'user') THEN
    RAISE EXCEPTION 'Sales access required' USING ERRCODE = '42501';
  END IF;
  IF p_sale_items IS NULL OR jsonb_typeof(p_sale_items) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_sale_items) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Add between one and 100 sale items';
  END IF;
  IF p_payment_method NOT IN ('cash','mpesa','bank','credit') THEN RAISE EXCEPTION 'Choose a valid payment method'; END IF;
  channel_key := CASE p_payment_method WHEN 'cash' THEN 'CASH' WHEN 'mpesa' THEN 'MPESA_STK'
    WHEN 'bank' THEN 'BANK_TRANSFER' WHEN 'credit' THEN 'CREDIT' END;
  IF NOT EXISTS (SELECT 1 FROM public.payment_channels c
    WHERE c.tenant_id = tenant_key AND c.channel = channel_key AND c.enabled) THEN
    RAISE EXCEPTION 'This payment method is disabled by your administrator';
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(p_sale_items) LOOP
    product_id := NULLIF(item ->> 'product_id','')::uuid;
    quantity := NULLIF(item ->> 'quantity','')::numeric;
    IF product_id IS NULL OR quantity IS NULL OR quantity <= 0 THEN RAISE EXCEPTION 'Select products and enter positive quantities'; END IF;
    SELECT product.selling_price INTO unit_price FROM public.products product
    WHERE product.id = product_id AND product.tenant_id = tenant_key
      AND product.status = 'active' AND product.catalog_variant_id IS NOT NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'A selected catalogue product is unavailable'; END IF;
    sale_total := sale_total + quantity * unit_price;
    normalized_items := normalized_items || jsonb_build_array(jsonb_build_object(
      'product_id',product_id,'quantity',quantity,'selling_price',unit_price));
  END LOOP;

  IF p_payment_method = 'cash' AND p_amount_tendered IS NOT NULL AND p_amount_tendered < sale_total THEN
    RAISE EXCEPTION 'Cash received must cover the sale total';
  END IF;
  IF p_payment_method = 'mpesa' AND (sale_total < 1 OR sale_total <> trunc(sale_total)) THEN
    RAISE EXCEPTION 'M-Pesa checkout requires a whole KSh amount of at least 1';
  END IF;
  IF p_payment_method = 'credit' THEN
    IF p_credit_customer_id IS NULL THEN RAISE EXCEPTION 'Select a registered credit customer'; END IF;
    SELECT * INTO customer_row FROM public.credit_customers c
      WHERE c.id = p_credit_customer_id AND c.tenant_id = tenant_key AND c.status = 'active' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Credit customer is unavailable'; END IF;
    IF customer_row.current_balance + sale_total > customer_row.credit_limit THEN
      RAISE EXCEPTION 'Sale exceeds customer credit limit. Available credit: %',
        GREATEST(customer_row.credit_limit - customer_row.current_balance,0);
    END IF;
  ELSIF p_credit_customer_id IS NOT NULL THEN RAISE EXCEPTION 'Credit customer is only used for credit sales';
  END IF;

  new_sale_id := public.process_sale_unchecked(normalized_items,
    CASE WHEN p_payment_method = 'credit' THEN customer_row.name ELSE NULLIF(btrim(p_customer_name),'') END,p_payment_method,
    NULLIF(btrim(p_note),''),COALESCE(p_sale_date,CURRENT_DATE));
  initial_status := CASE p_payment_method WHEN 'cash' THEN 'SUCCESS' WHEN 'credit' THEN 'PENDING' ELSE 'PENDING' END;
  sale_payment_status := CASE p_payment_method WHEN 'cash' THEN 'paid' WHEN 'credit' THEN 'credit' ELSE 'pending' END;

  UPDATE public.sales SET payment_status = sale_payment_status, credit_customer_id = p_credit_customer_id
  WHERE id = new_sale_id AND tenant_id = tenant_key;
  INSERT INTO public.payments(tenant_id,sale_id,credit_customer_id,channel,direction,amount,
    amount_tendered,change_due,currency,status,initiated_by,idempotency_key,notes)
  VALUES (tenant_key,new_sale_id,p_credit_customer_id,channel_key,'INBOUND',sale_total,
    CASE WHEN p_payment_method = 'cash' THEN COALESCE(p_amount_tendered,sale_total) END,
    CASE WHEN p_payment_method = 'cash' THEN GREATEST(COALESCE(p_amount_tendered,sale_total)-sale_total,0) ELSE 0 END,
    'KES',initial_status,auth.uid(),'sale-'||new_sale_id::text,'Initial sale payment');
  IF p_payment_method = 'credit' THEN
    UPDATE public.credit_customers SET current_balance = current_balance + sale_total, updated_at = now()
    WHERE id = p_credit_customer_id AND tenant_id = tenant_key;
  END IF;

  SELECT * INTO business_row FROM public.system_settings settings WHERE settings.tenant_id = tenant_key
    ORDER BY settings.updated_at DESC LIMIT 1;
  SELECT tenant.name INTO business_fallback FROM public.business_tenants tenant WHERE tenant.id = tenant_key;
  UPDATE public.sales SET
    receipt_business_name = COALESCE(NULLIF(btrim(business_row.business_name),''),business_fallback,'Business'),
    receipt_business_address = business_row.business_address, receipt_business_phone = business_row.business_phone,
    receipt_business_email = business_row.business_email, receipt_currency = COALESCE(NULLIF(btrim(business_row.currency),''),'KSh')
  WHERE id = new_sale_id AND tenant_id = tenant_key;
  RETURN new_sale_id;
END;
$$;
REVOKE ALL ON FUNCTION public.process_sale_with_payment(jsonb,text,text,text,date,uuid,numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_sale_with_payment(jsonb,text,text,text,date,uuid,numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.process_sale(
  p_sale_items jsonb, p_customer_name text DEFAULT NULL, p_payment_method text DEFAULT 'cash',
  p_note text DEFAULT NULL, p_sale_date date DEFAULT CURRENT_DATE
) RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = public, auth AS $$
  SELECT public.process_sale_with_payment(p_sale_items,p_customer_name,p_payment_method,p_note,p_sale_date,NULL,NULL);
$$;
REVOKE ALL ON FUNCTION public.process_sale(jsonb,text,text,text,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_sale(jsonb,text,text,text,date) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_payment_status(p_payment_id uuid)
RETURNS TABLE(id uuid,status text,provider_receipt text,failure_reason text,updated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
  SELECT p.id,p.status,p.provider_receipt,p.failure_reason,p.updated_at
  FROM public.payments p LEFT JOIN public.sales s ON s.tenant_id=p.tenant_id AND s.id=p.sale_id
  WHERE p.id=p_payment_id AND p.tenant_id=public.current_tenant_id()
    AND (public.is_admin() OR (p.initiated_by=auth.uid() AND s.created_by=auth.uid()))
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.get_my_payment_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_payment_status(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_sale_payment(p_sale_id uuid)
RETURNS TABLE(payment_id uuid,channel text,amount numeric,status text,provider_receipt text,failure_reason text,customer_phone text,sale_payment_status text,refundable boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,auth AS $$
  SELECT p.id,p.channel,p.amount,p.status,p.provider_receipt,p.failure_reason,p.customer_phone,s.payment_status,
    (p.channel='MPESA_STK' AND p.credit_customer_id IS NULL AND s.payment_method='mpesa')
  FROM public.payments p JOIN public.sales s ON s.tenant_id=p.tenant_id AND s.id=p.sale_id
  WHERE p.sale_id=p_sale_id AND p.tenant_id=public.current_tenant_id()
    AND p.channel<>'MPESA_B2C'
    AND (public.is_admin() OR s.created_by=auth.uid())
  ORDER BY p.created_at DESC LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.get_sale_payment(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_sale_payment(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_sale_refunds(p_sale_id uuid)
RETURNS TABLE(refund_id uuid,amount numeric,status text,provider_receipt text,failure_reason text,notes text,created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,auth AS $$
  SELECT p.id,p.amount,p.status,p.provider_receipt,p.failure_reason,p.notes,p.created_at
  FROM public.payments p JOIN public.sales s ON s.tenant_id=p.tenant_id AND s.id=p.sale_id
  WHERE p.sale_id=p_sale_id AND p.tenant_id=public.current_tenant_id() AND p.refund_for_payment_id IS NOT NULL
    AND (public.is_admin() OR s.created_by=auth.uid())
  ORDER BY p.created_at DESC;
$$;
REVOKE ALL ON FUNCTION public.get_sale_refunds(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_sale_refunds(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_confirm_payment(p_payment_id uuid,p_success boolean,p_reference text DEFAULT NULL,p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth AS $$
DECLARE payment_row public.payments%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
  SELECT * INTO payment_row FROM public.payments p WHERE p.id=p_payment_id
    AND p.tenant_id=public.current_tenant_id() FOR UPDATE;
  IF NOT FOUND OR payment_row.status NOT IN ('PENDING','PROCESSING')
    OR payment_row.channel NOT IN ('BANK_TRANSFER','CHEQUE') THEN RAISE EXCEPTION 'Manual payment cannot be confirmed'; END IF;
  UPDATE public.payments SET status=CASE WHEN p_success THEN 'SUCCESS' ELSE 'FAILED' END,
    provider_receipt=NULLIF(btrim(p_reference),''),notes=concat_ws(' | ',notes,NULLIF(btrim(p_note),'')),
    confirmed_at=CASE WHEN p_success THEN now() ELSE NULL END,updated_at=now() WHERE id=p_payment_id;
  IF payment_row.sale_id IS NOT NULL THEN UPDATE public.sales SET payment_status=CASE WHEN p_success THEN 'paid' ELSE 'failed' END,
    payment_reference=NULLIF(btrim(p_reference),'') WHERE id=payment_row.sale_id AND tenant_id=payment_row.tenant_id; END IF;
END $$;
REVOKE ALL ON FUNCTION public.admin_confirm_payment(uuid,boolean,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_confirm_payment(uuid,boolean,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_record_credit_payment(
  p_customer_id uuid,p_amount numeric,p_channel text,p_reference text DEFAULT NULL,p_note text DEFAULT NULL
) RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth AS $$
DECLARE
  customer_row public.credit_customers%ROWTYPE;
  remaining numeric := p_amount;
  applied numeric := 0;
  reserved numeric := 0;
  invoice record;
  piece numeric;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
  IF p_amount IS NULL OR p_amount<=0 OR p_channel NOT IN ('CASH','BANK_TRANSFER','CHEQUE') THEN
    RAISE EXCEPTION 'Enter a positive amount and a manually verifiable channel';
  END IF;
  SELECT * INTO customer_row FROM public.credit_customers c WHERE c.id=p_customer_id
    AND c.tenant_id=public.current_tenant_id() FOR UPDATE;
  IF NOT FOUND OR customer_row.current_balance<=0 THEN RAISE EXCEPTION 'Customer has no outstanding credit'; END IF;
  SELECT COALESCE(sum(p.amount),0) INTO reserved FROM public.payments p
    WHERE p.tenant_id=customer_row.tenant_id AND p.credit_customer_id=customer_row.id AND p.channel='MPESA_STK'
      AND p.status IN ('PENDING','PROCESSING','REVIEW_REQUIRED');
  IF p_amount>customer_row.current_balance-reserved THEN RAISE EXCEPTION 'Payment exceeds available outstanding credit'; END IF;
  FOR invoice IN SELECT s.id,s.total_amount,s.payment_status FROM public.sales s
    WHERE s.tenant_id=customer_row.tenant_id AND s.credit_customer_id=customer_row.id
      AND s.payment_status IN ('credit','partial') ORDER BY s.sale_date,s.created_at,s.id FOR UPDATE
  LOOP
    EXIT WHEN remaining<=0;
    SELECT COALESCE(sum(p.amount) FILTER (WHERE p.channel<>'CREDIT' AND p.status='SUCCESS'),0)
      INTO piece FROM public.payments p WHERE p.tenant_id=customer_row.tenant_id AND p.sale_id=invoice.id;
    piece := LEAST(remaining,invoice.total_amount-piece);
    IF piece<=0 THEN CONTINUE; END IF;
    INSERT INTO public.payments(tenant_id,sale_id,credit_customer_id,channel,direction,amount,currency,status,
      provider,provider_receipt,initiated_by,confirmed_at,idempotency_key,notes)
    VALUES(customer_row.tenant_id,invoice.id,customer_row.id,p_channel,'INBOUND',piece,'KES','SUCCESS',
      'manual',NULLIF(btrim(p_reference),''),auth.uid(),now(),gen_random_uuid()::text,NULLIF(btrim(p_note),''));
    remaining:=remaining-piece; applied:=applied+piece;
    UPDATE public.sales SET payment_status=CASE WHEN invoice.total_amount <= (
      SELECT sum(p.amount) FROM public.payments p WHERE p.tenant_id=customer_row.tenant_id AND p.sale_id=invoice.id
        AND p.channel<>'CREDIT' AND p.status='SUCCESS') THEN 'paid' ELSE 'partial' END
      WHERE id=invoice.id AND tenant_id=customer_row.tenant_id;
  END LOOP;
  UPDATE public.credit_customers SET current_balance=current_balance-applied,updated_at=now()
    WHERE id=customer_row.id AND tenant_id=customer_row.tenant_id;
  RETURN applied;
END $$;
REVOKE ALL ON FUNCTION public.admin_record_credit_payment(uuid,numeric,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_record_credit_payment(uuid,numeric,text,text,text) TO authenticated;

-- The Edge Function first authenticates the user and membership. These
-- service-only claims serialize duplicate checkout and payout requests.
CREATE OR REPLACE FUNCTION public.service_claim_stk_payment(
  p_tenant_id uuid,p_payment_id uuid,p_user_id uuid,p_token_hash text,p_phone text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth AS $$
DECLARE claimed integer;
BEGIN
  UPDATE public.payments p SET status='PROCESSING',customer_phone=p_phone,callback_token_hash=p_token_hash,
    provider='mpesa',provider_ref=NULL,provider_response=NULL,failure_reason=NULL,updated_at=now()
  WHERE p.id=p_payment_id AND p.tenant_id=p_tenant_id AND p.initiated_by=p_user_id
    AND p.channel='MPESA_STK' AND p.sale_id IS NOT NULL AND p.status IN ('PENDING','FAILED')
    AND EXISTS (SELECT 1 FROM public.sales s WHERE s.id=p.sale_id AND s.tenant_id=p.tenant_id
      AND s.payment_status IN ('pending','failed') AND s.payment_method='mpesa');
  GET DIAGNOSTICS claimed = ROW_COUNT;
  IF claimed=1 THEN
    UPDATE public.sales SET payment_status='pending' WHERE tenant_id=p_tenant_id
      AND id=(SELECT sale_id FROM public.payments WHERE id=p_payment_id AND tenant_id=p_tenant_id);
  END IF;
  RETURN claimed=1;
END $$;
REVOKE ALL ON FUNCTION public.service_claim_stk_payment(uuid,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.service_claim_stk_payment(uuid,uuid,uuid,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.service_create_credit_stk_payment(
  p_tenant_id uuid,p_user_id uuid,p_payment_id uuid,p_customer_id uuid,p_amount numeric,
  p_phone text,p_token_hash text,p_idempotency_key text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth AS $$
DECLARE
  customer_row public.credit_customers%ROWTYPE;
  invoice record;
  invoice_paid numeric;
  invoice_reserved numeric;
  customer_reserved numeric:=0;
  invoice_remaining numeric:=0;
  target_invoice_id uuid;
BEGIN
  IF p_amount IS NULL OR p_amount<1 OR p_amount>250000 OR p_amount<>trunc(p_amount)
    OR p_phone IS NULL OR p_phone !~ '^254[17][0-9]{8}$' THEN RAISE EXCEPTION 'Enter a valid KSh amount and Kenyan M-Pesa phone'; END IF;
  SELECT * INTO customer_row FROM public.credit_customers c WHERE c.id=p_customer_id
    AND c.tenant_id=p_tenant_id AND c.status='active' FOR UPDATE;
  IF NOT FOUND OR customer_row.current_balance<=0 THEN RAISE EXCEPTION 'Customer has no active outstanding credit'; END IF;
  SELECT COALESCE(sum(p.amount),0) INTO customer_reserved FROM public.payments p
    WHERE p.tenant_id=p_tenant_id AND p.credit_customer_id=p_customer_id AND p.channel='MPESA_STK'
      AND p.status IN ('PENDING','PROCESSING','REVIEW_REQUIRED');
  FOR invoice IN SELECT s.id,s.total_amount FROM public.sales s
    WHERE s.tenant_id=p_tenant_id AND s.credit_customer_id=p_customer_id AND s.payment_status IN ('credit','partial')
    ORDER BY s.sale_date,s.created_at,s.id FOR UPDATE
  LOOP
    SELECT COALESCE(sum(p.amount),0) INTO invoice_paid FROM public.payments p
      WHERE p.tenant_id=p_tenant_id AND p.sale_id=invoice.id AND p.channel<>'CREDIT' AND p.status='SUCCESS';
    SELECT COALESCE(sum(p.amount),0) INTO invoice_reserved FROM public.payments p
      WHERE p.tenant_id=p_tenant_id AND p.sale_id=invoice.id AND p.channel='MPESA_STK'
        AND p.status IN ('PENDING','PROCESSING','REVIEW_REQUIRED');
    invoice_remaining:=GREATEST(invoice.total_amount-invoice_paid-invoice_reserved,0);
    IF invoice_remaining>0 THEN target_invoice_id:=invoice.id; EXIT; END IF;
  END LOOP;
  IF target_invoice_id IS NULL THEN RAISE EXCEPTION 'No unpaid invoice is available for this customer'; END IF;
  IF p_amount>LEAST(customer_row.current_balance-customer_reserved,invoice_remaining) THEN
    RAISE EXCEPTION 'Amount exceeds the remaining balance on the oldest invoice or the customer account';
  END IF;
  INSERT INTO public.payments(id,tenant_id,sale_id,credit_customer_id,channel,direction,amount,currency,status,
    customer_phone,provider,callback_token_hash,initiated_by,idempotency_key,notes)
  VALUES(p_payment_id,p_tenant_id,target_invoice_id,p_customer_id,'MPESA_STK','INBOUND',p_amount,'KES','PROCESSING',
    p_phone,'mpesa',p_token_hash,p_user_id,p_idempotency_key,'Credit account payment');
  RETURN p_payment_id;
END $$;
REVOKE ALL ON FUNCTION public.service_create_credit_stk_payment(uuid,uuid,uuid,uuid,numeric,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.service_create_credit_stk_payment(uuid,uuid,uuid,uuid,numeric,text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.service_create_mpesa_refund(
  p_tenant_id uuid,p_user_id uuid,p_payment_id uuid,p_original_payment_id uuid,p_amount numeric,
  p_phone text,p_token_hash text,p_idempotency_key text,p_reason text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth AS $$
DECLARE original_row public.payments%ROWTYPE; reserved numeric := 0;
BEGIN
  IF p_amount IS NULL OR p_amount<=0 OR p_amount>250000 OR p_amount<>trunc(p_amount)
    OR NULLIF(btrim(p_reason),'') IS NULL OR length(p_reason)>200 THEN
    RAISE EXCEPTION 'Enter a refund reason and a whole KSh amount between 1 and 250,000';
  END IF;
  SELECT * INTO original_row FROM public.payments p WHERE p.id=p_original_payment_id
    AND p.tenant_id=p_tenant_id AND p.channel='MPESA_STK' AND p.direction='INBOUND' AND p.status='SUCCESS'
    AND p.sale_id IS NOT NULL AND p.credit_customer_id IS NULL
    AND EXISTS (SELECT 1 FROM public.sales s WHERE s.id=p.sale_id AND s.tenant_id=p.tenant_id AND s.payment_method='mpesa')
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Only a confirmed M-Pesa sale payment can be refunded'; END IF;
  IF NULLIF(btrim(p_phone),'') IS NULL OR p_phone<>original_row.customer_phone THEN
    RAISE EXCEPTION 'Refund must be sent to the phone number that made the original payment';
  END IF;
  SELECT COALESCE(sum(p.amount),0) INTO reserved FROM public.payments p
    WHERE p.tenant_id=p_tenant_id AND p.refund_for_payment_id=p_original_payment_id
      AND p.status IN ('PENDING','PROCESSING','SUCCESS','REVIEW_REQUIRED');
  IF p_amount>original_row.amount-reserved THEN RAISE EXCEPTION 'Refund exceeds the remaining amount received'; END IF;
  INSERT INTO public.payments(id,tenant_id,sale_id,refund_for_payment_id,channel,direction,amount,currency,status,
    customer_phone,provider,callback_token_hash,initiated_by,idempotency_key,notes)
  VALUES(p_payment_id,p_tenant_id,original_row.sale_id,p_original_payment_id,'MPESA_B2C','OUTBOUND',p_amount,'KES','PROCESSING',
    p_phone,'mpesa',p_token_hash,p_user_id,p_idempotency_key,btrim(p_reason));
  RETURN p_payment_id;
END $$;
REVOKE ALL ON FUNCTION public.service_create_mpesa_refund(uuid,uuid,uuid,uuid,numeric,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.service_create_mpesa_refund(uuid,uuid,uuid,uuid,numeric,text,text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.service_create_supplier_disbursement(
  p_tenant_id uuid,p_user_id uuid,p_payment_id uuid,p_supplier_id uuid,p_purchase_id uuid,p_amount numeric,
  p_phone text,p_callback_token_hash text,p_idempotency_key text,p_note text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth AS $$
DECLARE
  supplier_row public.suppliers%ROWTYPE;
  purchase_row public.purchases%ROWTYPE;
  reserved numeric := 0;
  payment_id uuid := p_payment_id;
BEGIN
  IF p_amount IS NULL OR p_amount<=0 OR p_amount>250000 OR p_amount<>trunc(p_amount) THEN
    RAISE EXCEPTION 'Supplier payout must be a whole KSh amount between 1 and 250,000';
  END IF;
  SELECT * INTO supplier_row FROM public.suppliers s WHERE s.id=p_supplier_id AND s.tenant_id=p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Supplier could not be found'; END IF;
  IF p_purchase_id IS NOT NULL THEN
    SELECT * INTO purchase_row FROM public.purchases p WHERE p.id=p_purchase_id AND p.tenant_id=p_tenant_id
      AND p.supplier_id=p_supplier_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Supplier invoice could not be found'; END IF;
    SELECT COALESCE(sum(amount),0) INTO reserved FROM public.payments
      WHERE tenant_id=p_tenant_id AND purchase_id=p_purchase_id AND channel='MPESA_B2C'
        AND status IN ('PENDING','PROCESSING','REVIEW_REQUIRED');
    IF p_amount > purchase_row.total_amount-purchase_row.amount_paid-reserved THEN
      RAISE EXCEPTION 'Amount exceeds the available supplier invoice balance';
    END IF;
  ELSE
    SELECT COALESCE(sum(amount),0) INTO reserved FROM public.payments
      WHERE tenant_id=p_tenant_id AND supplier_id=p_supplier_id AND purchase_id IS NULL
        AND channel='MPESA_B2C' AND status IN ('PENDING','PROCESSING','REVIEW_REQUIRED');
    IF p_amount > supplier_row.credit_balance-reserved THEN RAISE EXCEPTION 'Amount exceeds the supplier balance owed'; END IF;
  END IF;
  INSERT INTO public.payments(id,tenant_id,supplier_id,purchase_id,channel,direction,amount,currency,status,
    customer_phone,provider,callback_token_hash,initiated_by,idempotency_key,notes)
  VALUES(payment_id,p_tenant_id,p_supplier_id,p_purchase_id,'MPESA_B2C','OUTBOUND',p_amount,'KES','PROCESSING',
    p_phone,'mpesa',p_callback_token_hash,p_user_id,p_idempotency_key,NULLIF(btrim(p_note),''));
  RETURN payment_id;
END $$;
REVOKE ALL ON FUNCTION public.service_create_supplier_disbursement(uuid,uuid,uuid,uuid,uuid,numeric,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.service_create_supplier_disbursement(uuid,uuid,uuid,uuid,uuid,numeric,text,text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.service_apply_mpesa_result(
  p_tenant_id uuid,p_token_hash text,p_success boolean,p_provider_ref text,p_receipt text,p_phone text,p_failure text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth AS $$
DECLARE payment_row public.payments%ROWTYPE; credit_row public.credit_customers%ROWTYPE;
BEGIN
  SELECT * INTO payment_row FROM public.payments p WHERE p.tenant_id=p_tenant_id
    AND p.callback_token_hash=p_token_hash AND p.channel='MPESA_STK' FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF payment_row.status IN ('SUCCESS','FAILED','CANCELLED','TIMEOUT','REVIEW_REQUIRED') THEN RETURN true; END IF;
  IF p_success AND payment_row.credit_customer_id IS NOT NULL THEN
    SELECT * INTO credit_row FROM public.credit_customers c WHERE c.id=payment_row.credit_customer_id
      AND c.tenant_id=p_tenant_id FOR UPDATE;
    IF NOT FOUND OR credit_row.current_balance<payment_row.amount THEN
      UPDATE public.payments SET status='REVIEW_REQUIRED',failure_reason='Credit balance changed before payment confirmation',updated_at=now()
        WHERE id=payment_row.id;
      RETURN true;
    END IF;
  END IF;
  UPDATE public.payments SET status=CASE WHEN p_success THEN 'SUCCESS' ELSE 'FAILED' END,
    provider_ref=COALESCE(provider_ref,p_provider_ref),provider_receipt=NULLIF(p_receipt,''),
    customer_phone=COALESCE(NULLIF(p_phone,''),customer_phone),failure_reason=CASE WHEN p_success THEN NULL ELSE left(p_failure,500) END,
    confirmed_at=CASE WHEN p_success THEN now() ELSE NULL END,updated_at=now()
  WHERE id=payment_row.id;
  IF payment_row.credit_customer_id IS NOT NULL AND p_success THEN
    UPDATE public.credit_customers SET current_balance=current_balance-payment_row.amount,updated_at=now()
      WHERE id=payment_row.credit_customer_id AND tenant_id=p_tenant_id;
    UPDATE public.sales SET payment_status=CASE WHEN total_amount <= (
        SELECT COALESCE(sum(p.amount),0) FROM public.payments p WHERE p.tenant_id=p_tenant_id
          AND p.sale_id=payment_row.sale_id AND p.channel<>'CREDIT' AND p.status='SUCCESS') THEN 'paid' ELSE 'partial' END,
      payment_reference=NULLIF(p_receipt,'')
    WHERE id=payment_row.sale_id AND tenant_id=p_tenant_id;
  ELSIF payment_row.sale_id IS NOT NULL AND payment_row.credit_customer_id IS NULL THEN
    UPDATE public.sales SET payment_status=CASE WHEN p_success THEN 'paid' ELSE 'failed' END,
      payment_reference=NULLIF(p_receipt,''),payment_method='mpesa'
    WHERE id=payment_row.sale_id AND tenant_id=p_tenant_id;
  END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.service_apply_mpesa_result(uuid,text,boolean,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.service_apply_mpesa_result(uuid,text,boolean,text,text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.service_apply_b2c_result(p_payment_id uuid,p_receipt text,p_success boolean,p_failure text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth AS $$
DECLARE payment_row public.payments%ROWTYPE; purchase_row public.purchases%ROWTYPE;
BEGIN
  SELECT * INTO payment_row FROM public.payments WHERE id=p_payment_id AND channel='MPESA_B2C' FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF payment_row.status IN ('SUCCESS','FAILED','CANCELLED','TIMEOUT','REVIEW_REQUIRED') THEN RETURN true; END IF;
  UPDATE public.payments SET status=CASE WHEN p_success THEN 'SUCCESS' ELSE 'FAILED' END,
    provider_receipt=NULLIF(p_receipt,''),failure_reason=CASE WHEN p_success THEN NULL ELSE left(p_failure,500) END,
    confirmed_at=CASE WHEN p_success THEN now() ELSE NULL END,updated_at=now() WHERE id=p_payment_id;
  IF p_success AND payment_row.purchase_id IS NOT NULL THEN
    SELECT * INTO purchase_row FROM public.purchases WHERE id=payment_row.purchase_id
      AND tenant_id=payment_row.tenant_id FOR UPDATE;
    IF NOT FOUND OR payment_row.amount>purchase_row.total_amount-purchase_row.amount_paid THEN
      UPDATE public.payments SET status='REVIEW_REQUIRED',failure_reason='Payout exceeds the remaining purchase balance',updated_at=now() WHERE id=p_payment_id;
      RETURN true;
    END IF;
    UPDATE public.purchases SET amount_paid=amount_paid+payment_row.amount,
      payment_status=CASE WHEN amount_paid+payment_row.amount>=total_amount THEN 'paid' ELSE 'partial' END
      WHERE id=purchase_row.id AND tenant_id=purchase_row.tenant_id;
  ELSIF p_success AND payment_row.supplier_id IS NOT NULL THEN
    UPDATE public.suppliers SET credit_balance=GREATEST(0,credit_balance-payment_row.amount),updated_at=now()
      WHERE id=payment_row.supplier_id AND tenant_id=payment_row.tenant_id;
  END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.service_apply_b2c_result(uuid,text,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.service_apply_b2c_result(uuid,text,boolean,text) TO service_role;

ALTER TABLE public.payments VALIDATE CONSTRAINT payments_sale_tenant_fk;
ALTER TABLE public.payments VALIDATE CONSTRAINT payments_purchase_tenant_fk;
ALTER TABLE public.payments VALIDATE CONSTRAINT payments_customer_tenant_fk;
ALTER TABLE public.payments VALIDATE CONSTRAINT payments_supplier_tenant_fk;
ALTER TABLE public.payments VALIDATE CONSTRAINT payments_refund_tenant_fk;
ALTER TABLE public.sales VALIDATE CONSTRAINT sales_tenant_credit_customer_fk;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.payment_channels,public.credit_customers,public.payments TO service_role;
NOTIFY pgrst, 'reload schema';
