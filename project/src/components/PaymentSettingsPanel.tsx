import { FormEvent, useCallback, useEffect, useState } from 'react';
import { CreditCard, Loader2, Plus, RefreshCw, Save, ShieldCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/components/ui/Toast';
import { MpesaPaymentPrompt } from '@/components/MpesaPaymentPrompt';
import { formatCurrency } from '@/lib/utils';

type Channel = { channel: string; enabled: boolean; display_name: string; sort_order: number };
type CreditCustomer = { id: string; name: string; phone: string | null; credit_limit: number; current_balance: number; status: string };
type GatewaySettings = { channels: Channel[]; mpesaConfigured: boolean; b2cConfigured: boolean; environment: string | null };
const channelLabels: Record<string, string> = {
  CASH: 'Cash at checkout', MPESA_STK: 'M-Pesa customer prompt', CREDIT: 'Approved customer credit',
  BANK_TRANSFER: 'Bank transfer', CHEQUE: 'Cheque', MPESA_B2C: 'M-Pesa supplier payout',
};

async function invokeGateway(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('payment-gateway', { body });
  if (error) {
    let message = error.message || 'Payment service request failed';
    const response = (error as unknown as { context?: Response }).context;
    if (response) { try { message = (await response.clone().json())?.error || message; } catch { /* preserve function error */ } }
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export function PaymentSettingsPanel() {
  const { showToast } = useToast();
  const [settings, setSettings] = useState<GatewaySettings>({ channels: [], mpesaConfigured: false, b2cConfigured: false, environment: null });
  const [customers, setCustomers] = useState<CreditCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingCredentials, setSavingCredentials] = useState(false);
  const [savingChannel, setSavingChannel] = useState<string | null>(null);
  const [customerSaving, setCustomerSaving] = useState(false);
  const [creditPaymentSaving, setCreditPaymentSaving] = useState(false);
  const [creditPaymentPrompt, setCreditPaymentPrompt] = useState<{ paymentId: string; amount: number; phone: string } | null>(null);
  const [environment, setEnvironment] = useState('sandbox');
  const [credentialForm, setCredentialForm] = useState({ consumerKey: '', consumerSecret: '', shortcode: '', partyB: '', transactionType: 'CustomerPayBillOnline', passkey: '', initiatorName: '', securityCredential: '' });
  const [customerForm, setCustomerForm] = useState({ name: '', phone: '', email: '', creditLimit: '' });
  const [repayForm, setRepayForm] = useState({ customerId: '', amount: '', channel: 'CASH', reference: '', note: '', phone: '' });

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [gateway, creditResult] = await Promise.all([
        invokeGateway({ action: 'get-settings' }),
        supabase.rpc('admin_get_credit_customers'),
      ]);
      setSettings(gateway as GatewaySettings);
      if (creditResult.error) throw new Error(creditResult.error.message);
      setCustomers((creditResult.data || []) as CreditCustomer[]);
      setEnvironment((gateway as GatewaySettings).environment || 'sandbox');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not load payment settings', 'error');
    } finally { if (!quiet) setLoading(false); }
  }, [showToast]);

  useEffect(() => { void load(); }, [load]);

  const saveCredentials = async (event: FormEvent) => {
    event.preventDefault();
    setSavingCredentials(true);
    try {
      await invokeGateway({ action: 'save-mpesa-credentials', environment, ...credentialForm });
      setCredentialForm(current => ({ ...current, consumerKey: '', consumerSecret: '', shortcode: '', partyB: '', passkey: '', securityCredential: '' }));
      showToast('M-Pesa credentials encrypted and verified with Daraja', 'success');
      await load();
    } catch (error) { showToast(error instanceof Error ? error.message : 'Could not save M-Pesa credentials', 'error'); }
    finally { setSavingCredentials(false); }
  };

  const setChannel = async (channel: string, enabled: boolean) => {
    setSavingChannel(channel);
    try {
      await invokeGateway({ action: 'set-channel', channel, enabled });
      setSettings(current => ({ ...current, channels: current.channels.map(item => item.channel === channel ? { ...item, enabled } : item) }));
    } catch (error) { showToast(error instanceof Error ? error.message : 'Could not update payment channel', 'error'); }
    finally { setSavingChannel(null); }
  };

  const addCustomer = async (event: FormEvent) => {
    event.preventDefault();
    setCustomerSaving(true);
    const { error } = await supabase.rpc('admin_create_credit_customer', {
      p_name: customerForm.name.trim(), p_phone: customerForm.phone.trim() || null,
      p_email: customerForm.email.trim().toLowerCase() || null, p_credit_limit: Number(customerForm.creditLimit),
    });
    if (error) showToast(error.message, 'error');
    else { setCustomerForm({ name: '', phone: '', email: '', creditLimit: '' }); showToast('Credit customer added', 'success'); await load(); }
    setCustomerSaving(false);
  };

  const receiveCreditPayment = async (event: FormEvent) => {
    event.preventDefault();
    setCreditPaymentSaving(true);
    if (repayForm.channel === 'MPESA_STK') {
      try {
        const amount = Number(repayForm.amount);
        if (!Number.isSafeInteger(amount) || amount < 1) throw new Error('Enter a positive whole KSh amount');
        const result = await invokeGateway({ action: 'initiate-credit-stk', customerId: repayForm.customerId,
          amount, phone: repayForm.phone });
        setCreditPaymentPrompt({ paymentId: result.paymentId, amount, phone: result.phone });
        showToast('M-Pesa credit payment prompt sent', 'success');
      } catch (error) { showToast(error instanceof Error ? error.message : 'Could not start credit payment', 'error'); }
      finally { setCreditPaymentSaving(false); }
      return;
    }
    const { data, error } = await supabase.rpc('admin_record_credit_payment', {
      p_customer_id: repayForm.customerId, p_amount: Number(repayForm.amount), p_channel: repayForm.channel,
      p_reference: repayForm.reference.trim() || null, p_note: repayForm.note.trim() || null,
    });
    if (error) showToast(error.message, 'error');
    else { showToast(`Received ${formatCurrency(Number(data))} and applied it to oldest invoices`, 'success'); setRepayForm({ customerId: '', amount: '', channel: 'CASH', reference: '', note: '', phone: '' }); await load(); }
    setCreditPaymentSaving(false);
  };

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="animate-spin text-accent-600" /></div>;

  return <div className="space-y-6">
    <section className="max-w-4xl rounded-md border border-ink-100 bg-paper p-6 shadow-xs">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="font-display text-lg font-semibold text-ink-900">Payment channels</h2>
          <p className="mt-1 text-sm text-ink-500">Cashier checkout methods and administrator confirmations.</p></div>
        <button type="button" onClick={() => void load()} className="flex items-center gap-2 rounded-sm border border-ink-200 px-3 py-2 text-sm"><RefreshCw size={15} /> Refresh</button>
      </div>
      <div className="mt-5 divide-y divide-ink-100">
        {settings.channels.map(channel => {
          const gated = channel.channel === 'MPESA_STK' && !settings.mpesaConfigured || channel.channel === 'MPESA_B2C' && !settings.b2cConfigured;
          return <div key={channel.channel} className="flex items-center justify-between gap-4 py-3">
            <div><p className="text-sm font-medium text-ink-900">{channelLabels[channel.channel] || channel.display_name}</p>
              <p className="text-xs text-ink-500">{channel.channel === 'MPESA_B2C' ? 'Administrator only. Sends real funds to a verified supplier or the original M-Pesa payer for a refund.' : channel.channel === 'CREDIT' ? 'Only registered customers and within their credit limit.' : channel.channel === 'BANK_TRANSFER' || channel.channel === 'CHEQUE' ? 'Sale remains pending until an administrator confirms receipt.' : ''}</p></div>
            <button type="button" role="switch" aria-checked={channel.enabled} disabled={Boolean(savingChannel) || gated || channel.channel === 'CASH'}
              onClick={() => void setChannel(channel.channel, !channel.enabled)}
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${channel.enabled ? 'bg-accent-600' : 'bg-ink-300'}`}>
              <span className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-transform ${channel.enabled ? 'left-6' : 'left-1'}`} />
            </button>
          </div>;
        })}
      </div>
    </section>

    <section className="max-w-4xl rounded-md border border-ink-100 bg-paper p-6 shadow-xs">
      <div className="flex items-start gap-3"><div className="rounded-sm bg-accent-50 p-2 text-accent-700"><ShieldCheck size={20} /></div>
        <div><h2 className="font-display text-lg font-semibold text-ink-900">Daraja M-Pesa credentials</h2>
          <p className="mt-1 text-sm text-ink-500">Credentials are encrypted before storage and used only by the payment Edge Function. {settings.mpesaConfigured ? `Current environment: ${settings.environment}.` : 'Not configured.'}</p></div></div>
      <form onSubmit={event => void saveCredentials(event)} className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-medium text-ink-700">Environment<select value={environment} onChange={event => setEnvironment(event.target.value)} className="mt-1 block h-10 w-full rounded-sm border border-ink-200 bg-paper px-3"><option value="sandbox">Sandbox</option><option value="production">Production</option></select></label>
        <label className="text-sm font-medium text-ink-700">STK transaction type<select value={credentialForm.transactionType} onChange={event => setCredentialForm({ ...credentialForm, transactionType: event.target.value })} className="mt-1 block h-10 w-full rounded-sm border border-ink-200 bg-paper px-3"><option value="CustomerPayBillOnline">PayBill</option><option value="CustomerBuyGoodsOnline">Till / Buy Goods</option></select></label>
        <label className="text-sm font-medium text-ink-700">Business shortcode<input required inputMode="numeric" value={credentialForm.shortcode} onChange={event => setCredentialForm({ ...credentialForm, shortcode: event.target.value })} className="mt-1 block h-10 w-full rounded-sm border border-ink-200 px-3" /></label>
        {credentialForm.transactionType === 'CustomerBuyGoodsOnline' && <label className="text-sm font-medium text-ink-700">Till number<input required inputMode="numeric" value={credentialForm.partyB} onChange={event => setCredentialForm({ ...credentialForm, partyB: event.target.value })} className="mt-1 block h-10 w-full rounded-sm border border-ink-200 px-3" /></label>}
        <label className="text-sm font-medium text-ink-700">Consumer key<input required autoComplete="off" value={credentialForm.consumerKey} onChange={event => setCredentialForm({ ...credentialForm, consumerKey: event.target.value })} className="mt-1 block h-10 w-full rounded-sm border border-ink-200 px-3" /></label>
        <label className="text-sm font-medium text-ink-700">Consumer secret<input required type="password" autoComplete="new-password" value={credentialForm.consumerSecret} onChange={event => setCredentialForm({ ...credentialForm, consumerSecret: event.target.value })} className="mt-1 block h-10 w-full rounded-sm border border-ink-200 px-3" /></label>
        <label className="text-sm font-medium text-ink-700 sm:col-span-2">Lipa na M-Pesa passkey<input required type="password" autoComplete="new-password" value={credentialForm.passkey} onChange={event => setCredentialForm({ ...credentialForm, passkey: event.target.value })} className="mt-1 block h-10 w-full rounded-sm border border-ink-200 px-3" /></label>
        <div className="sm:col-span-2 grid gap-4 rounded-sm bg-ink-50 p-4 sm:grid-cols-2"><p className="sm:col-span-2 text-xs leading-5 text-ink-600">Optional B2C fields enable administrator-initiated supplier payouts. A Daraja B2C security credential is already RSA-encrypted from Safaricom.</p>
          <label className="text-sm font-medium text-ink-700">B2C initiator name<input autoComplete="off" value={credentialForm.initiatorName} onChange={event => setCredentialForm({ ...credentialForm, initiatorName: event.target.value })} className="mt-1 block h-10 w-full rounded-sm border border-ink-200 px-3" /></label>
          <label className="text-sm font-medium text-ink-700">B2C security credential<input type="password" autoComplete="new-password" value={credentialForm.securityCredential} onChange={event => setCredentialForm({ ...credentialForm, securityCredential: event.target.value })} className="mt-1 block h-10 w-full rounded-sm border border-ink-200 px-3" /></label></div>
        <div className="sm:col-span-2"><button disabled={savingCredentials} className="flex items-center gap-2 rounded-sm bg-accent-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"><Save size={16} />{savingCredentials ? 'Verifying and saving…' : 'Verify and save credentials'}</button></div>
      </form>
      <p className="mt-4 text-xs leading-5 text-ink-500">Use sandbox keys to configure a test environment. Production payouts require Safaricom to enable the M-Pesa Express or B2C product on your live shortcode.</p>
    </section>

    <section className="max-w-4xl rounded-md border border-ink-100 bg-paper p-6 shadow-xs">
      <div className="flex items-center gap-2"><CreditCard size={19} className="text-accent-700" /><h2 className="font-display text-lg font-semibold text-ink-900">Approved credit customers</h2></div>
      <p className="mt-1 text-sm text-ink-500">Only administrators can register customers and set their credit limits. Received payments apply to the oldest outstanding sales first.</p>
      <form onSubmit={event => void addCustomer(event)} className="mt-4 grid gap-3 sm:grid-cols-2">
        <input required aria-label="Customer name" placeholder="Customer name" value={customerForm.name} onChange={event => setCustomerForm({ ...customerForm, name: event.target.value })} className="h-10 rounded-sm border border-ink-200 px-3 text-sm" />
        <input aria-label="Customer phone" placeholder="Phone number" value={customerForm.phone} onChange={event => setCustomerForm({ ...customerForm, phone: event.target.value })} className="h-10 rounded-sm border border-ink-200 px-3 text-sm" />
        <input type="email" aria-label="Customer email" placeholder="Email (optional)" value={customerForm.email} onChange={event => setCustomerForm({ ...customerForm, email: event.target.value })} className="h-10 rounded-sm border border-ink-200 px-3 text-sm" />
        <input required min="0" type="number" step="0.01" aria-label="Credit limit" placeholder="Credit limit (KES)" value={customerForm.creditLimit} onChange={event => setCustomerForm({ ...customerForm, creditLimit: event.target.value })} className="h-10 rounded-sm border border-ink-200 px-3 text-sm" />
        <button disabled={customerSaving} className="flex items-center justify-center gap-2 rounded-sm border border-ink-300 px-4 py-2 text-sm font-medium sm:col-span-2"><Plus size={16} />Add approved customer</button>
      </form>
      <div className="mt-5 overflow-x-auto"><table className="w-full min-w-[500px] text-left text-sm"><thead className="text-xs uppercase text-ink-500"><tr><th className="py-2">Customer</th><th className="py-2">Limit</th><th className="py-2">Outstanding</th></tr></thead>
        <tbody className="divide-y divide-ink-100">{customers.map(customer => <tr key={customer.id}><td className="py-2.5 font-medium text-ink-900">{customer.name}</td><td className="py-2.5" data-numeric>{formatCurrency(Number(customer.credit_limit))}</td><td className="py-2.5" data-numeric>{formatCurrency(Number(customer.current_balance))}</td></tr>)}
          {customers.length === 0 && <tr><td colSpan={3} className="py-5 text-center text-ink-500">No approved credit customers yet.</td></tr>}</tbody></table></div>
    </section>

    <section className="max-w-4xl rounded-md border border-ink-100 bg-paper p-6 shadow-xs">
      <h2 className="font-display text-lg font-semibold text-ink-900">Receive a credit payment</h2>
      <p className="mt-1 text-sm text-ink-500">Cash, bank and cheque receipts apply FIFO. M-Pesa prompts go to the customer phone and settle the oldest invoice; the amount must fit that invoice's remaining balance.</p>
      <form onSubmit={event => void receiveCreditPayment(event)} className="mt-4 grid gap-3 sm:grid-cols-2">
        <select required value={repayForm.customerId} onChange={event => { const customer = customers.find(item => item.id === event.target.value); setRepayForm({ ...repayForm, customerId: event.target.value, phone: customer?.phone || '' }); }} className="h-10 rounded-sm border border-ink-200 bg-paper px-3 text-sm"><option value="">Select customer</option>{customers.filter(customer => Number(customer.current_balance)>0).map(customer => <option key={customer.id} value={customer.id}>{customer.name} · {formatCurrency(Number(customer.current_balance))} due</option>)}</select>
        <input required min={repayForm.channel === 'MPESA_STK' ? '1' : '0.01'} type="number" step={repayForm.channel === 'MPESA_STK' ? '1' : '0.01'} placeholder="Amount received (KES)" value={repayForm.amount} onChange={event => setRepayForm({ ...repayForm, amount: event.target.value })} className="h-10 rounded-sm border border-ink-200 px-3 text-sm" />
        <select value={repayForm.channel} onChange={event => setRepayForm({ ...repayForm, channel: event.target.value })} className="h-10 rounded-sm border border-ink-200 bg-paper px-3 text-sm"><option value="CASH">Cash</option><option value="BANK_TRANSFER">Bank transfer</option><option value="CHEQUE">Cheque</option><option value="MPESA_STK">M-Pesa STK</option></select>
        {repayForm.channel === 'MPESA_STK' ? <input required aria-label="M-Pesa phone" inputMode="tel" value={repayForm.phone} onChange={event => setRepayForm({ ...repayForm, phone: event.target.value })} placeholder="Customer's M-Pesa phone" className="h-10 rounded-sm border border-ink-200 px-3 text-sm" /> : <input placeholder="Bank / cheque reference (optional)" value={repayForm.reference} onChange={event => setRepayForm({ ...repayForm, reference: event.target.value })} className="h-10 rounded-sm border border-ink-200 px-3 text-sm" />}
        <input placeholder="Note (optional)" value={repayForm.note} onChange={event => setRepayForm({ ...repayForm, note: event.target.value })} className="h-10 rounded-sm border border-ink-200 px-3 text-sm sm:col-span-2" />
        <button disabled={creditPaymentSaving} className="rounded-sm bg-accent-600 px-4 py-2.5 text-sm font-semibold text-white sm:col-span-2">{creditPaymentSaving ? 'Processing…' : repayForm.channel === 'MPESA_STK' ? 'Send M-Pesa prompt' : 'Record payment and apply to invoices'}</button>
      </form>
    </section>
    {creditPaymentPrompt && <MpesaPaymentPrompt paymentId={creditPaymentPrompt.paymentId} amount={creditPaymentPrompt.amount} phone={creditPaymentPrompt.phone}
      onClose={() => setCreditPaymentPrompt(null)} onStatus={status => { if (['SUCCESS','FAILED','CANCELLED','TIMEOUT','REVIEW_REQUIRED'].includes(status)) void load(true); }} />}
  </div>;
}
