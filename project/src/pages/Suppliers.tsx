import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { formatCurrency, formatDate } from '@/lib/utils';
import { logAudit } from '@/lib/audit';
import { PageHeader } from '@/components/ui/PageHeader';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Truck, Plus, Pencil, Trash2, Search, Eye, Wallet } from 'lucide-react';
import type { Supplier, Purchase } from '@/types';

export function Suppliers() {
  const { isAdmin } = useAuth();
  const { showToast } = useToast();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [viewSupplier, setViewSupplier] = useState<Supplier | null>(null);
  const [supplierPurchases, setSupplierPurchases] = useState<Purchase[]>([]);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentSupplier, setPaymentSupplier] = useState<Supplier | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [formData, setFormData] = useState({
    name: '', contact_person: '', phone: '', email: '', address: '',
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
    (s.contact_person || '').toLowerCase().includes(search.toLowerCase()) ||
    (s.phone || '').toLowerCase().includes(search.toLowerCase())
  );

  const openAdd = () => {
    setEditingId(null);
    setFormData({ name: '', contact_person: '', phone: '', email: '', address: '' });
    setModalOpen(true);
  };

  const openEdit = (s: Supplier) => {
    setEditingId(s.id);
    setFormData({
      name: s.name, contact_person: s.contact_person || '', phone: s.phone || '',
      email: s.email || '', address: s.address || '',
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    const payload = {
      name: formData.name,
      contact_person: formData.contact_person || null,
      phone: formData.phone || null,
      email: formData.email || null,
      address: formData.address || null,
    };
    if (!payload.name) { showToast('Supplier name is required', 'error'); return; }

    if (editingId) {
      const { error } = await supabase.from('suppliers').update(payload).eq('id', editingId);
      if (error) { showToast('Failed to update supplier', 'error'); return; }
      await logAudit('UPDATE_SUPPLIER', 'supplier', editingId, `Updated supplier: ${payload.name}`);
      showToast('Supplier updated', 'success');
    } else {
      const { data, error } = await supabase.from('suppliers').insert(payload).select().single();
      if (error) { showToast('Failed to create supplier', 'error'); return; }
      await logAudit('CREATE_SUPPLIER', 'supplier', data.id, `Created supplier: ${payload.name}`);
      showToast('Supplier added', 'success');
    }
    setModalOpen(false);
    loadData();
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    const supplier = suppliers.find(s => s.id === deleteId);
    const { error } = await supabase.from('suppliers').delete().eq('id', deleteId);
    if (error) {
      showToast('Cannot delete supplier with existing purchases', 'error');
    } else {
      await logAudit('DELETE_SUPPLIER', 'supplier', deleteId, `Deleted supplier: ${supplier?.name || ''}`);
      showToast('Supplier deleted', 'success');
      loadData();
    }
    setDeleteId(null);
  };

  const viewSupplierDetails = async (s: Supplier) => {
    setViewSupplier(s);
    const { data } = await supabase
      .from('purchases')
      .select('*')
      .eq('supplier_id', s.id)
      .order('purchase_date', { ascending: false });
    setSupplierPurchases(data || []);
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
    return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>;
  }

  const totalCredit = suppliers.reduce((sum, s) => sum + (s.credit_balance || 0), 0);

  return (
    <div>
      <PageHeader
        title="Suppliers"
        subtitle={`${suppliers.length} suppliers · Total outstanding credit: ${formatCurrency(totalCredit)}`}
        actions={isAdmin && (
          <button onClick={openAdd} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors">
            <Plus size={18} /> Add Supplier
          </button>
        )}
      />

      <div className="mb-4 relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search suppliers..."
          className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-10 pr-4 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
          <EmptyState icon={Truck} title="No suppliers found" description="Add your first supplier to start tracking purchases and credit." action={isAdmin && (
            <button onClick={openAdd} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
              <Plus size={18} /> Add Supplier
            </button>
          )} />
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Name</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Contact</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Phone</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600">Credit Balance</th>
                  {isAdmin && <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map(s => (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-sm font-medium text-slate-900">{s.name}</td>
                    <td className="px-4 py-3 text-sm text-slate-600">{s.contact_person || '—'}</td>
                    <td className="px-4 py-3 text-sm text-slate-600">{s.phone || '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={`text-sm font-semibold ${(s.credit_balance || 0) > 0 ? 'text-rose-600' : 'text-slate-400'}`}>
                        {formatCurrency(s.credit_balance || 0)}
                      </span>
                    </td>
                    {isAdmin && (
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button onClick={() => viewSupplierDetails(s)} className="rounded-lg p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600" title="View history">
                            <Eye size={16} />
                          </button>
                          {(s.credit_balance || 0) > 0 && (
                            <button onClick={() => openPayment(s)} className="flex items-center gap-1 rounded-lg bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100" title="Record payment">
                              <Wallet size={14} /> Pay
                            </button>
                          )}
                          <button onClick={() => openEdit(s)} className="rounded-lg p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600">
                            <Pencil size={16} />
                          </button>
                          <button onClick={() => setDeleteId(s.id)} className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600">
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

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editingId ? 'Edit Supplier' : 'Add Supplier'}>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Supplier Name *</label>
            <input
              type="text"
              value={formData.name}
              onChange={e => setFormData({ ...formData, name: e.target.value })}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 outline-none"
              placeholder="ABC Suppliers Ltd"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Contact Person</label>
            <input
              type="text"
              value={formData.contact_person}
              onChange={e => setFormData({ ...formData, contact_person: e.target.value })}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 outline-none"
              placeholder="John Smith"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Phone</label>
              <input
                type="text"
                value={formData.phone}
                onChange={e => setFormData({ ...formData, phone: e.target.value })}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 outline-none"
                placeholder="0712345678"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
              <input
                type="email"
                value={formData.email}
                onChange={e => setFormData({ ...formData, email: e.target.value })}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 outline-none"
                placeholder="supplier@example.com"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Address</label>
            <textarea
              value={formData.address}
              onChange={e => setFormData({ ...formData, address: e.target.value })}
              rows={2}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 outline-none"
            />
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <button onClick={() => setModalOpen(false)} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
          <button onClick={handleSave} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
            {editingId ? 'Save Changes' : 'Add Supplier'}
          </button>
        </div>
      </Modal>

      <Modal open={!!viewSupplier} onClose={() => setViewSupplier(null)} title={viewSupplier?.name || 'Supplier'} size="lg">
        {viewSupplier && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-xs text-slate-500">Contact Person</p>
                <p className="text-sm font-medium text-slate-900">{viewSupplier.contact_person || '—'}</p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-xs text-slate-500">Phone</p>
                <p className="text-sm font-medium text-slate-900">{viewSupplier.phone || '—'}</p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-xs text-slate-500">Email</p>
                <p className="text-sm font-medium text-slate-900">{viewSupplier.email || '—'}</p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-xs text-slate-500">Credit Balance</p>
                <p className={`text-sm font-bold ${(viewSupplier.credit_balance || 0) > 0 ? 'text-rose-600' : 'text-slate-900'}`}>
                  {formatCurrency(viewSupplier.credit_balance || 0)}
                </p>
              </div>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900 mb-2">Purchase History ({supplierPurchases.length})</h3>
              {supplierPurchases.length > 0 ? (
                <div className="max-h-64 overflow-y-auto space-y-2">
                  {supplierPurchases.map(p => (
                    <div key={p.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                      <div>
                        <p className="text-sm font-medium text-slate-900">{p.invoice_number || 'Purchase'}</p>
                        <p className="text-xs text-slate-500">{formatDate(p.purchase_date)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-slate-900">{formatCurrency(p.total_amount)}</p>
                        <span className={`text-xs font-medium ${
                          p.payment_status === 'paid' ? 'text-emerald-600' :
                          p.payment_status === 'partial' ? 'text-amber-600' : 'text-rose-600'
                        }`}>
                          {p.payment_status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-400 py-4 text-center">No purchases recorded from this supplier</p>
              )}
            </div>
          </div>
        )}
      </Modal>

      <Modal open={paymentModalOpen} onClose={() => setPaymentModalOpen(false)} title="Record Credit Payment" size="sm">
        {paymentSupplier && (
          <div className="space-y-4">
            <div className="rounded-lg bg-rose-50 px-4 py-3">
              <p className="text-xs text-slate-500">Supplier</p>
              <p className="text-sm font-medium text-slate-900">{paymentSupplier.name}</p>
              <p className="mt-1 text-xs text-slate-500">Outstanding Credit</p>
              <p className="text-lg font-bold text-rose-600">{formatCurrency(paymentSupplier.credit_balance || 0)}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Payment Amount</label>
              <input
                type="number"
                step="1"
                min="1"
                value={paymentAmount}
                onChange={e => setPaymentAmount(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 outline-none"
                placeholder="Enter amount"
              />
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={() => setPaymentModalOpen(false)} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
              <button onClick={handlePayment} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700">Record Payment</button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete Supplier"
        message="Are you sure you want to delete this supplier? This cannot be undone if they have existing purchases."
        confirmLabel="Delete"
        danger
      />
    </div>
  );
}
