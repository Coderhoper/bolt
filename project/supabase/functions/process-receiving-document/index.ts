import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-tenant-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type ExtractedLine = {
  description: string;
  supplier_sku: string | null;
  quantity: number | null;
  unit: string | null;
  unit_price: number | null;
  confidence: number;
  source_page: number | null;
  source_bbox: unknown;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function fieldValue(field: any): unknown {
  if (!field || typeof field !== 'object') return field;
  return field.valueString ?? field.valueNumber ?? field.valueDate ?? field.valueCurrency?.amount
    ?? field.valueBoolean ?? field.valueTime ?? field.valueArray ?? field.valueObject ?? field.content ?? null;
}

function numeric(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[,\s]/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function cleanText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 500) : null;
}

function confidence(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5;
}

function redactPersonalData(text: string) {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted email]')
    .replace(/(?:\+?\d[\d ().-]{7,}\d)/g, '[redacted phone]')
    .replace(/\b(?:tax(?:payer)?\s*(?:id|pin|no)?|vat(?:\s*(?:id|no))?|kra\s*pin|registration\s*(?:no|number))\s*[:#-]?\s*[A-Z0-9/-]{6,24}\b/gi, '[redacted tax or registration number]');
}

function azureLines(result: any): ExtractedLine[] {
  const fields = result?.documents?.[0]?.fields || {};
  const values = Array.isArray(fieldValue(fields.Items)) ? fieldValue(fields.Items) as any[] : [];
  return values.map((item: any) => {
    const row = item?.valueObject || item || {};
    const regions = row.Description?.boundingRegions || item?.boundingRegions || [];
    const polygon = regions[0]?.polygon;
    return {
      description: cleanText(fieldValue(row.Description)) || '',
      supplier_sku: cleanText(fieldValue(row.ProductCode)),
      quantity: numeric(fieldValue(row.Quantity)),
      unit: cleanText(fieldValue(row.Unit)),
      unit_price: numeric(fieldValue(row.UnitPrice)),
      confidence: confidence(row.Description?.confidence ?? item?.confidence),
      source_page: typeof regions[0]?.pageNumber === 'number' ? regions[0].pageNumber : null,
      source_bbox: Array.isArray(polygon) ? polygon : null,
    };
  }).filter(line => line.description || line.supplier_sku);
}

async function callAzureDocumentIntelligence(file: ArrayBuffer, mimeType: string) {
  const endpoint = Deno.env.get('AZURE_DI_ENDPOINT')?.replace(/\/$/, '');
  const key = Deno.env.get('AZURE_DI_KEY');
  if (!endpoint || !key) throw new Error('Azure Document Intelligence is not configured. Set AZURE_DI_ENDPOINT and AZURE_DI_KEY.');

  const analyzeUrl = `${endpoint}/documentintelligence/documentModels/prebuilt-invoice:analyze?api-version=2024-11-30`;
  const started = Date.now();
  const analyze = await fetch(analyzeUrl, {
    method: 'POST',
    headers: { 'Ocp-Apim-Subscription-Key': key, 'Content-Type': mimeType },
    body: file,
  });
  if (!analyze.ok) throw new Error(`Document scanning failed (${analyze.status}). Check the Azure endpoint and document format.`);
  let result: any;
  if (analyze.status === 200) result = await analyze.json();
  else {
    const operation = analyze.headers.get('operation-location');
    if (!operation) throw new Error('Document scanning did not return a result location.');
    const deadline = Date.now() + 75_000;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 1_500));
      const poll = await fetch(operation, { headers: { 'Ocp-Apim-Subscription-Key': key } });
      if (!poll.ok) throw new Error(`Document scan polling failed (${poll.status}).`);
      result = await poll.json();
      if (result.status === 'succeeded') break;
      if (result.status === 'failed' || result.status === 'canceled') throw new Error('Azure could not read this document. Try a clearer image or PDF.');
    }
    if (result?.status !== 'succeeded') throw new Error('Document scanning is taking longer than expected. Retry processing in a moment.');
  }
  return { result, durationMs: Date.now() - started };
}

async function callPaddleOCR(file: ArrayBuffer, mimeType: string) {
  const endpoint = Deno.env.get('PADDLE_OCR_URL');
  if (!endpoint) throw new Error('PaddleOCR fallback is not configured. Set PADDLE_OCR_URL.');
  const apiKey = Deno.env.get('PADDLE_OCR_API_KEY');
  const started = Date.now();
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': mimeType, ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
    body: file,
  });
  if (!response.ok) throw new Error(`PaddleOCR fallback failed (${response.status}).`);
  const result = await response.json();
  if (typeof result?.text !== 'string') throw new Error('PaddleOCR adapter must return { text, lines }.');
  const lines: ExtractedLine[] = Array.isArray(result.lines) ? result.lines.map((line: any) => ({
    description: cleanText(line.description) || '', supplier_sku: cleanText(line.supplier_sku),
    quantity: numeric(line.quantity), unit: cleanText(line.unit), unit_price: numeric(line.unit_price),
    confidence: confidence(line.confidence), source_page: numeric(line.source_page), source_bbox: line.source_bbox ?? null,
  })).filter((line: ExtractedLine) => line.description || line.supplier_sku) : [];
  return { result: { text: result.text, lines, structured: result.structured || {} }, durationMs: Date.now() - started };
}

function openAiText(response: any): string | null {
  for (const output of response?.output || []) {
    for (const content of output?.content || []) {
      if (content?.type === 'output_text' && typeof content.text === 'string') return content.text;
    }
  }
  return null;
}

async function extractWithOpenAI(ocrText: string, azureFields: any) {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) return null;
  const model = Deno.env.get('OPENAI_MODEL') || 'gpt-4o-mini';
  const inputText = redactPersonalData(ocrText).slice(0, 45_000);
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      store: false,
      input: [{ role: 'user', content: [{ type: 'input_text', text: `Extract the supplier document fields and line items. Do not infer missing values. Return null for unknown numeric/date fields. Preserve the supplier's product description and SKU.\n\nDocument text:\n${inputText}` }] }],
      text: { format: { type: 'json_schema', name: 'supplier_document', strict: true, schema: {
        type: 'object', additionalProperties: false,
        properties: {
          invoice_number: { type: ['string', 'null'] }, supplier_name: { type: ['string', 'null'] },
          document_date: { type: ['string', 'null'] }, currency: { type: ['string', 'null'] },
          total: { type: ['number', 'null'] },
          items: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
            description: { type: 'string' }, supplier_sku: { type: ['string', 'null'] },
            quantity: { type: ['number', 'null'] }, unit: { type: ['string', 'null'] },
            unit_price: { type: ['number', 'null'] }, confidence: { type: 'number' },
          }, required: ['description', 'supplier_sku', 'quantity', 'unit', 'unit_price', 'confidence'] } },
        }, required: ['invoice_number', 'supplier_name', 'document_date', 'currency', 'total', 'items'],
      } } },
    }),
  });
  if (!response.ok) throw new Error(`Structured extraction failed (${response.status}).`);
  const parsed = JSON.parse(openAiText(await response.json()) || 'null');
  if (!parsed || !Array.isArray(parsed.items)) throw new Error('Structured extraction returned an invalid result.');
  const azureLinesFound = azureLines({ documents: [{ fields: azureFields }] });
  const lines: ExtractedLine[] = parsed.items.map((line: any, index: number) => ({
    description: cleanText(line.description) || '', supplier_sku: cleanText(line.supplier_sku),
    quantity: numeric(line.quantity), unit: cleanText(line.unit), unit_price: numeric(line.unit_price),
    confidence: confidence(line.confidence), source_page: azureLinesFound[index]?.source_page ?? null,
    source_bbox: azureLinesFound[index]?.source_bbox ?? null,
  })).filter((line: ExtractedLine) => line.description || line.supplier_sku);
  return { parsed, lines, model };
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authorization = request.headers.get('authorization');
  const tenantId = request.headers.get('x-tenant-id');
  if (!authorization?.startsWith('Bearer ') || !tenantId) return json({ error: 'A signed-in workspace session is required.' }, 401);
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !supabaseKey) return json({ error: 'Supabase function configuration is incomplete.' }, 500);
  const client = createClient(supabaseUrl, supabaseKey, { global: { headers: { Authorization: authorization, 'x-tenant-id': tenantId } } });
  const token = authorization.slice('Bearer '.length);
  const { data: userData, error: userError } = await client.auth.getUser(token);
  if (userError || !userData.user) return json({ error: 'Session is invalid or expired.' }, 401);
  const { data: membership, error: membershipError } = await client.rpc('get_current_tenant_membership');
  if (membershipError || !Array.isArray(membership) || membership[0]?.role !== 'admin' || membership[0]?.status !== 'active') {
    return json({ error: 'Administrator access is required to process supplier documents.' }, 403);
  }

  let body: { document_id?: string };
  try { body = await request.json(); } catch { return json({ error: 'Request body must be JSON.' }, 400); }
  if (!body.document_id) return json({ error: 'document_id is required.' }, 400);

  const { data: document, error: documentError } = await client.from('receiving_documents').select('*')
    .eq('tenant_id', tenantId).eq('id', body.document_id).maybeSingle();
  if (documentError || !document) return json({ error: 'Document was not found in this workspace.' }, 404);
  if (['posted', 'rejected', 'archived'].includes(document.status)) return json({ error: 'This document cannot be processed.' }, 409);

  let job = (await client.from('automation_jobs').select('id, attempts, max_attempts').eq('tenant_id', tenantId)
    .eq('source_id', document.id).eq('job_type', 'document.process').in('status', ['queued', 'failed'])
    .order('created_at', { ascending: false }).limit(1).maybeSingle()).data;
  if (!job) {
    const { error } = await client.rpc('enqueue_document_processing', { p_document_id: document.id, p_reprocess: true });
    if (error) return json({ error: error.message }, 409);
    job = (await client.from('automation_jobs').select('id, attempts, max_attempts').eq('tenant_id', tenantId)
      .eq('source_id', document.id).eq('job_type', 'document.process').eq('status', 'queued')
      .order('created_at', { ascending: false }).limit(1).maybeSingle()).data;
  }
  if (!job) return json({ error: 'No processing job could be queued.' }, 409);
  if ((job.attempts || 0) >= (job.max_attempts || 5)) {
    await client.from('automation_jobs').update({ status: 'dead_letter', last_error: 'Maximum processing attempts reached.' }).eq('id', job.id);
    return json({ error: 'Maximum processing attempts reached. Create an explicit reprocess from the document review queue.' }, 409);
  }
  const { data: claimed, error: claimError } = await client.rpc('claim_receiving_document_job', { p_job_id: job.id });
  if (claimError || !claimed) return json({ error: claimError?.message || 'Document processing is already running or unavailable.' }, 409);

  const { data: previousAttempts } = await client.from('document_extraction_attempts').select('attempt_no')
    .eq('tenant_id', tenantId).eq('document_id', document.id).order('attempt_no', { ascending: false }).limit(1);
  const attemptNo = (previousAttempts?.[0]?.attempt_no || 0) + 1;
  const startedAt = new Date().toISOString();
  const { data: attempt, error: attemptError } = await client.from('document_extraction_attempts').insert({
    tenant_id: tenantId, document_id: document.id, attempt_no: attemptNo, engine: 'azure-document-intelligence', status: 'running', started_at: startedAt,
  }).select('id').single();
  if (attemptError) {
    await client.from('automation_jobs').update({ status: 'failed', attempts: (job.attempts || 0) + 1, last_error: attemptError.message, locked_at: null, locked_by: null }).eq('id', job.id);
    return json({ error: attemptError.message }, 500);
  }
  try {
    const { data: file, error: downloadError } = await client.storage.from('receiving-documents').download(document.storage_path);
    if (downloadError || !file) throw new Error('Private source document could not be downloaded.');
    if (file.size > 20 * 1024 * 1024) throw new Error('Source document exceeds the 20 MB limit.');
    const fileBytes = await file.arrayBuffer();
    const signature = new Uint8Array(fileBytes.slice(0, 12));
    const textAt = (start: number, end: number) => String.fromCharCode(...signature.slice(start, end));
    const validSignature = document.mime_type === 'application/pdf' ? textAt(0, 5) === '%PDF-'
      : document.mime_type === 'image/jpeg' ? signature[0] === 0xff && signature[1] === 0xd8 && signature[2] === 0xff
      : document.mime_type === 'image/png' ? [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => signature[index] === byte)
      : document.mime_type === 'image/webp' ? textAt(0, 4) === 'RIFF' && textAt(8, 12) === 'WEBP' : false;
    if (!validSignature) throw new Error('File contents do not match the document type.');
    const { error: statusError } = await client.rpc('set_receiving_document_processing_state', {
      p_document_id: document.id, p_status: 'scanning', p_error: null, p_page_count: null,
    });
    if (statusError) throw new Error(statusError.message);
    const { data: settings } = await client.from('automation_settings').select('ocr_provider, llm_provider').eq('tenant_id', tenantId).maybeSingle();
    let provider = settings?.ocr_provider || 'azure';
    let result: any;
    let durationMs = 0;
    if (provider === 'paddle') {
      const paddle = await callPaddleOCR(fileBytes, document.mime_type);
      result = { paddle: paddle.result }; durationMs = paddle.durationMs;
    } else if (provider === 'manual') {
      throw new Error('Automatic scanning is set to manual. Review the document lines by hand.');
    } else {
      try {
        const azure = await callAzureDocumentIntelligence(fileBytes, document.mime_type);
        result = { azure: azure.result }; durationMs = azure.durationMs;
      } catch (azureError) {
        if (!Deno.env.get('PADDLE_OCR_URL')) throw azureError;
        const paddle = await callPaddleOCR(fileBytes, document.mime_type);
        result = { paddle: paddle.result }; durationMs = paddle.durationMs; provider = 'paddle-fallback';
      }
    }
    const azureResult = result?.azure?.analyzeResult || result?.azure || null;
    const paddleResult = result?.paddle || null;
    const azureFields = azureResult?.documents?.[0]?.fields || {};
    const rawOcr = paddleResult?.text || (typeof azureResult?.content === 'string' ? azureResult.content
      : (azureResult?.pages || []).flatMap((page: any) => page.lines || []).map((line: any) => line.content).filter(Boolean).join('\n'));
    if (!rawOcr.trim()) throw new Error('The scanner could not find readable text in this document.');
    const { error: extractingError } = await client.rpc('set_receiving_document_processing_state', {
      p_document_id: document.id, p_status: 'extracting', p_error: null, p_page_count: azureResult?.pages?.length || null,
    });
    if (extractingError) throw new Error(extractingError.message);

    let ai: Awaited<ReturnType<typeof extractWithOpenAI>> = null;
    let aiWarning: string | null = null;
    const llmProvider = settings?.llm_provider || 'openai';
    try {
      if (llmProvider === 'openai') ai = await extractWithOpenAI(rawOcr, azureFields);
    }
    catch { aiWarning = 'Structured extraction was unavailable; scanner output was retained for manual review.'; }
    const lines = ai?.lines || paddleResult?.lines || azureLines(azureResult);
    const invoiceNumber = cleanText(ai?.parsed?.invoice_number) || cleanText(paddleResult?.structured?.invoice_number) || cleanText(fieldValue(azureFields.InvoiceId));
    const supplierName = cleanText(ai?.parsed?.supplier_name) || cleanText(paddleResult?.structured?.supplier_name) || cleanText(fieldValue(azureFields.VendorName));
    const currency = cleanText(ai?.parsed?.currency) || cleanText(paddleResult?.structured?.currency) || cleanText(fieldValue(azureFields.CurrencyCode));
    const confidenceOverall = lines.length ? lines.reduce((total, line) => total + line.confidence, 0) / lines.length : 0;
    const warnings: string[] = aiWarning ? [aiWarning] : [];
    if (!lines.length) warnings.push('No line items were detected. Add receipt lines manually during review.');
    if (!invoiceNumber) warnings.push('No invoice or reference number was detected.');
    const structured = {
      invoice_number: invoiceNumber,
      supplier_name: supplierName,
      document_date: ai?.parsed?.document_date || paddleResult?.structured?.document_date || fieldValue(azureFields.InvoiceDate) || null,
      language: cleanText(paddleResult?.structured?.language) || cleanText(azureResult?.languages?.[0]?.locale) || cleanText(azureResult?.documents?.[0]?.locale),
      currency,
      total: numeric(ai?.parsed?.total) ?? numeric(paddleResult?.structured?.total) ?? numeric(fieldValue(azureFields.InvoiceTotal)),
    };
    const boundedLines = lines.slice(0, 500).map(line => ({
      description: line.description,
      supplier_sku: line.supplier_sku,
      quantity: line.quantity,
      unit: line.unit,
      unit_price: line.unit_price,
      confidence: line.confidence,
      source_page: line.source_page,
      source_bbox: line.source_bbox,
    }));
    const { error: saveError } = await client.rpc('save_document_extraction_result', {
      p_document_id: document.id,
      p_engine: ai ? `${provider}+openai` : provider === 'azure' ? 'azure-document-intelligence' : provider,
      p_raw_text: redactPersonalData(rawOcr).slice(0, 100_000),
      p_structured: structured,
      p_confidence: confidenceOverall,
      p_warnings: warnings,
      p_model_version: ai?.model || (provider.includes('paddle') ? 'paddle-adapter' : 'prebuilt-invoice/2024-11-30'),
      p_duration_ms: durationMs,
      p_lines: boundedLines,
    });
    if (saveError) throw new Error(saveError.message);
    const finishedAt = new Date().toISOString();
    await client.from('document_extraction_attempts').update({ status: 'succeeded', engine: provider, finished_at: finishedAt, duration_ms: durationMs }).eq('id', attempt.id);
    await client.from('automation_jobs').update({ status: 'succeeded', finished_at: finishedAt, locked_at: null, locked_by: null, last_error: null }).eq('id', job.id);
    return json({ status: 'extracted', line_count: boundedLines.length, warnings });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Document processing failed.';
    const finishedAt = new Date().toISOString();
    await client.from('document_extraction_attempts').update({ status: 'failed', error: message.slice(0, 1000), finished_at: finishedAt }).eq('id', attempt.id);
    const terminal = (job.attempts || 0) + 1 >= (job.max_attempts || 5);
    await client.from('automation_jobs').update({ status: terminal ? 'dead_letter' : 'failed', finished_at: finishedAt, locked_at: null, locked_by: null, last_error: message.slice(0, 1000) }).eq('id', job.id);
    await client.rpc('set_receiving_document_processing_state', {
      p_document_id: document.id, p_status: 'extraction_failed', p_error: message.slice(0, 1000), p_page_count: null,
    });
    return json({ error: message }, 502);
  }
});
