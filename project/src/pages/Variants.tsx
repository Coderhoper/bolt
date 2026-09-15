import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { PageHeader } from '@/components/ui/PageHeader';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Plus, Package, Pencil, Trash2, AlertTriangle } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { ProductVariant, Product } from '@/types';

export function Variants() {
  const { isAdmin } = useAuth();
  const { showToast } = useToast();
  const [variants, setVariants] = useState<ProductVariant[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ProductVariant | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [form, setForm] = useState({ product_id: '', brand: '', size: '', sku: '', selling_price: '', cost_price: '', current_stock: '' });

  const loadData = useCallback(async () => {
    setLoading(true);
    const [{ data: vars }, { data: prods }] = await Promise.all([
      supabase.from('product_variants').select('*, product:products(*)').order('created_at', { ascending: false }),
      supabase.from('products').select('*').order('name'),
    ]);
    setVariants(vars || []);
    setProducts(prods || []);
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const openAdd = () => {
    setEditing(null);
    setForm({ product_id: '', brand: '', size: '', sku: '', selling_price: '', cost_price: '', current_stock: '' });
    setModalOpen(true);
  };

  const openEdit = (v: ProductVariant) => {
    setEditing(v);
    setForm({
      product_id: v.product_id,
      brand: v.brand || '',
      size: v.size || '',
      sku: v.sku || '',
      selling_price: String(v.selling_price),
      cost_price: String(v.cost_price),
      current_stock: String(v.current_stock),
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    const payload: any = {
      product_id: form.product_id || null,
      brand: form.brand || null,
      size: form.size || null,
      sku: form.sku || null,
      selling_price: parseFloat(form.selling_price) || 0,
      cost_price: parseFloat(form.cost_price) || 0,
      current_stock: parseFloat(form.current_stock) || 0,
    };

    if (!payload.product_id) {
      showToast('Please select a product', 'error');
      return;
    }

    if (editing) {
      const { error } = await supabase.from('product_variants').update(payload).eq('id', editing.id);
      if (error) showToast('Failed to update variant', 'error');
      else { showToast('Variant updated', 'success'); setModalOpen(false); loadData(); }
    } else {
      const { data, error } = await supabase.from('product_variants').insert(payload).select().single();
      if (error) showToast('Failed to create variant', 'error');
      else { showToast('Variant created', 'success'); setModalOpen(false); loadData(); }
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    const { error } = await supabase.from('product_variants').update({ status: 'inactive' }).eq('id', deleteId);
    if (error) showToast('Failed to deactivate variant', 'error');
    else { showToast('Variant deactivated', 'success'); loadData(); }
    setDeleteId(null);
  };

  if (loading) return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>;

  return (
    <div>
      <PageHeader title="Variants" subtitle={`${variants.length} variants`} actions={isAdmin && (<button onClick={openAdd} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"><Plus size={18} /> Add Variant</button>)} />

      {variants.length === 0 ? (
        <div className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
          <EmptyState icon={Package} title="No variants" description="Add product variants to track brands, sizes and stock." action={isAdmin && (<button onClick={openAdd} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"><Plus size={18} /> Add Variant</button>)} />
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Product</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Brand / Size</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600">Sell</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600">Cost</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600">Stock</th>
                  {isAdmin && <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {variants.map(v => (
                  <tr key={v.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-sm text-slate-900">{v.product?.name || '—'}</td>
                    <td className="px-4 py-3 text-sm text-slate-600">{v.brand || '—'} {v.size ? `· ${v.size}` : ''}</td>
                    <td className="px-4 py-3 text-sm text-slate-600 text-right">{formatCurrency(v.selling_price)}</td>
                    <td className="px-4 py-3 text-sm text-slate-600 text-right">{formatCurrency(v.cost_price)}</td>
                    <td className="px-4 py-3 text-sm font-medium text-slate-900 text-right">{v.current_stock}</td>
                    {isAdmin && (
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button onClick={() => openEdit(v)} className="rounded-lg p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600"><Pencil size={16} /></button>
                          <button onClick={() => setDeleteId(v.id)} className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={16} /></button>
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

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Variant' : 'Add Variant'} size="lg">
        <div className="grid grid-cols-1 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Product</label>
            <select value={form.product_id} onChange={e => setForm({ ...form, product_id: e.target.value })} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 outline-none">
              <option value="">Select product</option>
              {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Brand</label>
              <input value={form.brand} onChange={e => setForm({ ...form, brand: e.target.value })} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Size</label>
              <input value={form.size} onChange={e => setForm({ ...form, size: e.target.value })} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Sell Price</label>
              <input type="number" value={form.selling_price} onChange={e => setForm({ ...form, selling_price: e.target.value })} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Cost Price</label>
              <input type="number" value={form.cost_price} onChange={e => setForm({ ...form, cost_price: e.target.value })} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Stock</label>
              <input type="number" value={form.current_stock} onChange={e => setForm({ ...form, current_stock: e.target.value })} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none" />
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <button onClick={() => setModalOpen(false)} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
            <button onClick={handleSave} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">{editing ? 'Save' : 'Create'}</button>
          </div>
        </div>
      </Modal>

      {deleteId && (
        <div className="fixed bottom-4 right-4 z-30 rounded-xl bg-white shadow-2xl ring-1 ring-slate-200 p-4 max-w-xs">
          <p className="text-sm text-slate-700 mb-3">Deactivate this variant? This will not adjust historic sales.</p>
          <div className="flex justify-end gap-2">
            <button onClick={() => setDeleteId(null)} className="rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100">Cancel</button>
            <button onClick={handleDelete} className="rounded-lg bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700">Deactivate</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default Variants;
