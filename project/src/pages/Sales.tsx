import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { useToast } from '@/components/ui/Toast';
import { formatCurrency, formatDate } from '@/lib/utils';
import { logAudit } from '@/lib/audit';
import { PageHeader } from '@/components/ui/PageHeader';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  ShoppingCart, Plus, Search, Eye, X,
} from 'lucide-react';
import type { Sale, Product, SaleItem } from '@/types';

export function Sales() {
  const { isAdmin, canRecordSales } = useAuth();
  const canCreateSale = isAdmin || canRecordSales;
  const { showToast } = useToast();
  const [sales, setSales] = useState<Sale[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [viewSale, setViewSale] = useState<Sale | null>(null);
  const [viewItems, setViewItems] = useState<SaleItem[]>([]);
  const [saleItems, setSaleItems] = useState<{ product_id: string; quantity: string }[]>([]);
  const [customerName, setCustomerName] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [saleDate, setSaleDate] = useState(new Date().toISOString().split('T')[0]);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    const [{ data: s }, { data: p }] = await Promise.all([
      supabase.from('sales').select('*').order('created_at', { ascending: false }),
      supabase.from('products').select('*').eq('status', 'active')
        .not('catalog_variant_id', 'is', null).order('name'),
    ]);
    setSales(s || []);
    setProducts(p || []);
    if (!quiet) setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);
  useRealtimeRefresh(loadData);

  const filtered = sales.filter(s =>
    (s.sale_number || '').toLowerCase().includes(search.toLowerCase()) ||
    (s.customer_name || '').toLowerCase().includes(search.toLowerCase())
  );

  const addItem = () => {
    setSaleItems(items => [...items, { product_id: '', quantity: '1' }]);
  };

  const removeItem = (index: number) => {
    setSaleItems(saleItems.filter((_, i) => i !== index));
  };

  const updateItem = (index: number, field: 'product_id' | 'quantity', value: string) => {
    setSaleItems(items => items.map((item, i) => i === index ? { ...item, [field]: value } : item));
  };

  const calculateTotal = () => {
    return saleItems.reduce((sum, item) => {
      const qty = Number(item.quantity) || 0;
      const product = products.find(p => p.id === item.product_id);
      if (!product) return sum;
      return sum + qty * product.selling_price;
    }, 0);
  };

  const calculateProfit = () => {
    return saleItems.reduce((sum, item) => {
      const qty = Number(item.quantity) || 0;
      const product = products.find(p => p.id === item.product_id);
      if (!product) return sum;
      return sum + qty * (product.selling_price - product.buying_price);
    }, 0);
  };

  const openAdd = () => {
    if (!products.length) {
      showToast('Add a catalogue item to inventory before recording a sale', 'error');
      return;
    }
    setSaleItems([{ product_id: '', quantity: '1' }]);
    setCustomerName('');
    setPaymentMethod('cash');
    setSaleDate(new Date().toISOString().split('T')[0]);
    setNote('');
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (saleItems.length === 0 || saleItems.some(i => {
      const product = products.find(p => p.id === i.product_id);
      const quantity = Number(i.quantity);
      return !product?.catalog_variant_id || !Number.isFinite(quantity) || quantity <= 0;
    })) {
      showToast('Please fill in all sale items', 'error');
      return;
    }

    setSaving(true);
    const itemsJson = saleItems.map(i => ({
      product_id: i.product_id,
      quantity: Number(i.quantity),
    }));

    const { data, error } = await supabase.rpc('process_sale', {
      p_sale_items: itemsJson,
      p_customer_name: customerName || null,
      p_payment_method: paymentMethod,
      p_note: note || null,
      p_sale_date: saleDate,
    });

    if (error) {
      showToast(error.message, 'error');
      setSaving(false);
    } else {
      await logAudit('CREATE_SALE', 'sale', data, `Created sale with ${saleItems.length} items`);
      showToast('Sale recorded successfully', 'success');
      setModalOpen(false);
      loadData();
    }
    setSaving(false);
  };

  const viewSaleDetails = async (sale: Sale) => {
    setViewSale(sale);
    const { data } = await supabase
      .from('sale_items')
      .select('*, product:products(*)')
      .eq('sale_id', sale.id);
    setViewItems(data || []);
  };

  if (loading) {
    return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent-500" /></div>;
  }

  return (
    <div>
      <PageHeader
        title="Sales"
        subtitle={`${sales.length} sales recorded`}
        actions={canCreateSale && (
          <button onClick={openAdd} disabled={!products.length} className="flex items-center gap-2 rounded-sm bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-700 disabled:opacity-50 transition-colors">
            <Plus size={18} /> New Sale
          </button>
        )}
      />

      <div className="mb-4 relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" size={18} />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by sale number or customer..."
          className="w-full rounded-sm border py-2 pl-10 pr-4 text-sm focus:ring-2 focus:ring-accent-500/20 outline-none h-10 border-ink-200 bg-paper focus:border-accent-500"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-md bg-paper shadow-xs border border-ink-100">
          <EmptyState icon={ShoppingCart} title="No sales recorded" description={products.length ? "Record your first sale to start tracking revenue." : "Add catalogue products to inventory before recording a sale."} action={canCreateSale && (
            <button onClick={openAdd} disabled={!products.length} className="flex items-center gap-2 rounded-sm bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-700 disabled:opacity-50">
              <Plus size={18} /> New Sale
            </button>
          )} />
        </div>
      ) : (
        <div className="overflow-hidden rounded-md bg-paper shadow-xs border border-ink-100">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-ink-50 border-b border-ink-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-ink-600 uppercase tracking-wide">Sale #</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-ink-600 uppercase tracking-wide">Date</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-ink-600 uppercase tracking-wide">Customer</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-ink-600 uppercase tracking-wide">Payment</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-ink-600 uppercase tracking-wide">Amount</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-ink-600 uppercase tracking-wide">Profit</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-ink-600 uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {filtered.map(sale => (
                  <tr key={sale.id} className="hover:bg-ink-50">
                    <td className="px-4 py-3 text-sm font-medium text-ink-900">{sale.sale_number || '—'}</td>
                    <td className="px-4 py-3 text-sm text-ink-600" data-numeric>{formatDate(sale.sale_date)}</td>
                    <td className="px-4 py-3 text-sm text-ink-600">{sale.customer_name || 'Walk-in'}</td>
                    <td className="px-4 py-3 text-sm text-ink-600 capitalize">{sale.payment_method}</td>
                    <td className="px-4 py-3 text-sm font-semibold text-ink-900 text-right" data-numeric>{formatCurrency(sale.total_amount)}</td>
                    <td className="px-4 py-3 text-sm font-medium text-accent-500 text-right" data-numeric>{formatCurrency(sale.total_profit)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => viewSaleDetails(sale)} className="rounded-sm p-1.5 text-ink-400 hover:bg-accent-50 hover:text-accent-500" aria-label={`View sale ${sale.sale_number || sale.id}`}>
                          <Eye size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="New Sale" size="xl">
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="block text-sm font-medium text-ink-700 mb-1">Customer Name</label>
              <input
                type="text"
                value={customerName}
                onChange={e => setCustomerName(e.target.value)}
                className="w-full rounded-sm border px-3 py-2 text-sm outline-none h-10 border-ink-200 bg-paper focus:border-accent-500"
                placeholder="Walk-in customer"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-700 mb-1">Payment Method</label>
              <select
                value={paymentMethod}
                onChange={e => setPaymentMethod(e.target.value)}
                className="w-full rounded-sm border px-3 py-2 text-sm outline-none h-10 border-ink-200 bg-paper focus:border-accent-500"
              >
                <option value="cash">Cash</option>
                <option value="mpesa">M-Pesa</option>
                <option value="bank">Bank</option>
                <option value="credit">Credit</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-700 mb-1">Sale Date</label>
              <input
                type="date"
                value={saleDate}
                onChange={e => setSaleDate(e.target.value)}
                className="w-full rounded-sm border px-3 py-2 text-sm outline-none h-10 border-ink-200 bg-paper focus:border-accent-500 font-mono tabular-nums"
              />
            </div>
          </div>

          <div className="rounded-md border border-ink-200">
            <div className="flex items-center justify-between border-b border-ink-200 px-4 py-2.5">
              <p className="text-sm font-semibold text-ink-900">Sale Items</p>
              <button onClick={addItem} disabled={!products.length} className="flex items-center gap-1 text-sm text-accent-500 hover:text-accent-700 disabled:opacity-50">
                <Plus size={16} /> Add Item
              </button>
            </div>
            <div className="divide-y divide-ink-100">
              {saleItems.map((item, index) => {
                const selectedProduct = products.find(p => p.id === item.product_id);
                const quantity = Number(item.quantity) || 0;
                const lineTotal = selectedProduct ? quantity * selectedProduct.selling_price : 0;

                return (
                  <div key={index} className="flex items-center gap-3 px-4 py-3">
                    <div className="grid min-w-0 flex-1 grid-cols-1 items-center gap-2 sm:grid-cols-[minmax(0,1fr)_5rem_7rem_7rem]">
                      <select
                        value={item.product_id}
                        onChange={e => updateItem(index, 'product_id', e.target.value)}
                        className="w-full rounded-sm border px-3 py-1.5 text-sm outline-none h-10 border-ink-200 bg-paper focus:border-accent-500"
                      >
                        <option value="">Select catalogue product</option>
                        {products.map(product => (
                          <option key={product.id} value={product.id} disabled={product.current_stock <= 0} data-numeric>
                            {product.name} · {product.catalog_sku} · {product.current_stock} {product.unit}
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        step="1"
                        min="1"
                        value={item.quantity}
                        onChange={e => updateItem(index, 'quantity', e.target.value)}
                        className="w-full rounded-sm border px-2 py-1.5 text-sm outline-none h-10 border-ink-200 bg-paper focus:border-accent-500 font-mono tabular-nums"
                        placeholder="Qty"
                      />
                      <div className="text-sm text-ink-500 sm:text-right" data-numeric>
                        {selectedProduct ? `@ ${formatCurrency(selectedProduct.selling_price)}` : '—'}
                      </div>
                      <div className="text-right text-sm font-medium text-ink-900" data-numeric>
                        {formatCurrency(lineTotal)}
                      </div>
                    </div>
                    <button onClick={() => removeItem(index)} className="rounded-sm p-1 text-ink-400 hover:bg-danger/10 hover:text-danger" aria-label="Remove sale item">
                      <X size={16} />
                    </button>
                  </div>
                );
              })}              {saleItems.length === 0 && (
                <div className="px-4 py-8 text-center text-sm text-ink-400">No items added. Select a catalogue product to start.</div>
              )}
            </div>
            <div className="flex items-center justify-between border-t border-ink-200 px-4 py-3 bg-ink-50">
              <div>
                <span className="text-sm font-semibold text-ink-900">Total: </span>
                <span className="text-lg font-bold text-accent-500" data-numeric>{formatCurrency(calculateTotal())}</span>
              </div>
              <div>
                <span className="text-sm font-semibold text-accent-500">Expected Profit: </span>
                <span className="text-lg font-bold text-accent-500" data-numeric>{formatCurrency(calculateProfit())}</span>
              </div>
            </div>
          </div>

          <div className="rounded-lg bg-accent-50 px-3 py-2 text-sm text-accent-700">
            Products and prices come from catalogue-linked inventory. Sale totals and stock are verified when saved.
          </div>

          <div>
            <label className="block text-sm font-medium text-ink-700 mb-1">Note (optional)</label>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={2}
              className="w-full rounded-sm border px-3 py-2 text-sm outline-none border-ink-200 bg-paper focus:border-accent-500"
              placeholder="Additional notes..."
            />
          </div>

          <div className="flex justify-end gap-3">
            <button onClick={() => setModalOpen(false)} className="rounded-sm px-4 py-2 text-sm font-medium text-ink-600 hover:bg-ink-100">
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || saleItems.length === 0}
              className="rounded-sm bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-700 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Record Sale'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={!!viewSale} onClose={() => setViewSale(null)} title={`Sale ${viewSale?.sale_number || ''}`} size="lg">
        {viewSale && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-lg bg-ink-50 p-3">
                <p className="text-xs text-ink-500">Date</p>
                <p className="text-sm font-medium text-ink-900" data-numeric>{formatDate(viewSale.sale_date)}</p>
              </div>
              <div className="rounded-lg bg-ink-50 p-3">
                <p className="text-xs text-ink-500">Customer</p>
                <p className="text-sm font-medium text-ink-900">{viewSale.customer_name || 'Walk-in'}</p>
              </div>
              <div className="rounded-lg bg-ink-50 p-3">
                <p className="text-xs text-ink-500">Payment Method</p>
                <p className="text-sm font-medium text-ink-900 capitalize">{viewSale.payment_method}</p>
              </div>
              <div className="rounded-lg bg-ink-50 p-3">
                <p className="text-xs text-ink-500">Note</p>
                <p className="text-sm font-medium text-ink-900">{viewSale.note || '—'}</p>
              </div>
            </div>
            <div className="overflow-hidden rounded-md border border-ink-200">
              <table className="w-full">
                <thead className="bg-ink-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-ink-600 uppercase tracking-wide">Product</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-ink-600 uppercase tracking-wide">Qty</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-ink-600 uppercase tracking-wide">Price</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-ink-600 uppercase tracking-wide">Total</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-ink-600 uppercase tracking-wide">Profit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {viewItems.map(item => (
                    <tr key={item.id}>
                      <td className="px-3 py-2 text-sm text-ink-900">{item.product?.name || '—'}</td>
                      <td className="px-3 py-2 text-sm text-ink-600 text-right" data-numeric>{item.quantity}</td>
                      <td className="px-3 py-2 text-sm text-ink-600 text-right" data-numeric>{formatCurrency(item.selling_price)}</td>
                      <td className="px-3 py-2 text-sm font-medium text-ink-900 text-right" data-numeric>{formatCurrency(item.total)}</td>
                      <td className="px-3 py-2 text-sm text-accent-500 text-right" data-numeric>{formatCurrency(item.profit)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-ink-50">
                  <tr>
                    <td colSpan={3} className="px-3 py-2 text-sm font-semibold text-ink-900 text-right">Total</td>
                    <td className="px-3 py-2 text-sm font-bold text-ink-900 text-right" data-numeric>{formatCurrency(viewSale.total_amount)}</td>
                    <td className="px-3 py-2 text-sm font-bold text-accent-500 text-right" data-numeric>{formatCurrency(viewSale.total_profit)}</td>
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
