import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { formatCurrency, formatNumber } from '@/lib/utils';
import { logAudit } from '@/lib/audit';
import { PageHeader } from '@/components/ui/PageHeader';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  Package, Plus, Search, Pencil, Trash2, AlertTriangle,
} from 'lucide-react';
import type { Product, Category, Supplier } from '@/types';

interface CatalogVariant {
  id: number; sku: string; barcode: string | null; product_name: string;
  product_description: string | null; subcategory: string; category: string;
  brand: string | null; size_specification: string | null; unit: string;
  variant_description: string | null; cost_price: number; selling_price: number;
}

export function Products() {
  const { isAdmin } = useAuth();
  const { showToast } = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [catalog, setCatalog] = useState<CatalogVariant[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [selectedCatalogId, setSelectedCatalogId] = useState('');
  const [catalogSearch, setCatalogSearch] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: '', category_id: '', supplier_id: '', brand: '', unit: 'pcs',
    buying_price: '', selling_price: '', current_stock: '',
    minimum_stock: '', maximum_stock: '', status: 'active',
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    const [{ data: prods }, { data: cats }, { data: sups }] = await Promise.all([
      supabase.from('products').select('*, category:categories(*), supplier:suppliers(*)').order('name'),
      supabase.from('categories').select('*').order('name'),
      supabase.from('suppliers').select('*').order('name'),
    ]);
    const { data: catalogItems } = await supabase.from('hardware_catalog_variants').select('*').order('product_name').limit(5000);
    setProducts(prods || []);
    setCategories(cats || []);
    setCatalog((catalogItems || []) as CatalogVariant[]);
    setSuppliers(sups || []);
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const filtered = products.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.brand || '').toLowerCase().includes(search.toLowerCase()) ||
      (p.catalog_sku || '').toLowerCase().includes(search.toLowerCase());
    const matchesCategory = filterCategory === 'all' || p.category_id === filterCategory;
    const matchesStatus = filterStatus === 'all' || p.status === filterStatus;
    return matchesSearch && matchesCategory && matchesStatus;
  });

  const openAdd = () => {
    setEditingProduct(null);
    setSelectedCatalogId('');
    setCatalogSearch('');
    setFormData({
      name: '', category_id: '', supplier_id: '', brand: '', unit: 'pcs',
      buying_price: '', selling_price: '', current_stock: '',
      minimum_stock: '', maximum_stock: '', status: 'active',
    });
    setModalOpen(true);
  };

  const openEdit = (p: Product) => {
    setEditingProduct(p);
    setSelectedCatalogId(String(p.catalog_variant_id || ''));
    setFormData({
      name: p.name, category_id: p.category_id || '', supplier_id: p.supplier_id || '',
      brand: p.brand || '', unit: p.unit, buying_price: String(p.buying_price),
      selling_price: String(p.selling_price), current_stock: String(p.current_stock),
      minimum_stock: String(p.minimum_stock), maximum_stock: String(p.maximum_stock),
      status: p.status,
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    const catalogItem = catalog.find(item => String(item.id) === selectedCatalogId);
    if (!editingProduct && !catalogItem) {
      showToast('Select an item from the hardware catalogue', 'error');
      return;
    }
    const payload = {
      name: editingProduct?.name || catalogItem?.product_name || '',
      ...(!editingProduct && { catalog_variant_id: catalogItem?.id }),
      ...(!editingProduct && { catalog_sku: catalogItem?.sku }),
      category_id: editingProduct?.category_id ||
        (catalogItem && categories.find(category => category.name === catalogItem.category)?.id) ||
        formData.category_id || null,
      supplier_id: formData.supplier_id || null,
      brand: editingProduct?.brand || catalogItem?.brand || null,
      unit: editingProduct?.unit || catalogItem?.unit || 'piece',
      buying_price: parseInt(formData.buying_price) || 0,
      selling_price: parseInt(formData.selling_price) || 0,
      ...(!editingProduct && { current_stock: parseInt(formData.current_stock) || 0 }),
      minimum_stock: parseInt(formData.minimum_stock) || 0,
      maximum_stock: parseInt(formData.maximum_stock) || 0,
      status: formData.status,
    };

    if (editingProduct) {
      const { error } = await supabase.from('products').update(payload).eq('id', editingProduct.id);
      if (error) {
        showToast('Failed to update product', 'error');
      } else {
        await logAudit('UPDATE_PRODUCT', 'product', editingProduct.id, `Updated product: ${payload.name}`, editingProduct as unknown as Record<string, unknown>, payload);
        showToast('Product updated successfully', 'success');
        setModalOpen(false);
        loadData();
      }
    } else {
      const { data, error } = await supabase.from('products').insert(payload).select().single();
      if (error) {
        showToast(error.message || 'Failed to add catalogue product', 'error');
      } else {
        await logAudit('CREATE_PRODUCT', 'product', data.id, `Created product: ${payload.name}`, null, payload);
        showToast('Catalogue item added to inventory', 'success');
        setModalOpen(false);
        loadData();
      }
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    const product = products.find(p => p.id === deleteId);
    const { error } = await supabase.from('products').update({ status: 'inactive' }).eq('id', deleteId);
    if (error) {
      showToast('Failed to deactivate product', 'error');
    } else {
      await logAudit('DELETE_PRODUCT', 'product', deleteId, `Deactivated product: ${product?.name || ''}`);
      showToast('Product deactivated', 'success');
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
        title="Products"
        subtitle={`${products.length} products in inventory`}
        actions={isAdmin && (
          <button onClick={openAdd} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors">
            <Plus size={18} /> Add from Catalogue
          </button>
        )}
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search products..."
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-10 pr-4 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none"
          />
        </div>
        <select
          value={filterCategory}
          onChange={e => setFilterCategory(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 outline-none"
        >
          <option value="all">All Categories</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 outline-none"
        >
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
          <EmptyState icon={Package} title="No products found" description="Select an item from the hardware catalogue to add it to inventory." action={isAdmin && (
            <button onClick={openAdd} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
              <Plus size={18} /> Add from Catalogue
            </button>
          )} />
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Product</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Category</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600">Buy Price</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600">Sell Price</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600">Profit/Unit</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600">Stock</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600">Stock Value</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-slate-600">Status</th>
                  {isAdmin && <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map(p => {
                  const lowStock = p.current_stock <= p.minimum_stock && p.status === 'active';
                  return (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div>
                            <p className="text-sm font-medium text-slate-900">{p.name}</p>
                            <p className="text-xs text-slate-400">{p.catalog_sku ? `${p.catalog_sku} · ` : ''}{p.brand || '—'}{p.catalog_size_specification ? ` · ${p.catalog_size_specification}` : ''} · {p.unit}</p>
                          </div>
                          {lowStock && (
                            <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
                              <AlertTriangle size={12} /> Low
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">{p.category?.name || '—'}</td>
                      <td className="px-4 py-3 text-sm text-slate-600 text-right">{formatCurrency(p.buying_price)}</td>
                      <td className="px-4 py-3 text-sm font-medium text-slate-900 text-right">{formatCurrency(p.selling_price)}</td>
                      <td className="px-4 py-3 text-sm text-right font-medium text-emerald-600">{formatCurrency(p.profit_per_unit || (p.selling_price - p.buying_price))}</td>
                      <td className={`px-4 py-3 text-sm text-right font-medium ${lowStock ? 'text-amber-600' : 'text-slate-900'}`}>
                        {formatNumber(p.current_stock)}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600 text-right">{formatCurrency(p.current_stock * p.buying_price)}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          p.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                        }`}>
                          {p.status === 'active' ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      {isAdmin && (
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button onClick={() => openEdit(p)} className="rounded-lg p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600">
                              <Pencil size={16} />
                            </button>
                            <button onClick={() => setDeleteId(p.id)} className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600">
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editingProduct ? 'Edit Inventory Item' : 'Add from Hardware Catalogue'} size="lg">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-slate-700 mb-1">Hardware Catalogue Item *</label>
            {editingProduct ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">{editingProduct.name} · {editingProduct.catalog_sku || 'Legacy inventory item'}</div>
            ) : (
              <>
              <input value={catalogSearch} onChange={e => setCatalogSearch(e.target.value)} placeholder="Search name, SKU, brand, size, or category" className="mb-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 outline-none" />
              <select value={selectedCatalogId} onChange={e => {
                const item = catalog.find(option => String(option.id) === e.target.value);
                setSelectedCatalogId(e.target.value);
                if (item) setFormData(current => ({ ...current, buying_price: String(item.cost_price), selling_price: String(item.selling_price) }));
              }} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 outline-none">
                <option value="">Select a catalogue item…</option>
                {catalog.filter(item => `${item.product_name} ${item.sku} ${item.brand || ''} ${item.size_specification || ''} ${item.category}`.toLowerCase().includes(catalogSearch.toLowerCase())).map(item => <option key={item.id} value={item.id}>{item.product_name} · {item.brand || 'Generic'} · {item.size_specification || item.unit} · {item.sku}</option>)}
              </select>
              </>
            )}
            {!editingProduct && catalog.length === 0 && <p className="mt-1 text-xs text-amber-700">Catalogue is unavailable or not imported yet. Apply the hardware catalogue migration first.</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Category</label>
            <select
              value={formData.category_id}
              onChange={e => setFormData({ ...formData, category_id: e.target.value })}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 outline-none"
            >
              <option value="">None</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Supplier</label>
            <select
              value={formData.supplier_id}
              onChange={e => setFormData({ ...formData, supplier_id: e.target.value })}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 outline-none"
            >
              <option value="">None</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Brand</label>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">{editingProduct?.brand || catalog.find(item => String(item.id) === selectedCatalogId)?.brand || 'From catalogue'}</div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Unit</label>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">{editingProduct?.unit || catalog.find(item => String(item.id) === selectedCatalogId)?.unit || 'From catalogue'}</div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Buying Price (integer)</label>
            <input
              type="number"
              step="1"
              min="0"
              value={formData.buying_price}
              onChange={e => setFormData({ ...formData, buying_price: e.target.value })}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 outline-none"
              placeholder="0"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Selling Price (integer)</label>
            <input
              type="number"
              step="1"
              min="0"
              value={formData.selling_price}
              onChange={e => setFormData({ ...formData, selling_price: e.target.value })}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 outline-none"
              placeholder="0"
            />
            {(parseInt(formData.buying_price) || 0) > 0 && (parseInt(formData.selling_price) || 0) > 0 && (
              <p className="mt-1 text-xs text-emerald-600">
                Auto-calculated profit per unit: {formatCurrency((parseInt(formData.selling_price) || 0) - (parseInt(formData.buying_price) || 0))}
              </p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Current Stock</label>
            <input
              type="number"
              step="1"
              min="0"
              value={formData.current_stock}
              onChange={e => setFormData({ ...formData, current_stock: e.target.value })}
              disabled={!!editingProduct}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 outline-none disabled:bg-slate-50 disabled:text-slate-400"
              placeholder="0"
            />
            {editingProduct && <p className="mt-1 text-xs text-slate-400">Use stock adjustments to change stock</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Minimum Stock</label>
            <input
              type="number"
              step="1"
              min="0"
              value={formData.minimum_stock}
              onChange={e => setFormData({ ...formData, minimum_stock: e.target.value })}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 outline-none"
              placeholder="0"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Maximum Stock</label>
            <input
              type="number"
              step="1"
              min="0"
              value={formData.maximum_stock}
              onChange={e => setFormData({ ...formData, maximum_stock: e.target.value })}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 outline-none"
              placeholder="0"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
            <select
              value={formData.status}
              onChange={e => setFormData({ ...formData, status: e.target.value })}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 outline-none"
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <button onClick={() => setModalOpen(false)} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button onClick={handleSave} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
            {editingProduct ? 'Save Changes' : 'Add Inventory Item'}
          </button>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Deactivate Product"
        message="This will mark the product as inactive. It will no longer appear in active inventory. This action can be reversed."
        confirmLabel="Deactivate"
        danger
      />
    </div>
  );
}
