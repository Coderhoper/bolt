import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

const validEmail = (value: string) => /^[^\s@\r\n]+@[^\s@\r\n]+\.[^\s@\r\n]+$/.test(value);
const validPhone = (value: string) => /^\+[1-9]\d{7,14}$/.test(value);
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] || char);

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  const bearer = request.headers.get('Authorization') || '';
  const token = bearer.replace(/^Bearer\s+/i, '');
  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  if (!token || !url || !anon) return reply({ error: 'Owner messaging service is not configured' }, 503);

  const db = createClient(url, anon, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
  const [{ data: userResult, error: authError }, { data: claimResult }] = await Promise.all([
    db.auth.getUser(token), db.auth.getClaims(token),
  ]);
  const user = userResult.user;
  if (authError || !user) return reply({ error: 'Authentication required' }, 401);
  if (claimResult?.claims?.aal !== 'aal2') return reply({ error: 'Verified MFA is required' }, 403);
  const { data: staff } = await db.from('owner_staff').select('role,is_active').eq('user_id', user.id).maybeSingle();
  if (!staff?.is_active || !['platform_admin', 'provisioner'].includes(staff.role)) return reply({ error: 'Owner communications access required' }, 403);

  let payload: { channel?: string; to?: string; subject?: string; text?: string; idempotencyKey?: string };
  try { payload = await request.json(); } catch { return reply({ error: 'Invalid request' }, 400); }
  const channel = payload.channel;
  const to = typeof payload.to === 'string' ? payload.to.trim() : '';
  const subject = typeof payload.subject === 'string' ? payload.subject.trim() : '';
  const text = typeof payload.text === 'string' ? payload.text.trim() : '';
  const idempotencyKey = typeof payload.idempotencyKey === 'string' ? payload.idempotencyKey : '';
  if (!['email', 'sms', 'whatsapp'].includes(channel || '') || !idempotencyKey || idempotencyKey.length > 100 || !text || text.length > 2000 || /[\r\n]/.test(subject)) return reply({ error: 'Check the channel, subject and message fields' }, 400);
  if ((channel === 'email' && (!validEmail(to) || !subject || subject.length > 160)) || (channel !== 'email' && !validPhone(to))) return reply({ error: 'Recipient or subject is invalid' }, 400);

  const { count, error: rateError } = await db.from('owner_comm_messages').select('id', { count: 'exact', head: true })
    .eq('created_by', user.id).gte('created_at', new Date(Date.now() - 60_000).toISOString());
  if (rateError || (count || 0) >= 10) return reply({ error: 'Message rate limit reached. Try again shortly.' }, 429);
  const { data: config } = await db.from('owner_comm_channels').select('*').eq('channel', channel).maybeSingle();
  if (!config?.is_enabled) return reply({ error: 'This channel is not enabled yet' }, 409);
  const missingSecret = channel === 'email'
    ? !Deno.env.get('POSTMARK_SERVER_TOKEN') || !config.sender_address
    : channel === 'sms'
      ? !Deno.env.get('TWILIO_ACCOUNT_SID') || !Deno.env.get('TWILIO_AUTH_TOKEN') || !(Deno.env.get('TWILIO_FROM_NUMBER') || config.sender_address)
      : !Deno.env.get('META_WHATSAPP_ACCESS_TOKEN') || !Deno.env.get('META_WHATSAPP_PHONE_NUMBER_ID') || !Deno.env.get('META_GRAPH_API_VERSION');
  if (missingSecret) return reply({ error: 'Provider credentials and sender settings are required before sending' }, 503);

  const recipientHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(to.toLowerCase()));
  const recipient_hash = [...new Uint8Array(recipientHash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const provider = config.provider as string;
  const { error: reserveError } = await db.rpc('owner_comm_reserve_message', {
    p_channel: channel, p_recipient_hash: recipient_hash, p_provider: provider, p_idempotency_key: idempotencyKey,
  });
  if (reserveError) return reply({ error: reserveError.code === '23505' ? 'This message request was already processed' : 'Could not queue this message' }, 409);

  let providerMessageId: string | null = null;
  let errorCode: string | null = null;
  try {
    let response: Response;
    if (channel === 'email' && provider === 'postmark') {
      const key = Deno.env.get('POSTMARK_SERVER_TOKEN');
      if (!key || !config.sender_address) return reply({ error: 'Email provider credentials or sender are missing' }, 503);
      response = await fetch('https://api.postmarkapp.com/email', {
        method: 'POST', headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'X-Postmark-Server-Token': key },
        body: JSON.stringify({ From: config.sender_address, To: to, Subject: subject, TextBody: text, HtmlBody: `<p>${escapeHtml(text).replace(/\n/g, '<br>')}</p>`, ReplyTo: config.reply_to || undefined, MessageStream: 'outbound' }),
      });
    } else if (channel === 'sms' && provider === 'twilio') {
      const sid = Deno.env.get('TWILIO_ACCOUNT_SID'); const key = Deno.env.get('TWILIO_AUTH_TOKEN');
      const from = Deno.env.get('TWILIO_FROM_NUMBER') || config.sender_address;
      if (!sid || !key || !from) return reply({ error: 'SMS provider credentials or sender are missing' }, 503);
      const form = new URLSearchParams({ To: to, From: from, Body: text });
      response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST', headers: { 'Authorization': `Basic ${btoa(`${sid}:${key}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: form,
      });
    } else if (channel === 'whatsapp' && provider === 'meta_cloud') {
      const key = Deno.env.get('META_WHATSAPP_ACCESS_TOKEN'); const phoneId = Deno.env.get('META_WHATSAPP_PHONE_NUMBER_ID');
      const version = Deno.env.get('META_GRAPH_API_VERSION');
      if (!key || !phoneId || !version) return reply({ error: 'WhatsApp Cloud credentials are missing' }, 503);
      response = await fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
        method: 'POST', headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: to.replace('+', ''), type: 'text', text: { preview_url: false, body: text } }),
      });
    } else return reply({ error: 'The selected provider does not support this channel' }, 400);

    const result = await response.json().catch(() => ({}));
    if (!response.ok) errorCode = `provider_http_${response.status}`;
    else providerMessageId = result.MessageID || result.sid || result.messages?.[0]?.id || null;
  } catch {
    errorCode = 'provider_unavailable';
  }

  const status = errorCode ? 'failed' : 'accepted';
  const { error: logError } = await db.rpc('owner_comm_complete_message', {
    p_idempotency_key: idempotencyKey, p_provider_message_id: providerMessageId,
    p_status: status, p_error_code: errorCode,
  });
  if (logError) return reply({ error: 'Could not record the delivery audit entry' }, 500);
  return errorCode ? reply({ error: 'The provider did not accept the message', code: errorCode }, 502) : reply({ status, providerMessageId });
});
