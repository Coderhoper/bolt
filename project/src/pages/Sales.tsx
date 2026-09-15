import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { formatCurrency, formatDate } from '@/lib/utils';
import { logAudit } from '@/lib/audit';
import { PageHeader } from '@/components/ui/PageHeader';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  ShoppingCart, Plus, Search, Eye, Trash2, X,
} from 'lucide-react';
import type { Sale, Product, SaleItem } from '@/types';

export function Sales() {
  const { isAdmin } = useAuth();
  const { showToast } = useToast();
  const [sales, setSales] = useState<Sale[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [viewSale, setViewSale] = useState<Sale | null>(null);
  const [viewItems, setViewItems] = useState<SaleItem[]>([]);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [saleItems, setSaleItems] = useState<{ product_id: string; quantity: string }[]>([]);
  const [customerName, setCustomerName] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [saleDate, setSaleDate] = useState(new Date().toISOString().split('T')[0]);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [{ data: s }, { data: p }] = await Promise.all([
      supabase.from('sales').select('*').order('created_at', { ascending: false }),
      supabase.from('products').select('*').eq('status', 'active').order('name'),
    ]);
    setSales(s || []);
    setProducts(p || []);
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const filtered = sales.filter(s =>
    (s.sale_number || '').toLowerCase().includes(search.toLowerCase()) ||
    (s.customer_name || '').toLowerCase().includes(search.toLowerCase())
  );

  const addItem = () => {
    setSaleItems([...saleItems, { product_id: '', quantity: '1' }]);
  };

  const removeItem = (index: number) => {
    setSaleItems(saleItems.filter((_, i) => i !== index));
  };

  const updateItem = (index: number, field: string, value: string) => {
    const updated = [...saleItems];
    updated[index] = { ...updated[index], [field]: value };
    setSaleItems(updated);
  };

  const calculateTotal = () => {
    return saleItems.reduce((sum, item) => {
      const product = products.find(p => p.id === item.product_id);
      if (!product) return sum;
      return sum + (parseInt(item.quantity) || 0) * product.selling_price;
    }, 0);
  };

  const calculateProfit = () => {
    return saleItems.reduce((sum, item) => {
      const product = products.find(p => p.id === item.product_id);
      if (!product) return sum;
      return sum + (parseInt(item.quantity) || 0) * (product.selling_price - product.buying_price);
    }, 0);
  };

  const openAdd = () => {
    setSaleItems([{ product_id: '', quantity: '1' }]);
    setCustomerName('');
    setPaymentMethod('cash');
    setSaleDate(new Date().toISOString().split('T')[0]);
    setNote('');
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (saleItems.length === 0 || saleItems.some(i => !i.product_id || !i.quantity)) {
      showToast('Please fill in all sale items', 'error');
      return;
    }

    setSaving(true);
    const itemsJson = saleItems.map(i => ({
      product_id: i.product_id,
      quantity: parseInt(i.quantity),
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

  const handleDelete = async () => {
    if (!deleteId) return;
    const sale = sales.find(s => s.id === deleteId);
    const { error } = await supabase.from('sales').delete().eq('id', deleteId);
    if (error) {
      showToast('Failed to delete sale', 'error');
    } else {
      await logAudit('DELETE_SALE', 'sale', deleteId, `Deleted sale ${sale?.sale_number || ''}`);
      showToast('Sale deleted', 'success');
      loadData();
    }
    setDeleteId(null);
  };

  if (loading) {
    return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>;
  }

  return (
    <div>
      <PageHeader
        title="Sales"
        subtitle={`${sales.length} sales recorded`}
        actions={isAdmin && (
          <button onClick={openAdd} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors">
            <Plus size={18} /> New Sale
          </button>
        )}
      />

      <div className="mb-4 relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by sale number or customer..."
          className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-10 pr-4 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
          <EmptyState icon={ShoppingCart} title="No sales recorded" description="Record your first sale to start tracking revenue." action={isAdmin && (
            <button onClick={openAdd} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
              <Plus size={18} /> New Sale
            </button>
          )} />
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Sale #</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Date</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Customer</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Payment</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600">Amount</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600">Profit</th>
                  {isAdmin && <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map(sale => (
                  <tr key={sale.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-sm font-medium text-slate-900">{sale.sale_number || '—'}</td>
                    <td className="px-4 py-3 text-sm text-slate-600">{formatDate(sale.sale_date)}</td>
                    <td className="px-4 py-3 text-sm text-slate-600">{sale.customer_name || 'Walk-in'}</td>
                    <td className="px-4 py-3 text-sm text-slate-600 capitalize">{sale.payment_method}</td>
                    <td className="px-4 py-3 text-sm font-semibold text-slate-900 text-right">{formatCurrency(sale.total_amount)}</td>
                    <td className="px-4 py-3 text-sm font-medium text-emerald-600 text-right">{formatCurrency(sale.total_profit)}</td>
                    {isAdmin && (
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button onClick={() => viewSaleDetails(sale)} className="rounded-lg p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600">
                            <Eye size={16} />
                          </button>
                          <button onClick={() => setDeleteId(sale.id)} className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600">
                            <Trash2 size={16} />
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

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="New Sale" size="xl">
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Customer Name</label>
              <input
                type="text"
                value={customerName}
                onChange={e => setCustomerName(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 outline-none"
                placeholder="Walk-in customer"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Payment Method</label>
              <select
                value={paymentMethod}
                onChange={e => setPaymentMethod(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 outline-none"
              >
                <option value="cash">Cash</option>
                <option value="mpesa">M-Pesa</option>
                <option value="bank">Bank</option>
                <option value="credit">Credit</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Sale Date</label>
              <input
                type="date"
                value={saleDate}
                onChange={e => setSaleDate(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 outline-none"
              />
            </div>
          </div>

          <div className="rounded-xl border border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
              <p className="text-sm font-semibold text-slate-900">Sale Items</p>
              <button onClick={addItem} className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700">
                <Plus size={16} /> Add Item
              </button>
            </div>
            <div className="divide-y divide-slate-100">
              {saleItems.map((item, index) => {
                const product = products.find(p => p.id === item.product_id);
                const lineTotal = product ? (parseInt(item.quantity) || 0) * product.selling_price : 0;
                return (
                  <div key={index} className="flex items-center gap-3 px-4 py-3">
                    <div className="flex-1">
                      <select
                        value={item.product_id}
                        onChange={e => updateItem(index, 'product_id', e.target.value)}
                        className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:border-blue-500 outline-none"
                      >
                        <option value="">Select product...</option>
                        {products.map(p => (
                          <option key={p.id} value={p.id} disabled={p.current_stock <= 0}>
                            {p.name} ({p.current_stock} {p.unit} in stock)
                          </option>
                        ))}
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
                    <div className="w-28 text-sm text-slate-500 text-right">
                      {product ? `@ ${formatCurrency(product.selling_price)}` : '—'}
                    </div>
                    <div className="w-24 text-right text-sm font-medium text-slate-900">
                      {formatCurrency(lineTotal)}
                    </div>
                    <button onClick={() => removeItem(index)} className="rounded-lg p-1 text-slate-400 hover:bg-red-50 hover:text-red-600">
                      <X size={16} />
                    </button>
                  </div>
                );
              })}
              {saleItems.length === 0 && (
                <div className="px-4 py-8 text-center text-sm text-slate-400">No items added. Click "Add Item" to start.</div>
              )}
            </div>
            <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 bg-slate-50">
              <div>
                <span className="text-sm font-semibold text-slate-900">Total: </span>
                <span className="text-lg font-bold text-blue-600">{formatCurrency(calculateTotal())}</span>
              </div>
              <div>
                <span className="text-sm font-semibold text-emerald-600">Expected Profit: </span>
                <span className="text-lg font-bold text-emerald-600">{formatCurrency(calculateProfit())}</span>
              </div>
            </div>
          </div>

          <div className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">
            Prices are set universally on each product. To change a price, update it from the Products page.
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Note (optional)</label>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 outline-none"
              placeholder="Additional notes..."
            />
          </div>

          <div className="flex justify-end gap-3">
            <button onClick={() => setModalOpen(false)} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || saleItems.length === 0}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
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
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-xs text-slate-500">Date</p>
                <p className="text-sm font-medium text-slate-900">{formatDate(viewSale.sale_date)}</p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-xs text-slate-500">Customer</p>
                <p className="text-sm font-medium text-slate-900">{viewSale.customer_name || 'Walk-in'}</p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-xs text-slate-500">Payment Method</p>
                <p className="text-sm font-medium text-slate-900 capitalize">{viewSale.payment_method}</p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-xs text-slate-500">Note</p>
                <p className="text-sm font-medium text-slate-900">{viewSale.note || '—'}</p>
              </div>
            </div>
            <div className="overflow-hidden rounded-xl border border-slate-200">
              <table className="w-full">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600">Product</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-slate-600">Qty</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-slate-600">Price</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-slate-600">Total</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-slate-600">Profit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {viewItems.map(item => (
                    <tr key={item.id}>
                      <td className="px-3 py-2 text-sm text-slate-900">{item.product?.name || '—'}</td>
                      <td className="px-3 py-2 text-sm text-slate-600 text-right">{item.quantity}</td>
                      <td className="px-3 py-2 text-sm text-slate-600 text-right">{formatCurrency(item.selling_price)}</td>
                      <td className="px-3 py-2 text-sm font-medium text-slate-900 text-right">{formatCurrency(item.total)}</td>
                      <td className="px-3 py-2 text-sm text-emerald-600 text-right">{formatCurrency(item.profit)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50">
                  <tr>
                    <td colSpan={3} className="px-3 py-2 text-sm font-semibold text-slate-900 text-right">Total</td>
                    <td className="px-3 py-2 text-sm font-bold text-slate-900 text-right">{formatCurrency(viewSale.total_amount)}</td>
                    <td className="px-3 py-2 text-sm font-bold text-emerald-600 text-right">{formatCurrency(viewSale.total_profit)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
      </Modal>

      {isAdmin && deleteId && (
        <div className="fixed bottom-4 right-4 z-30 rounded-xl bg-white shadow-2xl ring-1 ring-slate-200 p-4 max-w-xs">
          <p className="text-sm text-slate-700 mb-3">Delete this sale? This will not restore stock levels.</p>
          <div className="flex justify-end gap-2">
            <button onClick={() => setDeleteId(null)} className="rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100">Cancel</button>
            <button onClick={handleDelete} className="rounded-lg bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700">Delete</button>
          </div>
        </div>
      )}
    </div>
  );
}
