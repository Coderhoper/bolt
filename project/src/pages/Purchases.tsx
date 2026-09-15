import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { formatCurrency, formatDate } from '@/lib/utils';
import { logAudit } from '@/lib/audit';
import { PageHeader } from '@/components/ui/PageHeader';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { Receipt, Plus, Eye, X } from 'lucide-react';
import type { Purchase, Product, Supplier, PurchaseItem } from '@/types';

export function Purchases() {
  const { isAdmin } = useAuth();
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

  const loadData = useCallback(async () => {
    setLoading(true);
    const [{ data: p }, { data: prods }, { data: sups }] = await Promise.all([
      supabase.from('purchases').select('*, supplier:suppliers(*)').order('created_at', { ascending: false }),
      supabase.from('products').select('*').eq('status', 'active').order('name'),
      supabase.from('suppliers').select('*').order('name'),
    ]);
    setPurchases(p || []);
    setProducts(prods || []);
    setSuppliers(sups || []);
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

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

  if (loading) {
    return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>;
  }

  return (
    <div>
      <PageHeader
        title="Purchases"
        subtitle={`${purchases.length} purchases recorded`}
        actions={isAdmin && (
          <button onClick={openAdd} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors">
            <Plus size={18} /> New Purchase
          </button>
        )}
      />

      {purchases.length === 0 ? (
        <div className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
          <EmptyState icon={Receipt} title="No purchases recorded" description="Record your first purchase to start tracking inventory inflow." action={isAdmin && (
            <button onClick={openAdd} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
              <Plus size={18} /> New Purchase
            </button>
          )} />
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Date</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Supplier</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Invoice #</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600">Amount</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-slate-600">Payment</th>
                  {isAdmin && <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {purchases.map(p => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-sm text-slate-600">{formatDate(p.purchase_date)}</td>
                    <td className="px-4 py-3 text-sm text-slate-900">{p.supplier?.name || '—'}</td>
                    <td className="px-4 py-3 text-sm text-slate-600">{p.invoice_number || '—'}</td>
                    <td className="px-4 py-3 text-sm font-semibold text-slate-900 text-right">{formatCurrency(p.total_amount)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        p.payment_status === 'paid' ? 'bg-emerald-100 text-emerald-700' :
                        p.payment_status === 'partial' ? 'bg-amber-100 text-amber-700' :
                        'bg-rose-100 text-rose-700'
                      }`}>
                        {p.payment_status === 'paid' ? 'Paid' : p.payment_status === 'partial' ? `Partial (${formatCurrency(p.amount_paid)})` : 'Credit'}
                      </span>
                    </td>
                    {isAdmin && (
                      <td className="px-4 py-3 text-right">
                        <button onClick={() => viewPurchaseDetails(p)} className="rounded-lg p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600">
                          <Eye size={16} />
                        </button>
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
              <label className="block text-sm font-medium text-slate-700 mb-1">Supplier</label>
              <select
                value={supplierId}
                onChange={e => setSupplierId(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 outline-none"
              >
                <option value="">None</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Invoice Number</label>
              <input
                type="text"
                value={invoiceNumber}
                onChange={e => setInvoiceNumber(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 outline-none"
                placeholder="Optional"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Purchase Date</label>
              <input
                type="date"
                value={purchaseDate}
                onChange={e => setPurchaseDate(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 outline-none"
              />
            </div>
          </div>

          <div className="rounded-xl border border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
              <p className="text-sm font-semibold text-slate-900">Purchase Items</p>
              <button onClick={addItem} className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700">
                <Plus size={16} /> Add Item
              </button>
            </div>
            <div className="divide-y divide-slate-100">
              {items.map((item, index) => (
                <div key={index} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex-1">
                    <select
                      value={item.product_id}
                      onChange={e => updateItem(index, 'product_id', e.target.value)}
                      className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:border-blue-500 outline-none"
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
                      className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:border-blue-500 outline-none"
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
                      className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:border-blue-500 outline-none"
                      placeholder="Buy Price"
                    />
                  </div>
                  <div className="w-24 text-right text-sm font-medium text-slate-900">
                    {formatCurrency((parseInt(item.quantity) || 0) * (parseInt(item.buying_price) || 0))}
                  </div>
                  <button onClick={() => removeItem(index)} className="rounded-lg p-1 text-slate-400 hover:bg-red-50 hover:text-red-600">
                    <X size={16} />
                  </button>
                </div>
              ))}
              {items.length === 0 && (
                <div className="px-4 py-8 text-center text-sm text-slate-400">No items added. Click "Add Item" to start.</div>
              )}
            </div>
            <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 bg-slate-50">
              <span className="text-sm font-semibold text-slate-900">Total</span>
              <span className="text-lg font-bold text-blue-600">{formatCurrency(calculateTotal())}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Payment Status</label>
              <select
                value={paymentStatus}
                onChange={e => setPaymentStatus(e.target.value as 'paid' | 'partial' | 'credit')}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 outline-none"
              >
                <option value="paid">Paid in Full</option>
                <option value="partial">Partial Payment</option>
                <option value="credit">On Credit</option>
              </select>
            </div>
            {paymentStatus === 'partial' && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Amount Paid</label>
                <input
                  type="number"
                  step="1"
                  min="0"
                  value={amountPaid}
                  onChange={e => setAmountPaid(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 outline-none"
                  placeholder="0"
                />
              </div>
            )}
          </div>

          {paymentStatus !== 'paid' && supplierId && (
            <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
              {paymentStatus === 'credit'
                ? `The full amount (${formatCurrency(calculateTotal())}) will be added to this supplier's credit balance.`
                : `The remaining balance (${formatCurrency(calculateTotal() - (parseInt(amountPaid) || 0))}) will be added to this supplier's credit balance.`}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Note (optional)</label>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 outline-none"
            />
          </div>

          <div className="flex justify-end gap-3">
            <button onClick={() => setModalOpen(false)} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
            <button onClick={handleSave} disabled={saving || items.length === 0} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Saving...' : 'Record Purchase'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={!!viewPurchase} onClose={() => setViewPurchase(null)} title="Purchase Details" size="lg">
        {viewPurchase && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-xs text-slate-500">Date</p>
                <p className="text-sm font-medium text-slate-900">{formatDate(viewPurchase.purchase_date)}</p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-xs text-slate-500">Supplier</p>
                <p className="text-sm font-medium text-slate-900">{viewPurchase.supplier?.name || '—'}</p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-xs text-slate-500">Invoice #</p>
                <p className="text-sm font-medium text-slate-900">{viewPurchase.invoice_number || '—'}</p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-xs text-slate-500">Payment</p>
                <p className="text-sm font-medium text-slate-900 capitalize">
                  {viewPurchase.payment_status}
                  {viewPurchase.payment_status === 'partial' && ` (${formatCurrency(viewPurchase.amount_paid)} paid)`}
                </p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-xs text-slate-500">Note</p>
                <p className="text-sm font-medium text-slate-900">{viewPurchase.note || '—'}</p>
              </div>
            </div>
            <div className="overflow-hidden rounded-xl border border-slate-200">
              <table className="w-full">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600">Product</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-slate-600">Qty</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-slate-600">Buy Price</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-slate-600">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {viewItems.map(item => (
                    <tr key={item.id}>
                      <td className="px-3 py-2 text-sm text-slate-900">{item.product?.name || '—'}</td>
                      <td className="px-3 py-2 text-sm text-slate-600 text-right">{item.quantity}</td>
                      <td className="px-3 py-2 text-sm text-slate-600 text-right">{formatCurrency(item.buying_price)}</td>
                      <td className="px-3 py-2 text-sm font-medium text-slate-900 text-right">{formatCurrency(item.total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50">
                  <tr>
                    <td colSpan={3} className="px-3 py-2 text-sm font-semibold text-slate-900 text-right">Total</td>
                    <td className="px-3 py-2 text-sm font-bold text-slate-900 text-right">{formatCurrency(viewPurchase.total_amount)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
