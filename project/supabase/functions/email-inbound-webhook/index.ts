import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const maxBytes = 20 * 1024 * 1024;
const maxRequestBytes = 28 * 1024 * 1024;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function decodeBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function hex(bytes: Uint8Array) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function sniffMime(bytes: Uint8Array): string | null {
  const text = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  if (text(0, 5) === '%PDF-') return 'application/pdf';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte)) return 'image/png';
  if (text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

function cleanFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120) || 'email-attachment';
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function safeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index++) result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return result === 0;
}

async function readLimitedBody(request: Request): Promise<string | null> {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxRequestBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(body);
}

Deno.serve(async request => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const secret = Deno.env.get('INBOUND_EMAIL_WEBHOOK_SECRET');
  const supplied = request.headers.get('x-inbound-email-secret');
  if (!secret || !supplied || !safeEqual(supplied, secret)) return json({ error: 'Unauthorized' }, 401);
  const serviceUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!serviceUrl || !serviceKey) return json({ error: 'Webhook service is not configured' }, 500);
  const admin = createClient(serviceUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (declaredLength > maxRequestBytes) return json({ error: 'Webhook body exceeds the 28 MB limit' }, 413);
  const bodyText = await readLimitedBody(request);
  if (bodyText === null) return json({ error: 'Webhook body exceeds the 28 MB limit' }, 413);
  let payload: any;
  try { payload = JSON.parse(bodyText); } catch { return json({ error: 'Invalid JSON payload' }, 400); }
  const recipient = normalizeEmail(String(payload.to || ''));
  const sender = normalizeEmail(String(payload.from || ''));
  if (!recipient || !sender || !Array.isArray(payload.attachments)) return json({ error: 'to, from, and attachments are required' }, 400);

  const { data: routes } = await admin.from('inbound_channel_routes').select('tenant_id, supplier_id')
    .eq('channel', 'EMAIL').eq('route_key', recipient).eq('is_active', true);
  if (!routes?.length) return json({ received: true });
  let route: any = null;
  let allow: any = null;
  for (const candidate of routes) {
    const { data: senders } = await admin.from('inbound_sender_allowlist').select('supplier_id, sender_address')
      .eq('tenant_id', candidate.tenant_id).eq('channel', 'EMAIL').eq('is_active', true);
    const match = senders?.find(item => normalizeEmail(item.sender_address) === sender);
    if (match) { route = candidate; allow = match; break; }
  }
  if (!route) return json({ received: true });
  const supplierId = allow.supplier_id || route.supplier_id;
  if (!supplierId) return json({ error: 'Inbound email sender has no mapped supplier' }, 422);
  if (payload.attachments.length > 10) return json({ error: 'A message may contain at most 10 attachments' }, 413);
  const asnNumber = `${payload.subject || ''}\n${payload.text || ''}`.match(/#asn\s+([a-z0-9_-]+)/i)?.[1];
  let asnId: string | null = null;
  if (asnNumber) {
    const { data: asn } = await admin.from('supplier_asns').select('id')
      .eq('tenant_id', route.tenant_id).eq('supplier_id', supplierId).eq('asn_number', asnNumber).maybeSingle();
    asnId = asn?.id || null;
  }

  const prepared: Array<{ bytes: Uint8Array; mime: string; filename: string; digest: string }> = [];
  let totalBytes = 0;
  for (const attachment of payload.attachments) {
    if (typeof attachment?.content_base64 !== 'string') continue;
    let bytes: Uint8Array;
    try { bytes = decodeBase64(attachment.content_base64); } catch { continue; }
    if (bytes.byteLength === 0) continue;
    if (bytes.byteLength > maxBytes || totalBytes + bytes.byteLength > maxBytes) {
      return json({ error: 'Combined supported attachments must be 20 MB or smaller' }, 413);
    }
    const actualMime = sniffMime(bytes);
    const claimedMime = String(attachment.content_type || '').split(';')[0].toLowerCase();
    if (!actualMime || actualMime !== claimedMime) continue;
    const digest = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
    totalBytes += bytes.byteLength;
    prepared.push({ bytes, mime: actualMime, filename: cleanFilename(String(attachment.filename || 'email-attachment')), digest });
  }

  let saved = 0;
  for (const attachment of prepared) {
    const { bytes, mime: actualMime, filename, digest } = attachment;
    const { data: duplicate } = await admin.from('receiving_documents').select('id')
      .eq('tenant_id', route.tenant_id).eq('sha256', digest).limit(1).maybeSingle();
    const path = `${route.tenant_id}/${crypto.randomUUID()}/${filename}`;
    const { error: uploadError } = await admin.storage.from('receiving-documents').upload(path, new Blob([bytes], { type: actualMime }), {
      contentType: actualMime, cacheControl: '3600', upsert: false,
    });
    if (uploadError) continue;
    const { error: insertError } = await admin.from('receiving_documents').insert({
      tenant_id: route.tenant_id, supplier_id: supplierId, asn_id: asnId, document_type: 'delivery_note',
      channel: 'email', status: 'uploaded', storage_path: path, file_name: filename, mime_type: actualMime,
      size_bytes: bytes.byteLength, sha256: digest, duplicate_of: duplicate?.id || null,
      notes: 'Received through the approved inbound email route.',
    });
    if (insertError) { await admin.storage.from('receiving-documents').remove([path]); continue; }
    saved++;
  }
  return json({ received: true, documents_saved: saved });
});
