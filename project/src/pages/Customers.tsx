import { useCallback, useEffect, useMemo, useState } from 'react';
import { CircleDollarSign, Clock3, Crown, History, Mail, MessageSquareText, Phone, Plus, Search, UserRound, UsersRound } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/components/ui/Toast';
import { PageHeader } from '@/components/ui/PageHeader';
import { Modal } from '@/components/ui/Modal';
import { formatCurrency, formatDate, formatDateTime } from '@/lib/utils';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';

type Customer = {
  id: string; name: string; phone: string | null; email: string | null; sms_opt_in: boolean;
  loyalty_points: number; lifetime_spend: number; current_balance: number; sale_count: number;
  last_sale_at: string | null;
};
type HistorySale = {
  id: string; sale_number: string | null; sale_date: string; payment_method: string;
  payment_status: string; total_amount: number; created_at: string;
  payments: { channel: string; amount: number; status: string; reference: string | null; created_at: string }[];
};
type LoyaltyEntry = { id: string; type: string; points: number; value_kes: number; description: string | null; created_at: string };
type CustomerHistory = {
  customer: Customer & { created_at: string };
  sales: HistorySale[];
  loyalty: LoyaltyEntry[];
  messages: { id: string; payment_id: string; status: string; last_error: string | null; created_at: string; sent_at: string | null }[];
};
type LoyaltySettings = { loyalty_enabled: boolean; loyalty_points_per_100: number; loyalty_kes_per_point: number; loyalty_minimum_redemption: number; loyalty_redemption_month: number; loyalty_redemption_day: number; timezone: string | null };

const emptyForm = { name: '', phone: '', email: '', sms_opt_in: false };
const localDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export function Customers() {
  const { showToast } = useToast();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [settings, setSettings] = useState<LoyaltySettings | null>(null);
  const [history, setHistory] = useState<CustomerHistory | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [redeeming, setRedeeming] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);

  const loadData = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    const [{ data, error }, { data: settingData, error: settingsError }] = await Promise.all([
      supabase.rpc('admin_get_customer_directory'),
      supabase.from('system_settings').select('loyalty_enabled,loyalty_points_per_100,loyalty_kes_per_point,loyalty_minimum_redemption,loyalty_redemption_month,loyalty_redemption_day,timezone').maybeSingle(),
    ]);
    const failure = error || settingsError;
    setLoadError(failure?.message || '');
    if (failure) showToast(failure.message, 'error');
    setCustomers((data || []) as Customer[]);
    setSettings(settingData as LoyaltySettings | null);
    if (!quiet) setLoading(false);
  }, [showToast]);

  useEffect(() => { void loadData(); }, [loadData]);
  useRealtimeRefresh(loadData);

  const filtered = useMemo(() => customers.filter(customer =>
    `${customer.name} ${customer.phone || ''} ${customer.email || ''}`.toLowerCase().includes(query.toLowerCase())), [customers, query]);
  const totalPoints = customers.reduce((sum, customer) => sum + Number(customer.loyalty_points || 0), 0);
  const activeCustomers = customers.filter(customer => Number(customer.sale_count) > 0).length;
  const today = new Date();
  const redemptionDate = settings ? new Date(today.getFullYear(), settings.loyalty_redemption_month - 1, 1) : today;
  if (settings) redemptionDate.setDate(Math.min(settings.loyalty_redemption_day, new Date(today.getFullYear(), settings.loyalty_redemption_month, 0).getDate()));
  const redemptionOpen = Boolean(settings?.loyalty_enabled && localDate(today) >= localDate(redemptionDate));

  const openCreate = () => { setEditingId(null); setForm(emptyForm); setFormOpen(true); };
  const openEdit = (customer: Customer) => {
    setEditingId(customer.id);
    setForm({ name: customer.name, phone: customer.phone || '', email: customer.email || '', sms_opt_in: customer.sms_opt_in });
    setFormOpen(true);
  };

  const saveCustomer = async () => {
    if (!form.name.trim() || !form.phone.trim()) {
      showToast('Enter a name and phone number', 'error');
      return;
    }
    setSaving(true);
    const { data, error } = await supabase.rpc('admin_register_customer', {
      p_name: form.name.trim(), p_phone: form.phone.trim(), p_email: form.email.trim() || null,
      p_sms_opt_in: form.sms_opt_in, p_customer_id: editingId,
    });
    if (error) showToast(error.message, 'error');
    else {
      showToast(editingId ? 'Customer details updated' : 'Customer added', 'success');
      setFormOpen(false);
      await loadData(true);
      if (editingId) await openHistory(String(data));
    }
    setSaving(false);
  };

  const openHistory = async (customerId: string) => {
    const { data, error } = await supabase.rpc('admin_get_customer_history', { p_customer_id: customerId });
    if (error) showToast(error.message, 'error');
    else setHistory(data as CustomerHistory);
  };

  const redeemPoints = async () => {
    if (!history || !redemptionOpen) return;
    setRedeeming(true);
    const { data, error } = await supabase.rpc('admin_redeem_customer_points', {
      p_customer_id: history.customer.id, p_note: `Year-end points redemption ${today.getFullYear()}`,
    });
    if (error) showToast(error.message, 'error');
    else {
      const result = data as { points_redeemed: number; value_kes: number };
      showToast(`${result.points_redeemed} points redeemed for ${formatCurrency(Number(result.value_kes))}`, 'success');
      await Promise.all([openHistory(history.customer.id), loadData(true)]);
    }
    setRedeeming(false);
  };

  const retryMessage = async (paymentId: string, customerId: string) => {
    const { data, error } = await supabase.functions.invoke('payment-gateway', {
      body: { action: 'send-customer-payment-sms', paymentId },
    });
    if (error || data?.error) showToast(data?.error || error?.message || 'SMS could not be sent', 'error');
    else showToast(data?.sent ? 'Customer SMS sent' : 'No SMS is waiting for this payment', data?.sent ? 'success' : 'info');
    await openHistory(customerId);
  };

  return <div className="space-y-6">
    <PageHeader title="Customers" subtitle="Customer records, payment history, loyalty rewards, and SMS consent."
      actions={<button onClick={openCreate} className="inline-flex items-center gap-2 rounded-lg bg-accent-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-accent-700"><Plus size={17} />Add customer</button>} />

    <section className="grid gap-4 sm:grid-cols-3">
      <SummaryCard label="Customer records" value={customers.length.toLocaleString()} icon={UsersRound} tone="indigo" />
      <SummaryCard label="Returning customers" value={activeCustomers.toLocaleString()} icon={CircleDollarSign} tone="green" />
      <SummaryCard label="Unredeemed points" value={totalPoints.toLocaleString()} icon={Crown} tone="amber" />
    </section>

    {loadError && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">Customer records are not available. Apply `20261005090000_customer_loyalty_analytics.sql` to the tenant Supabase project, then refresh. <span className="mt-1 block text-xs text-amber-700">{loadError}</span></div>}

    <section className="overflow-hidden rounded-xl border border-ink-100 bg-paper shadow-sm">
      <div className="flex flex-col gap-3 border-b border-ink-100 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div><h2 className="font-semibold text-ink-900">Customer directory</h2><p className="mt-1 text-sm text-ink-500">Phone numbers connect payment history, rewards, and approved SMS updates.</p></div>
        <label className="flex items-center gap-2 rounded-lg border border-ink-200 px-3 py-2 text-sm"><Search size={16} className="text-ink-400" /><input value={query} onChange={event => setQuery(event.target.value)} className="w-full border-0 bg-transparent p-0 text-sm outline-none focus:ring-0 sm:w-56" placeholder="Search customers" /></label>
      </div>
      {loading ? <div className="p-10 text-center text-sm text-ink-400">Loading customer records…</div> : filtered.length ? <div className="overflow-x-auto">
        <table className="w-full min-w-[850px] text-left">
          <thead className="bg-ink-50/70"><tr>{['Customer', 'Contact', 'Purchases', 'Balance', 'Points', 'Last activity', ''].map((label, index) => <th key={`${label}-${index}`} className="px-5 py-3 text-[10px] font-semibold uppercase tracking-[.12em] text-ink-500">{label}</th>)}</tr></thead>
          <tbody className="divide-y divide-ink-100">
            {filtered.map(customer => <tr key={customer.id} className="transition-colors hover:bg-ink-50/60">
              <td className="px-5 py-4"><button onClick={() => void openHistory(customer.id)} className="text-left"><span className="block text-sm font-semibold text-ink-900 hover:text-accent-700">{customer.name}</span><span className="mt-1 block text-xs text-ink-400">{Number(customer.sale_count)} recorded sales</span></button></td>
              <td className="px-5 py-4"><p className="flex items-center gap-1.5 text-sm text-ink-700"><Phone size={13} className="text-ink-400" />{customer.phone || 'No phone'}</p><p className="mt-1 flex items-center gap-1.5 text-xs text-ink-400"><Mail size={12} />{customer.email || 'No email'}</p></td>
              <td className="px-5 py-4 text-sm font-medium text-ink-700" data-numeric>{Number(customer.sale_count).toLocaleString()}</td>
              <td className="px-5 py-4 text-sm font-medium text-ink-800" data-numeric>{formatCurrency(Number(customer.current_balance))}</td>
              <td className="px-5 py-4"><span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700"><Crown size={12} />{Number(customer.loyalty_points).toLocaleString()}</span></td>
              <td className="px-5 py-4 text-sm text-ink-500">{customer.last_sale_at ? formatDate(customer.last_sale_at) : 'No sales yet'}</td>
              <td className="px-5 py-4 text-right"><button onClick={() => openEdit(customer)} className="rounded-md px-3 py-1.5 text-xs font-semibold text-accent-700 hover:bg-accent-50">Edit</button><button onClick={() => void openHistory(customer.id)} className="ml-1 rounded-md px-3 py-1.5 text-xs font-semibold text-ink-600 hover:bg-ink-100">History</button></td>
            </tr>)}
          </tbody>
        </table>
      </div> : <div className="p-12 text-center"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-ink-50 text-ink-400"><UserRound size={22} /></div><p className="mt-3 text-sm font-semibold text-ink-800">No customer records found</p><p className="mt-1 text-xs text-ink-400">Add a customer or search by name, phone, or email.</p></div>}
    </section>

    <Modal open={formOpen} onClose={() => setFormOpen(false)} title={editingId ? 'Edit customer' : 'Add customer'}>
      <div className="space-y-4">
        <Field label="Full name"><input autoFocus value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} className="mt-1.5 h-10 w-full rounded-lg border border-ink-200 bg-paper px-3 text-sm" placeholder="Customer name" /></Field>
        <Field label="Phone number"><input type="tel" autoComplete="tel" value={form.phone} onChange={event => setForm({ ...form, phone: event.target.value })} className="mt-1.5 h-10 w-full rounded-lg border border-ink-200 bg-paper px-3 text-sm" placeholder="0712 345 678" /></Field>
        <Field label="Email (optional)"><input type="email" autoComplete="email" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} className="mt-1.5 h-10 w-full rounded-lg border border-ink-200 bg-paper px-3 text-sm" placeholder="name@example.com" /></Field>
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-ink-200 p-3"><input type="checkbox" checked={form.sms_opt_in} onChange={event => setForm({ ...form, sms_opt_in: event.target.checked })} className="mt-0.5 h-4 w-4 rounded border-ink-300 text-accent-600 focus:ring-accent-500" /><span><span className="block text-sm font-medium text-ink-800">Customer agrees to receive payment and balance SMS</span><span className="mt-1 block text-xs leading-5 text-ink-500">Only send messages after the customer gives permission. You can change this consent later.</span></span></label>
        <div className="flex justify-end gap-2 pt-2"><button onClick={() => setFormOpen(false)} className="rounded-lg border border-ink-200 px-4 py-2 text-sm font-medium text-ink-600 hover:bg-ink-50">Cancel</button><button onClick={() => void saveCustomer()} disabled={saving} className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-700 disabled:opacity-50">{saving ? 'Saving…' : editingId ? 'Save changes' : 'Add customer'}</button></div>
      </div>
    </Modal>

    <Modal open={Boolean(history)} onClose={() => setHistory(null)} title={history?.customer.name || 'Customer history'} size="xl">
      {history && <div className="max-h-[75vh] space-y-5 overflow-y-auto pr-1">
        <div className="grid gap-3 sm:grid-cols-4">
          <DetailTile label="Phone" value={history.customer.phone || 'Not recorded'} icon={Phone} />
          <DetailTile label="Current balance" value={formatCurrency(Number(customers.find(item => item.id === history.customer.id)?.current_balance || 0))} icon={CircleDollarSign} />
          <DetailTile label="Reward points" value={Number(history.customer.loyalty_points).toLocaleString()} icon={Crown} />
          <DetailTile label="SMS consent" value={history.customer.sms_opt_in ? 'Opted in' : 'Not opted in'} icon={MessageSquareText} />
        </div>
        {settings?.loyalty_enabled && <div className="flex flex-col gap-3 rounded-xl border border-accent-100 bg-accent-50/60 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-semibold text-ink-900">Year-end rewards</p><p className="mt-1 text-xs text-ink-600">{Number(history.customer.loyalty_points).toLocaleString()} points · {formatCurrency(Number(history.customer.loyalty_points) * Number(settings.loyalty_kes_per_point ?? 1))} redeemable value · opens {redemptionDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}.</p></div><button onClick={() => void redeemPoints()} disabled={!redemptionOpen || Number(history.customer.loyalty_points) < Number(settings.loyalty_minimum_redemption || 100) || redeeming} className="shrink-0 rounded-lg bg-accent-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-700 disabled:cursor-not-allowed disabled:opacity-40">{redeeming ? 'Redeeming…' : redemptionOpen ? 'Redeem points' : 'Available at year-end'}</button></div>}

        <HistorySection title="Sales and payments" icon={History}>
          {history.sales.length ? history.sales.map(sale => <div key={sale.id} className="rounded-lg border border-ink-100 p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-sm font-semibold text-ink-800">{sale.sale_number || 'Sale'} <span className="font-normal text-ink-400">· {formatDate(sale.sale_date)}</span></p><p className="mt-1 text-xs capitalize text-ink-500">{sale.payment_method} · {sale.payment_status}</p></div><span className="text-sm font-semibold text-ink-900" data-numeric>{formatCurrency(Number(sale.total_amount))}</span></div>{sale.payments?.length > 0 && <div className="mt-3 space-y-1 border-t border-ink-100 pt-2">{sale.payments.map((payment, index) => <p key={`${sale.id}-${index}`} className="flex justify-between gap-3 text-xs text-ink-500"><span>{payment.channel.replace(/_/g, ' ')} · {payment.status.toLowerCase()}{payment.reference ? ` · ${payment.reference}` : ''}</span><span data-numeric>{formatCurrency(Number(payment.amount))}</span></p>)}</div>}</div>) : <p className="rounded-lg bg-ink-50 p-4 text-sm text-ink-500">No sales have been linked to this customer.</p>}
        </HistorySection>

        <div className="grid gap-5 lg:grid-cols-2"><HistorySection title="Loyalty activity" icon={Crown}>{history.loyalty.length ? history.loyalty.map(entry => <div key={entry.id} className="flex items-center justify-between gap-3 border-b border-ink-100 py-2 last:border-0"><div><p className="text-sm font-medium capitalize text-ink-800">{entry.description || entry.type.toLowerCase()}</p><p className="mt-0.5 text-xs text-ink-400">{formatDateTime(entry.created_at)} · {formatCurrency(Number(entry.value_kes))}</p></div><span className={`text-sm font-bold ${entry.points > 0 ? 'text-emerald-600' : 'text-ink-700'}`}>{entry.points > 0 ? '+' : ''}{entry.points} pts</span></div>) : <p className="text-sm text-ink-500">No points activity yet.</p>}</HistorySection>
          <HistorySection title="SMS delivery" icon={MessageSquareText}>{history.messages.length ? history.messages.map(message => <div key={message.id} className="flex items-center justify-between gap-3 border-b border-ink-100 py-2 last:border-0"><div><p className="text-sm font-medium text-ink-800">Payment and balance update</p><p className="mt-0.5 text-xs text-ink-400">{formatDateTime(message.sent_at || message.created_at)}</p>{message.last_error && <p className="mt-1 text-xs text-rose-600">{message.last_error}</p>}</div><div className="flex shrink-0 items-center gap-2"><span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${message.status === 'SENT' ? 'bg-emerald-50 text-emerald-700' : message.status === 'FAILED' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'}`}>{message.status.toLowerCase()}</span>{message.status !== 'SENT' && <button onClick={() => void retryMessage(message.payment_id, history.customer.id)} className="rounded-md px-2 py-1 text-[10px] font-semibold text-accent-700 hover:bg-accent-50">Retry</button>}</div></div>) : <p className="text-sm text-ink-500">No SMS messages recorded.</p>}</HistorySection></div>
      </div>}
    </Modal>
  </div>;
}

function SummaryCard({ label, value, icon: Icon, tone }: { label: string; value: string; icon: typeof UsersRound; tone: 'indigo' | 'green' | 'amber' }) {
  const styles = { indigo: 'bg-accent-50 text-accent-700', green: 'bg-emerald-50 text-emerald-700', amber: 'bg-amber-50 text-amber-700' };
  return <div className="rounded-xl border border-ink-100 bg-paper p-5 shadow-sm"><div className="flex items-center justify-between"><p className="text-xs font-semibold uppercase tracking-[.1em] text-ink-500">{label}</p><span className={`flex h-10 w-10 items-center justify-center rounded-xl ${styles[tone]}`}><Icon size={19} /></span></div><p className="mt-4 text-2xl font-bold text-ink-900" data-numeric>{value}</p></div>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block text-sm font-medium text-ink-700">{label}{children}</label>; }
function DetailTile({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Phone }) { return <div className="rounded-lg border border-ink-100 bg-ink-50/60 p-3"><div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.1em] text-ink-400"><Icon size={13} />{label}</div><p className="mt-2 truncate text-sm font-semibold text-ink-800" data-numeric>{value}</p></div>; }
function HistorySection({ title, icon: Icon, children }: { title: string; icon: typeof Clock3; children: React.ReactNode }) { return <section className="rounded-xl border border-ink-100 p-4"><h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink-900"><Icon size={16} className="text-accent-600" />{title}</h3><div className="space-y-2">{children}</div></section>; }
