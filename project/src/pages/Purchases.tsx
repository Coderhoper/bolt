import { useEffect, useState, useCallback } from 'react';
import { isTenantContextActive, supabase } from '@/lib/supabase';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { formatCurrency, formatDate } from '@/lib/utils';
import { logAudit } from '@/lib/audit';
import { PageHeader } from '@/components/ui/PageHeader';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { Receipt, Plus, Eye, X, Smartphone } from 'lucide-react';
import type { Purchase, Product, Supplier, PurchaseItem } from '@/types';

export function Purchases() {
  const { isAdmin } = useAuth();
  const tenantMode = isTenantContextActive();
  const { showToast } = useToast();
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [viewPurchase, setViewPurchase] = useState<Purchase | null>(null);
  const [viewItems, setViewItems] = useState<PurchaseItem[]>([]);
  const [items, setItems] = useState<{ product_id: string; quantity: string; buying_price: string }[]>([]);
  const [supplierId, setSupplierId] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().split('T')[0]);
  const [note, setNote] = useState('');
  const [paymentStatus, setPaymentStatus] = useState<'paid' | 'partial' | 'credit'>('paid');
  const [amountPaid, setAmountPaid] = useState('');
  const [saving, setSaving] = useState(false);
  const [payoutTarget, setPayoutTarget] = useState<{ purchase: Purchase; amount: string } | null>(null);
  const [payoutBusy, setPayoutBusy] = useState(false);
  const [payoutRemarks, setPayoutRemarks] = useState('');

  const loadData = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    const [{ data: p }, { data: prods }, { data: sups }] = await Promise.all([
      supabase.from('purchases').select('*, supplier:suppliers(*)').order('created_at', { ascending: false }),
      supabase.from('products').select('*').eq('status', 'active').order('name'),
      supabase.from('suppliers').select('*').order('name'),
    ]);
    setPurchases(p || []);
    setProducts(prods || []);
    setSuppliers(sups || []);
    if (!quiet) setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);
  useRealtimeRefresh(loadData);

  const addItem = () => setItems([...items, { product_id: '', quantity: '1', buying_price: '' }]);
  const removeItem = (index: number) => setItems(items.filter((_, i) => i !== index));

  const updateItem = (index: number, field: string, value: string) => {
    const updated = [...items];
    updated[index] = { ...updated[index], [field]: value };
    if (field === 'product_id') {
      const product = products.find(p => p.id === value);
      if (product) updated[index].buying_price = String(product.buying_price);
    }
    setItems(updated);
  };

  const calculateTotal = () => {
    return items.reduce((sum, item) => sum + (parseInt(item.quantity) || 0) * (parseInt(item.buying_price) || 0), 0);
  };

  const openAdd = () => {
    setItems([{ product_id: '', quantity: '1', buying_price: '' }]);
    setSupplierId('');
    setInvoiceNumber('');
    setPurchaseDate(new Date().toISOString().split('T')[0]);
    setNote('');
    setPaymentStatus('paid');
    setAmountPaid('');
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (items.length === 0 || items.some(i => !i.product_id || !i.quantity)) {
      showToast('Please fill in all purchase items', 'error');
      return;
    }
    setSaving(true);
    const itemsJson = items.map(i => ({
      product_id: i.product_id,
      quantity: parseInt(i.quantity),
      buying_price: parseInt(i.buying_price) || 0,
    }));

    const total = calculateTotal();
    const paid = paymentStatus === 'paid' ? total : (parseInt(amountPaid) || 0);

    const { data, error } = await supabase.rpc('process_purchase', {
      p_purchase_items: itemsJson,
      p_supplier_id: supplierId || null,
      p_invoice_number: invoiceNumber || null,
      p_note: note || null,
      p_purchase_date: purchaseDate,
      p_payment_status: paymentStatus,
      p_amount_paid: paid,
    });

    if (error) {
      showToast(error.message, 'error');
    } else {
      await logAudit('CREATE_PURCHASE', 'purchase', data, `Created purchase with ${items.length} items (${paymentStatus})`);
      showToast('Purchase recorded and stock updated', 'success');
      setModalOpen(false);
      loadData();
    }
    setSaving(false);
  };

  const viewPurchaseDetails = async (purchase: Purchase) => {
    setViewPurchase(purchase);
    const { data } = await supabase
      .from('purchase_items')
      .select('*, product:products(*)')
      .eq('purchase_id', purchase.id);
    setViewItems(data || []);
  };

  const initiateSupplierPayout = async () => {
    if (!payoutTarget?.purchase.supplier_id) return;
    const amount = Number(payoutTarget.amount);
    if (!Number.isSafeInteger(amount) || amount < 1) { showToast('Enter a positive whole KSh amount', 'error'); return; }
    setPayoutBusy(true);
    const { data, error } = await supabase.functions.invoke('payment-gateway', { body: {
      action: 'initiate-supplier-payment', supplierId: payoutTarget.purchase.supplier_id,
      purchaseId: payoutTarget.purchase.id, amount, remarks: payoutRemarks.trim() || `Invoice ${payoutTarget.purchase.invoice_number || payoutTarget.purchase.id.slice(0,8)}`,
    } });
    if (error || data?.error) {
      let message = data?.error || error?.message || 'Supplier payout could not be started';
      const response = (error as unknown as { context?: Response } | null)?.context;
      if (response) { try { message = (await response.clone().json())?.error || message; } catch { /* preserve */ } }
      showToast(message, 'error');
    } else {
      await logAudit('INITIATE_SUPPLIER_MPESA_PAYMENT','payment',data.paymentId,`M-Pesa supplier payout initiated for purchase ${payoutTarget.purchase.invoice_number || payoutTarget.purchase.id}`);
      showToast('Supplier payout submitted. The payable balance changes after Safaricom confirms it.', 'success');
      setPayoutTarget(null);
      setPayoutRemarks('');
    }
    setPayoutBusy(false);
  };

  if (loading) {
    return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent-500" /></div>;
  }

  return (
    <div>
      <PageHeader
        title="Purchases"
        subtitle={`${purchases.length} purchases recorded`}
        actions={isAdmin && (
          <button onClick={openAdd} className="flex items-center gap-2 rounded-sm bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-700 transition-colors">
            <Plus size={18} /> New Purchase
          </button>
        )}
      />

      {purchases.length === 0 ? (
        <div className="rounded-md bg-paper shadow-xs border border-ink-100">
          <EmptyState icon={Receipt} title="No purchases recorded" description="Record your first purchase to start tracking inventory inflow." action={isAdmin && (
            <button onClick={openAdd} className="flex items-center gap-2 rounded-sm bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-700">
              <Plus size={18} /> New Purchase
            </button>
          )} />
        </div>
      ) : (
        <div className="overflow-hidden rounded-md bg-paper shadow-xs border border-ink-100">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-ink-50 border-b border-ink-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-ink-600 uppercase tracking-wide">Date</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-ink-600 uppercase tracking-wide">Supplier</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-ink-600 uppercase tracking-wide">Invoice #</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-ink-600 uppercase tracking-wide">Amount</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-ink-600 uppercase tracking-wide">Payment</th>
                  {isAdmin && <th className="px-4 py-3 text-right text-xs font-medium text-ink-600 uppercase tracking-wide">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {purchases.map(p => (
                  <tr key={p.id} className="hover:bg-ink-50">
                    <td className="px-4 py-3 text-sm text-ink-600" data-numeric>{formatDate(p.purchase_date)}</td>
                    <td className="px-4 py-3 text-sm text-ink-900">{p.supplier?.name || '—'}</td>
                    <td className="px-4 py-3 text-sm text-ink-600">{p.invoice_number || '—'}</td>
                    <td className="px-4 py-3 text-sm font-semibold text-ink-900 text-right" data-numeric>{formatCurrency(p.total_amount)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        p.payment_status === 'paid' ? 'bg-accent-100 text-accent-700' :
                        p.payment_status === 'partial' ? 'bg-warning/10 text-warning' :
                        'bg-danger/10 text-danger'
                      }`} data-numeric>
                        {p.payment_status === 'paid' ? 'Paid' : p.payment_status === 'partial' ? `Partial (${formatCurrency(p.amount_paid)})` : 'Credit'}
                      </span>
                    </td>
                    {isAdmin && (
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {tenantMode && p.supplier_id && p.supplier?.phone && Number(p.amount_paid) < Number(p.total_amount) && <button
                            onClick={() => { setPayoutTarget({ purchase: p, amount: String(Math.floor(Number(p.total_amount)-Number(p.amount_paid))) }); setPayoutRemarks(''); }}
                            className="inline-flex items-center gap-1 rounded-sm border border-accent-200 px-2 py-1.5 text-xs font-medium text-accent-800 hover:bg-accent-50">
                            <Smartphone size={14} /> Pay M-Pesa
                          </button>}
                          <button onClick={() => viewPurchaseDetails(p)} aria-label={`View invoice ${p.invoice_number || p.id}`} className="rounded-sm p-1.5 text-ink-400 hover:bg-accent-50 hover:text-accent-500">
                            <Eye size={16} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="New Purchase" size="xl">
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="block text-sm font-medium text-ink-700 mb-1">Supplier</label>
              <select
                value={supplierId}
                onChange={e => setSupplierId(e.target.value)}
                className="w-full rounded-sm border px-3 py-2 text-sm outline-none h-10 border-ink-200 bg-paper focus:border-accent-500"
              >
                <option value="">None</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-700 mb-1">Invoice Number</label>
              <input
                type="text"
                value={invoiceNumber}
                onChange={e => setInvoiceNumber(e.target.value)}
                className="w-full rounded-sm border px-3 py-2 text-sm outline-none h-10 border-ink-200 bg-paper focus:border-accent-500"
                placeholder="Optional"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-700 mb-1">Purchase Date</label>
              <input
                type="date"
                value={purchaseDate}
                onChange={e => setPurchaseDate(e.target.value)}
                className="w-full rounded-sm border px-3 py-2 text-sm outline-none h-10 border-ink-200 bg-paper focus:border-accent-500 font-mono tabular-nums"
              />
            </div>
          </div>

          <div className="rounded-md border border-ink-200">
            <div className="flex items-center justify-between border-b border-ink-200 px-4 py-2.5">
              <p className="text-sm font-semibold text-ink-900">Purchase Items</p>
              <button onClick={addItem} className="flex items-center gap-1 text-sm text-accent-500 hover:text-accent-700">
                <Plus size={16} /> Add Item
              </button>
            </div>
            <div className="divide-y divide-ink-100">
              {items.map((item, index) => (
                <div key={index} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex-1">
                    <select
                      value={item.product_id}
                      onChange={e => updateItem(index, 'product_id', e.target.value)}
                      className="w-full rounded-sm border px-3 py-1.5 text-sm outline-none h-10 border-ink-200 bg-paper focus:border-accent-500"
                    >
                      <option value="">Select product...</option>
                      {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                  <div className="w-20">
                    <input
                      type="number"
                      step="1"
                      min="1"
                      value={item.quantity}
                      onChange={e => updateItem(index, 'quantity', e.target.value)}
                      className="w-full rounded-sm border px-2 py-1.5 text-sm outline-none h-10 border-ink-200 bg-paper focus:border-accent-500 font-mono tabular-nums"
                      placeholder="Qty"
                    />
                  </div>
                  <div className="w-28">
                    <input
                      type="number"
                      step="1"
                      min="0"
                      value={item.buying_price}
                      onChange={e => updateItem(index, 'buying_price', e.target.value)}
                      className="w-full rounded-sm border px-2 py-1.5 text-sm outline-none h-10 border-ink-200 bg-paper focus:border-accent-500 font-mono tabular-nums"
                      placeholder="Buy Price"
                    />
                  </div>
                  <div className="w-24 text-right text-sm font-medium text-ink-900" data-numeric>
                    {formatCurrency((parseInt(item.quantity) || 0) * (parseInt(item.buying_price) || 0))}
                  </div>
                  <button onClick={() => removeItem(index)} className="rounded-sm p-1 text-ink-400 hover:bg-danger/10 hover:text-danger">
                    <X size={16} />
                  </button>
                </div>
              ))}
              {items.length === 0 && (
                <div className="px-4 py-8 text-center text-sm text-ink-400">No items added. Click "Add Item" to start.</div>
              )}
            </div>
            <div className="flex items-center justify-between border-t border-ink-200 px-4 py-3 bg-ink-50">
              <span className="text-sm font-semibold text-ink-900">Total</span>
              <span className="text-lg font-bold text-accent-500" data-numeric>{formatCurrency(calculateTotal())}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-ink-700 mb-1">Payment Status</label>
              <select
                value={paymentStatus}
                onChange={e => setPaymentStatus(e.target.value as 'paid' | 'partial' | 'credit')}
                className="w-full rounded-sm border px-3 py-2 text-sm outline-none h-10 border-ink-200 bg-paper focus:border-accent-500"
              >
                <option value="paid">Paid in Full</option>
                <option value="partial">Partial Payment</option>
                <option value="credit">On Credit</option>
              </select>
            </div>
            {paymentStatus === 'partial' && (
              <div>
                <label className="block text-sm font-medium text-ink-700 mb-1">Amount Paid</label>
                <input
                  type="number"
                  step="1"
                  min="0"
                  value={amountPaid}
                  onChange={e => setAmountPaid(e.target.value)}
                  className="w-full rounded-sm border px-3 py-2 text-sm outline-none h-10 border-ink-200 bg-paper focus:border-accent-500 font-mono tabular-nums"
                  placeholder="0"
                />
              </div>
            )}
          </div>

          {paymentStatus !== 'paid' && supplierId && (
            <div className="rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning" data-numeric>
              {paymentStatus === 'credit'
                ? `The full amount (${formatCurrency(calculateTotal())}) will be added to this supplier's credit balance.`
                : `The remaining balance (${formatCurrency(calculateTotal() - (parseInt(amountPaid) || 0))}) will be added to this supplier's credit balance.`}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-ink-700 mb-1">Note (optional)</label>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={2}
              className="w-full rounded-sm border px-3 py-2 text-sm outline-none border-ink-200 bg-paper focus:border-accent-500"
            />
          </div>

          <div className="flex justify-end gap-3">
            <button onClick={() => setModalOpen(false)} className="rounded-sm px-4 py-2 text-sm font-medium text-ink-600 hover:bg-ink-100">Cancel</button>
            <button onClick={handleSave} disabled={saving || items.length === 0} className="rounded-sm bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-700 disabled:opacity-50">
              {saving ? 'Saving...' : 'Record Purchase'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={!!viewPurchase} onClose={() => setViewPurchase(null)} title="Purchase Details" size="lg">
        {viewPurchase && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-lg bg-ink-50 p-3">
                <p className="text-xs text-ink-500">Date</p>
                <p className="text-sm font-medium text-ink-900" data-numeric>{formatDate(viewPurchase.purchase_date)}</p>
              </div>
              <div className="rounded-lg bg-ink-50 p-3">
                <p className="text-xs text-ink-500">Supplier</p>
                <p className="text-sm font-medium text-ink-900">{viewPurchase.supplier?.name || '—'}</p>
              </div>
              <div className="rounded-lg bg-ink-50 p-3">
                <p className="text-xs text-ink-500">Invoice #</p>
                <p className="text-sm font-medium text-ink-900">{viewPurchase.invoice_number || '—'}</p>
              </div>
              <div className="rounded-lg bg-ink-50 p-3">
                <p className="text-xs text-ink-500">Payment</p>
                <p className="text-sm font-medium text-ink-900 capitalize">
                  {viewPurchase.payment_status}
                  {viewPurchase.payment_status === 'partial' && ` (${formatCurrency(viewPurchase.amount_paid)} paid)`}
                </p>
              </div>
              <div className="rounded-lg bg-ink-50 p-3">
                <p className="text-xs text-ink-500">Note</p>
                <p className="text-sm font-medium text-ink-900">{viewPurchase.note || '—'}</p>
              </div>
            </div>
            <div className="overflow-hidden rounded-md border border-ink-200">
              <table className="w-full">
                <thead className="bg-ink-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-ink-600 uppercase tracking-wide">Product</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-ink-600 uppercase tracking-wide">Qty</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-ink-600 uppercase tracking-wide">Buy Price</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-ink-600 uppercase tracking-wide">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {viewItems.map(item => (
                    <tr key={item.id}>
                      <td className="px-3 py-2 text-sm text-ink-900">{item.product?.name || '—'}</td>
                      <td className="px-3 py-2 text-sm text-ink-600 text-right" data-numeric>{item.quantity}</td>
                      <td className="px-3 py-2 text-sm text-ink-600 text-right" data-numeric>{formatCurrency(item.buying_price)}</td>
                      <td className="px-3 py-2 text-sm font-medium text-ink-900 text-right" data-numeric>{formatCurrency(item.total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-ink-50">
                  <tr>
                    <td colSpan={3} className="px-3 py-2 text-sm font-semibold text-ink-900 text-right">Total</td>
                    <td className="px-3 py-2 text-sm font-bold text-ink-900 text-right" data-numeric>{formatCurrency(viewPurchase.total_amount)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
      </Modal>
      <Modal open={!!payoutTarget} onClose={() => { if (!payoutBusy) setPayoutTarget(null); }} title="Send supplier payment with M-Pesa" size="md">
        {payoutTarget && <div className="space-y-4">
          <div className="rounded-sm bg-warning/10 p-3 text-sm leading-5 text-ink-700">
            This sends real funds to <strong>{payoutTarget.purchase.supplier?.name}</strong> at the phone number saved on the supplier record ({payoutTarget.purchase.supplier?.phone}). Only proceed after verifying the supplier and invoice.
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-medium text-ink-700">Invoice<input readOnly value={payoutTarget.purchase.invoice_number || 'Purchase invoice'} className="mt-1 h-10 w-full rounded-sm border border-ink-200 bg-ink-50 px-3" /></label>
            <label className="text-sm font-medium text-ink-700">Outstanding balance<input readOnly value={formatCurrency(Number(payoutTarget.purchase.total_amount)-Number(payoutTarget.purchase.amount_paid))} className="mt-1 h-10 w-full rounded-sm border border-ink-200 bg-ink-50 px-3" /></label>
          </div>
          <label className="block text-sm font-medium text-ink-700">Amount to send (KES)
            <input required min="1" max={Number(payoutTarget.purchase.total_amount)-Number(payoutTarget.purchase.amount_paid)} step="1" type="number" value={payoutTarget.amount} onChange={event => setPayoutTarget({ ...payoutTarget, amount: event.target.value })} className="mt-1 h-10 w-full rounded-sm border border-ink-200 px-3" />
          </label>
          <label className="block text-sm font-medium text-ink-700">Payment note
            <input maxLength={100} value={payoutRemarks} onChange={event => setPayoutRemarks(event.target.value)} className="mt-1 h-10 w-full rounded-sm border border-ink-200 px-3" />
          </label>
          <div className="flex justify-end gap-2 border-t border-ink-100 pt-4">
            <button disabled={payoutBusy} onClick={() => setPayoutTarget(null)} className="rounded-sm px-4 py-2 text-sm text-ink-600">Cancel</button>
            <button disabled={payoutBusy} onClick={() => void initiateSupplierPayout()} className="flex items-center gap-2 rounded-sm bg-accent-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"><Smartphone size={16} />{payoutBusy ? 'Submitting…' : 'Send M-Pesa payment'}</button>
          </div>
        </div>}
      </Modal>
    </div>
  );
}
