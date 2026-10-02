import { useCallback, useEffect, useState } from 'react';
import { Activity, AlertTriangle, Bell, Check, Clock3, Power, RefreshCw, ShieldCheck, Workflow } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { useToast } from '@/components/ui/Toast';
import { supabase, getActiveTenantId } from '@/lib/supabase';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { formatDateTime } from '@/lib/utils';
import type { Supplier } from '@/types';

type Job = { id: string; job_type: string; source_id: string | null; status: string; attempts: number; last_error: string | null; created_at: string };
type Anomaly = { id: string; severity: string; category: string; subject_type: string; detected_at: string; details: Record<string, unknown> };
type Notice = { id: string; channel: string; severity: string; title: string; body: string; status: string; read_at: string | null; created_at: string };
type ReconciliationRun = { id: string; report_date: string; status: string; summary: Record<string, unknown>; started_at: string; error: string | null };
type InboundRoute = { id: string; channel: 'WHATSAPP' | 'EMAIL'; route_key: string; supplier_id: string | null; is_active: boolean; supplier?: Pick<Supplier, 'name'> };
type InboundSender = { id: string; channel: 'WHATSAPP' | 'EMAIL'; sender_address: string; supplier_id: string | null; is_active: boolean; supplier?: Pick<Supplier, 'name'> };
type Scorecard = { id: string; supplier_id: string; period_start: string; period_end: string; on_time_pct: number | null; accuracy_pct: number | null; dispute_rate_pct: number | null; avg_response_hours: number | null; price_competitiveness: number | null; overall_rating: number | null; supplier?: Pick<Supplier, 'name'> };
type AutomationSettings = { ocr_provider: 'azure' | 'paddle' | 'manual'; llm_provider: 'openai' | 'none'; auto_match_confidence: number; qty_tolerance_pct: number; price_tolerance_pct: number };
const defaultSettings: AutomationSettings = { ocr_provider: 'azure', llm_provider: 'openai', auto_match_confidence: 0.97, qty_tolerance_pct: 2, price_tolerance_pct: 1 };

const cardClass = 'rounded-md border border-ink-100 bg-paper shadow-xs';

export function Automation() {
  const { showToast } = useToast();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [runs, setRuns] = useState<ReconciliationRun[]>([]);
  const [routes, setRoutes] = useState<InboundRoute[]>([]);
  const [senders, setSenders] = useState<InboundSender[]>([]);
  const [scorecards, setScorecards] = useState<Scorecard[]>([]);
  const [settings, setSettings] = useState<AutomationSettings>(defaultSettings);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [inboundChannel, setInboundChannel] = useState<'WHATSAPP' | 'EMAIL'>('WHATSAPP');
  const [routeKey, setRouteKey] = useState('');
  const [senderAddress, setSenderAddress] = useState('');
  const [routeSupplierId, setRouteSupplierId] = useState('');
  const [senderSupplierId, setSenderSupplierId] = useState('');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [chain, setChain] = useState<{ valid?: boolean; checked?: number; first_broken_id?: string | null } | null>(null);

  const loadData = useCallback(async () => {
    const [jobResult, anomalyResult, noticeResult, runResult, routeResult, senderResult, supplierResult, scorecardResult, settingsResult] = await Promise.all([
      supabase.from('automation_jobs').select('id, job_type, source_id, status, attempts, last_error, created_at').order('created_at', { ascending: false }).limit(30),
      supabase.from('anomaly_flags').select('id, severity, category, subject_type, detected_at, details').eq('status', 'OPEN').order('detected_at', { ascending: false }).limit(30),
      supabase.from('system_notifications').select('id, channel, severity, title, body, status, read_at, created_at').order('created_at', { ascending: false }).limit(20),
      supabase.from('reconciliation_runs').select('id, report_date, status, summary, started_at, error').order('started_at', { ascending: false }).limit(10),
      supabase.from('inbound_channel_routes').select('*, supplier:suppliers(name)').order('created_at', { ascending: false }),
      supabase.from('inbound_sender_allowlist').select('*, supplier:suppliers(name)').order('created_at', { ascending: false }),
      supabase.from('suppliers').select('*').order('name'),
      supabase.from('supplier_scorecards').select('*, supplier:suppliers(name)').order('period_end', { ascending: false }).limit(25),
      supabase.from('automation_settings').select('*').maybeSingle(),
    ]);
    const failed = [jobResult, anomalyResult, noticeResult, runResult, routeResult, senderResult, supplierResult, scorecardResult, settingsResult].find(result => result.error);
    if (failed?.error) showToast(`Could not load automation data: ${failed.error.message}`, 'error');
    setJobs((jobResult.data || []) as Job[]);
    setAnomalies((anomalyResult.data || []) as Anomaly[]);
    setNotices((noticeResult.data || []) as Notice[]);
    setRuns((runResult.data || []) as ReconciliationRun[]);
    setRoutes((routeResult.data || []) as unknown as InboundRoute[]);
    setSenders((senderResult.data || []) as unknown as InboundSender[]);
    setSuppliers((supplierResult.data || []) as Supplier[]);
    setScorecards((scorecardResult.data || []) as unknown as Scorecard[]);
    if (settingsResult.data) setSettings({
      ocr_provider: settingsResult.data.ocr_provider,
      llm_provider: settingsResult.data.llm_provider === 'none' ? 'none' : 'openai',
      auto_match_confidence: Number(settingsResult.data.auto_match_confidence),
      qty_tolerance_pct: Number(settingsResult.data.qty_tolerance_pct),
      price_tolerance_pct: Number(settingsResult.data.price_tolerance_pct),
    });
    setLoading(false);
  }, [showToast]);

  const saveInboundRoute = async () => {
    const tenantId = getActiveTenantId();
    if (!tenantId || !routeKey.trim() || !senderAddress.trim()) {
      showToast('Enter both the inbound address/phone route and an approved sender', 'error'); return;
    }
    if (inboundChannel === 'EMAIL' && !routeSupplierId && !senderSupplierId) {
      showToast('Map the approved email sender or route to a supplier.', 'error'); return;
    }
    const { data: authData } = await supabase.auth.getUser();
    const route = inboundChannel === 'EMAIL' ? routeKey.trim().toLowerCase() : routeKey.trim().replace(/\D/g, '');
    const sender = inboundChannel === 'EMAIL' ? senderAddress.trim().toLowerCase() : senderAddress.trim().replace(/\D/g, '');
    const { error: routeError } = await supabase.from('inbound_channel_routes').upsert({
      tenant_id: tenantId, channel: inboundChannel, route_key: route, supplier_id: routeSupplierId || null,
      created_by: authData.user?.id || null, is_active: true,
    }, { onConflict: 'tenant_id,channel,route_key' });
    if (routeError) { showToast(routeError.message, 'error'); return; }
    const { error: senderError } = await supabase.from('inbound_sender_allowlist').upsert({
      tenant_id: tenantId, channel: inboundChannel, sender_address: sender, supplier_id: senderSupplierId || null, is_active: true,
    }, { onConflict: 'tenant_id,channel,sender_address' });
    if (senderError) showToast(senderError.message, 'error');
    else {
      setRouteKey(''); setSenderAddress(''); setRouteSupplierId(''); setSenderSupplierId('');
      showToast('Inbound route and approved sender saved', 'success');
      await loadData();
    }
  };

  const toggleInboundRecord = async (table: 'inbound_channel_routes' | 'inbound_sender_allowlist', id: string, active: boolean) => {
    const { error } = await supabase.from(table).update({ is_active: !active }).eq('id', id);
    if (error) showToast(`Could not update inbound access: ${error.message}`, 'error');
    else { showToast(active ? 'Inbound access disabled' : 'Inbound access enabled', 'success'); await loadData(); }
  };

  useEffect(() => { void loadData(); }, [loadData]);
  useRealtimeRefresh(loadData);

  const runReconciliation = async () => {
    setWorking(true);
    const reportDate = new Date().toLocaleDateString('en-CA');
    const { data: runId, error } = await supabase.rpc('run_receiving_reconciliation', { p_report_date: reportDate });
    if (error) showToast(error.message, 'error');
    else {
      const { data: run } = await supabase.from('reconciliation_runs').select('status, error').eq('id', runId).maybeSingle();
      if (run?.status === 'failed') showToast(`Receiving reconciliation failed: ${run.error || 'Unknown error'}`, 'error');
      else showToast('Receiving reconciliation completed', 'success');
      await loadData();
    }
    setWorking(false);
  };

  const verifyLedger = async () => {
    const tenantId = getActiveTenantId();
    if (!tenantId) { showToast('Select a business workspace first', 'error'); return; }
    setWorking(true);
    const { data, error } = await supabase.rpc('verify_stock_movement_chain', { p_tenant_id: tenantId });
    if (error) showToast(error.message, 'error');
    else {
      setChain(data as typeof chain);
      showToast(data?.valid ? `Ledger verified: ${data.checked} movement(s)` : 'Ledger verification found a broken link', data?.valid ? 'success' : 'error');
    }
    setWorking(false);
  };

  const refreshScorecards = async () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1).toLocaleDateString('en-CA');
    const end = now.toLocaleDateString('en-CA');
    setWorking(true);
    const { error } = await supabase.rpc('refresh_supplier_scorecards', { p_period_start: start, p_period_end: end });
    if (error) showToast(error.message, 'error');
    else { showToast('Supplier scorecards refreshed', 'success'); await loadData(); }
    setWorking(false);
  };

  const saveSettings = async () => {
    const tenantId = getActiveTenantId();
    if (!tenantId || settings.auto_match_confidence < 0 || settings.auto_match_confidence > 1
      || settings.qty_tolerance_pct < 0 || settings.qty_tolerance_pct > 100
      || settings.price_tolerance_pct < 0 || settings.price_tolerance_pct > 100
      || !Number.isFinite(settings.auto_match_confidence) || !Number.isFinite(settings.qty_tolerance_pct)
      || !Number.isFinite(settings.price_tolerance_pct)) {
      showToast('Choose matching thresholds within their allowed ranges.', 'error'); return;
    }
    const { data: authData } = await supabase.auth.getUser();
    const { error } = await supabase.from('automation_settings').upsert({
      tenant_id: tenantId, ...settings, auto_approve_enabled: false,
      updated_by: authData.user?.id || null, updated_at: new Date().toISOString(),
    }, { onConflict: 'tenant_id' });
    if (error) showToast(`Could not save automation settings: ${error.message}`, 'error');
    else showToast('Automation settings saved', 'success');
  };

  const resolveAnomaly = async (anomaly: Anomaly) => {
    const resolution = window.prompt(`Resolution for ${anomaly.category.replace(/_/g, ' ')}:`);
    if (!resolution?.trim()) return;
    const { error } = await supabase.rpc('resolve_anomaly', { p_anomaly_id: anomaly.id, p_resolution: resolution.trim() });
    if (error) showToast(error.message, 'error');
    else { showToast('Anomaly resolved', 'success'); await loadData(); }
  };

  const markRead = async (notice: Notice) => {
    const { error } = await supabase.rpc('mark_system_notification_read', { p_notification_id: notice.id });
    if (error) showToast(error.message, 'error');
    else setNotices(current => current.map(item => item.id === notice.id ? { ...item, read_at: new Date().toISOString() } : item));
  };

  const retryJob = async (job: Job) => {
    if (job.job_type !== 'document.process' || !job.source_id) return;
    setWorking(true);
    const { data, error } = await supabase.functions.invoke('process-receiving-document', { body: { document_id: job.source_id } });
    if (error) showToast(error.message, 'error');
    else if (data?.error) showToast(data.error, 'error');
    else showToast('Document processing completed', 'success');
    await loadData();
    setWorking(false);
  };

  if (loading) return <div className="flex min-h-[50vh] items-center justify-center"><div className="h-9 w-9 animate-spin rounded-full border-2 border-ink-200 border-t-accent-500" /></div>;

  return <div className="mx-auto max-w-7xl space-y-6 pb-10">
    <PageHeader title="Automation & controls" subtitle="Monitor document processing, supplier exceptions, and stock integrity." actions={<button onClick={() => void loadData()} className="inline-flex items-center gap-2 rounded-sm border border-ink-200 bg-paper px-3 py-2.5 text-sm font-semibold text-ink-700 hover:bg-ink-50"><RefreshCw size={15} /> Refresh</button>} />

    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Metric icon={Workflow} label="Queued or failed jobs" value={jobs.filter(job => ['queued', 'failed', 'dead_letter'].includes(job.status)).length} tone="blue" />
      <Metric icon={AlertTriangle} label="Open anomalies" value={anomalies.length} tone={anomalies.length ? 'rose' : 'green'} />
      <Metric icon={Bell} label="Unread notifications" value={notices.filter(notice => !notice.read_at).length} tone="amber" />
      <Metric icon={Activity} label="Latest reconciliation" value={runs[0]?.report_date || '—'} tone="slate" />
    </div>

    <section className={`${cardClass} p-4 sm:p-5`}>
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center"><div><h2 className="text-ink-900 font-semibold font-display">Daily controls</h2><p className="mt-1 text-sm text-ink-500">Reconcile receipt variances, run ledger verification, and refresh supplier ratings.</p></div><div className="flex flex-wrap gap-2">
        <button onClick={() => void runReconciliation()} disabled={working} className="rounded-sm bg-accent-500 px-3.5 py-2.5 text-sm font-semibold text-white hover:bg-accent-700 disabled:opacity-50">Run reconciliation</button>
        <button onClick={() => void verifyLedger()} disabled={working} className="inline-flex items-center gap-2 rounded-sm border border-ink-200 px-3.5 py-2.5 text-sm font-semibold text-ink-700 hover:bg-ink-50 disabled:opacity-50"><ShieldCheck size={15} /> Verify stock ledger</button>
        <button onClick={() => void refreshScorecards()} disabled={working} className="rounded-sm border border-ink-200 px-3.5 py-2.5 text-sm font-semibold text-ink-700 hover:bg-ink-50 disabled:opacity-50">Refresh scorecards</button>
      </div></div>
      {chain && <p className={`mt-4 rounded-md px-3 py-2 text-sm ${chain.valid ? 'bg-accent-50 text-accent-900' : 'bg-danger/10 text-danger'}`}>{chain.valid ? `Ledger chain is valid across ${chain.checked || 0} stock movements.` : `Ledger chain failed at movement ${chain.first_broken_id || 'unknown'}.`}</p>}
    </section>

    <section className={`${cardClass} p-4 sm:p-5`}>
      <div className="mb-4"><h2 className="text-ink-900 font-semibold font-display">Processing settings</h2><p className="mt-1 text-sm text-ink-500">Choose the configured scan and extraction providers and set review matching thresholds.</p></div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs font-semibold text-ink-600">OCR provider<select value={settings.ocr_provider} onChange={event => setSettings(value => ({ ...value, ocr_provider: event.target.value as AutomationSettings['ocr_provider'] }))} className="mt-1.5 w-full rounded-sm border px-3 py-2.5 text-sm font-normal h-10 border-ink-200 bg-paper focus:border-accent-500"><option value="azure">Azure Document Intelligence</option><option value="paddle">PaddleOCR adapter</option><option value="manual">Manual review</option></select></label>
        <label className="text-xs font-semibold text-ink-600">Structured extraction<select value={settings.llm_provider} onChange={event => setSettings(value => ({ ...value, llm_provider: event.target.value as AutomationSettings['llm_provider'] }))} className="mt-1.5 w-full rounded-sm border px-3 py-2.5 text-sm font-normal h-10 border-ink-200 bg-paper focus:border-accent-500"><option value="openai">OpenAI (optional key)</option><option value="none">Disabled</option></select></label>
        <label className="text-xs font-semibold text-ink-600">Automatic match confidence<input type="number" min="0" max="1" step="0.01" value={settings.auto_match_confidence} onChange={event => setSettings(value => ({ ...value, auto_match_confidence: Number(event.target.value) }))} className="mt-1.5 w-full rounded-sm border px-3 py-2.5 text-sm font-normal h-10 border-ink-200 bg-paper focus:border-accent-500 font-mono tabular-nums" /></label>
        <label className="text-xs font-semibold text-ink-600">Quantity tolerance (%)<input type="number" min="0" max="100" step="0.1" value={settings.qty_tolerance_pct} onChange={event => setSettings(value => ({ ...value, qty_tolerance_pct: Number(event.target.value) }))} className="mt-1.5 w-full rounded-sm border px-3 py-2.5 text-sm font-normal h-10 border-ink-200 bg-paper focus:border-accent-500 font-mono tabular-nums" /></label>
        <label className="text-xs font-semibold text-ink-600">Price tolerance (%)<input type="number" min="0" max="100" step="0.1" value={settings.price_tolerance_pct} onChange={event => setSettings(value => ({ ...value, price_tolerance_pct: Number(event.target.value) }))} className="mt-1.5 w-full rounded-sm border px-3 py-2.5 text-sm font-normal h-10 border-ink-200 bg-paper focus:border-accent-500 font-mono tabular-nums" /></label>
      </div>
      <div className="mt-3 flex flex-col justify-between gap-3 border-t border-ink-100 pt-3 sm:flex-row sm:items-center"><p className="text-xs text-ink-500">Every extracted receipt still requires an administrator review before stock is posted.</p><button onClick={() => void saveSettings()} disabled={working} className="rounded-sm bg-accent-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-700 disabled:opacity-50">Save settings</button></div>
    </section>

    <section className={`${cardClass} p-4 sm:p-5`}>
      <div className="mb-4"><h2 className="text-ink-900 font-semibold font-display">Inbound document routing</h2><p className="mt-1 text-sm text-ink-500">Connect an approved receiving address or WhatsApp number to supplier accounts.</p></div>
      <div className="grid gap-3 lg:grid-cols-2">
        <label className="text-xs font-semibold text-ink-600">Channel<select value={inboundChannel} onChange={event => setInboundChannel(event.target.value as 'WHATSAPP' | 'EMAIL')} className="mt-1.5 w-full rounded-sm border px-3 py-2.5 text-sm font-normal h-10 border-ink-200 bg-paper focus:border-accent-500"><option value="WHATSAPP">WhatsApp Cloud API</option><option value="EMAIL">Inbound email</option></select></label>
        <label className="text-xs font-semibold text-ink-600">{inboundChannel === 'WHATSAPP' ? 'Meta phone number ID' : 'Receiving email address'}<input value={routeKey} onChange={event => setRouteKey(event.target.value)} placeholder={inboundChannel === 'WHATSAPP' ? '123456789012345' : 'receiving@example.com'} className="mt-1.5 w-full rounded-sm border px-3 py-2.5 text-sm font-normal h-10 border-ink-200 bg-paper focus:border-accent-500" /></label>
        <label className="text-xs font-semibold text-ink-600">Approved sender phone or email<input value={senderAddress} onChange={event => setSenderAddress(event.target.value)} placeholder={inboundChannel === 'WHATSAPP' ? '+254700000000' : 'supplier@example.com'} className="mt-1.5 w-full rounded-sm border px-3 py-2.5 text-sm font-normal h-10 border-ink-200 bg-paper focus:border-accent-500" /></label>
        <label className="text-xs font-semibold text-ink-600">Route supplier (optional)<select value={routeSupplierId} onChange={event => setRouteSupplierId(event.target.value)} className="mt-1.5 w-full rounded-sm border px-3 py-2.5 text-sm font-normal h-10 border-ink-200 bg-paper focus:border-accent-500"><option value="">Identify supplier by approved sender</option>{suppliers.map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
        <label className="text-xs font-semibold text-ink-600">Sender supplier (optional)<select value={senderSupplierId} onChange={event => setSenderSupplierId(event.target.value)} className="mt-1.5 w-full rounded-sm border px-3 py-2.5 text-sm font-normal h-10 border-ink-200 bg-paper focus:border-accent-500"><option value="">Use route supplier / WhatsApp #supplier code</option>{suppliers.map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
      </div>
      <div className="mt-3 flex justify-end"><button onClick={() => void saveInboundRoute()} className="rounded-sm bg-accent-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-700">Save route</button></div>
      {(routes.length > 0 || senders.length > 0) && <div className="mt-4 grid gap-4 border-t border-ink-100 pt-4 md:grid-cols-2"><div><p className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-500">Receiving routes</p>{routes.map(route => <div key={route.id} className="flex items-center justify-between gap-2 py-1.5"><p className="min-w-0 truncate text-xs text-ink-700">{route.channel} · {route.route_key} · {route.supplier?.name || 'Supplier selected by sender'} · {route.is_active ? 'active' : 'disabled'}</p><button onClick={() => void toggleInboundRecord('inbound_channel_routes', route.id, route.is_active)} className="shrink-0 rounded-sm p-1 text-ink-500 hover:bg-ink-100" title={route.is_active ? 'Disable route' : 'Enable route'}><Power size={14} /></button></div>)}</div><div><p className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-500">Approved senders</p>{senders.map(sender => <div key={sender.id} className="flex items-center justify-between gap-2 py-1.5"><p className="min-w-0 truncate text-xs text-ink-700">{sender.channel} · {sender.sender_address} · {sender.supplier?.name || 'Use route supplier'} · {sender.is_active ? 'active' : 'disabled'}</p><button onClick={() => void toggleInboundRecord('inbound_sender_allowlist', sender.id, sender.is_active)} className="shrink-0 rounded-sm p-1 text-ink-500 hover:bg-ink-100" title={sender.is_active ? 'Disable sender' : 'Enable sender'}><Power size={14} /></button></div>)}</div></div>}
    </section>

    <div className="grid gap-5 xl:grid-cols-2">
      <section className={cardClass}>
        <SectionTitle icon={Workflow} title="Processing jobs" subtitle="Latest queued, completed, and failed work." />
        {jobs.length ? <div className="divide-y divide-ink-100">{jobs.map(job => <div key={job.id} className="flex items-start justify-between gap-3 px-5 py-3.5"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-semibold text-ink-800">{job.job_type.replace(/\./g, ' ')}</span><Badge value={job.status} /></div><p className="mt-1 text-xs text-ink-500" data-numeric>{job.source_id ? `Source ${job.source_id.slice(0, 8)} · ` : ''}{job.attempts} attempt(s) · {formatDateTime(job.created_at)}</p>{job.last_error && <p className="mt-1 text-xs text-danger">{job.last_error}</p>}</div>{['failed', 'dead_letter'].includes(job.status) && job.job_type === 'document.process' && <button onClick={() => void retryJob(job)} disabled={working} className="shrink-0 rounded-sm bg-accent-50 px-2.5 py-1.5 text-xs font-semibold text-accent-700 hover:bg-accent-100">Retry</button>}</div>)}</div> : <Empty text="No automation jobs yet." />}
      </section>

      <section className={cardClass}>
        <SectionTitle icon={AlertTriangle} title="Open anomalies" subtitle="Receipt, pricing, and ledger exceptions." />
        {anomalies.length ? <div className="divide-y divide-ink-100">{anomalies.map(anomaly => <div key={anomaly.id} className="flex items-start justify-between gap-3 px-5 py-3.5"><div className="min-w-0"><div className="flex items-center gap-2"><span className="text-sm font-semibold text-ink-800">{anomaly.category.replace(/_/g, ' ')}</span><Badge value={anomaly.severity} /></div><p className="mt-1 text-xs text-ink-500" data-numeric>{anomaly.subject_type} · {formatDateTime(anomaly.detected_at)}</p><p className="mt-1 truncate text-xs text-ink-500">{JSON.stringify(anomaly.details)}</p></div><button onClick={() => void resolveAnomaly(anomaly)} className="shrink-0 rounded-sm border border-ink-200 px-2.5 py-1.5 text-xs font-semibold text-ink-700 hover:bg-ink-50">Resolve</button></div>)}</div> : <Empty text="No open anomalies." />}
      </section>

      <section className={cardClass}>
        <SectionTitle icon={Bell} title="Notifications" subtitle="Workspace messages and processing alerts." />
        {notices.length ? <div className="divide-y divide-ink-100">{notices.map(notice => <div key={notice.id} className="flex items-start gap-3 px-5 py-3.5"><span className={`mt-1 h-2 w-2 rounded-full ${notice.read_at ? 'bg-ink-200' : 'bg-accent-500'}`} /><div className="min-w-0 flex-1"><p className="text-sm font-semibold text-ink-800">{notice.title}</p><p className="mt-0.5 text-xs text-ink-600">{notice.body}</p><p className="mt-1 text-[11px] text-ink-400" data-numeric>{notice.channel} · {formatDateTime(notice.created_at)}</p></div>{!notice.read_at && <button onClick={() => void markRead(notice)} className="rounded-sm p-1.5 text-ink-400 hover:bg-ink-100" title="Mark read"><Check size={15} /></button>}</div>)}</div> : <Empty text="No notifications yet." />}
      </section>

      <section className={cardClass}>
        <SectionTitle icon={Clock3} title="Reconciliation history" subtitle="Manual and scheduled receiving checks." />
        {runs.length ? <div className="divide-y divide-ink-100">{runs.map(run => <div key={run.id} className="flex items-start justify-between gap-3 px-5 py-3.5"><div><p className="text-sm font-semibold text-ink-800" data-numeric>{run.report_date}</p><p className="mt-1 text-xs text-ink-500" data-numeric>{formatDateTime(run.started_at)} · {Number(run.summary?.open_anomalies || 0)} open anomalies</p>{run.error && <p className="mt-1 text-xs text-danger">{run.error}</p>}</div><Badge value={run.status} /></div>)}</div> : <Empty text="No reconciliation has run yet." />}
      </section>

      <section className={cardClass}>
        <SectionTitle icon={Activity} title="Supplier scorecards" subtitle="Latest delivery, receipt accuracy, dispute, response, and price measures." />
        {scorecards.length ? <div className="divide-y divide-ink-100">{scorecards.map(scorecard => <div key={scorecard.id} className="px-5 py-3.5"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-ink-800">{scorecard.supplier?.name || 'Supplier'}</p><p className="mt-1 text-xs text-ink-500">{scorecard.period_start} to {scorecard.period_end}</p></div><span className="rounded-lg bg-accent-50 px-2.5 py-1 text-sm font-bold text-accent-700" data-numeric>{scorecard.overall_rating == null ? '—' : `${Number(scorecard.overall_rating).toFixed(2)} / 5`}</span></div><p className="mt-2 text-xs text-ink-600">On time {formatPct(scorecard.on_time_pct)} · Receipt accuracy {formatPct(scorecard.accuracy_pct)} · Disputes {formatPct(scorecard.dispute_rate_pct)}</p><p className="mt-1 text-xs text-ink-500" data-numeric>Reply {scorecard.avg_response_hours == null ? '—' : `${scorecard.avg_response_hours} h`} · Price competitiveness {formatPct(scorecard.price_competitiveness)}</p></div>)}</div> : <Empty text="Refresh scorecards after receiving deliveries to create the first ratings." />}
      </section>
    </div>
  </div>;
}

function Metric({ icon: Icon, label, value, tone }: { icon: typeof Activity; label: string; value: string | number; tone: 'blue' | 'rose' | 'green' | 'amber' | 'slate' }) {
  const colors = { blue: 'bg-accent-50 text-accent-700', rose: 'bg-danger/10 text-danger', green: 'bg-accent-50 text-accent-700', amber: 'bg-warning/10 text-warning', slate: 'bg-ink-100 text-ink-700' };
  return <div className={`${cardClass} p-4`}><div className="flex items-center justify-between"><p className="text-xs font-semibold uppercase tracking-wide text-ink-500">{label}</p><span className={`rounded-lg p-2 ${colors[tone]}`}><Icon size={16} /></span></div><p className="mt-3 text-2xl font-extrabold text-ink-900">{value}</p></div>;
}

function SectionTitle({ icon: Icon, title, subtitle }: { icon: typeof Activity; title: string; subtitle: string }) {
  return <div className="flex items-start gap-3 border-b border-ink-100 px-5 py-4"><span className="rounded-lg bg-ink-100 p-2 text-ink-600"><Icon size={16} /></span><div><h2 className="text-sm text-ink-900 font-semibold font-display">{title}</h2><p className="mt-0.5 text-xs text-ink-500">{subtitle}</p></div></div>;
}

function Badge({ value }: { value: string }) {
  const tone = ['failed', 'dead_letter', 'URGENT', 'HIGH'].includes(value) ? 'bg-danger/10 text-danger'
    : ['succeeded', 'completed', 'RESOLVED'].includes(value) ? 'bg-accent-50 text-accent-700'
    : ['queued', 'running', 'NORMAL', 'OPEN'].includes(value) ? 'bg-warning/10 text-warning' : 'bg-ink-100 text-ink-600';
  return <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${tone}`}>{value}</span>;
}

function Empty({ text }: { text: string }) {
  return <p className="px-5 py-6 text-sm text-ink-500">{text}</p>;
}

function formatPct(value: number | null) {
  return value == null ? '—' : `${Number(value).toFixed(1)}%`;
}
