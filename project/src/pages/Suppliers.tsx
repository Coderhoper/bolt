import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { formatCurrency, formatDate } from '@/lib/utils';
import { logAudit } from '@/lib/audit';
import { PageHeader } from '@/components/ui/PageHeader';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { Truck, Plus, Pencil, Search, Eye, Wallet, ShieldCheck } from 'lucide-react';
import type { Supplier, Purchase, Product } from '@/types';

interface SupplierProductMap {
  product_id: string;
  supplier_sku: string | null;
  unit: string | null;
  conversion_factor: number;
  lead_time_days: number | null;
  is_preferred: boolean;
  product?: Pick<Product, 'name' | 'catalog_sku' | 'unit'>;
}

export function Suppliers() {
  const { isAdmin } = useAuth();
  const { showToast } = useToast();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewSupplier, setViewSupplier] = useState<Supplier | null>(null);
  const [supplierPurchases, setSupplierPurchases] = useState<Purchase[]>([]);
  const [supplierProducts, setSupplierProducts] = useState<SupplierProductMap[]>([]);
  const [catalogProducts, setCatalogProducts] = useState<Product[]>([]);
  const [mapForm, setMapForm] = useState({ product_id: '', supplier_sku: '', unit: '', conversion_factor: '1', lead_time_days: '', is_preferred: false });
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentSupplier, setPaymentSupplier] = useState<Supplier | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [formData, setFormData] = useState({
    name: '', supplier_code: '', legal_name: '', tax_id: '', registration_no: '', tier: 'TIER_1', payment_terms: '',
    contact_person: '', phone: '', email: '', address: '',
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('suppliers').select('*').order('name');
    setSuppliers(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const filtered = suppliers.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    (s.supplier_code || '').toLowerCase().includes(search.toLowerCase()) ||
    (s.contact_person || '').toLowerCase().includes(search.toLowerCase()) ||
    (s.phone || '').toLowerCase().includes(search.toLowerCase())
  );

  const openAdd = () => {
    setEditingId(null);
    setFormData({ name: '', supplier_code: '', legal_name: '', tax_id: '', registration_no: '', tier: 'TIER_1', payment_terms: '', contact_person: '', phone: '', email: '', address: '' });
    setModalOpen(true);
  };

  const openEdit = (s: Supplier) => {
    setEditingId(s.id);
    setFormData({
      name: s.name, contact_person: s.contact_person || '', phone: s.phone || '',
      email: s.email || '', address: s.address || '',
      supplier_code: s.supplier_code || '', legal_name: s.legal_name || s.name,
      tax_id: s.tax_id || '', registration_no: s.registration_no || '',
      tier: s.tier || 'TIER_1', payment_terms: s.payment_terms || '',
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    const payload = {
      name: formData.name,
      supplier_code: formData.supplier_code.trim().toUpperCase() || null,
      legal_name: formData.legal_name.trim() || formData.name,
      tax_id: formData.tax_id.trim() || null,
      registration_no: formData.registration_no.trim() || null,
      tier: formData.tier,
      payment_terms: formData.payment_terms.trim() || null,
      contact_person: formData.contact_person || null,
      phone: formData.phone || null,
      email: formData.email || null,
      address: formData.address || null,
    };
    if (!payload.name || !payload.supplier_code) { showToast('Supplier name and supplier code are required', 'error'); return; }

    if (editingId) {
      const { error } = await supabase.from('suppliers').update(payload).eq('id', editingId);
      if (error) { showToast('Failed to update supplier', 'error'); return; }
      await logAudit('UPDATE_SUPPLIER', 'supplier', editingId, `Updated supplier: ${payload.name}`);
      showToast('Supplier updated', 'success');
    } else {
      const { data, error } = await supabase.from('suppliers').insert({ ...payload, status: 'PENDING' }).select().single();
      if (error) { showToast('Failed to create supplier', 'error'); return; }
      await logAudit('CREATE_SUPPLIER', 'supplier', data.id, `Created supplier: ${payload.name}`);
      showToast('Supplier added', 'success');
    }
    setModalOpen(false);
    loadData();
  };

  const transitionSupplier = async (supplier: Supplier, action: 'approve' | 'suspend' | 'blacklist' | 'archive' | 'reactivate') => {
    const reason = window.prompt(`Reason to ${action} ${supplier.name}:`);
    if (!reason?.trim()) return;
    const { error } = await supabase.rpc('transition_supplier_status', {
      p_supplier_id: supplier.id, p_action: action, p_reason: reason.trim(),
    });
    if (error) showToast(error.message, 'error');
    else { showToast(`Supplier ${action} complete`, 'success'); await loadData(); }
  };

  const viewSupplierDetails = async (s: Supplier) => {
    setViewSupplier(s);
    setMapForm({ product_id: '', supplier_sku: '', unit: '', conversion_factor: '1', lead_time_days: '', is_preferred: false });
    const [purchaseResult, mapResult, productsResult] = await Promise.all([
      supabase.from('purchases').select('*').eq('supplier_id', s.id).order('purchase_date', { ascending: false }),
      supabase.from('supplier_products').select('*, product:products(name, catalog_sku, unit)').eq('supplier_id', s.id).order('is_preferred', { ascending: false }),
      supabase.from('products').select('*').eq('status', 'active').order('name'),
    ]);
    setSupplierPurchases(purchaseResult.data || []);
    setSupplierProducts((mapResult.data || []) as unknown as SupplierProductMap[]);
    setCatalogProducts((productsResult.data || []) as Product[]);
  };

  const saveSupplierProduct = async () => {
    if (!viewSupplier || !mapForm.product_id || Number(mapForm.conversion_factor) <= 0) {
      showToast('Choose a product and enter a positive conversion factor', 'error'); return;
    }
    const { error } = await supabase.rpc('map_supplier_product', {
      p_supplier_id: viewSupplier.id,
      p_product_id: mapForm.product_id,
      p_supplier_sku: mapForm.supplier_sku.trim() || null,
      p_unit: mapForm.unit.trim() || null,
      p_conversion_factor: Number(mapForm.conversion_factor),
      p_lead_time_days: mapForm.lead_time_days ? Number(mapForm.lead_time_days) : null,
      p_is_preferred: mapForm.is_preferred,
    });
    if (error) showToast(error.message, 'error');
    else {
      const { data } = await supabase.from('supplier_products').select('*, product:products(name, catalog_sku, unit)').eq('supplier_id', viewSupplier.id).order('is_preferred', { ascending: false });
      setSupplierProducts((data || []) as unknown as SupplierProductMap[]);
      setMapForm({ product_id: '', supplier_sku: '', unit: '', conversion_factor: '1', lead_time_days: '', is_preferred: false });
      showToast('Supplier product mapping saved', 'success');
    }
  };

  const openPayment = (s: Supplier) => {
    setPaymentSupplier(s);
    setPaymentAmount('');
    setPaymentModalOpen(true);
  };

  const handlePayment = async () => {
    if (!paymentSupplier || !paymentAmount) {
      showToast('Please enter a payment amount', 'error');
      return;
    }
    const amount = parseInt(paymentAmount) || 0;
    if (amount <= 0) { showToast('Amount must be greater than 0', 'error'); return; }

    const { error } = await supabase.rpc('record_supplier_payment', {
      p_supplier_id: paymentSupplier.id,
      p_amount: amount,
    });
    if (error) {
      showToast('Failed to record payment', 'error');
    } else {
      await logAudit('SUPPLIER_PAYMENT', 'supplier', paymentSupplier.id, `Paid ${formatCurrency(amount)} to ${paymentSupplier.name}`);
      showToast('Payment recorded', 'success');
      setPaymentModalOpen(false);
      loadData();
    }
  };

  if (loading) {
    return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent-500" /></div>;
  }

  const totalCredit = suppliers.reduce((sum, s) => sum + (s.credit_balance || 0), 0);

  return (
    <div>
      <PageHeader
        title="Suppliers"
        subtitle={`${suppliers.length} suppliers · Total outstanding credit: ${formatCurrency(totalCredit)}`}
        actions={isAdmin && (
          <button onClick={openAdd} className="flex items-center gap-2 rounded-sm bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-700 transition-colors">
            <Plus size={18} /> Add Supplier
          </button>
        )}
      />

      <div className="mb-4 relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" size={18} />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search suppliers..."
          className="w-full rounded-sm border py-2 pl-10 pr-4 text-sm focus:ring-2 focus:ring-accent-500/20 outline-none h-10 border-ink-200 bg-paper focus:border-accent-500"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-md bg-paper shadow-xs border border-ink-100">
          <EmptyState icon={Truck} title="No suppliers found" description="Add your first supplier to start tracking purchases and credit." action={isAdmin && (
            <button onClick={openAdd} className="flex items-center gap-2 rounded-sm bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-700">
              <Plus size={18} /> Add Supplier
            </button>
          )} />
        </div>
      ) : (
        <div className="overflow-hidden rounded-md bg-paper shadow-xs border border-ink-100">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-ink-50 border-b border-ink-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-ink-600 uppercase tracking-wide">Name</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-ink-600 uppercase tracking-wide">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-ink-600 uppercase tracking-wide">Contact</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-ink-600 uppercase tracking-wide">Phone</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-ink-600 uppercase tracking-wide">Credit Balance</th>
                  {isAdmin && <th className="px-4 py-3 text-right text-xs font-medium text-ink-600 uppercase tracking-wide">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {filtered.map(s => (
                  <tr key={s.id} className="hover:bg-ink-50">
                    <td className="px-4 py-3 text-sm font-medium text-ink-900"><span className="block">{s.name}</span><span className="text-xs font-normal text-ink-500">{s.supplier_code || 'No code'} · {s.tier || 'TIER_1'}</span></td>
                    <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${s.status === 'ACTIVE' ? 'bg-accent-50 text-accent-700' : s.status === 'PENDING' ? 'bg-warning/10 text-warning' : s.status === 'BLACKLISTED' ? 'bg-danger/10 text-danger' : s.status === 'SUSPENDED' ? 'bg-warning/10 text-warning' : 'bg-ink-100 text-ink-600'}`}>{s.status || 'ACTIVE'}</span></td>
                    <td className="px-4 py-3 text-sm text-ink-600">{s.contact_person || '—'}</td>
                    <td className="px-4 py-3 text-sm text-ink-600">{s.phone || '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={`text-sm font-semibold ${(s.credit_balance || 0) > 0 ? 'text-danger' : 'text-ink-400'}`} data-numeric>
                        {formatCurrency(s.credit_balance || 0)}
                      </span>
                    </td>
                    {isAdmin && (
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button onClick={() => viewSupplierDetails(s)} className="rounded-sm p-1.5 text-ink-400 hover:bg-accent-50 hover:text-accent-500" title="View history">
                            <Eye size={16} />
                          </button>
                          {(s.credit_balance || 0) > 0 && (
                            <button onClick={() => openPayment(s)} className="flex items-center gap-1 rounded-sm bg-accent-50 px-2 py-1 text-xs font-medium text-accent-700 hover:bg-accent-100" title="Record payment">
                              <Wallet size={14} /> Pay
                            </button>
                          )}
                          <button onClick={() => openEdit(s)} className="rounded-sm p-1.5 text-ink-400 hover:bg-accent-50 hover:text-accent-500">
                            <Pencil size={16} />
                          </button>
                          {s.status === 'PENDING' && <button onClick={() => void transitionSupplier(s, 'approve')} className="inline-flex items-center gap-1 rounded-sm bg-accent-50 px-2 py-1.5 text-xs font-semibold text-accent-700 hover:bg-accent-100"><ShieldCheck size={14} /> Approve</button>}
                          {s.status === 'ACTIVE' && <button onClick={() => void transitionSupplier(s, 'suspend')} className="rounded-sm bg-warning/10 px-2 py-1.5 text-xs font-semibold text-warning hover:bg-warning/10">Suspend</button>}
                          {['SUSPENDED', 'BLACKLISTED'].includes(s.status || '') && <button onClick={() => void transitionSupplier(s, 'reactivate')} className="rounded-sm bg-accent-50 px-2 py-1.5 text-xs font-semibold text-accent-700 hover:bg-accent-100">Reactivate</button>}
                          {s.status !== 'ARCHIVED' && s.status !== 'ACTIVE' && <button onClick={() => void transitionSupplier(s, 'archive')} className="rounded-sm bg-ink-100 px-2 py-1.5 text-xs font-semibold text-ink-700 hover:bg-ink-200">Archive</button>}
                          {['ACTIVE', 'SUSPENDED'].includes(s.status || '') && <button onClick={() => void transitionSupplier(s, 'blacklist')} className="rounded-sm p-1.5 text-ink-400 hover:bg-danger/10 hover:text-danger" title="Blacklist supplier">×</button>}
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

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editingId ? 'Edit Supplier' : 'Add Supplier'}>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-ink-700 mb-1">Supplier Name *</label>
            <input
              type="text"
              value={formData.name}
              onChange={e => setFormData({ ...formData, name: e.target.value })}
              className="w-full rounded-sm border px-3 py-2 text-sm outline-none h-10 border-ink-200 bg-paper focus:border-accent-500"
              placeholder="ABC Suppliers Ltd"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="mb-1 block text-sm font-medium text-ink-700">Supplier Code *</label><input type="text" value={formData.supplier_code} onChange={e => setFormData({ ...formData, supplier_code: e.target.value.toUpperCase() })} className="w-full rounded-sm border px-3 py-2 text-sm outline-none h-10 border-ink-200 bg-paper focus:border-accent-500" placeholder="ABC-001" /></div>
            <div><label className="mb-1 block text-sm font-medium text-ink-700">Supplier Tier</label><select value={formData.tier} onChange={e => setFormData({ ...formData, tier: e.target.value })} className="w-full rounded-sm border px-3 py-2 text-sm outline-none h-10 border-ink-200 bg-paper focus:border-accent-500"><option value="TIER_1">Tier 1</option><option value="TIER_2">Tier 2</option><option value="TIER_3">Tier 3</option></select></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="mb-1 block text-sm font-medium text-ink-700">Legal Name</label><input value={formData.legal_name} onChange={e => setFormData({ ...formData, legal_name: e.target.value })} className="w-full rounded-sm border px-3 py-2 text-sm outline-none h-10 border-ink-200 bg-paper focus:border-accent-500" placeholder="Registered business name" /></div>
            <div><label className="mb-1 block text-sm font-medium text-ink-700">Payment Terms</label><input value={formData.payment_terms} onChange={e => setFormData({ ...formData, payment_terms: e.target.value })} className="w-full rounded-sm border px-3 py-2 text-sm outline-none h-10 border-ink-200 bg-paper focus:border-accent-500" placeholder="Net 30" /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="mb-1 block text-sm font-medium text-ink-700">Tax ID</label><input value={formData.tax_id} onChange={e => setFormData({ ...formData, tax_id: e.target.value })} className="w-full rounded-sm border px-3 py-2 text-sm outline-none h-10 border-ink-200 bg-paper focus:border-accent-500" /></div>
            <div><label className="mb-1 block text-sm font-medium text-ink-700">Registration Number</label><input value={formData.registration_no} onChange={e => setFormData({ ...formData, registration_no: e.target.value })} className="w-full rounded-sm border px-3 py-2 text-sm outline-none h-10 border-ink-200 bg-paper focus:border-accent-500" /></div>
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-700 mb-1">Contact Person</label>
            <input
              type="text"
              value={formData.contact_person}
              onChange={e => setFormData({ ...formData, contact_person: e.target.value })}
              className="w-full rounded-sm border px-3 py-2 text-sm outline-none h-10 border-ink-200 bg-paper focus:border-accent-500"
              placeholder="John Smith"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-ink-700 mb-1">Phone</label>
              <input
                type="text"
                value={formData.phone}
                onChange={e => setFormData({ ...formData, phone: e.target.value })}
                className="w-full rounded-sm border px-3 py-2 text-sm outline-none h-10 border-ink-200 bg-paper focus:border-accent-500"
                placeholder="0712345678"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-700 mb-1">Email</label>
              <input
                type="email"
                value={formData.email}
                onChange={e => setFormData({ ...formData, email: e.target.value })}
                className="w-full rounded-sm border px-3 py-2 text-sm outline-none h-10 border-ink-200 bg-paper focus:border-accent-500"
                placeholder="supplier@example.com"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-700 mb-1">Address</label>
            <textarea
              value={formData.address}
              onChange={e => setFormData({ ...formData, address: e.target.value })}
              rows={2}
              className="w-full rounded-sm border px-3 py-2 text-sm outline-none border-ink-200 bg-paper focus:border-accent-500"
            />
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <button onClick={() => setModalOpen(false)} className="rounded-sm px-4 py-2 text-sm font-medium text-ink-600 hover:bg-ink-100">Cancel</button>
          <button onClick={handleSave} className="rounded-sm bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-700">
            {editingId ? 'Save Changes' : 'Add Supplier'}
          </button>
        </div>
      </Modal>

      <Modal open={!!viewSupplier} onClose={() => setViewSupplier(null)} title={viewSupplier?.name || 'Supplier'} size="lg">
        {viewSupplier && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-lg bg-ink-50 p-3">
                <p className="text-xs text-ink-500">Contact Person</p>
                <p className="text-sm font-medium text-ink-900">{viewSupplier.contact_person || '—'}</p>
              </div>
              <div className="rounded-lg bg-ink-50 p-3">
                <p className="text-xs text-ink-500">Phone</p>
                <p className="text-sm font-medium text-ink-900">{viewSupplier.phone || '—'}</p>
              </div>
              <div className="rounded-lg bg-ink-50 p-3">
                <p className="text-xs text-ink-500">Email</p>
                <p className="text-sm font-medium text-ink-900">{viewSupplier.email || '—'}</p>
              </div>
              <div className="rounded-lg bg-ink-50 p-3">
                <p className="text-xs text-ink-500">Credit Balance</p>
                <p className={`text-sm font-bold ${(viewSupplier.credit_balance || 0) > 0 ? 'text-danger' : 'text-ink-900'}`} data-numeric>
                  {formatCurrency(viewSupplier.credit_balance || 0)}
                </p>
              </div>
            </div>
            <section className="rounded-md border border-ink-200 p-4">
              <div className="mb-3"><h3 className="text-sm font-semibold text-ink-900">Supplier product catalogue</h3><p className="mt-1 text-xs text-ink-500">Map supplier SKUs to inventory products to improve invoice matching.</p></div>
              {supplierProducts.length > 0 && <div className="mb-4 divide-y divide-ink-100 rounded-lg border border-ink-100">{supplierProducts.map(mapping => <div key={mapping.product_id} className="flex items-center justify-between gap-3 px-3 py-2"><div className="min-w-0"><p className="truncate text-xs font-semibold text-ink-800">{mapping.product?.name || 'Product'}{mapping.is_preferred ? ' · Preferred' : ''}</p><p className="truncate text-[11px] text-ink-500">Supplier SKU {mapping.supplier_sku || '—'} · {mapping.unit || mapping.product?.unit || 'unit'} × {mapping.conversion_factor}</p></div><span className="shrink-0 text-xs text-ink-500" data-numeric>{mapping.lead_time_days == null ? 'Lead time —' : `${mapping.lead_time_days} days`}</span></div>)}</div>}
              {isAdmin && viewSupplier.status === 'ACTIVE' && <div className="space-y-2.5">
                <select value={mapForm.product_id} onChange={event => setMapForm({ ...mapForm, product_id: event.target.value })} className="w-full rounded-sm border px-3 py-2 text-sm h-10 border-ink-200 bg-paper focus:border-accent-500"><option value="">Select catalogue product...</option>{catalogProducts.map(product => <option key={product.id} value={product.id} data-numeric>{product.name}{product.catalog_sku ? ` · ${product.catalog_sku}` : ''}</option>)}</select>
                <div className="grid grid-cols-2 gap-2"><input value={mapForm.supplier_sku} onChange={event => setMapForm({ ...mapForm, supplier_sku: event.target.value })} placeholder="Supplier SKU" className="rounded-sm border px-3 py-2 text-sm h-10 border-ink-200 bg-paper focus:border-accent-500" /><input value={mapForm.unit} onChange={event => setMapForm({ ...mapForm, unit: event.target.value })} placeholder="Supplier unit" className="rounded-sm border px-3 py-2 text-sm h-10 border-ink-200 bg-paper focus:border-accent-500" /></div>
                <div className="grid grid-cols-2 gap-2"><input type="number" min="0.0001" step="0.0001" value={mapForm.conversion_factor} onChange={event => setMapForm({ ...mapForm, conversion_factor: event.target.value })} aria-label="Unit conversion factor" placeholder="Conversion factor" className="rounded-sm border px-3 py-2 text-sm h-10 border-ink-200 bg-paper focus:border-accent-500 font-mono tabular-nums" /><input type="number" min="0" step="1" value={mapForm.lead_time_days} onChange={event => setMapForm({ ...mapForm, lead_time_days: event.target.value })} aria-label="Supplier lead time in days" placeholder="Lead time (days)" className="rounded-sm border px-3 py-2 text-sm h-10 border-ink-200 bg-paper focus:border-accent-500 font-mono tabular-nums" /></div>
                <div className="flex items-center justify-between"><label className="flex items-center gap-2 text-xs text-ink-600"><input type="checkbox" checked={mapForm.is_preferred} onChange={event => setMapForm({ ...mapForm, is_preferred: event.target.checked })} /> Preferred supplier for this product</label><button onClick={() => void saveSupplierProduct()} className="rounded-sm bg-accent-500 px-3 py-2 text-xs font-semibold text-white hover:bg-accent-700">Save mapping</button></div>
              </div>}
            </section>
            <div>
              <h3 className="text-sm font-semibold text-ink-900 mb-2" data-numeric>Purchase History ({supplierPurchases.length})</h3>
              {supplierPurchases.length > 0 ? (
                <div className="max-h-64 overflow-y-auto space-y-2">
                  {supplierPurchases.map(p => (
                    <div key={p.id} className="flex items-center justify-between rounded-lg bg-ink-50 px-3 py-2">
                      <div>
                        <p className="text-sm font-medium text-ink-900">{p.invoice_number || 'Purchase'}</p>
                        <p className="text-xs text-ink-500" data-numeric>{formatDate(p.purchase_date)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-ink-900" data-numeric>{formatCurrency(p.total_amount)}</p>
                        <span className={`text-xs font-medium ${
                          p.payment_status === 'paid' ? 'text-accent-500' :
                          p.payment_status === 'partial' ? 'text-warning' : 'text-danger'
                        }`}>
                          {p.payment_status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-ink-400 py-4 text-center">No purchases recorded from this supplier</p>
              )}
            </div>
          </div>
        )}
      </Modal>

      <Modal open={paymentModalOpen} onClose={() => setPaymentModalOpen(false)} title="Record Credit Payment" size="sm">
        {paymentSupplier && (
          <div className="space-y-4">
            <div className="rounded-lg bg-danger/10 px-4 py-3">
              <p className="text-xs text-ink-500">Supplier</p>
              <p className="text-sm font-medium text-ink-900">{paymentSupplier.name}</p>
              <p className="mt-1 text-xs text-ink-500">Outstanding Credit</p>
              <p className="text-lg font-bold text-danger" data-numeric>{formatCurrency(paymentSupplier.credit_balance || 0)}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-700 mb-1">Payment Amount</label>
              <input
                type="number"
                step="1"
                min="1"
                value={paymentAmount}
                onChange={e => setPaymentAmount(e.target.value)}
                className="w-full rounded-sm border px-3 py-2 text-sm outline-none h-10 border-ink-200 bg-paper focus:border-accent-500 font-mono tabular-nums"
                placeholder="Enter amount"
              />
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={() => setPaymentModalOpen(false)} className="rounded-sm px-4 py-2 text-sm font-medium text-ink-600 hover:bg-ink-100">Cancel</button>
              <button onClick={handlePayment} className="rounded-sm bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-700">Record Payment</button>
            </div>
          </div>
        )}
      </Modal>

    </div>
  );
}
