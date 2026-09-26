import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, CalendarDays, Check, Clock3, CreditCard, FileText, LifeBuoy, Mail, Plus, Send, Users, X } from 'lucide-react';
import { ownerSupabase } from '@/lib/ownerSupabase';

export type OwnerTenant = { id: string; name: string; slug: string; plan: string; status: string; contact_email: string | null };
type DbRow = { id: string; tenant_id?: string | null; created_at?: string; status?: string; meeting_url?: string | null; agenda?: string | null; outcome?: string | null; [key: string]: unknown };

const input = 'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500';
const button = 'inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50';
const secondary = 'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50';
const dateLabel = (value?: string | null, timezone?: string) => value ? new Date(value).toLocaleString(undefined, timezone ? { timeZone: timezone } : undefined) : '—';
const toLocalInput = (value?: string | null) => {
  const date = value ? new Date(value) : new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const errText = (error: unknown) => error instanceof Error ? error.message : 'Could not complete this action.';
const businessSizeOrder: Record<string, number> = { small: 0, medium: 1, large: 2 };

function Notice({ value, danger = false }: { value: string; danger?: boolean }) {
  if (!value) return null;
  return <p role={danger ? 'alert' : 'status'} className={`mb-4 rounded-lg border p-3 text-sm ${danger ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>{value}</p>;
}

function Heading({ eyebrow, title, subtitle, action }: { eyebrow: string; title: string; subtitle: string; action?: React.ReactNode }) {
  return <div className="mb-6 flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wider text-blue-700">{eyebrow}</p><h1 className="mt-1 text-2xl font-bold text-slate-900">{title}</h1><p className="mt-1 text-sm text-slate-500">{subtitle}</p></div>{action}</div>;
}

function Empty({ text }: { text: string }) { return <div className="p-8 text-center text-sm text-slate-500">{text}</div>; }

export function BillingPage({ tenants, role }: { tenants: OwnerTenant[]; role: string | null }) {
  const [tab, setTab] = useState<'plans' | 'subscriptions' | 'invoices'>('plans');
  const [plans, setPlans] = useState<DbRow[]>([]);
  const [subscriptions, setSubscriptions] = useState<DbRow[]>([]);
  const [invoices, setInvoices] = useState<DbRow[]>([]);
  const [notice, setNotice] = useState('');
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingPlan, setEditingPlan] = useState('starter');
  const [planForm, setPlanForm] = useState({ display_name: '', business_size: 'small', size_description: '', description: '', amount: '', currency: 'KES', billing_interval: 'monthly', seat_limit: '', features: '', is_active: true });
  const [subForm, setSubForm] = useState({ tenant_id: '', plan_key: 'starter', status: 'trialing', billing_interval: 'monthly', period_start: '', period_end: '', notes: '' });
  const [invoiceForm, setInvoiceForm] = useState({ tenant_id: '', currency: 'KES', subtotal: '', tax: '0', due_at: '', description: '', notes: '' });
  const canWrite = role === 'platform_admin' || role === 'provisioner';
  const canEditPlans = role === 'platform_admin';

  const load = useCallback(async () => {
    if (!ownerSupabase) return;
    const [planResult, subResult, invoiceResult] = await Promise.all([
      ownerSupabase.from('billing_plans').select('*').order('business_size'),
      ownerSupabase.from('tenant_subscriptions').select('*').order('updated_at', { ascending: false }),
      ownerSupabase.from('billing_invoices').select('*').order('created_at', { ascending: false }).limit(100),
    ]);
    const firstError = planResult.error || subResult.error || invoiceResult.error;
    if (firstError) setFailure(firstError.message);
    else {
      setFailure(''); setPlans([...(planResult.data || []) as DbRow[]].sort((a,b)=>(businessSizeOrder[String(a.business_size)]??9)-(businessSizeOrder[String(b.business_size)]??9)));
      setSubscriptions((subResult.data || []) as DbRow[]); setInvoices((invoiceResult.data || []) as DbRow[]);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const current = plans.find(plan => plan.plan_key === editingPlan);
    if (!current) return;
    setPlanForm({
      display_name: String(current.display_name || ''), business_size: String(current.business_size || 'small'),
      size_description: String(current.size_description || ''), description: String(current.description || ''),
      amount: current.amount == null ? '' : String(current.amount), currency: String(current.currency || 'KES'),
      billing_interval: String(current.billing_interval || 'monthly'), seat_limit: current.seat_limit == null ? '' : String(current.seat_limit),
      features: Array.isArray(current.features) ? current.features.join(', ') : '', is_active: Boolean(current.is_active),
    });
  }, [plans, editingPlan]);

  const savePlan = async (event: FormEvent) => {
    event.preventDefault(); if (!ownerSupabase || !canEditPlans) return;
    setBusy(true); setFailure(''); setNotice('');
    const { error } = await ownerSupabase.rpc('owner_save_billing_plan', {
      p_plan_key: editingPlan, p_display_name: planForm.display_name, p_business_size: planForm.business_size,
      p_size_description: planForm.size_description, p_description: planForm.description,
      p_amount: planForm.amount === '' ? null : Number(planForm.amount), p_currency: planForm.currency.toUpperCase(),
      p_interval: planForm.billing_interval, p_seat_limit: planForm.seat_limit === '' ? null : Number(planForm.seat_limit),
      p_features: planForm.features.split(',').map(value => value.trim()).filter(Boolean), p_is_active: planForm.is_active,
    });
    setBusy(false);
    if (error) setFailure(error.message); else { setNotice('Package details saved. Payment collection is still disabled.'); await load(); }
  };

  const saveSubscription = async (event: FormEvent) => {
    event.preventDefault(); if (!ownerSupabase || !canWrite) return;
    setBusy(true); setFailure(''); setNotice('');
    const { error } = await ownerSupabase.rpc('owner_save_subscription', {
      p_tenant_id: subForm.tenant_id, p_plan_key: subForm.plan_key, p_status: subForm.status,
      p_billing_interval: subForm.billing_interval, p_period_start: subForm.period_start || null,
      p_period_end: subForm.period_end || null, p_notes: subForm.notes,
    });
    setBusy(false);
    if (error) setFailure(error.message); else { setNotice('Subscription record saved. No payment was charged.'); await load(); }
  };

  const createInvoice = async (event: FormEvent) => {
    event.preventDefault(); if (!ownerSupabase || !canWrite) return;
    setBusy(true); setFailure(''); setNotice('');
    const { error } = await ownerSupabase.rpc('owner_create_invoice', {
      p_tenant_id: invoiceForm.tenant_id, p_currency: invoiceForm.currency.toUpperCase(),
      p_subtotal: Number(invoiceForm.subtotal), p_tax: Number(invoiceForm.tax || 0),
      p_due_at: invoiceForm.due_at || null,
      p_line_items: [{ description: invoiceForm.description || 'Business platform subscription', quantity: 1, amount: Number(invoiceForm.subtotal) }],
      p_notes: invoiceForm.notes,
    });
    setBusy(false);
    if (error) setFailure(error.message); else { setNotice('Draft invoice created. Issue it when ready; payments are not connected.'); setInvoiceForm(current => ({ ...current, description: '', subtotal: '', tax: '0', notes: '' })); await load(); }
  };

  const changeInvoice = async (id: string, status: string) => {
    if (!ownerSupabase) return;
    setBusy(true); setFailure('');
    const { error } = await ownerSupabase.rpc('owner_set_invoice_status', { p_invoice_id: id, p_status: status });
    setBusy(false); if (error) setFailure(error.message); else { setNotice(`Invoice marked ${status}.`); await load(); }
  };
  const tenantName = (id: unknown) => tenants.find(tenant => tenant.id === id)?.name || 'Tenant';
  const money = (amount: unknown, currency: unknown) => amount == null ? 'Price not set' : `${String(currency || 'KES')} ${Number(amount).toLocaleString('en-KE', { minimumFractionDigits: 2 })}`;

  return <>
    <Heading eyebrow="Revenue operations" title="Billing" subtitle="Manage business-size packages, subscription records and invoices. Payment collection stays off until you configure a provider." />
    <Notice value={notice} /><Notice value={failure} danger />
    <div className="mb-5 grid gap-4 md:grid-cols-3">
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4"><p className="text-xs font-semibold uppercase text-amber-800">Payment gateway</p><p className="mt-1 font-semibold text-amber-950">Not configured</p><p className="mt-1 text-xs leading-5 text-amber-900">Invoices and plan records work in manual mode. No card is charged. Add provider secrets later in Owner Edge Function settings.</p></div>
      <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">Packages</p><p className="mt-1 text-2xl font-bold">{plans.length}</p></div>
      <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">Open invoices</p><p className="mt-1 text-2xl font-bold">{invoices.filter(row => row.status === 'open' || row.status === 'past_due').length}</p></div>
    </div>
    <div className="mb-4 flex gap-1 rounded-xl border border-slate-200 bg-white p-1 w-fit">{([['plans','Packages'],['subscriptions','Subscriptions'],['invoices','Invoices']] as const).map(([key,label]) => <button key={key} onClick={() => setTab(key)} className={`rounded-lg px-4 py-2 text-sm font-medium ${tab === key ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>{label}</button>)}</div>

    {tab === 'plans' && <div className="grid gap-5 xl:grid-cols-[1fr_1.1fr]">
      <section className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="font-semibold">Business-size packages</h2><p className="mt-1 text-sm text-slate-500">Monthly list prices in Kenyan shillings. Edit business-size criteria or package details as your offer is finalized.</p><div className="mt-4 space-y-3">{plans.map(plan => <button key={String(plan.plan_key)} onClick={() => setEditingPlan(String(plan.plan_key))} className={`w-full rounded-lg border p-4 text-left ${editingPlan === plan.plan_key ? 'border-blue-400 bg-blue-50' : 'border-slate-200 hover:bg-slate-50'}`}><div className="flex items-center justify-between"><span className="font-semibold">{String(plan.display_name)}</span><span className="text-xs uppercase text-slate-500">{String(plan.business_size)} business</span></div><p className="mt-1 text-sm font-medium text-slate-800">{money(plan.amount, plan.currency)} / {String(plan.billing_interval || 'monthly')}</p><p className="mt-1 text-xs text-slate-500">{String(plan.size_description || plan.description || 'Size criteria not set')}</p></button>)}</div></section>
      <form onSubmit={savePlan} className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="font-semibold">Edit package</h2><p className="mt-1 text-xs text-slate-500">Only platform administrators can change package pricing.</p><div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-sm">Package name<input required maxLength={100} disabled={!canEditPlans} value={planForm.display_name} onChange={e => setPlanForm({ ...planForm, display_name: e.target.value })} className={input} /></label>
        <label className="text-sm">Business size<select disabled={!canEditPlans} value={planForm.business_size} onChange={e => setPlanForm({ ...planForm, business_size: e.target.value })} className={input}><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></label>
        <label className="text-sm">Package price<input type="number" min="0" step="0.01" disabled={!canEditPlans} placeholder="Set later" value={planForm.amount} onChange={e => setPlanForm({ ...planForm, amount: e.target.value })} className={input} /></label>
        <label className="text-sm">Currency<input maxLength={3} disabled={!canEditPlans} value={planForm.currency} onChange={e => setPlanForm({ ...planForm, currency: e.target.value })} className={input} /></label>
        <label className="text-sm">Billing cycle<select disabled={!canEditPlans} value={planForm.billing_interval} onChange={e => setPlanForm({ ...planForm, billing_interval: e.target.value })} className={input}><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></label>
        <label className="text-sm">User limit<input type="number" min="1" disabled={!canEditPlans} placeholder="No limit set" value={planForm.seat_limit} onChange={e => setPlanForm({ ...planForm, seat_limit: e.target.value })} className={input} /></label>
        <label className="text-sm sm:col-span-2">Size criteria<input maxLength={300} disabled={!canEditPlans} placeholder="Describe the intended company or business size" value={planForm.size_description} onChange={e => setPlanForm({ ...planForm, size_description: e.target.value })} className={input} /></label>
        <label className="text-sm sm:col-span-2">Package description<textarea maxLength={1000} disabled={!canEditPlans} value={planForm.description} onChange={e => setPlanForm({ ...planForm, description: e.target.value })} className={input} rows={2} /></label>
        <label className="text-sm sm:col-span-2">Features (comma separated)<input disabled={!canEditPlans} value={planForm.features} onChange={e => setPlanForm({ ...planForm, features: e.target.value })} className={input} /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={!canEditPlans} checked={planForm.is_active} onChange={e => setPlanForm({ ...planForm, is_active: e.target.checked })} />Available for new subscriptions</label>
      </div>{canEditPlans && <button disabled={busy} className={`${button} mt-4`}>Save package</button>}</form>
    </div>}

    {tab === 'subscriptions' && <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
      {canWrite && <form onSubmit={saveSubscription} className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="font-semibold">Assign or update subscription</h2><div className="mt-4 space-y-3">
        <label className="block text-sm">Business<select required value={subForm.tenant_id} onChange={e => setSubForm({ ...subForm, tenant_id: e.target.value })} className={input}><option value="">Select tenant</option>{tenants.map(tenant => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}</select></label>
        <label className="block text-sm">Package<select value={subForm.plan_key} onChange={e => setSubForm({ ...subForm, plan_key: e.target.value })} className={input}>{plans.map(plan => <option key={String(plan.plan_key)} value={String(plan.plan_key)}>{String(plan.display_name)}</option>)}</select></label>
        <label className="block text-sm">Status<select value={subForm.status} onChange={e => setSubForm({ ...subForm, status: e.target.value })} className={input}><option value="trialing">Trial</option><option value="active">Active</option><option value="past_due">Past due</option><option value="paused">Paused</option><option value="cancelled">Cancelled</option></select></label>
        <label className="block text-sm">Cycle<select value={subForm.billing_interval} onChange={e => setSubForm({ ...subForm, billing_interval: e.target.value })} className={input}><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></label>
        <div className="grid grid-cols-2 gap-3"><label className="text-sm">Period start<input type="date" value={subForm.period_start} onChange={e => setSubForm({ ...subForm, period_start: e.target.value })} className={input} /></label><label className="text-sm">Period end<input type="date" value={subForm.period_end} onChange={e => setSubForm({ ...subForm, period_end: e.target.value })} className={input} /></label></div>
        <label className="block text-sm">Internal note<textarea maxLength={1000} value={subForm.notes} onChange={e => setSubForm({ ...subForm, notes: e.target.value })} className={input} rows={2} /></label>
        <button disabled={busy || !subForm.tenant_id} className={button}>Save subscription</button>
      </div></form>}
      <section className="rounded-xl border border-slate-200 bg-white"><div className="border-b border-slate-100 p-5"><h2 className="font-semibold">Tenant subscriptions</h2><p className="mt-1 text-xs text-slate-500">Manual status records. Provider IDs remain empty until a payment integration is configured.</p></div>{subscriptions.length ? <div className="divide-y divide-slate-100">{subscriptions.map(row => <div key={row.id} className="flex items-center justify-between gap-3 p-4"><div><p className="font-medium">{tenantName(row.tenant_id)}</p><p className="mt-1 text-xs text-slate-500">{String(row.plan_key)} · {String(row.billing_interval)} · {row.period_start ? String(row.period_start) : 'No start date'}</p></div><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs">{String(row.status)}</span></div>)}</div> : <Empty text="No subscriptions assigned yet." />}</section>
    </div>}

    {tab === 'invoices' && <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
      {canWrite && <form onSubmit={createInvoice} className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="font-semibold">Create draft invoice</h2><p className="mt-1 text-xs text-slate-500">Creates a record only. No provider call or payment is made.</p><div className="mt-4 space-y-3">
        <label className="block text-sm">Business<select required value={invoiceForm.tenant_id} onChange={e => setInvoiceForm({ ...invoiceForm, tenant_id: e.target.value })} className={input}><option value="">Select tenant</option>{tenants.map(tenant => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}</select></label>
        <label className="block text-sm">Line description<input required maxLength={160} value={invoiceForm.description} onChange={e => setInvoiceForm({ ...invoiceForm, description: e.target.value })} className={input} /></label>
        <div className="grid grid-cols-2 gap-3"><label className="text-sm">Subtotal<input required type="number" min="0" step="0.01" value={invoiceForm.subtotal} onChange={e => setInvoiceForm({ ...invoiceForm, subtotal: e.target.value })} className={input} /></label><label className="text-sm">Tax<input type="number" min="0" step="0.01" value={invoiceForm.tax} onChange={e => setInvoiceForm({ ...invoiceForm, tax: e.target.value })} className={input} /></label></div>
        <div className="grid grid-cols-2 gap-3"><label className="text-sm">Currency<input required maxLength={3} value={invoiceForm.currency} onChange={e => setInvoiceForm({ ...invoiceForm, currency: e.target.value })} className={input} /></label><label className="text-sm">Due date<input type="date" value={invoiceForm.due_at} onChange={e => setInvoiceForm({ ...invoiceForm, due_at: e.target.value })} className={input} /></label></div>
        <label className="block text-sm">Notes<textarea maxLength={1000} value={invoiceForm.notes} onChange={e => setInvoiceForm({ ...invoiceForm, notes: e.target.value })} className={input} rows={2} /></label>
        <button disabled={busy || !invoiceForm.tenant_id} className={button}><FileText size={15} />Create draft</button>
      </div></form>}
      <section className="rounded-xl border border-slate-200 bg-white"><div className="border-b border-slate-100 p-5"><h2 className="font-semibold">Invoice ledger</h2><p className="mt-1 text-xs text-slate-500">Mark paid only after payment is confirmed outside this system.</p></div>{invoices.length ? <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{['Invoice','Business','Total','Status','Due','Action'].map(title => <th key={title} className="px-3 py-3">{title}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{invoices.map(row => <tr key={row.id}><td className="px-3 py-3 font-mono text-xs">{String(row.invoice_number)}</td><td className="px-3 py-3">{tenantName(row.tenant_id)}</td><td className="px-3 py-3">{money(row.total, row.currency)}</td><td className="px-3 py-3">{String(row.status)}</td><td className="px-3 py-3">{String(row.due_at || '—')}</td><td className="px-3 py-3">{canWrite && row.status === 'draft' && <button disabled={busy} onClick={() => void changeInvoice(String(row.id),'open')} className="text-xs font-semibold text-blue-700">Issue</button>}{canWrite && (row.status === 'open' || row.status === 'past_due') && <button disabled={busy} onClick={() => void changeInvoice(String(row.id),'paid')} className="text-xs font-semibold text-emerald-700">Mark paid</button>}</td></tr>)}</tbody></table></div> : <Empty text="No invoices yet." />}</section>
    </div>}
  </>;
}

export function AlertsPage({ rows, role }: { rows: DbRow[]; role: string | null }) {
  const [items, setItems] = useState(rows); const [failure, setFailure] = useState('');
  useEffect(() => setItems(rows), [rows]);
  const canUpdate = ['platform_admin','provisioner','support'].includes(role || '');
  const update = async (id: string, status: string) => {
    if (!ownerSupabase) return;
    const { error } = await ownerSupabase.rpc('owner_set_platform_alert_status', { p_alert_id: id, p_status: status });
    if (error) setFailure(error.message); else { setFailure(''); setItems(current => current.map(item => item.id === id ? { ...item, status } : item)); }
  };
  return <><Heading eyebrow="Platform signals" title="Technical alerts" subtitle="Acknowledge incidents, track response and close resolved alerts. Alerts contain operational metadata only." /><Notice value={failure} danger /><div className="rounded-xl border border-slate-200 bg-white">{items.length ? <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{['Alert','Tenant','Severity','Status','Created','Action'].map(text => <th key={text} className="px-4 py-3">{text}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{items.map(row => <tr key={row.id}><td className="px-4 py-3"><p className="font-medium">{String(row.title || row.category || 'Platform alert')}</p><p className="mt-1 max-w-lg text-xs text-slate-500">{String(row.summary || '')}</p></td><td className="px-4 py-3">{String(row.tenant_id || 'Platform')}</td><td className="px-4 py-3">{String(row.severity)}</td><td className="px-4 py-3">{String(row.status)}</td><td className="px-4 py-3 text-xs text-slate-500">{dateLabel(String(row.created_at || ''))}</td><td className="px-4 py-3">{canUpdate && row.status !== 'resolved' && <div className="flex gap-2"><button onClick={() => void update(row.id,'acknowledged')} className="text-xs font-semibold text-amber-700">Acknowledge</button><button onClick={() => void update(row.id,'resolved')} className="text-xs font-semibold text-emerald-700">Resolve</button></div>}</td></tr>)}</tbody></table></div> : <Empty text="No technical alerts have been received." />}</div></>;
}

export function TrainingPage({ tenants, rows, role }: { tenants: OwnerTenant[]; rows: DbRow[]; role: string | null }) {
  const [courses, setCourses] = useState<DbRow[]>([]); const [failure, setFailure] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false);
  const [courseForm, setCourseForm] = useState({ course_id: '', title: '', description: '', is_required: false });
  const [assignForm, setAssignForm] = useState({ tenant_id: '', course_id: '', status: 'assigned', progress: '0' });
  const canEdit = role === 'platform_admin' || role === 'provisioner';
  const load = useCallback(async () => { if (!ownerSupabase) return; const { data, error } = await ownerSupabase.from('training_courses').select('*').order('title'); if (error) setFailure(error.message); else setCourses((data || []) as DbRow[]); }, []);
  useEffect(() => { void load(); }, [load]);
  const saveCourse = async (event: FormEvent) => { event.preventDefault(); if (!ownerSupabase) return; setBusy(true); const { error } = await ownerSupabase.rpc('owner_save_training_course', { p_course_id: courseForm.course_id.toLowerCase().replace(/\s+/g,'-'), p_title: courseForm.title, p_description: courseForm.description, p_is_required: courseForm.is_required, p_is_active: true }); setBusy(false); if(error) setFailure(error.message); else { setNotice('Course saved.'); setCourseForm({ course_id:'',title:'',description:'',is_required:false }); await load(); } };
  const assign = async (event: FormEvent) => { event.preventDefault(); if(!ownerSupabase) return; setBusy(true); const { error } = await ownerSupabase.rpc('owner_set_training_enrollment', { p_tenant_id: assignForm.tenant_id, p_course_id: assignForm.course_id, p_status: assignForm.status, p_progress: Number(assignForm.progress) }); setBusy(false); if(error) setFailure(error.message); else { setFailure(''); setNotice('Training assignment updated.'); } };
  const tenantName = (id?: string | null) => tenants.find(tenant => tenant.id === id)?.name || id || 'Tenant';
  return <><Heading eyebrow="Customer enablement" title="Training" subtitle="Maintain courses, assign onboarding and training sessions, and track completion by tenant." /><Notice value={notice} /><Notice value={failure} danger />
    <div className="grid gap-5 xl:grid-cols-2">{canEdit && <form onSubmit={saveCourse} className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="font-semibold">Training course catalog</h2><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-sm">Course ID<input required value={courseForm.course_id} onChange={e=>setCourseForm({...courseForm,course_id:e.target.value})} placeholder="getting-started" className={input}/></label><label className="text-sm">Course name<input required value={courseForm.title} onChange={e=>setCourseForm({...courseForm,title:e.target.value})} className={input}/></label><label className="text-sm sm:col-span-2">Description<input value={courseForm.description} onChange={e=>setCourseForm({...courseForm,description:e.target.value})} className={input}/></label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={courseForm.is_required} onChange={e=>setCourseForm({...courseForm,is_required:e.target.checked})}/>Required onboarding course</label></div><button disabled={busy} className={`${button} mt-4`}><Plus size={15}/>Save course</button><div className="mt-4 flex flex-wrap gap-2">{courses.map(course=><span key={String(course.course_id)} className="rounded-full bg-slate-100 px-3 py-1 text-xs">{String(course.title)}</span>)}</div></form>}
      {canEdit && <form onSubmit={assign} className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="font-semibold">Assign or update tenant progress</h2><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-sm">Business<select required value={assignForm.tenant_id} onChange={e=>setAssignForm({...assignForm,tenant_id:e.target.value})} className={input}><option value="">Select tenant</option>{tenants.map(tenant=><option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}</select></label><label className="text-sm">Course<select required value={assignForm.course_id} onChange={e=>setAssignForm({...assignForm,course_id:e.target.value})} className={input}><option value="">Select course</option>{courses.filter(course=>course.is_active).map(course=><option key={String(course.course_id)} value={String(course.course_id)}>{String(course.title)}</option>)}</select></label><label className="text-sm">Status<select value={assignForm.status} onChange={e=>setAssignForm({...assignForm,status:e.target.value})} className={input}>{['assigned','in_progress','completed','certified','stalled'].map(v=><option key={v} value={v}>{v.replace('_',' ')}</option>)}</select></label><label className="text-sm">Progress %<input type="number" min="0" max="100" value={assignForm.progress} onChange={e=>setAssignForm({...assignForm,progress:e.target.value})} className={input}/></label></div><button disabled={busy || !assignForm.tenant_id || !assignForm.course_id} className={`${button} mt-4`}>Save progress</button></form>}</div>
    <section className="mt-5 rounded-xl border border-slate-200 bg-white"><div className="border-b border-slate-100 p-5"><h2 className="font-semibold">Tenant training progress</h2></div>{rows.length?<div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{['Business','Course','Progress','Status','Updated'].map(v=><th key={v} className="px-4 py-3">{v}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{rows.map(row=><tr key={row.id}><td className="px-4 py-3">{tenantName(row.tenant_id)}</td><td className="px-4 py-3">{String(courses.find(c=>c.course_id===row.course_id)?.title || row.course_id)}</td><td className="px-4 py-3">{String(row.progress_percent ?? 0)}%</td><td className="px-4 py-3">{String(row.status)}</td><td className="px-4 py-3 text-xs text-slate-500">{dateLabel(row.created_at)}</td></tr>)}</tbody></table></div>:<Empty text="No tenant courses assigned yet."/>}</section>
  </>;
}

export function SupportDesk({ tenants, rows, role }: { tenants: OwnerTenant[]; rows: DbRow[]; role: string | null }) {
  const [selectedId, setSelectedId] = useState(''); const [messages, setMessages] = useState<DbRow[]>([]); const [reply, setReply] = useState(''); const [status, setStatus] = useState('open'); const [failure, setFailure] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false);
  const [items, setItems] = useState(rows);
  useEffect(()=>setItems(rows),[rows]);
  const current = items.find(row=>row.id===selectedId); const canSupport = ['platform_admin','provisioner','support'].includes(role||'');
  useEffect(()=>{ if(current) setStatus(String(current.status||'open')); },[selectedId, items]);
  const loadMessages = useCallback(async()=>{if(!ownerSupabase||!selectedId)return;const {data,error}=await ownerSupabase.from('support_ticket_messages').select('*').eq('ticket_id',selectedId).order('created_at');if(error)setFailure(error.message);else setMessages((data||[]) as DbRow[]);},[selectedId]);
  useEffect(()=>{void loadMessages();},[loadMessages]);
  const tenantName = (id?:string|null)=>tenants.find(t=>t.id===id)?.name||'Tenant';
  const updateStatus=async()=>{if(!ownerSupabase||!selectedId)return;setBusy(true);const {error}=await ownerSupabase.rpc('owner_set_support_ticket',{p_ticket_id:selectedId,p_status:status,p_assigned_to:null});setBusy(false);if(error)setFailure(error.message);else{setItems(current=>current.map(row=>row.id===selectedId?{...row,status}:row));setNotice('Ticket updated.');}};
  const sendReply=async(event:FormEvent)=>{event.preventDefault();if(!ownerSupabase||!selectedId)return;setBusy(true);const {error}=await ownerSupabase.rpc('owner_reply_support_ticket',{p_ticket_id:selectedId,p_body:reply});setBusy(false);if(error)setFailure(error.message);else{setReply('');setNotice('Reply recorded in the ticket history.');await loadMessages();}};
  return <><Heading eyebrow="Customer care" title="Support desk" subtitle="Review tenant requests, assign a status and keep support replies in an auditable thread."/><Notice value={notice}/><Notice value={failure} danger/>
    <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]"><section className="rounded-xl border border-slate-200 bg-white"><div className="border-b border-slate-100 p-5"><h2 className="font-semibold">Ticket queue</h2></div>{items.length? <div className="divide-y divide-slate-100">{items.map(row=><button key={row.id} onClick={()=>setSelectedId(row.id)} className={`w-full p-4 text-left hover:bg-slate-50 ${selectedId===row.id?'bg-blue-50':''}`}><div className="flex justify-between gap-2"><span className="font-medium">{String(row.title||'Support request')}</span><span className="text-xs text-slate-500">{String(row.status)}</span></div><p className="mt-1 text-xs text-slate-500">{tenantName(row.tenant_id)} · {String(row.severity||'normal')} · {dateLabel(row.created_at)}</p><p className="mt-2 line-clamp-2 text-sm text-slate-600">{String(row.summary||'')}</p></button>)}</div>:<Empty text="No support requests have arrived."/>}</section>
      <section className="rounded-xl border border-slate-200 bg-white">{current?<><div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5"><div><p className="text-xs uppercase text-blue-700">{tenantName(current.tenant_id)}</p><h2 className="mt-1 font-semibold">{String(current.title)}</h2></div>{canSupport&&<div className="flex gap-2"><select value={status} onChange={e=>setStatus(e.target.value)} className="rounded-lg border border-slate-300 px-2 text-sm">{['open','in_progress','waiting','resolved','closed'].map(v=><option key={v}>{v}</option>)}</select><button onClick={()=>void updateStatus()} disabled={busy} className={secondary}>Save</button></div>}</div><div className="max-h-[420px] space-y-3 overflow-y-auto p-5"><p className="rounded-lg bg-slate-50 p-3 text-sm">{String(current.summary||'No request description')}</p>{messages.map(message=><div key={message.id} className={`rounded-lg p-3 ${message.author_kind==='owner'?'ml-8 bg-blue-50':'mr-8 bg-slate-100'}`}><p className="text-xs font-semibold">{message.author_kind==='owner'?'Owner support':String(message.author_email||'Tenant administrator')}</p><p className="mt-1 whitespace-pre-wrap text-sm">{String(message.body)}</p><p className="mt-2 text-[11px] text-slate-500">{dateLabel(message.created_at)}</p></div>)}</div>{canSupport&&<form onSubmit={sendReply} className="border-t border-slate-100 p-5"><label className="text-sm font-medium">Reply<textarea required maxLength={5000} rows={3} value={reply} onChange={e=>setReply(e.target.value)} className={input}/></label><button disabled={busy||!reply.trim()} className={`${button} mt-3`}><Send size={15}/>Save reply</button></form>}</>:<Empty text="Select a ticket to review its details and conversation."/>}</section></div>
    <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><strong>Break-glass access:</strong> this support desk does not expose tenant business records. Any direct diagnostic access needs a separate scoped, approved and audited workflow.</div>
  </>;
}

export function TenantInboxPage({ tenants, role }: { tenants: OwnerTenant[]; role: string | null }) {
  const [rows,setRows]=useState<DbRow[]>([]); const [form,setForm]=useState({tenant_id:'',title:'',body:'',priority:'normal',expires_at:''}); const [failure,setFailure]=useState(''); const [notice,setNotice]=useState(''); const [busy,setBusy]=useState(false);
  const canSend=role==='platform_admin'||role==='provisioner';
  const load=useCallback(async()=>{if(!ownerSupabase)return;const {data,error}=await ownerSupabase.from('owner_inbox_messages').select('*').order('created_at',{ascending:false}).limit(100);if(error)setFailure(error.message);else setRows((data||[]) as DbRow[]);},[]);
  useEffect(()=>{void load();},[load]);
  const send=async(event:FormEvent)=>{event.preventDefault();if(!ownerSupabase)return;setBusy(true);const {error}=await ownerSupabase.rpc('owner_send_tenant_message',{p_tenant_id:form.tenant_id,p_title:form.title,p_body:form.body,p_priority:form.priority,p_expires_at:form.expires_at?new Date(form.expires_at).toISOString():null});setBusy(false);if(error)setFailure(error.message);else{setFailure('');setNotice('Message delivered to the tenant admin inbox.');setForm({tenant_id:'',title:'',body:'',priority:'normal',expires_at:''});await load();}};
  const archive=async(id:string,active:boolean)=>{if(!ownerSupabase)return;const {error}=await ownerSupabase.rpc('owner_archive_tenant_message',{p_message_id:id,p_is_active:active});if(error)setFailure(error.message);else{setNotice(active?'Message restored.':'Message archived.');await load();}};
  return <><Heading eyebrow="Tenant communications" title="Tenant inbox" subtitle="Send notices to a tenant’s administrator dashboard. Only active tenant administrators can read them."/><Notice value={notice}/><Notice value={failure} danger/>
    <div className="grid gap-5 xl:grid-cols-[0.85fr_1.15fr]">{canSend&&<form onSubmit={send} className="rounded-xl border border-slate-200 bg-white p-5"><div className="flex items-center gap-2"><Mail size={18} className="text-blue-700"/><h2 className="font-semibold">Compose admin notice</h2></div><div className="mt-4 space-y-3"><label className="block text-sm">Business<select required value={form.tenant_id} onChange={e=>setForm({...form,tenant_id:e.target.value})} className={input}><option value="">Select tenant</option>{tenants.filter(t=>t.status==='active').map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label><label className="block text-sm">Subject<input required maxLength={160} value={form.title} onChange={e=>setForm({...form,title:e.target.value})} className={input}/></label><label className="block text-sm">Message<textarea required maxLength={5000} rows={6} value={form.body} onChange={e=>setForm({...form,body:e.target.value})} className={input}/></label><label className="block text-sm">Priority<select value={form.priority} onChange={e=>setForm({...form,priority:e.target.value})} className={input}><option value="normal">Normal</option><option value="important">Important</option><option value="urgent">Urgent</option></select></label><label className="block text-sm">Optional expiry<input type="datetime-local" value={form.expires_at} onChange={e=>setForm({...form,expires_at:e.target.value})} className={input}/></label><button disabled={busy||!form.tenant_id} className={button}><Send size={15}/>Send to tenant</button></div></form>}
      <section className="rounded-xl border border-slate-200 bg-white"><div className="border-b border-slate-100 p-5"><h2 className="font-semibold">Sent messages</h2><p className="mt-1 text-xs text-slate-500">Message content is visible to Owner staff and tenant administrators in the selected business.</p></div>{rows.length?<div className="divide-y divide-slate-100">{rows.map(row=><div key={row.id} className="p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><h3 className="font-semibold">{String(row.title)}</h3><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px]">{String(row.priority)}</span>{!row.is_active&&<span className="text-xs text-slate-500">Archived</span>}</div><p className="mt-1 text-xs text-slate-500">{tenants.find(t=>t.id===row.tenant_id)?.name||'Tenant'} · {dateLabel(String(row.created_at||''))}{row.expires_at?` · Expires ${dateLabel(String(row.expires_at))}`:''}</p></div>{canSend&&<button onClick={()=>void archive(row.id,!row.is_active)} className={secondary}>{row.is_active?<><Archive size={14}/>Archive</>:<><Check size={14}/>Restore</>}</button>}</div><p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">{String(row.body)}</p></div>)}</div>:<Empty text="No tenant notices sent yet."/>}</section></div>
  </>;
}

export function MeetingsPage({ tenants, role }: { tenants: OwnerTenant[]; role: string | null }) {
  const [rows,setRows]=useState<DbRow[]>([]); const [busy,setBusy]=useState(false); const [failure,setFailure]=useState(''); const [notice,setNotice]=useState(''); const [outcomeId,setOutcomeId]=useState(''); const [outcome,setOutcome]=useState({status:'completed',outcome:'',follow_up_at:'',follow_up_note:''});
  const [form,setForm]=useState({tenant_id:'',title:'',purpose:'onboarding',starts_at:toLocalInput(),ends_at:toLocalInput(new Date(Date.now()+60*60*1000).toISOString()),timezone:'Africa/Nairobi',provider:'external',meeting_url:'',attendee_name:'',attendee_email:'',agenda:''});
  const canEdit=role==='platform_admin'||role==='provisioner';
  const load=useCallback(async()=>{if(!ownerSupabase)return;const {data,error}=await ownerSupabase.from('owner_meetings').select('*').order('starts_at',{ascending:false}).limit(200);if(error)setFailure(error.message);else setRows((data||[]) as DbRow[]);},[]);
  useEffect(()=>{void load();},[load]);
  const schedule=async(event:FormEvent)=>{event.preventDefault();if(!ownerSupabase)return;setBusy(true);setFailure('');const {error}=await ownerSupabase.rpc('owner_save_meeting',{p_meeting_id:null,p_tenant_id:form.tenant_id,p_title:form.title,p_purpose:form.purpose,p_starts_at:new Date(form.starts_at).toISOString(),p_ends_at:new Date(form.ends_at).toISOString(),p_timezone:form.timezone,p_provider:form.provider,p_meeting_url:form.meeting_url||null,p_attendee_name:form.attendee_name,p_attendee_email:form.attendee_email,p_agenda:form.agenda});setBusy(false);if(error)setFailure(error.message);else{setNotice('Meeting scheduled.');setForm({...form,title:'',meeting_url:'',attendee_name:'',attendee_email:'',agenda:''});await load();}};
  const saveOutcome=async(event:FormEvent)=>{event.preventDefault();if(!ownerSupabase)return;setBusy(true);const {error}=await ownerSupabase.rpc('owner_record_meeting_outcome',{p_meeting_id:outcomeId,p_status:outcome.status,p_outcome:outcome.outcome,p_follow_up_at:outcome.follow_up_at?new Date(outcome.follow_up_at).toISOString():null,p_follow_up_note:outcome.follow_up_note});setBusy(false);if(error)setFailure(error.message);else{setNotice('Meeting outcome recorded.');setOutcomeId('');await load();}};
  const tenantName=(id?:string|null)=>tenants.find(t=>t.id===id)?.name||'Tenant';
  return <><Heading eyebrow="Customer onboarding" title="Meetings" subtitle="Schedule customer onboarding, training, support and review sessions. Record outcomes and follow-up actions."/><Notice value={notice}/><Notice value={failure} danger/>
    <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">{canEdit&&<form onSubmit={schedule} className="rounded-xl border border-slate-200 bg-white p-5"><div className="flex items-center gap-2"><CalendarDays size={18} className="text-blue-700"/><h2 className="font-semibold">Schedule meeting</h2></div><div className="mt-4 space-y-3"><label className="block text-sm">Business<select required value={form.tenant_id} onChange={e=>setForm({...form,tenant_id:e.target.value})} className={input}><option value="">Select tenant</option>{tenants.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label><label className="block text-sm">Title<input required maxLength={160} value={form.title} onChange={e=>setForm({...form,title:e.target.value})} className={input}/></label><label className="block text-sm">Purpose<select value={form.purpose} onChange={e=>setForm({...form,purpose:e.target.value})} className={input}>{[['onboarding','Onboarding'],['training','Training'],['support','Support'],['review','Business review'],['other','Other']].map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label><div className="grid grid-cols-2 gap-3"><label className="text-sm">Starts<input required type="datetime-local" value={form.starts_at} onChange={e=>setForm({...form,starts_at:e.target.value})} className={input}/></label><label className="text-sm">Ends<input required type="datetime-local" value={form.ends_at} onChange={e=>setForm({...form,ends_at:e.target.value})} className={input}/></label></div><label className="block text-sm">Timezone<input required value={form.timezone} placeholder="Africa/Nairobi" onChange={e=>setForm({...form,timezone:e.target.value})} className={input}/></label><label className="block text-sm">Meeting provider<input value={form.provider} onChange={e=>setForm({...form,provider:e.target.value})} placeholder="Connect later" className={input}/></label><label className="block text-sm">Join URL<input type="url" pattern="https://.*" title="Use an HTTPS meeting link" value={form.meeting_url} onChange={e=>setForm({...form,meeting_url:e.target.value})} placeholder="https://…" className={input}/></label><label className="block text-sm">Attendee name<input value={form.attendee_name} onChange={e=>setForm({...form,attendee_name:e.target.value})} className={input}/></label><label className="block text-sm">Attendee email<input type="email" value={form.attendee_email} onChange={e=>setForm({...form,attendee_email:e.target.value})} className={input}/></label><label className="block text-sm">Agenda<textarea rows={2} value={form.agenda} onChange={e=>setForm({...form,agenda:e.target.value})} className={input}/></label><button disabled={busy||!form.tenant_id} className={button}><Plus size={15}/>Save meeting</button></div></form>}
      <section className="rounded-xl border border-slate-200 bg-white"><div className="flex items-center gap-2 border-b border-slate-100 p-5"><Clock3 size={18} className="text-blue-700"/><div><h2 className="font-semibold">Schedule and outcomes</h2><p className="mt-1 text-xs text-slate-500">Meeting room providers can be connected later; saved join links open externally.</p></div></div>{rows.length?<div className="divide-y divide-slate-100">{rows.map(row=><div key={row.id} className="p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><h3 className="font-semibold">{String(row.title)}</h3><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px]">{String(row.status)}</span></div><p className="mt-1 text-sm text-slate-600">{tenantName(row.tenant_id)} · {String(row.purpose)}</p><p className="mt-1 text-xs text-slate-500">{dateLabel(String(row.starts_at), String(row.timezone))} – {new Date(String(row.ends_at)).toLocaleTimeString(undefined,{timeZone:String(row.timezone)})} · {String(row.timezone)}</p><p className="mt-1 text-xs text-slate-500">Attendee: {String(row.attendee_name||'—')} {row.attendee_email?`(${String(row.attendee_email)})`:''}</p></div><div className="flex gap-2">{row.meeting_url&&<a href={String(row.meeting_url)} target="_blank" rel="noreferrer" className={secondary}>Join</a>}{canEdit&&row.status==='scheduled'&&<button onClick={()=>{setOutcomeId(row.id);setOutcome({status:'completed',outcome:'',follow_up_at:'',follow_up_note:''});}} className={button}>Record outcome</button>}</div></div>{row.agenda&&<p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">Agenda: {String(row.agenda)}</p>}{row.outcome&&<p className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm">Outcome: {String(row.outcome)}</p>}{outcomeId===row.id&&<form onSubmit={saveOutcome} className="mt-4 grid gap-3 rounded-lg border border-blue-100 bg-blue-50 p-4"><label className="text-sm">Result<select value={outcome.status} onChange={e=>setOutcome({...outcome,status:e.target.value})} className={input}><option value="completed">Completed</option><option value="cancelled">Cancelled</option><option value="no_show">No show</option></select></label><label className="text-sm">Outcome<textarea rows={3} required={outcome.status==='completed'} value={outcome.outcome} onChange={e=>setOutcome({...outcome,outcome:e.target.value})} className={input}/></label><label className="text-sm">Follow-up time<input type="datetime-local" value={outcome.follow_up_at} onChange={e=>setOutcome({...outcome,follow_up_at:e.target.value})} className={input}/></label><label className="text-sm">Follow-up note<input value={outcome.follow_up_note} onChange={e=>setOutcome({...outcome,follow_up_note:e.target.value})} className={input}/></label><div className="flex gap-2"><button disabled={busy} className={button}>Save outcome</button><button type="button" onClick={()=>setOutcomeId('')} className={secondary}>Cancel</button></div></form>}</div>)}</div>:<Empty text="No meetings scheduled yet."/>}</section>
    </div>
  </>;
}
