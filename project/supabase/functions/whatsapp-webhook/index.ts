import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const maxBytes = 20 * 1024 * 1024;
const maxWebhookBytes = 2 * 1024 * 1024;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function hex(bytes: Uint8Array) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function safeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index++) result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return result === 0;
}

async function verifySignature(body: string, supplied: string | null, secret: string) {
  if (!supplied?.startsWith('sha256=')) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
  return safeEqual(`sha256=${hex(digest)}`, supplied.toLowerCase());
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
    if (length > maxWebhookBytes) {
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

function sniffMime(bytes: Uint8Array): string | null {
  const text = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  if (text(0, 5) === '%PDF-') return 'application/pdf';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte)) return 'image/png';
  if (text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

function cleanFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120) || 'supplier-document';
}

function normalizePhone(value: string) {
  return value.replace(/\D/g, '');
}

async function reply(phoneNumberId: string, recipient: string, message: string) {
  const token = Deno.env.get('WHATSAPP_ACCESS_TOKEN');
  if (!token) return;
  const version = Deno.env.get('WHATSAPP_GRAPH_VERSION');
  if (!version) return;
  await fetch(`https://graph.facebook.com/${version}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: recipient, type: 'text', text: { body: message } }),
  });
}

function supportedMedia(message: any) {
  if (message?.type === 'document' && message.document?.id) {
    return { mediaId: message.document.id as string, name: String(message.document.filename || 'supplier-document.pdf'), mime: String(message.document.mime_type || 'application/pdf') };
  }
  if (message?.type === 'image' && message.image?.id) {
    return { mediaId: message.image.id as string, name: 'supplier-document.jpg', mime: String(message.image.mime_type || 'image/jpeg') };
  }
  return null;
}

Deno.serve(async request => {
  const verifyToken = Deno.env.get('META_WEBHOOK_VERIFY_TOKEN');
  if (request.method === 'GET') {
    const params = new URL(request.url).searchParams;
    if (params.get('hub.mode') === 'subscribe' && verifyToken && params.get('hub.verify_token') === verifyToken) {
      return new Response(params.get('hub.challenge') || '', { status: 200 });
    }
    return new Response('Forbidden', { status: 403 });
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  if (Number(request.headers.get('content-length') || 0) > maxWebhookBytes) return json({ error: 'Webhook body is too large' }, 413);
  const rawBody = await readLimitedBody(request);
  if (rawBody === null) return json({ error: 'Webhook body is too large' }, 413);
  const appSecret = Deno.env.get('META_APP_SECRET');
  if (!appSecret || !await verifySignature(rawBody, request.headers.get('x-hub-signature-256'), appSecret)) {
    return json({ error: 'Invalid webhook signature' }, 401);
  }
  const serviceUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const mediaToken = Deno.env.get('WHATSAPP_ACCESS_TOKEN');
  const graphVersion = Deno.env.get('WHATSAPP_GRAPH_VERSION');
  if (!serviceUrl || !serviceKey) return json({ error: 'Webhook service is not configured' }, 500);
  const admin = createClient(serviceUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  let payload: any;
  try { payload = JSON.parse(rawBody); } catch { return json({ error: 'Invalid webhook JSON' }, 400); }
  if (payload.object !== 'whatsapp_business_account') return json({ received: true });

  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== 'messages') continue;
      const phoneNumberId = String(change.value?.metadata?.phone_number_id || '');
      if (!phoneNumberId) continue;
      const { data: routes } = await admin.from('inbound_channel_routes').select('tenant_id, supplier_id')
        .eq('channel', 'WHATSAPP').eq('route_key', phoneNumberId).eq('is_active', true);
      if (!routes?.length) continue;

      for (const message of change.value?.messages || []) {
        const sender = String(message.from || '').replace(/[^0-9+]/g, '');
        const text = message.text?.body?.trim() || message.image?.caption?.trim() || message.document?.caption?.trim() || '';
        let route: any = null;
        let allow: any = null;
        for (const candidate of routes) {
          const { data: senderRows } = await admin.from('inbound_sender_allowlist').select('supplier_id, sender_address')
            .eq('tenant_id', candidate.tenant_id).eq('channel', 'WHATSAPP').eq('is_active', true);
          const data = senderRows?.find(item => normalizePhone(item.sender_address) === normalizePhone(sender));
          if (data) { route = candidate; allow = data; break; }
        }
        if (!route) continue;

        const normalizedSender = normalizePhone(sender);
        const { data: savedContext } = await admin.from('inbound_sender_contexts').select('supplier_id, asn_id')
          .eq('tenant_id', route.tenant_id).eq('channel', 'WHATSAPP').eq('sender_address', normalizedSender)
          .gt('expires_at', new Date().toISOString()).maybeSingle();

        if (/^#help\b/i.test(text)) {
          await reply(phoneNumberId, sender, 'Send a photo or PDF of the delivery document. Use #supplier CODE to identify your supplier, #asn ASN-NUMBER to link a shipment, or #status ASN-NUMBER to check delivery status.');
          continue;
        }
        const supplierCode = text.match(/#supplier\s+([a-z0-9_-]+)/i)?.[1];
        let supplierId = allow.supplier_id || route.supplier_id || savedContext?.supplier_id || null;
        if (supplierCode) {
          const { data: supplier } = await admin.from('suppliers').select('id')
            .eq('tenant_id', route.tenant_id).eq('supplier_code', supplierCode.toUpperCase()).eq('status', 'ACTIVE').maybeSingle();
          supplierId = supplier?.id || null;
          if (supplierId) {
            await admin.from('inbound_sender_contexts').upsert({
              tenant_id: route.tenant_id, channel: 'WHATSAPP', sender_address: normalizedSender,
              supplier_id: supplierId, asn_id: savedContext?.asn_id || null,
              expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), updated_at: new Date().toISOString(),
            });
          }
        }
        const asnNumber = text.match(/#asn\s+([a-z0-9_-]+)/i)?.[1];
        const statusCommand = text.match(/#status\s+([a-z0-9_-]+)/i)?.[1];
        if (asnNumber) {
          const { data: selectedAsn } = await admin.from('supplier_asns').select('id, supplier_id')
            .eq('tenant_id', route.tenant_id).eq('supplier_id', supplierId).eq('asn_number', asnNumber).maybeSingle();
          if (!selectedAsn) {
            if (!supportedMedia(message)) {
              await reply(phoneNumberId, sender, 'Shipment number was not found for your supplier account.');
              continue;
            }
          } else {
            await admin.from('inbound_sender_contexts').upsert({
              tenant_id: route.tenant_id, channel: 'WHATSAPP', sender_address: normalizedSender,
              supplier_id: supplierId, asn_id: selectedAsn.id,
              expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), updated_at: new Date().toISOString(),
            });
          }
        }
        if (statusCommand) {
          const { data: asn } = await admin.from('supplier_asns').select('asn_number, status')
            .eq('tenant_id', route.tenant_id).eq('supplier_id', supplierId).eq('asn_number', statusCommand).maybeSingle();
          await reply(phoneNumberId, sender, asn ? `${asn.asn_number}: ${asn.status.replace(/_/g, ' ')}` : 'Shipment not found for your supplier account.');
          continue;
        }
        if (supplierCode && !supplierId) {
          await reply(phoneNumberId, sender, 'Supplier code was not recognized. Ask your workspace administrator to confirm your supplier code.');
          continue;
        }
        const media = supportedMedia(message);
        if (!media) {
          if (supplierCode && supplierId) await reply(phoneNumberId, sender, 'Supplier linked for the next 24 hours. Send #asn ASN-NUMBER if you want to link a shipment, then send the document.');
          else if (asnNumber && supplierId) await reply(phoneNumberId, sender, 'Shipment linked for 24 hours. Send the delivery document as a PDF or photo.');
          else if (text) await reply(phoneNumberId, sender, 'Send a PDF, JPG, PNG, or WebP image. Use #help for supported commands.');
          continue;
        }
        if (!supplierId) {
          await reply(phoneNumberId, sender, 'Your number is approved, but no supplier is linked. Send #supplier CODE or contact the workspace administrator.');
          continue;
        }
        if (!mediaToken || !graphVersion) {
          await reply(phoneNumberId, sender, 'Document intake is temporarily unavailable. Please retry later.');
          continue;
        }
        const metaMime = media.mime.split(';')[0].toLowerCase();
        if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(metaMime)) {
          await reply(phoneNumberId, sender, 'Only PDF, JPG, PNG, and WebP files are accepted.');
          continue;
        }
        const mediaMeta = await fetch(`https://graph.facebook.com/${graphVersion}/${media.mediaId}`, { headers: { Authorization: `Bearer ${mediaToken}` } });
        if (!mediaMeta.ok) { await reply(phoneNumberId, sender, 'Could not retrieve that file. Please send it again.'); continue; }
        const mediaInfo = await mediaMeta.json();
        const download = await fetch(mediaInfo.url, { headers: { Authorization: `Bearer ${mediaToken}` } });
        if (!download.ok) { await reply(phoneNumberId, sender, 'Could not download that file. Please send it again.'); continue; }
        const bytes = await download.arrayBuffer();
        if (bytes.byteLength > maxBytes) { await reply(phoneNumberId, sender, 'Files must be 20 MB or smaller.'); continue; }
        const actualMime = sniffMime(new Uint8Array(bytes));
        if (!actualMime || actualMime !== metaMime) { await reply(phoneNumberId, sender, 'The file contents do not match the document type.'); continue; }
        let asnId: string | null = savedContext?.asn_id || null;
        if (asnNumber) {
          const { data: asn } = await admin.from('supplier_asns').select('id')
            .eq('tenant_id', route.tenant_id).eq('supplier_id', supplierId).eq('asn_number', asnNumber).maybeSingle();
          asnId = asn?.id || null;
          if (!asnId) { await reply(phoneNumberId, sender, 'Shipment number was not found for your supplier account.'); continue; }
        }
        const digest = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
        const { data: duplicate } = await admin.from('receiving_documents').select('id')
          .eq('tenant_id', route.tenant_id).eq('sha256', digest).limit(1).maybeSingle();
        const filename = cleanFilename(media.name);
        const path = `${route.tenant_id}/${crypto.randomUUID()}/${filename}`;
        const { error: uploadError } = await admin.storage.from('receiving-documents').upload(path, new Blob([bytes], { type: actualMime }), {
          contentType: actualMime, cacheControl: '3600', upsert: false,
        });
        if (uploadError) { await reply(phoneNumberId, sender, 'Could not securely save the document. Please retry later.'); continue; }
        const { error: insertError } = await admin.from('receiving_documents').insert({
          tenant_id: route.tenant_id, supplier_id: supplierId, asn_id: asnId, document_type: 'delivery_note',
          channel: 'whatsapp', status: 'uploaded', storage_path: path, file_name: filename,
          mime_type: actualMime, size_bytes: bytes.byteLength, sha256: digest, duplicate_of: duplicate?.id || null,
          notes: 'Received through the approved WhatsApp inbound route.',
        });
        if (insertError) {
          await admin.storage.from('receiving-documents').remove([path]);
          await reply(phoneNumberId, sender, 'Could not register the document. Please retry later.');
          continue;
        }
        await reply(phoneNumberId, sender, duplicate ? 'Document received and flagged as a duplicate. No stock will be posted from it.' : 'Document received and added to the workspace review queue.');
      }
    }
  }
  return json({ received: true });
});
