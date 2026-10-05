import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const appBaseUrl = (Deno.env.get('TENANT_APP_BASE_URL') || 'https://bolt-seven-eta.vercel.app').replace(/\/$/, '');
const corsHeadersBase = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-tenant-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin',
};
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Credentials = {
  consumerKey: string; consumerSecret: string; shortcode: string; passkey: string;
  initiatorName?: string; securityCredential?: string;
  transactionType?: 'CustomerPayBillOnline' | 'CustomerBuyGoodsOnline'; partyB?: string;
};
class DarajaResponseError extends Error {}

function json(body: unknown, status = 200, origin?: string) {
  return new Response(JSON.stringify(body), { status, headers: {
    ...corsHeadersBase, ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}), 'Content-Type': 'application/json',
  } });
}
function allowedOrigin(origin: string | null): string | undefined {
  if (!origin) return undefined;
  try {
    const candidate = new URL(origin).origin;
    const configured = (Deno.env.get('TENANT_APP_ALLOWED_ORIGINS') || appBaseUrl).split(',').map(value => value.trim()).filter(Boolean);
    if (configured.some(value => { try { return new URL(value).origin === candidate; } catch { return false; } })) return candidate;
  } catch { /* malformed origin */ }
  return undefined;
}
function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}
function encodeBase64(value: Uint8Array): string {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}
async function encryptionKey(): Promise<CryptoKey> {
  const encoded = Deno.env.get('PAYMENT_CREDENTIALS_ENCRYPTION_KEY') || '';
  if (!encoded) throw new Error('Payment credentials are not configured on the server');
  const bytes = decodeBase64(encoded);
  if (bytes.length !== 32) throw new Error('Payment encryption key must be base64-encoded 32-byte data');
  return await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function encrypt(value: Credentials): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await encryptionKey(), new TextEncoder().encode(JSON.stringify(value)));
  return `${encodeBase64(iv)}.${encodeBase64(new Uint8Array(encrypted))}`;
}
async function decrypt(value: string): Promise<Credentials> {
  const [ivText, dataText] = value.split('.');
  if (!ivText || !dataText) throw new Error('Stored provider credentials have an invalid format');
  const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decodeBase64(ivText) }, await encryptionKey(), decodeBase64(dataText));
  return JSON.parse(new TextDecoder().decode(clear)) as Credentials;
}
async function sha256(value: string): Promise<string> {
  return encodeBase64(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
}
function randomToken(): string { return encodeBase64(crypto.getRandomValues(new Uint8Array(32))); }
function normalizeKenyanPhone(phone: string): string {
  const cleaned = phone.replace(/[\s\-()]/g, '').replace(/^\+/, '');
  const normalized = cleaned.startsWith('254') ? cleaned : cleaned.startsWith('0') ? `254${cleaned.slice(1)}`
    : /^[17]\d{8}$/.test(cleaned) ? `254${cleaned}` : '';
  if (!/^254[17]\d{8}$/.test(normalized)) throw new Error('Enter a valid Kenyan mobile number, such as 0712345678');
  return normalized;
}
function timestampNairobi(): string {
  return new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
}
function mpesaHost(environment: string) { return environment === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke'; }
async function accessToken(credentials: Credentials, environment: string): Promise<string> {
  const host = mpesaHost(environment);
  const auth = btoa(`${credentials.consumerKey}:${credentials.consumerSecret}`);
  const response = await fetch(`${host}/oauth/v1/generate?grant_type=client_credentials`, { headers: { Authorization: `Basic ${auth}` } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || typeof body.access_token !== 'string') throw new Error('Could not authenticate with Safaricom Daraja');
  return body.access_token;
}
async function mpesaCredentials(admin: SupabaseClient, tenantId: string) {
  const { data, error } = await admin.from('payment_provider_credentials').select('environment,credentials_encrypted')
    .eq('tenant_id', tenantId).eq('provider', 'MPESA').maybeSingle();
  if (error || !data) throw new Error('M-Pesa is not configured for this business');
  return { environment: data.environment as string, credentials: await decrypt(data.credentials_encrypted as string) };
}
async function sendB2cPayment(admin: SupabaseClient, baseUrl: string, tenantId: string, paymentId: string,
  tokenSecret: string, phone: string, amount: number, remarks: string, occasion: string,
  environment: string, credentials: Credentials) {
  const callbackBase = `${baseUrl}/functions/v1/payment-gateway?route=b2c-result&tenant_id=${tenantId}&payment_id=${paymentId}&token=${encodeURIComponent(tokenSecret)}`;
  const timeoutUrl = `${baseUrl}/functions/v1/payment-gateway?route=b2c-timeout&tenant_id=${tenantId}&payment_id=${paymentId}&token=${encodeURIComponent(tokenSecret)}`;
  let requestStarted = false;
  let accepted = false;
  try {
    const bearer = await accessToken(credentials, environment);
    requestStarted = true;
    const result = await callSafaricom(`${mpesaHost(environment)}/mpesa/b2c/v3/paymentrequest`, bearer, {
      OriginatorConversationID: paymentId, InitiatorName: credentials.initiatorName,
      SecurityCredential: credentials.securityCredential, CommandID: 'BusinessPayment', Amount: amount,
      PartyA: credentials.shortcode, PartyB: phone, Remarks: remarks.slice(0, 100),
      QueueTimeOutURL: timeoutUrl, ResultURL: callbackBase, Occasion: occasion.slice(0, 50),
    });
    if (result.ResponseCode !== undefined && String(result.ResponseCode) !== '0') {
      throw new DarajaResponseError(typeof result.ResponseDescription === 'string' ? result.ResponseDescription : 'Safaricom did not accept the payout');
    }
    if (typeof result.ConversationID !== 'string') throw new Error('Safaricom response is uncertain. Check the payment ledger before trying again.');
    accepted = true;
    const { error } = await admin.from('payments').update({ provider_ref: result.ConversationID,
      provider_response: { responseCode: result.ResponseCode }, updated_at: new Date().toISOString() })
      .eq('id', paymentId).eq('tenant_id', tenantId);
    if (error) throw new Error('Safaricom accepted this payout but its reference could not be saved. Check the payment ledger before trying again.');
    return result.ConversationID;
  } catch (error) {
    if (!accepted && (!requestStarted || error instanceof DarajaResponseError)) {
      await admin.from('payments').update({ status: 'FAILED', failure_reason: error instanceof Error ? error.message.slice(0, 500) : 'Safaricom request failed', updated_at: new Date().toISOString() })
        .eq('id', paymentId).eq('tenant_id', tenantId);
    }
    throw error;
  }
}
async function authenticate(request: Request, admin: SupabaseClient) {
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  const tenantId = request.headers.get('x-tenant-id') || '';
  if (!token) throw new Error('Authentication required');
  if (!uuidPattern.test(tenantId)) throw new Error('Tenant context is required');
  const auth = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: `Bearer ${token}`, 'x-tenant-id': tenantId } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error } = await auth.auth.getUser(token);
  if (error || !user) throw new Error('Your session has expired. Sign in again.');
  const { data: membership, error: membershipError } = await admin.from('tenant_memberships')
    .select('role,status').eq('tenant_id', tenantId).eq('user_id', user.id).maybeSingle();
  if (membershipError || membership?.status !== 'active') throw new Error('Active business access is required');
  return { tenantId, user, role: membership.role as string, auth };
}
async function callSafaricom(url: string, token: string, body: unknown) {
  const response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const description = typeof result.errorMessage === 'string' ? result.errorMessage : 'Safaricom rejected the payment request';
    if (response.status >= 400 && response.status < 500) throw new DarajaResponseError(description.slice(0, 300));
    throw new Error('Safaricom response is uncertain. Check the payment ledger before trying again.');
  }
  return result as Record<string, unknown>;
}

Deno.serve(async request => {
  const origin = request.headers.get('Origin');
  const corsOrigin = allowedOrigin(origin);
  if (request.method === 'OPTIONS') return corsOrigin ? new Response('ok', { headers: { ...corsHeadersBase, 'Access-Control-Allow-Origin': corsOrigin } }) : new Response('Origin not allowed', { status: 403 });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, corsOrigin);
  if (origin && !corsOrigin) return json({ error: 'Origin not allowed' }, 403);

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !serviceKey || !anonKey) return json({ error: 'Payment service is not configured' }, 500, corsOrigin);
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const urlObject = new URL(request.url);
  const callbackRoute = urlObject.searchParams.get('route');
  if (callbackRoute === 'stk-callback') return await handleStkCallback(request, admin, corsOrigin);
  if (callbackRoute === 'b2c-result') return await handleB2cCallback(request, admin, corsOrigin, false);
  if (callbackRoute === 'b2c-timeout') return await handleB2cCallback(request, admin, corsOrigin, true);

  try {
    const { tenantId, user, role, auth } = await authenticate(request, admin);
    let body: Record<string, unknown>;
    try { body = await request.json(); } catch { return json({ error: 'Invalid request body' }, 400, corsOrigin); }
    const action = body.action;

    if (action === 'send-customer-payment-sms') {
      const paymentId = typeof body.paymentId === 'string' ? body.paymentId : '';
      if (!uuidPattern.test(paymentId)) return json({ error: 'Payment ID is invalid' }, 400, corsOrigin);
      const { data: payment, error: paymentError } = await admin.from('payments')
        .select('id,tenant_id,initiated_by,status')
        .eq('tenant_id', tenantId).eq('id', paymentId).maybeSingle();
      if (paymentError || !payment) return json({ error: 'Payment could not be found' }, 404, corsOrigin);
      if (role !== 'admin' && payment.initiated_by !== user.id) return json({ error: 'Payment access denied' }, 403, corsOrigin);
      if (payment.status !== 'SUCCESS') return json({ error: 'Only confirmed payments can send customer SMS' }, 409, corsOrigin);
      const result = await sendCustomerPaymentSms(admin, tenantId, paymentId);
      return json(result, 200, corsOrigin);
    }

    if (action === 'get-settings') {
      const [{ data: channels, error: channelError }, { data: credentials }] = await Promise.all([
        admin.from('payment_channels').select('channel,enabled,display_name,sort_order').eq('tenant_id', tenantId).order('sort_order'),
        admin.from('payment_provider_credentials').select('environment,verified').eq('tenant_id', tenantId).eq('provider', 'MPESA').maybeSingle(),
      ]);
      if (channelError) throw new Error('Could not load payment settings');
      let b2cConfigured = false;
      if (credentials) {
        const stored = await admin.from('payment_provider_credentials').select('credentials_encrypted')
          .eq('tenant_id', tenantId).eq('provider', 'MPESA').maybeSingle();
        if (stored.data?.credentials_encrypted) {
          const secret = await decrypt(stored.data.credentials_encrypted as string);
          b2cConfigured = Boolean(secret.initiatorName && secret.securityCredential);
        }
      }
        return json({ channels: channels || [], mpesaConfigured: Boolean(credentials?.verified), b2cConfigured, environment: credentials?.environment || null }, 200, corsOrigin);
    }

    if (action === 'save-mpesa-credentials') {
      if (role !== 'admin') return json({ error: 'Administrator access required' }, 403, corsOrigin);
      const environment = body.environment === 'production' ? 'production' : body.environment === 'sandbox' ? 'sandbox' : '';
      const existing = await admin.from('payment_provider_credentials').select('credentials_encrypted')
        .eq('tenant_id', tenantId).eq('provider', 'MPESA').maybeSingle();
      const oldCredentials = existing.data?.credentials_encrypted ? await decrypt(existing.data.credentials_encrypted as string) : {} as Credentials;
      const credentials: Credentials = {
        consumerKey: typeof body.consumerKey === 'string' ? body.consumerKey.trim() : '',
        consumerSecret: typeof body.consumerSecret === 'string' ? body.consumerSecret.trim() : '',
        shortcode: typeof body.shortcode === 'string' ? body.shortcode.trim() : '',
        passkey: typeof body.passkey === 'string' ? body.passkey.trim() : '',
        initiatorName: typeof body.initiatorName === 'string' && body.initiatorName.trim() ? body.initiatorName.trim() : oldCredentials.initiatorName,
        securityCredential: typeof body.securityCredential === 'string' && body.securityCredential.trim() ? body.securityCredential.trim() : oldCredentials.securityCredential,
        transactionType: body.transactionType === 'CustomerBuyGoodsOnline' ? 'CustomerBuyGoodsOnline' : 'CustomerPayBillOnline',
        partyB: typeof body.partyB === 'string' && body.partyB.trim() ? body.partyB.trim() : oldCredentials.partyB,
      };
      if (!environment || !credentials.consumerKey || !credentials.consumerSecret || !/^\d{5,7}$/.test(credentials.shortcode) || !credentials.passkey) {
        return json({ error: 'Environment, consumer key and secret, a valid shortcode, and STK passkey are required' }, 400, corsOrigin);
      }
      if (credentials.transactionType === 'CustomerBuyGoodsOnline' && !/^\d{5,7}$/.test(credentials.partyB || '')) {
        return json({ error: 'A valid Till number is required for Buy Goods checkout' }, 400, corsOrigin);
      }
      await accessToken(credentials, environment);
      const ciphertext = await encrypt(credentials);
      const { error } = await admin.from('payment_provider_credentials').upsert({ tenant_id: tenantId, provider: 'MPESA', environment,
        credentials_encrypted: ciphertext, verified: true, verified_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: 'tenant_id,provider' });
      if (error) throw new Error('Could not securely save M-Pesa credentials');
      return json({ success: true }, 200, corsOrigin);
    }

    if (action === 'set-channel') {
      if (role !== 'admin') return json({ error: 'Administrator access required' }, 403, corsOrigin);
      if (body.channel === 'MPESA_B2C' && body.enabled === true) {
        const { credentials } = await mpesaCredentials(admin, tenantId);
        if (!credentials.initiatorName || !credentials.securityCredential) return json({ error: 'Save the B2C initiator name and security credential first' }, 409, corsOrigin);
      }
      const { error } = await auth.rpc('admin_set_payment_channel', { p_channel: body.channel, p_enabled: body.enabled === true });
      if (error) throw new Error(error.message);
      return json({ success: true }, 200, corsOrigin);
    }

    if (action === 'payment-status') {
      if (typeof body.paymentId !== 'string' || !uuidPattern.test(body.paymentId)) return json({ error: 'Payment ID is invalid' }, 400, corsOrigin);
      const { data: payment, error } = await admin.from('payments').select('id,tenant_id,sale_id,initiated_by,status,provider_receipt,failure_reason,updated_at')
        .eq('tenant_id', tenantId).eq('id', body.paymentId).maybeSingle();
      if (error || !payment) return json({ error: 'Payment could not be found' }, 404, corsOrigin);
      if (role !== 'admin' && payment.initiated_by !== user.id) return json({ error: 'Payment access denied' }, 403, corsOrigin);
      return json({ id: payment.id, status: payment.status, receipt: payment.provider_receipt, failureReason: payment.failure_reason, updatedAt: payment.updated_at }, 200, corsOrigin);
    }

    if (action === 'initiate-stk') {
      const paymentId = typeof body.paymentId === 'string' ? body.paymentId : '';
      if (!uuidPattern.test(paymentId)) return json({ error: 'Payment ID is invalid' }, 400, corsOrigin);
      const { data: payment } = await admin.from('payments').select('id,tenant_id,sale_id,channel,amount,status,initiated_by')
        .eq('id', paymentId).eq('tenant_id', tenantId).maybeSingle();
      if (!payment || payment.channel !== 'MPESA_STK' || !payment.sale_id) return json({ error: 'Pending M-Pesa sale not found' }, 404, corsOrigin);
      if (role !== 'admin' && payment.initiated_by !== user.id) return json({ error: 'Payment access denied' }, 403, corsOrigin);
      if (!['PENDING','FAILED'].includes(payment.status)) return json({ error: 'This payment has already been submitted' }, 409, corsOrigin);
      const phone = normalizeKenyanPhone(typeof body.phone === 'string' ? body.phone : '');
      const amount = Math.floor(Number(payment.amount));
      if (!Number.isSafeInteger(amount) || amount < 1 || amount > 250000) return json({ error: 'M-Pesa checkout must be between KSh 1 and KSh 250,000' }, 400, corsOrigin);
      const { data: sale } = await admin.from('sales').select('sale_number,payment_status,payment_method')
        .eq('id', payment.sale_id).eq('tenant_id', tenantId).maybeSingle();
      if (!sale || !['pending','failed'].includes(sale.payment_status) || sale.payment_method !== 'mpesa') return json({ error: 'Sale is no longer eligible for an M-Pesa request' }, 409, corsOrigin);
      const { environment, credentials } = await mpesaCredentials(admin, tenantId);
      const tokenSecret = randomToken();
      const tokenHash = await sha256(tokenSecret);
      const { data: claimed, error: prepareError } = await admin.rpc('service_claim_stk_payment', {
        p_tenant_id: tenantId, p_payment_id: paymentId, p_user_id: payment.initiated_by,
        p_token_hash: tokenHash, p_phone: phone,
      });
      if (prepareError || claimed !== true) throw new Error('This payment has already been submitted or is no longer pending');
      const time = timestampNairobi();
      const password = btoa(`${credentials.shortcode}${credentials.passkey}${time}`);
      const callbackUrl = `${url}/functions/v1/payment-gateway?route=stk-callback&tenant_id=${tenantId}&payment_id=${paymentId}&token=${encodeURIComponent(tokenSecret)}`;
      let requestStarted = false;
      let acceptedByDaraja = false;
      try {
        const bearer = await accessToken(credentials, environment);
        requestStarted = true;
        const result = await callSafaricom(`${mpesaHost(environment)}/mpesa/stkpush/v1/processrequest`, bearer, {
          BusinessShortCode: credentials.shortcode, Password: password, Timestamp: time,
          TransactionType: credentials.transactionType || 'CustomerPayBillOnline', Amount: amount, PartyA: phone,
          PartyB: credentials.partyB || credentials.shortcode, PhoneNumber: phone, CallBackURL: callbackUrl,
          AccountReference: (sale.sale_number || payment.sale_id.slice(0, 12)).slice(0, 12),
          TransactionDesc: 'Business sale payment',
        });
        if (result.ResponseCode !== undefined && String(result.ResponseCode) !== '0') {
          throw new DarajaResponseError(typeof result.ResponseDescription === 'string' ? result.ResponseDescription : 'Safaricom did not accept the payment request');
        }
        if (typeof result.CheckoutRequestID !== 'string') throw new Error('Safaricom response is uncertain. Check the payment ledger before trying again.');
        acceptedByDaraja = true;
        const { error: updateError } = await admin.from('payments').update({ provider_ref: result.CheckoutRequestID,
          provider_response: { responseCode: result.ResponseCode, customerMessage: result.CustomerMessage }, updated_at: new Date().toISOString() })
          .eq('id', paymentId).eq('tenant_id', tenantId);
        if (updateError) throw new Error('Safaricom accepted the request, but it could not be recorded. Contact an administrator before retrying.');
        return json({ success: true, paymentId, message: typeof result.CustomerMessage === 'string' ? result.CustomerMessage : 'Payment prompt sent' }, 200, corsOrigin);
      } catch (error) {
        if (!acceptedByDaraja && (!requestStarted || error instanceof DarajaResponseError)) {
          await admin.from('payments').update({ status: 'FAILED', failure_reason: error instanceof Error ? error.message.slice(0, 500) : 'Safaricom request failed', updated_at: new Date().toISOString() })
            .eq('id', paymentId).eq('tenant_id', tenantId);
          await admin.from('sales').update({ payment_status: 'failed' }).eq('id', payment.sale_id).eq('tenant_id', tenantId);
        }
        throw error;
      }
    }

    if (action === 'initiate-credit-stk') {
      if (role !== 'admin') return json({ error: 'Administrator access required to receive credit payments' }, 403, corsOrigin);
      const customerId = typeof body.customerId === 'string' ? body.customerId : '';
      const amount = Number(body.amount);
      if (!uuidPattern.test(customerId) || !Number.isSafeInteger(amount) || amount < 1 || amount > 250000) {
        return json({ error: 'Select a credit customer and enter a whole KSh amount from 1 to 250,000' }, 400, corsOrigin);
      }
      const phone = normalizeKenyanPhone(typeof body.phone === 'string' ? body.phone : '');
      const { data: channel } = await admin.from('payment_channels').select('enabled')
        .eq('tenant_id', tenantId).eq('channel', 'MPESA_STK').maybeSingle();
      if (!channel?.enabled) return json({ error: 'M-Pesa customer payments are disabled' }, 409, corsOrigin);
      const { environment, credentials } = await mpesaCredentials(admin, tenantId);
      const id = crypto.randomUUID();
      const tokenSecret = randomToken();
      const tokenHash = await sha256(tokenSecret);
      const { data: createdId, error: createError } = await admin.rpc('service_create_credit_stk_payment', {
        p_tenant_id: tenantId, p_user_id: user.id, p_payment_id: id, p_customer_id: customerId,
        p_amount: amount, p_phone: phone, p_token_hash: tokenHash, p_idempotency_key: `credit-mpesa-${id}`,
      });
      if (createError || createdId !== id) throw new Error(createError?.message || 'Could not reserve the customer credit payment');
      const { data: payment } = await admin.from('payments').select('sale_id').eq('id', id).eq('tenant_id', tenantId).maybeSingle();
      const { data: sale } = payment?.sale_id ? await admin.from('sales').select('sale_number').eq('id', payment.sale_id).eq('tenant_id', tenantId).maybeSingle() : { data: null };
      const time = timestampNairobi();
      const password = btoa(`${credentials.shortcode}${credentials.passkey}${time}`);
      const callbackUrl = `${url}/functions/v1/payment-gateway?route=stk-callback&tenant_id=${tenantId}&payment_id=${id}&token=${encodeURIComponent(tokenSecret)}`;
      let requestStarted = false;
      let accepted = false;
      try {
        const bearer = await accessToken(credentials, environment);
        requestStarted = true;
        const result = await callSafaricom(`${mpesaHost(environment)}/mpesa/stkpush/v1/processrequest`, bearer, {
          BusinessShortCode: credentials.shortcode, Password: password, Timestamp: time,
          TransactionType: credentials.transactionType || 'CustomerPayBillOnline', Amount: amount, PartyA: phone,
          PartyB: credentials.partyB || credentials.shortcode, PhoneNumber: phone, CallBackURL: callbackUrl,
          AccountReference: (sale?.sale_number || id.slice(0, 12)).slice(0, 12), TransactionDesc: 'Customer credit payment',
        });
        if (result.ResponseCode !== undefined && String(result.ResponseCode) !== '0') {
          throw new DarajaResponseError(typeof result.ResponseDescription === 'string' ? result.ResponseDescription : 'Safaricom did not accept the payment request');
        }
        if (typeof result.CheckoutRequestID !== 'string') throw new Error('Safaricom response is uncertain. Check the payment ledger before trying again.');
        accepted = true;
        const { error } = await admin.from('payments').update({ provider_ref: result.CheckoutRequestID,
          provider_response: { responseCode: result.ResponseCode, customerMessage: result.CustomerMessage }, updated_at: new Date().toISOString() })
          .eq('id', id).eq('tenant_id', tenantId);
        if (error) throw new Error('Safaricom accepted the request but its reference could not be saved. Check the payment ledger before trying again.');
        return json({ success: true, paymentId: id, amount, phone,
          message: typeof result.CustomerMessage === 'string' ? result.CustomerMessage : 'Credit payment prompt sent' }, 200, corsOrigin);
      } catch (error) {
        if (!accepted && (!requestStarted || error instanceof DarajaResponseError)) {
          await admin.from('payments').update({ status: 'FAILED', failure_reason: error instanceof Error ? error.message.slice(0, 500) : 'Safaricom request failed', updated_at: new Date().toISOString() })
            .eq('id', id).eq('tenant_id', tenantId);
        }
        throw error;
      }
    }

    if (action === 'initiate-refund') {
      if (role !== 'admin') return json({ error: 'Administrator access required for customer refunds' }, 403, corsOrigin);
      const originalPaymentId = typeof body.originalPaymentId === 'string' ? body.originalPaymentId : '';
      const amount = Number(body.amount);
      const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 200) : '';
      if (!uuidPattern.test(originalPaymentId) || !Number.isSafeInteger(amount) || amount < 1 || amount > 250000 || !reason) {
        return json({ error: 'Choose a confirmed M-Pesa sale payment, a reason, and a whole KSh amount from 1 to 250,000' }, 400, corsOrigin);
      }
      const { data: channel } = await admin.from('payment_channels').select('enabled')
        .eq('tenant_id', tenantId).eq('channel', 'MPESA_B2C').maybeSingle();
      if (!channel?.enabled) return json({ error: 'M-Pesa refunds are disabled' }, 409, corsOrigin);
      const { data: original } = await admin.from('payments').select('id,amount,customer_phone,sale_id,credit_customer_id')
        .eq('tenant_id', tenantId).eq('id', originalPaymentId).eq('channel', 'MPESA_STK')
        .eq('direction', 'INBOUND').eq('status', 'SUCCESS').not('sale_id', 'is', null).maybeSingle();
      const { data: originalSale } = original?.sale_id ? await admin.from('sales').select('payment_method')
        .eq('tenant_id', tenantId).eq('id', original.sale_id).maybeSingle() : { data: null };
      if (!original?.customer_phone || original.credit_customer_id || originalSale?.payment_method !== 'mpesa') {
        return json({ error: 'Refunds are currently limited to confirmed M-Pesa sales, not credit repayments' }, 409, corsOrigin);
      }
      const phone = normalizeKenyanPhone(original.customer_phone);
      const { environment, credentials } = await mpesaCredentials(admin, tenantId);
      if (!credentials.initiatorName || !credentials.securityCredential) return json({ error: 'Add the B2C initiator name and encrypted security credential in payment settings' }, 409, corsOrigin);
      const id = crypto.randomUUID();
      const tokenSecret = randomToken();
      const tokenHash = await sha256(tokenSecret);
      const { data: createdId, error: createError } = await admin.rpc('service_create_mpesa_refund', {
        p_tenant_id: tenantId, p_user_id: user.id, p_payment_id: id, p_original_payment_id: originalPaymentId,
        p_amount: amount, p_phone: phone, p_token_hash: tokenHash, p_idempotency_key: `refund-${id}`, p_reason: reason,
      });
      if (createError || createdId !== id) throw new Error(createError?.message || 'Could not reserve the refund amount');
      await sendB2cPayment(admin, url, tenantId, id, tokenSecret, phone, amount,
        `Refund: ${reason}`, 'Sale refund', environment, credentials);
      return json({ success: true, paymentId: id, amount, phone, message: 'Customer refund submitted to M-Pesa' }, 200, corsOrigin);
    }

    if (action === 'initiate-supplier-payment') {
      if (role !== 'admin') return json({ error: 'Administrator access required for supplier payouts' }, 403, corsOrigin);
      const supplierId = typeof body.supplierId === 'string' ? body.supplierId : '';
      const purchaseId = typeof body.purchaseId === 'string' && uuidPattern.test(body.purchaseId) ? body.purchaseId : null;
      const amount = Number(body.amount);
      if (!uuidPattern.test(supplierId) || !Number.isSafeInteger(amount) || amount < 1 || amount > 250000) return json({ error: 'Choose a supplier and enter an amount from KSh 1 to KSh 250,000' }, 400, corsOrigin);
      const { data: channel } = await admin.from('payment_channels').select('enabled').eq('tenant_id', tenantId).eq('channel','MPESA_B2C').maybeSingle();
      if (!channel?.enabled) return json({ error: 'M-Pesa supplier payments are disabled' }, 409, corsOrigin);
      const { data: supplier } = await admin.from('suppliers').select('id,name,phone,credit_balance').eq('tenant_id',tenantId).eq('id',supplierId).maybeSingle();
      if (!supplier) return json({ error: 'Supplier could not be found' }, 404, corsOrigin);
      const phone = normalizeKenyanPhone(typeof supplier.phone === 'string' ? supplier.phone : '');
      if (purchaseId) {
        const { data: purchase } = await admin.from('purchases').select('id,supplier_id,total_amount,amount_paid')
          .eq('tenant_id',tenantId).eq('id',purchaseId).maybeSingle();
        if (!purchase || purchase.supplier_id !== supplierId || amount > Number(purchase.total_amount)-Number(purchase.amount_paid)) {
          return json({ error: 'Amount exceeds the unpaid balance on this supplier invoice' }, 400, corsOrigin);
        }
      } else if (amount > Number(supplier.credit_balance || 0)) {
        return json({ error: 'Amount exceeds the supplier balance owed' }, 400, corsOrigin);
      }
      const { environment, credentials } = await mpesaCredentials(admin,tenantId);
      if (!credentials.initiatorName || !credentials.securityCredential) return json({ error: 'Add B2C initiator name and encrypted security credential in payment settings' }, 409, corsOrigin);
      const id = crypto.randomUUID();
      const tokenSecret = randomToken();
      const tokenHash = await sha256(tokenSecret);
      const { data: createdPaymentId, error: insertError } = await admin.rpc('service_create_supplier_disbursement', {
        p_tenant_id:tenantId,p_user_id:user.id,p_payment_id:id,p_supplier_id:supplierId,p_purchase_id:purchaseId,p_amount:amount,
        p_phone:phone,p_callback_token_hash:tokenHash,p_idempotency_key:`b2c-${id}`,
        p_note:typeof body.remarks==='string'?body.remarks.slice(0,100):null,
      });
      if (insertError || createdPaymentId !== id) throw new Error(insertError?.message || 'Could not reserve and create the supplier payment record');
      await sendB2cPayment(admin, url, tenantId, id, tokenSecret, phone, amount,
        typeof body.remarks==='string'?body.remarks.slice(0,100):`Supplier ${supplier.name}`, 'Supplier payment', environment, credentials);
      return json({success:true,paymentId:id,message:'Supplier payment submitted to M-Pesa'},200,corsOrigin);
    }

    return json({ error: 'Unknown payment action' }, 400, corsOrigin);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Payment request failed';
    const status = /session|authentication/i.test(message) ? 401 : /administrator|access denied|active business/i.test(message) ? 403 : 400;
    return json({ error: message }, status, corsOrigin);
  }
});

async function handleStkCallback(request: Request, admin: SupabaseClient, origin?: string) {
  const url = new URL(request.url);
  const tenantId = url.searchParams.get('tenant_id') || '';
  const paymentId = url.searchParams.get('payment_id') || '';
  const token = url.searchParams.get('token') || '';
  let payload: Record<string, any> = {};
  try { payload = await request.json(); } catch { return new Response('OK', { status: 200 }); }
  const callback = payload?.Body?.stkCallback;
  const checkoutId = typeof callback?.CheckoutRequestID === 'string' ? callback.CheckoutRequestID : '';
  const resultCode = callback?.ResultCode;
  const items = Array.isArray(callback?.CallbackMetadata?.Item) ? callback.CallbackMetadata.Item : [];
  const getItem = (name: string) => items.find((item: Record<string, unknown>) => item.Name === name)?.Value;
  if (!uuidPattern.test(tenantId) || !uuidPattern.test(paymentId) || !token) return new Response('OK', { status: 200 });
  const tokenHash=await sha256(token);
  const { data: payment }=await admin.from('payments').select('id,provider_ref,amount').eq('tenant_id',tenantId).eq('id',paymentId).eq('callback_token_hash',tokenHash).eq('channel','MPESA_STK').maybeSingle();
  if (!payment) return new Response('OK', { status: 200 });
  const { data: webhook }=await admin.from('payment_webhook_events').insert({tenant_id:tenantId,provider:'mpesa',event_type:'stk_callback',provider_ref:checkoutId||null,
    result_code:resultCode===undefined?null:String(resultCode),processed:false}).select('id').maybeSingle();
  if (resultCode===undefined || !Number.isFinite(Number(resultCode))) {
    await admin.from('payments').update({status:'REVIEW_REQUIRED',failure_reason:'Safaricom callback did not include a valid result code',updated_at:new Date().toISOString()}).eq('id',paymentId);
    if (webhook?.id) await admin.from('payment_webhook_events').update({processed:true,error:'Missing result code'}).eq('id',webhook.id);
    return new Response('OK',{status:200});
  }
  const success=Number(resultCode)===0;
  const amount=getItem('Amount');
  const phone=getItem('PhoneNumber');
  if(success && (!checkoutId || Math.floor(Number(amount))!==Math.floor(Number(payment.amount))
    || (payment.provider_ref && payment.provider_ref!==checkoutId))) {
    await admin.from('payments').update({status:'REVIEW_REQUIRED',failure_reason:'M-Pesa callback does not match the checkout record',updated_at:new Date().toISOString()}).eq('id',paymentId);
    if (webhook?.id) await admin.from('payment_webhook_events').update({processed:true,error:'Callback does not match payment record'}).eq('id',webhook.id);
    return new Response('OK',{status:200});
  }
  const receipt=typeof getItem('MpesaReceiptNumber')==='string'?String(getItem('MpesaReceiptNumber')):'';
  const {error}=await admin.rpc('service_apply_mpesa_result',{p_tenant_id:tenantId,p_token_hash:tokenHash,p_success:success,p_provider_ref:checkoutId,
    p_receipt:receipt,p_phone:phone===undefined?'':String(phone),p_failure:typeof callback?.ResultDesc==='string'?callback.ResultDesc:'M-Pesa payment failed'});
  if (webhook?.id) await admin.from('payment_webhook_events').update({processed:!error,error:error?String(error.message).slice(0,500):null}).eq('id',webhook.id);
  if (success && !error) {
    try { await sendCustomerPaymentSms(admin, tenantId, paymentId); }
    catch (smsError) { console.error('Customer payment SMS dispatch failed', smsError); }
  }
  return new Response('OK',{status:200});
}

async function sendCustomerPaymentSms(admin: SupabaseClient, tenantId: string, paymentId: string) {
  const { data: queued, error: queueError } = await admin.from('customer_sms_outbox')
    .select('id,customer_id,payment_id,recipient_phone,status,attempts')
    .eq('tenant_id', tenantId).eq('payment_id', paymentId).in('status', ['QUEUED', 'FAILED'])
    .order('created_at', { ascending: true }).limit(1).maybeSingle();
  if (queueError) throw new Error('Could not load the customer SMS queue');
  if (!queued) return { sent: false, skipped: true, reason: 'No customer SMS is queued for this payment' };
  const username = Deno.env.get('AFRICASTALKING_USERNAME')?.trim();
  const apiKey = Deno.env.get('AFRICASTALKING_API_KEY')?.trim();
  if (!username || !apiKey) throw new Error('Africa’s Talking SMS is not configured in Supabase secrets');

  const [{ data: payment }, { data: customer }, { data: settings }, { data: business }] = await Promise.all([
    admin.from('payments').select('amount,channel,status,sale_id').eq('tenant_id', tenantId).eq('id', paymentId).maybeSingle(),
    admin.from('customers').select('name,phone,sms_opt_in,loyalty_points').eq('tenant_id', tenantId).eq('id', queued.customer_id).maybeSingle(),
    admin.from('system_settings').select('business_name,loyalty_enabled,sms_balance_notifications_enabled').eq('tenant_id', tenantId).maybeSingle(),
    admin.from('business_tenants').select('name').eq('id', tenantId).maybeSingle(),
  ]);
  if (!payment || payment.status !== 'SUCCESS') return { sent: false, skipped: true, reason: 'Payment is not confirmed' };
  if (!customer || !customer.sms_opt_in || settings?.sms_balance_notifications_enabled === false) {
    await admin.from('customer_sms_outbox').update({ status: 'FAILED', last_error: 'Customer SMS consent is off or notifications are disabled' })
      .eq('tenant_id', tenantId).eq('id', queued.id).in('status', ['QUEUED', 'FAILED']);
    return { sent: false, skipped: true, reason: 'Customer SMS consent or tenant SMS setting is off' };
  }

  const { data: claimed, error: claimError } = await admin.from('customer_sms_outbox')
    .update({ status: 'SENDING', attempts: Number(queued.attempts || 0) + 1, last_error: null })
    .eq('tenant_id', tenantId).eq('id', queued.id).in('status', ['QUEUED', 'FAILED'])
    .select('id').maybeSingle();
  if (claimError) throw new Error('Could not reserve the customer SMS for delivery');
  if (!claimed) return { sent: false, skipped: true, reason: 'Customer SMS is already being sent' };

  try {
    const [{ data: balance, error: balanceError }, { data: currentQueue, error: attemptError }] = await Promise.all([
      admin.rpc('service_get_customer_balance', { p_tenant_id: tenantId, p_customer_id: queued.customer_id }),
      admin.from('customer_sms_outbox').select('attempts').eq('tenant_id', tenantId).eq('id', queued.id).maybeSingle(),
    ]);
    if (balanceError || attemptError) throw new Error('Could not calculate the customer balance for the SMS');
    const amount = Number(payment.amount || 0).toLocaleString('en-KE', { maximumFractionDigits: 0 });
    const balanceAmount = Number(balance || 0).toLocaleString('en-KE', { maximumFractionDigits: 0 });
    const paymentLabel = payment.channel === 'MPESA_STK' ? 'M-Pesa' : payment.channel === 'BANK_TRANSFER' ? 'bank' : payment.channel.toLowerCase();
    const businessName = settings?.business_name?.trim() || business?.name?.trim() || 'Your business';
    const pointsText = settings?.loyalty_enabled === false ? '' : ` Points: ${Number(customer.loyalty_points || 0)}.`;
    const message = `Hi ${customer.name}, KSh ${amount} received via ${paymentLabel}. Balance due: KSh ${balanceAmount}.${pointsText} ${businessName}.`;
    const recipientPhone = customer.phone || queued.recipient_phone;
    const form = new URLSearchParams({ username, to: recipientPhone, message });
    const senderId = Deno.env.get('AFRICASTALKING_SENDER_ID')?.trim();
    if (senderId) form.set('from', senderId);
    const environment = Deno.env.get('AFRICASTALKING_ENVIRONMENT')?.toLowerCase() === 'sandbox' ? 'sandbox' : 'production';
    const endpoint = environment === 'sandbox'
      ? 'https://api.sandbox.africastalking.com/version1/messaging'
      : 'https://api.africastalking.com/version1/messaging';
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { apiKey, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
    });
    const result = await response.json().catch(() => ({}));
    const recipient = result?.SMSMessageData?.Recipients?.[0];
    if (!response.ok || !recipient || !/success/i.test(String(recipient.status || ''))) {
      const providerError = String(recipient?.status || result?.SMSMessageData?.Message || `Africa’s Talking returned HTTP ${response.status}`).slice(0, 500);
      throw new Error(providerError);
    }
    const { error: saveError } = await admin.from('customer_sms_outbox').update({
      status: 'SENT', recipient_phone: recipientPhone,
      provider_message_id: String(recipient.messageId || '').slice(0, 200) || null,
      sent_at: new Date().toISOString(), last_error: null,
    }).eq('tenant_id', tenantId).eq('id', queued.id).eq('status', 'SENDING');
    if (saveError) throw new Error('SMS was accepted but its delivery record could not be saved');
    return { sent: true, messageId: recipient.messageId || null };
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 500) : 'Africa’s Talking SMS request failed';
    const { data: current } = await admin.from('customer_sms_outbox').select('attempts').eq('tenant_id', tenantId).eq('id', queued.id).maybeSingle();
    await admin.from('customer_sms_outbox').update({
      status: 'FAILED', attempts: Math.max(1, Number(current?.attempts || 1)), last_error: reason,
    }).eq('tenant_id', tenantId).eq('id', queued.id).eq('status', 'SENDING');
    throw error;
  }
}

async function handleB2cCallback(request: Request, admin: SupabaseClient, origin?: string, timeout=false) {
  const url=new URL(request.url);
  const tenantId=url.searchParams.get('tenant_id')||'';
  const paymentId=url.searchParams.get('payment_id')||'';
  const secret=url.searchParams.get('token')||'';
  let payload:Record<string,any>={};
  try{payload=await request.json();}catch{return new Response('OK',{status:200});}
  const result=payload?.Result||{};
  const resultCode=result.ResultCode;
  const conversation=typeof result.ConversationID==='string'?result.ConversationID:'';
  const providerReceipt=Array.isArray(result.ResultParameters?.ResultParameter)
    ? result.ResultParameters.ResultParameter.find((item:Record<string,unknown>)=>item.Key==='TransactionReceipt')?.Value : undefined;
  if(!uuidPattern.test(tenantId)||!uuidPattern.test(paymentId)||!secret)return new Response('OK',{status:200});
  const tokenHash=await sha256(secret);
  const {data:payment}=await admin.from('payments').select('id,amount,provider_ref').eq('tenant_id',tenantId).eq('id',paymentId).eq('callback_token_hash',tokenHash).eq('channel','MPESA_B2C').maybeSingle();
  if(!payment)return new Response('OK',{status:200});
  const {data:webhook}=await admin.from('payment_webhook_events').insert({tenant_id:tenantId,provider:'mpesa',event_type:timeout?'b2c_timeout':'b2c_result',provider_ref:conversation||null,
    result_code:resultCode===undefined?null:String(resultCode),processed:false}).select('id').maybeSingle();
  if(!timeout&&(resultCode===undefined||!Number.isFinite(Number(resultCode)))){
    await admin.from('payments').update({status:'REVIEW_REQUIRED',failure_reason:'B2C callback did not include a valid result code',updated_at:new Date().toISOString()}).eq('id',paymentId);
    if(webhook?.id)await admin.from('payment_webhook_events').update({processed:true,error:'Missing result code'}).eq('id',webhook.id);
    return new Response('OK',{status:200});
  }
  const resultParameters=Array.isArray(result.ResultParameters?.ResultParameter)?result.ResultParameters.ResultParameter:[];
  const transactionAmount=resultParameters.find((item:Record<string,unknown>)=>item.Key==='TransactionAmount')?.Value;
  if(!timeout&&Number(resultCode)===0&&Number(transactionAmount)!==Number(payment.amount)){
    await admin.from('payments').update({status:'REVIEW_REQUIRED',failure_reason:'B2C callback amount does not match the payout request',updated_at:new Date().toISOString()}).eq('id',paymentId);
    if(webhook?.id)await admin.from('payment_webhook_events').update({processed:true,error:'Callback amount does not match payment record'}).eq('id',webhook.id);
    return new Response('OK',{status:200});
  }
  if(!timeout&&payment.provider_ref&&conversation&&payment.provider_ref!==conversation){
    await admin.from('payments').update({status:'REVIEW_REQUIRED',failure_reason:'B2C callback does not match the payout conversation',updated_at:new Date().toISOString()}).eq('id',paymentId);
    if(webhook?.id)await admin.from('payment_webhook_events').update({processed:true,error:'Callback conversation does not match payment record'}).eq('id',webhook.id);
    return new Response('OK',{status:200});
  }
  const {error}=await admin.rpc('service_apply_b2c_result',{p_payment_id:paymentId,p_receipt:typeof providerReceipt==='string'?providerReceipt:'',
    p_success:!timeout&&Number(resultCode)===0,p_failure:typeof result.ResultDesc==='string'?result.ResultDesc:(timeout?'M-Pesa payout timed out':'M-Pesa payout failed')});
  if(webhook?.id)await admin.from('payment_webhook_events').update({processed:!error,error:error?String(error.message).slice(0,500):null}).eq('id',webhook.id);
  return new Response('OK',{status:200});
}
