-- Customer identity, loyalty rewards, transactional balance SMS and analytics.

ALTER TABLE public.system_settings
  ADD COLUMN IF NOT EXISTS loyalty_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS loyalty_points_per_100 numeric(8,2) NOT NULL DEFAULT 1
    CHECK (loyalty_points_per_100 >= 0 AND loyalty_points_per_100 <= 1000),
  ADD COLUMN IF NOT EXISTS loyalty_kes_per_point numeric(8,2) NOT NULL DEFAULT 1
    CHECK (loyalty_kes_per_point >= 0 AND loyalty_kes_per_point <= 10000),
  ADD COLUMN IF NOT EXISTS loyalty_minimum_redemption integer NOT NULL DEFAULT 100
    CHECK (loyalty_minimum_redemption >= 1),
  ADD COLUMN IF NOT EXISTS loyalty_redemption_month smallint NOT NULL DEFAULT 12
    CHECK (loyalty_redemption_month BETWEEN 1 AND 12),
  ADD COLUMN IF NOT EXISTS loyalty_redemption_day smallint NOT NULL DEFAULT 31
    CHECK (loyalty_redemption_day BETWEEN 1 AND 31),
  ADD COLUMN IF NOT EXISTS sms_balance_notifications_enabled boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id()
    REFERENCES public.business_tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  phone text,
  phone_normalized text,
  email text,
  sms_opt_in boolean NOT NULL DEFAULT false,
  loyalty_points integer NOT NULL DEFAULT 0 CHECK (loyalty_points >= 0),
  lifetime_spend numeric(14,2) NOT NULL DEFAULT 0 CHECK (lifetime_spend >= 0),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, phone_normalized)
);

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS customer_id uuid;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS customer_id uuid;
ALTER TABLE public.credit_customers ADD COLUMN IF NOT EXISTS customer_profile_id uuid;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_tenant_customer_profile_fk') THEN
    ALTER TABLE public.sales ADD CONSTRAINT sales_tenant_customer_profile_fk
      FOREIGN KEY (tenant_id, customer_id) REFERENCES public.customers(tenant_id, id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_tenant_customer_profile_fk') THEN
    ALTER TABLE public.payments ADD CONSTRAINT payments_tenant_customer_profile_fk
      FOREIGN KEY (tenant_id, customer_id) REFERENCES public.customers(tenant_id, id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'credit_customers_tenant_customer_profile_fk') THEN
    ALTER TABLE public.credit_customers ADD CONSTRAINT credit_customers_tenant_customer_profile_fk
      FOREIGN KEY (tenant_id, customer_profile_id) REFERENCES public.customers(tenant_id, id) NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS customers_tenant_name_idx ON public.customers(tenant_id, lower(name));
CREATE INDEX IF NOT EXISTS sales_customer_date_idx ON public.sales(tenant_id, customer_id, sale_date DESC);
CREATE INDEX IF NOT EXISTS payments_customer_success_idx ON public.payments(tenant_id, customer_id, status, created_at DESC);

CREATE OR REPLACE FUNCTION public.normalize_customer_phone(p_phone text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE normalized text;
BEGIN
  normalized := regexp_replace(COALESCE(btrim(p_phone), ''), '[^0-9+]', '', 'g');
  normalized := regexp_replace(normalized, '^\+', '');
  IF normalized = '' THEN RETURN NULL; END IF;
  IF normalized ~ '^0[17][0-9]{8}$' THEN normalized := '254' || substr(normalized, 2);
  ELSIF normalized ~ '^[17][0-9]{8}$' THEN normalized := '254' || normalized;
  END IF;
  IF normalized !~ '^254[17][0-9]{8}$' THEN RETURN NULL; END IF;
  RETURN normalized;
END;
$$;
REVOKE ALL ON FUNCTION public.normalize_customer_phone(text) FROM PUBLIC, anon, authenticated;

-- Preserve existing approved credit customers as full customer profiles.
INSERT INTO public.customers(tenant_id, name, phone, phone_normalized, email, created_by)
SELECT DISTINCT ON (cc.tenant_id, public.normalize_customer_phone(cc.phone))
  cc.tenant_id, cc.name, cc.phone, public.normalize_customer_phone(cc.phone), cc.email, cc.created_by
FROM public.credit_customers cc
WHERE public.normalize_customer_phone(cc.phone) IS NOT NULL
ORDER BY cc.tenant_id, public.normalize_customer_phone(cc.phone), cc.created_at, cc.id
ON CONFLICT (tenant_id, phone_normalized) DO UPDATE
  SET name = EXCLUDED.name,
      email = COALESCE(EXCLUDED.email, public.customers.email),
      updated_at = now();

UPDATE public.credit_customers cc
SET customer_profile_id = customer.id
FROM public.customers customer
WHERE cc.tenant_id = customer.tenant_id
  AND public.normalize_customer_phone(cc.phone) = customer.phone_normalized
  AND cc.customer_profile_id IS NULL;

-- Preserve identities already captured during previous M-Pesa checkouts.
INSERT INTO public.customers(tenant_id, name, phone, phone_normalized, sms_opt_in, created_by)
SELECT payment.tenant_id,
  COALESCE(NULLIF(btrim(sale.customer_name), ''), '+' || normalized.phone),
  '+' || normalized.phone, normalized.phone, false, payment.initiated_by
FROM public.payments payment
LEFT JOIN public.sales sale ON sale.id = payment.sale_id AND sale.tenant_id = payment.tenant_id
CROSS JOIN LATERAL (SELECT public.normalize_customer_phone(payment.customer_phone) AS phone) normalized
WHERE payment.channel = 'MPESA_STK' AND normalized.phone IS NOT NULL
ON CONFLICT (tenant_id, phone_normalized) DO NOTHING;

UPDATE public.sales sale
SET customer_id = customer.id
FROM public.credit_customers credit
JOIN public.customers customer ON customer.tenant_id = credit.tenant_id
  AND customer.id = credit.customer_profile_id
WHERE sale.tenant_id = credit.tenant_id AND sale.credit_customer_id = credit.id
  AND sale.customer_id IS NULL;

UPDATE public.sales sale
SET customer_id = customer.id
FROM public.customers customer
WHERE sale.tenant_id = customer.tenant_id AND sale.customer_id IS NULL
  AND sale.payment_method = 'mpesa'
  AND customer.phone_normalized = public.normalize_customer_phone((
    SELECT payment.customer_phone FROM public.payments payment
    WHERE payment.tenant_id = sale.tenant_id AND payment.sale_id = sale.id
      AND payment.channel = 'MPESA_STK' ORDER BY payment.created_at DESC LIMIT 1
  ));

UPDATE public.payments payment
SET customer_id = sale.customer_id
FROM public.sales sale
WHERE payment.tenant_id = sale.tenant_id AND payment.sale_id = sale.id
  AND payment.customer_id IS NULL AND sale.customer_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.customer_loyalty_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.business_tenants(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL,
  transaction_type text NOT NULL CHECK (transaction_type IN ('EARN','REDEEM','REFUND')),
  points_delta integer NOT NULL CHECK (points_delta <> 0),
  amount_kes numeric(14,2) NOT NULL DEFAULT 0 CHECK (amount_kes >= 0),
  source_payment_id uuid,
  redemption_year smallint,
  description text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_loyalty_customer_fk FOREIGN KEY (tenant_id, customer_id)
    REFERENCES public.customers(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT customer_loyalty_payment_fk FOREIGN KEY (tenant_id, source_payment_id)
    REFERENCES public.payments(tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS customer_loyalty_payment_type_unique
  ON public.customer_loyalty_transactions(tenant_id, source_payment_id, transaction_type)
  WHERE source_payment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS customer_loyalty_yearly_redemption_unique
  ON public.customer_loyalty_transactions(tenant_id, customer_id, redemption_year)
  WHERE transaction_type = 'REDEEM' AND redemption_year IS NOT NULL;
CREATE INDEX IF NOT EXISTS customer_loyalty_history_idx
  ON public.customer_loyalty_transactions(tenant_id, customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.customer_sms_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.business_tenants(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL,
  payment_id uuid NOT NULL,
  recipient_phone text NOT NULL,
  message_type text NOT NULL DEFAULT 'PAYMENT_BALANCE',
  status text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','SENDING','SENT','FAILED')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  provider_message_id text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  CONSTRAINT customer_sms_customer_fk FOREIGN KEY (tenant_id, customer_id)
    REFERENCES public.customers(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT customer_sms_payment_fk FOREIGN KEY (tenant_id, payment_id)
    REFERENCES public.payments(tenant_id, id) ON DELETE CASCADE,
  UNIQUE (tenant_id, payment_id, message_type)
);
CREATE INDEX IF NOT EXISTS customer_sms_queue_idx
  ON public.customer_sms_outbox(tenant_id, status, created_at DESC);

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_loyalty_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_sms_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.customers, public.customer_loyalty_transactions, public.customer_sms_outbox
  FROM anon, authenticated;
GRANT ALL ON public.customers, public.customer_loyalty_transactions, public.customer_sms_outbox TO service_role;

CREATE OR REPLACE FUNCTION public.process_sale_with_customer(
  p_sale_items jsonb,
  p_customer_name text DEFAULT NULL,
  p_payment_method text DEFAULT 'cash',
  p_note text DEFAULT NULL,
  p_sale_date date DEFAULT CURRENT_DATE,
  p_credit_customer_id uuid DEFAULT NULL,
  p_amount_tendered numeric DEFAULT NULL,
  p_customer_phone text DEFAULT NULL,
  p_customer_email text DEFAULT NULL,
  p_sms_opt_in boolean DEFAULT false
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  tenant_key uuid := public.current_tenant_id();
  credit_row public.credit_customers%ROWTYPE;
  v_customer_profile_id uuid;
  normalized_phone text;
  display_phone text;
  customer_name_value text := NULLIF(btrim(p_customer_name), '');
  customer_email_value text := NULLIF(lower(btrim(p_customer_email)), '');
  customer_phone_value text := NULLIF(btrim(p_customer_phone), '');
  new_sale_id uuid;
BEGIN
  IF tenant_key IS NULL OR NOT (public.is_admin() OR public.current_user_role() = 'user') THEN
    RAISE EXCEPTION 'Sales access required' USING ERRCODE = '42501';
  END IF;

  IF p_payment_method = 'credit' THEN
    SELECT * INTO credit_row FROM public.credit_customers cc
    WHERE cc.id = p_credit_customer_id AND cc.tenant_id = tenant_key AND cc.status = 'active';
    IF NOT FOUND THEN RAISE EXCEPTION 'Credit customer is unavailable'; END IF;
    customer_name_value := credit_row.name;
    customer_phone_value := COALESCE(customer_phone_value, NULLIF(btrim(credit_row.phone), ''));
    customer_email_value := COALESCE(customer_email_value, NULLIF(lower(btrim(credit_row.email)), ''));
  ELSIF p_credit_customer_id IS NOT NULL THEN
    RAISE EXCEPTION 'Credit customer is only used for credit sales';
  END IF;

  normalized_phone := public.normalize_customer_phone(customer_phone_value);
  IF NULLIF(btrim(customer_phone_value), '') IS NOT NULL AND normalized_phone IS NULL THEN
    RAISE EXCEPTION 'Enter a valid Kenyan mobile number, such as 0712345678';
  END IF;
  IF p_payment_method IN ('mpesa','bank') AND normalized_phone IS NULL THEN
    RAISE EXCEPTION 'Enter the customer phone number for M-Pesa or bank payment';
  END IF;
  IF normalized_phone IS NOT NULL AND customer_name_value IS NULL THEN
    RAISE EXCEPTION 'Enter the customer name to save their details';
  END IF;
  display_phone := CASE WHEN normalized_phone IS NULL THEN customer_phone_value ELSE '+' || normalized_phone END;

  IF normalized_phone IS NOT NULL THEN
    INSERT INTO public.customers(tenant_id, name, phone, phone_normalized, email, sms_opt_in, created_by)
    VALUES (tenant_key, COALESCE(customer_name_value, display_phone), display_phone, normalized_phone,
      customer_email_value, COALESCE(p_sms_opt_in, false), auth.uid())
    ON CONFLICT (tenant_id, phone_normalized) DO UPDATE
      SET name = EXCLUDED.name,
          phone = EXCLUDED.phone,
          email = COALESCE(EXCLUDED.email, public.customers.email),
          sms_opt_in = customers.sms_opt_in OR EXCLUDED.sms_opt_in,
          updated_at = now()
    RETURNING id INTO v_customer_profile_id;

    IF p_payment_method = 'credit' THEN
    UPDATE public.credit_customers SET customer_profile_id = v_customer_profile_id
      WHERE id = p_credit_customer_id AND tenant_id = tenant_key;
    END IF;
  END IF;

  new_sale_id := public.process_sale_with_payment(
    p_sale_items, customer_name_value, p_payment_method, p_note, p_sale_date,
    p_credit_customer_id, p_amount_tendered
  );

  UPDATE public.sales SET customer_id = v_customer_profile_id
  WHERE id = new_sale_id AND tenant_id = tenant_key;
  UPDATE public.payments SET customer_id = v_customer_profile_id, customer_phone = display_phone
  WHERE sale_id = new_sale_id AND tenant_id = tenant_key AND direction = 'INBOUND';
  RETURN new_sale_id;
END;
$$;
REVOKE ALL ON FUNCTION public.process_sale_with_customer(jsonb,text,text,text,date,uuid,numeric,text,text,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_sale_with_customer(jsonb,text,text,text,date,uuid,numeric,text,text,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.apply_customer_payment_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  customer_key uuid;
  customer_row public.customers%ROWTYPE;
  settings_row public.system_settings%ROWTYPE;
  original_payment public.payments%ROWTYPE;
  original_points integer;
  points_to_reverse integer;
  points_delta_value integer;
  inserted_count integer;
BEGIN
  IF NEW.status <> 'SUCCESS' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'SUCCESS'
    AND OLD.customer_id IS NOT DISTINCT FROM NEW.customer_id THEN RETURN NEW; END IF;

  IF NEW.direction = 'OUTBOUND' AND NEW.refund_for_payment_id IS NOT NULL THEN
    SELECT * INTO original_payment FROM public.payments original
    WHERE original.id = NEW.refund_for_payment_id AND original.tenant_id = NEW.tenant_id;
    IF NOT FOUND OR original_payment.amount <= 0 THEN RETURN NEW; END IF;
    customer_key := original_payment.customer_id;
    IF customer_key IS NULL AND original_payment.sale_id IS NOT NULL THEN
      SELECT sale.customer_id INTO customer_key FROM public.sales sale
      WHERE sale.id = original_payment.sale_id AND sale.tenant_id = NEW.tenant_id;
    END IF;
    IF customer_key IS NULL THEN RETURN NEW; END IF;
    SELECT COALESCE(SUM(points_delta),0)::integer INTO original_points
    FROM public.customer_loyalty_transactions
    WHERE tenant_id = NEW.tenant_id AND source_payment_id = original_payment.id AND transaction_type = 'EARN';
    points_to_reverse := LEAST(original_points,
      floor(original_points * LEAST(NEW.amount / original_payment.amount, 1))::integer);
    IF points_to_reverse <= 0 THEN RETURN NEW; END IF;
    SELECT * INTO customer_row FROM public.customers customer
    WHERE customer.id = customer_key AND customer.tenant_id = NEW.tenant_id FOR UPDATE;
    IF NOT FOUND THEN RETURN NEW; END IF;
    points_delta_value := -LEAST(customer_row.loyalty_points, points_to_reverse);
    IF points_delta_value = 0 THEN RETURN NEW; END IF;
    INSERT INTO public.customer_loyalty_transactions(tenant_id, customer_id, transaction_type,
      points_delta, amount_kes, source_payment_id, description)
    VALUES (NEW.tenant_id, customer_key, 'REFUND', points_delta_value, NEW.amount, NEW.id,
      'Rewards adjusted for a refunded payment')
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS inserted_count = ROW_COUNT;
    IF inserted_count > 0 THEN
      UPDATE public.customers SET loyalty_points = loyalty_points + points_delta_value, updated_at = now()
      WHERE id = customer_key AND tenant_id = NEW.tenant_id;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.direction <> 'INBOUND' THEN RETURN NEW; END IF;
  customer_key := NEW.customer_id;
  IF customer_key IS NULL AND NEW.sale_id IS NOT NULL THEN
    SELECT sale.customer_id INTO customer_key FROM public.sales sale
    WHERE sale.id = NEW.sale_id AND sale.tenant_id = NEW.tenant_id;
  END IF;
  IF customer_key IS NULL AND NEW.credit_customer_id IS NOT NULL THEN
    SELECT credit.customer_profile_id INTO customer_key FROM public.credit_customers credit
    WHERE credit.id = NEW.credit_customer_id AND credit.tenant_id = NEW.tenant_id;
  END IF;
  IF customer_key IS NULL THEN RETURN NEW; END IF;

  SELECT * INTO customer_row FROM public.customers customer
  WHERE customer.id = customer_key AND customer.tenant_id = NEW.tenant_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NEW; END IF;
  SELECT * INTO settings_row FROM public.system_settings settings
  WHERE settings.tenant_id = NEW.tenant_id ORDER BY settings.updated_at DESC LIMIT 1;

  IF COALESCE(settings_row.loyalty_enabled, true) THEN
    points_delta_value := floor((NEW.amount / 100) * COALESCE(settings_row.loyalty_points_per_100, 1))::integer;
    IF points_delta_value > 0 THEN
      INSERT INTO public.customer_loyalty_transactions(tenant_id, customer_id, transaction_type,
        points_delta, amount_kes, source_payment_id, description)
      VALUES (NEW.tenant_id, customer_key, 'EARN', points_delta_value, NEW.amount, NEW.id,
        'Points earned from a confirmed payment')
      ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS inserted_count = ROW_COUNT;
      IF inserted_count > 0 THEN
        UPDATE public.customers SET loyalty_points = loyalty_points + points_delta_value,
          lifetime_spend = lifetime_spend + NEW.amount, updated_at = now()
        WHERE id = customer_key AND tenant_id = NEW.tenant_id;
      END IF;
    END IF;
  END IF;

  IF COALESCE(settings_row.sms_balance_notifications_enabled, true)
    AND customer_row.sms_opt_in AND customer_row.phone IS NOT NULL THEN
    INSERT INTO public.customer_sms_outbox(tenant_id, customer_id, payment_id, recipient_phone)
    VALUES (NEW.tenant_id, customer_key, NEW.id, customer_row.phone)
    ON CONFLICT (tenant_id, payment_id, message_type) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.apply_customer_payment_event() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS customer_payment_rewards_and_sms ON public.payments;
CREATE TRIGGER customer_payment_rewards_and_sms
AFTER INSERT OR UPDATE OF status, customer_id ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.apply_customer_payment_event();

CREATE OR REPLACE FUNCTION public.admin_register_customer(
  p_name text, p_phone text, p_email text DEFAULT NULL, p_sms_opt_in boolean DEFAULT false,
  p_customer_id uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  tenant_key uuid := public.current_tenant_id();
  normalized_phone text;
  customer_id uuid;
BEGIN
  IF tenant_key IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(p_name), '') IS NULL THEN RAISE EXCEPTION 'Enter the customer name'; END IF;
  normalized_phone := public.normalize_customer_phone(p_phone);
  IF normalized_phone IS NULL THEN RAISE EXCEPTION 'Enter the customer phone number'; END IF;
  IF p_customer_id IS NOT NULL THEN
    UPDATE public.customers SET name = btrim(p_name), phone = '+' || normalized_phone,
      phone_normalized = normalized_phone, email = NULLIF(lower(btrim(p_email)), ''),
      sms_opt_in = COALESCE(p_sms_opt_in, false), updated_at = now()
    WHERE id = p_customer_id AND tenant_id = tenant_key
    RETURNING id INTO customer_id;
    IF customer_id IS NULL THEN RAISE EXCEPTION 'Customer not found'; END IF;
    UPDATE public.credit_customers SET name = btrim(p_name), phone = '+' || normalized_phone,
      email = NULLIF(lower(btrim(p_email)), ''), updated_at = now()
    WHERE tenant_id = tenant_key AND customer_profile_id = customer_id;
    RETURN customer_id;
  END IF;
  INSERT INTO public.customers(tenant_id, name, phone, phone_normalized, email, sms_opt_in, created_by)
  VALUES (tenant_key, btrim(p_name), '+' || normalized_phone, normalized_phone,
    NULLIF(lower(btrim(p_email)), ''), COALESCE(p_sms_opt_in, false), auth.uid())
    ON CONFLICT (tenant_id, phone_normalized) DO UPDATE
      SET name = EXCLUDED.name, phone = EXCLUDED.phone,
        email = COALESCE(EXCLUDED.email, public.customers.email),
        sms_opt_in = EXCLUDED.sms_opt_in, updated_at = now()
  RETURNING id INTO customer_id;
  RETURN customer_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_register_customer(text,text,text,boolean,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_register_customer(text,text,text,boolean,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_customer_directory()
RETURNS TABLE(
  id uuid, name text, phone text, email text, sms_opt_in boolean, loyalty_points integer,
  lifetime_spend numeric, current_balance numeric, sale_count bigint, last_sale_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE tenant_key uuid := public.current_tenant_id();
BEGIN
  IF tenant_key IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT customer.id, customer.name, customer.phone, customer.email, customer.sms_opt_in,
    customer.loyalty_points, customer.lifetime_spend,
    COALESCE(SUM(GREATEST(sale.total_amount - COALESCE(paid.total_paid,0),0)),0)::numeric AS current_balance,
    COUNT(DISTINCT sale.id)::bigint AS sale_count, MAX(sale.created_at) AS last_sale_at
  FROM public.customers customer
  LEFT JOIN public.sales sale ON sale.tenant_id = tenant_key AND sale.customer_id = customer.id
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(payment.amount),0) AS total_paid
    FROM public.payments payment
    WHERE payment.tenant_id = tenant_key AND payment.sale_id = sale.id
      AND payment.direction = 'INBOUND' AND payment.status = 'SUCCESS'
  ) paid ON true
  WHERE customer.tenant_id = tenant_key
  GROUP BY customer.id
  ORDER BY customer.name;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_get_customer_directory() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_customer_directory() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_customer_history(p_customer_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  tenant_key uuid := public.current_tenant_id();
  customer_row public.customers%ROWTYPE;
  sales_json jsonb;
  loyalty_json jsonb;
  sms_json jsonb;
BEGIN
  IF tenant_key IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO customer_row FROM public.customers customer
  WHERE customer.id = p_customer_id AND customer.tenant_id = tenant_key;
  IF NOT FOUND THEN RAISE EXCEPTION 'Customer not found'; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', sale.id, 'sale_number', sale.sale_number, 'sale_date', sale.sale_date,
    'payment_method', sale.payment_method, 'payment_status', sale.payment_status,
    'total_amount', sale.total_amount, 'created_at', sale.created_at,
    'payments', COALESCE((SELECT jsonb_agg(jsonb_build_object('channel', payment.channel,
      'amount', payment.amount, 'status', payment.status, 'reference', payment.provider_receipt,
      'created_at', payment.created_at) ORDER BY payment.created_at DESC)
      FROM public.payments payment WHERE payment.tenant_id = tenant_key AND payment.sale_id = sale.id), '[]'::jsonb)
  ) ORDER BY sale.created_at DESC), '[]'::jsonb) INTO sales_json
  FROM public.sales sale WHERE sale.tenant_id = tenant_key AND sale.customer_id = p_customer_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',entry.id,'type',entry.transaction_type,
    'points',entry.points_delta,'value_kes',entry.amount_kes,'description',entry.description,
    'created_at',entry.created_at) ORDER BY entry.created_at DESC), '[]'::jsonb)
  INTO loyalty_json FROM public.customer_loyalty_transactions entry
  WHERE entry.tenant_id = tenant_key AND entry.customer_id = p_customer_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',message.id,'payment_id',message.payment_id,'status',message.status,
    'last_error',message.last_error,'created_at',message.created_at,'sent_at',message.sent_at)
    ORDER BY message.created_at DESC), '[]'::jsonb)
  INTO sms_json FROM public.customer_sms_outbox message
  WHERE message.tenant_id = tenant_key AND message.customer_id = p_customer_id;

  RETURN jsonb_build_object('customer', to_jsonb(customer_row), 'sales', sales_json,
    'loyalty', loyalty_json, 'messages', sms_json);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_get_customer_history(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_customer_history(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_redeem_customer_points(p_customer_id uuid, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  tenant_key uuid := public.current_tenant_id();
  settings_row public.system_settings%ROWTYPE;
  customer_row public.customers%ROWTYPE;
  local_today date;
  month_start date;
  redemption_date date;
  redemption_year_value smallint;
  redemption_amount numeric(14,2);
BEGIN
  IF tenant_key IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO settings_row FROM public.system_settings settings
  WHERE settings.tenant_id = tenant_key ORDER BY settings.updated_at DESC LIMIT 1;
  IF NOT COALESCE(settings_row.loyalty_enabled, true) THEN RAISE EXCEPTION 'Customer rewards are disabled'; END IF;
  local_today := (now() AT TIME ZONE COALESCE(NULLIF(settings_row.timezone,''),'Africa/Nairobi'))::date;
  redemption_year_value := EXTRACT(YEAR FROM local_today)::smallint;
  month_start := make_date(redemption_year_value, COALESCE(settings_row.loyalty_redemption_month,12), 1);
  redemption_date := month_start + LEAST(
    COALESCE(settings_row.loyalty_redemption_day,31),
    EXTRACT(DAY FROM (month_start + interval '1 month' - interval '1 day'))::integer
  ) - 1;
  IF local_today < redemption_date THEN
    RAISE EXCEPTION 'Points can be redeemed from %', to_char(redemption_date,'FMMonth DD');
  END IF;

  SELECT * INTO customer_row FROM public.customers customer
  WHERE customer.id = p_customer_id AND customer.tenant_id = tenant_key FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Customer not found'; END IF;
  IF customer_row.loyalty_points < COALESCE(settings_row.loyalty_minimum_redemption,100) THEN
    RAISE EXCEPTION 'Customer has not reached the minimum redemption balance';
  END IF;
  IF EXISTS (SELECT 1 FROM public.customer_loyalty_transactions entry
    WHERE entry.tenant_id = tenant_key AND entry.customer_id = p_customer_id
      AND entry.transaction_type = 'REDEEM' AND entry.redemption_year = redemption_year_value) THEN
    RAISE EXCEPTION 'This customer has already redeemed points this year';
  END IF;

  redemption_amount := customer_row.loyalty_points * COALESCE(settings_row.loyalty_kes_per_point,1);
  INSERT INTO public.customer_loyalty_transactions(tenant_id,customer_id,transaction_type,
    points_delta,amount_kes,redemption_year,description,created_by)
  VALUES (tenant_key,p_customer_id,'REDEEM',-customer_row.loyalty_points,redemption_amount,
    redemption_year_value,NULLIF(btrim(p_note),''),auth.uid());
  UPDATE public.customers SET loyalty_points = 0, updated_at = now()
  WHERE id = p_customer_id AND tenant_id = tenant_key;
  RETURN jsonb_build_object('points_redeemed',customer_row.loyalty_points,
    'value_kes',redemption_amount,'redemption_year',redemption_year_value);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_redeem_customer_points(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_redeem_customer_points(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.service_get_customer_balance(p_tenant_id uuid, p_customer_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(SUM(GREATEST(sale.total_amount - COALESCE(paid.total_paid, 0), 0)), 0)::numeric
  FROM public.sales sale
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(payment.amount), 0) AS total_paid
    FROM public.payments payment
    WHERE payment.tenant_id = p_tenant_id AND payment.sale_id = sale.id
      AND payment.direction = 'INBOUND' AND payment.status = 'SUCCESS'
  ) paid ON true
  WHERE sale.tenant_id = p_tenant_id AND sale.customer_id = p_customer_id;
$$;
REVOKE ALL ON FUNCTION public.service_get_customer_balance(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_get_customer_balance(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.get_business_analytics(p_start_date date DEFAULT CURRENT_DATE - 29,
  p_end_date date DEFAULT CURRENT_DATE)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  tenant_key uuid := public.current_tenant_id();
  result jsonb;
BEGIN
  IF tenant_key IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date
    OR p_end_date - p_start_date > 365 THEN
    RAISE EXCEPTION 'Choose an analytics period up to 366 days';
  END IF;

  SELECT jsonb_build_object(
    'summary', (SELECT jsonb_build_object(
      'revenue', COALESCE(SUM(sale.total_amount),0),
      'gross_profit', COALESCE(SUM(sale.total_profit),0),
      'orders', COUNT(*),
      'average_order', COALESCE(AVG(sale.total_amount),0))
      FROM public.sales sale WHERE sale.tenant_id = tenant_key
        AND sale.sale_date BETWEEN p_start_date AND p_end_date
        AND sale.payment_status IN ('paid','partial','credit')),
    'trend', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'date',day_stats.day,'revenue',day_stats.revenue,'orders',day_stats.orders) ORDER BY day_stats.day)
      FROM (
        SELECT days.day::date AS day, COALESCE(SUM(sale.total_amount),0) AS revenue, COUNT(sale.id) AS orders
        FROM generate_series(p_start_date::timestamp,p_end_date::timestamp,interval '1 day') days(day)
        LEFT JOIN public.sales sale ON sale.tenant_id = tenant_key AND sale.sale_date = days.day::date
          AND sale.payment_status IN ('paid','partial','credit')
        GROUP BY days.day
      ) day_stats), '[]'::jsonb),
    'products', COALESCE((SELECT jsonb_agg(to_jsonb(product_stats) ORDER BY product_stats.revenue DESC)
      FROM (
        SELECT product.id, product.name, product.catalog_sku, product.supplier_id,
          supplier.name AS supplier_name, SUM(item.quantity) AS units_sold,
          SUM(item.total) AS revenue, SUM(item.profit) AS gross_profit,
          COUNT(DISTINCT sale.id) AS orders
        FROM public.sale_items item
        JOIN public.sales sale ON sale.id = item.sale_id AND sale.tenant_id = item.tenant_id
        JOIN public.products product ON product.id = item.product_id AND product.tenant_id = item.tenant_id
        LEFT JOIN public.suppliers supplier ON supplier.id = product.supplier_id AND supplier.tenant_id = product.tenant_id
        WHERE item.tenant_id = tenant_key AND sale.sale_date BETWEEN p_start_date AND p_end_date
          AND sale.payment_status IN ('paid','partial','credit')
        GROUP BY product.id, product.name, product.catalog_sku, product.supplier_id, supplier.name
        ORDER BY SUM(item.total) DESC LIMIT 100
      ) product_stats), '[]'::jsonb),
    'suppliers', COALESCE((SELECT jsonb_agg(to_jsonb(supplier_stats) ORDER BY supplier_stats.purchased DESC)
      FROM (
        SELECT supplier.id, supplier.name, supplier.status, supplier.tier,
          COUNT(*) FILTER (WHERE purchase.id IS NOT NULL) AS purchase_orders,
          COALESCE(SUM(purchase.units_received),0) AS units_received,
          COALESCE(SUM(purchase.total_amount),0) AS purchased,
          COALESCE(SUM(purchase.outstanding),0) AS outstanding
        FROM public.suppliers supplier
        LEFT JOIN LATERAL (
          SELECT header.id, header.total_amount,
            GREATEST(header.total_amount - header.amount_paid,0) AS outstanding,
            COALESCE(SUM(item.quantity),0) AS units_received
          FROM public.purchases header
          LEFT JOIN public.purchase_items item ON item.purchase_id = header.id AND item.tenant_id = header.tenant_id
          WHERE header.supplier_id = supplier.id AND header.tenant_id = supplier.tenant_id
            AND header.purchase_date BETWEEN p_start_date AND p_end_date
          GROUP BY header.id
        ) purchase ON true
        WHERE supplier.tenant_id = tenant_key
        GROUP BY supplier.id, supplier.name, supplier.status, supplier.tier
        ORDER BY COALESCE(SUM(purchase.total_amount),0) DESC LIMIT 100
      ) supplier_stats), '[]'::jsonb)
  ) INTO result;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_business_analytics(date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_business_analytics(date,date) TO authenticated;

ALTER TABLE public.sales VALIDATE CONSTRAINT sales_tenant_customer_profile_fk;
ALTER TABLE public.payments VALIDATE CONSTRAINT payments_tenant_customer_profile_fk;
ALTER TABLE public.credit_customers VALIDATE CONSTRAINT credit_customers_tenant_customer_profile_fk;
