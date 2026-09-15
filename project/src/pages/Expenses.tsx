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
import { Wallet, Plus, Pencil, Trash2, Search } from 'lucide-react';
import type { Expense } from '@/types';

const EXPENSE_CATEGORIES = [
  'Rent', 'Electricity', 'Water', 'Transport', 'Internet',
  'Repairs', 'Marketing', 'Stationery', 'Bank Charges', 'Salaries', 'Other',
];

export function Expenses() {
  const { isAdmin } = useAuth();
  const { showToast } = useToast();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    category: 'Rent', description: '', amount: '', expense_date: new Date().toISOString().split('T')[0], payment_method: 'cash',
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('expenses').select('*').order('expense_date', { ascending: false });
    setExpenses(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const filtered = expenses.filter(e => {
    const matchesSearch = (e.description || '').toLowerCase().includes(search.toLowerCase()) ||
      e.category.toLowerCase().includes(search.toLowerCase());
    const matchesCat = filterCategory === 'all' || e.category === filterCategory;
    return matchesSearch && matchesCat;
  });

  const totalAmount = filtered.reduce((sum, e) => sum + Number(e.amount), 0);

  const openAdd = () => {
    setEditingId(null);
    setFormData({ category: 'Rent', description: '', amount: '', expense_date: new Date().toISOString().split('T')[0], payment_method: 'cash' });
    setModalOpen(true);
  };

  const openEdit = (e: Expense) => {
    setEditingId(e.id);
    setFormData({
      category: e.category, description: e.description || '', amount: String(e.amount),
      expense_date: e.expense_date, payment_method: e.payment_method,
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    const payload = {
      category: formData.category,
      description: formData.description || null,
      amount: parseFloat(formData.amount) || 0,
      expense_date: formData.expense_date,
      payment_method: formData.payment_method,
    };
    if (!payload.amount || payload.amount <= 0) {
      showToast('Amount must be greater than 0', 'error');
      return;
    }
    if (editingId) {
      const { error } = await supabase.from('expenses').update(payload).eq('id', editingId);
      if (error) { showToast('Failed to update expense', 'error'); return; }
      await logAudit('UPDATE_EXPENSE', 'expense', editingId, `Updated expense: ${payload.category}`, null, payload);
      showToast('Expense updated', 'success');
    } else {
      const { data, error } = await supabase.from('expenses').insert(payload).select().single();
      if (error) { showToast('Failed to create expense', 'error'); return; }
      await logAudit('CREATE_EXPENSE', 'expense', data.id, `Created expense: ${payload.category} - ${formatCurrency(payload.amount)}`);
      showToast('Expense recorded', 'success');
    }
    setModalOpen(false);
    loadData();
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    const expense = expenses.find(e => e.id === deleteId);
    const { error } = await supabase.from('expenses').delete().eq('id', deleteId);
    if (error) { showToast('Failed to delete expense', 'error'); return; }
    await logAudit('DELETE_EXPENSE', 'expense', deleteId, `Deleted expense: ${expense?.category || ''}`);
    showToast('Expense deleted', 'success');
    setDeleteId(null);
    loadData();
  };

  if (loading) {
    return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>;
  }

  return (
    <div>
      <PageHeader
        title="Expenses"
        subtitle={`Total: ${formatCurrency(totalAmount)}`}
        actions={isAdmin && (
          <button onClick={openAdd} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors">
            <Plus size={18} /> Add Expense
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
            placeholder="Search expenses..."
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-10 pr-4 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none"
          />
        </div>
        <select
          value={filterCategory}
          onChange={e => setFilterCategory(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 outline-none"
        >
          <option value="all">All Categories</option>
          {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
          <EmptyState icon={Wallet} title="No expenses recorded" description="Track business expenses like rent, utilities, and transport." action={isAdmin && (
            <button onClick={openAdd} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
              <Plus size={18} /> Add Expense
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
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Category</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Description</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Payment</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600">Amount</th>
                  {isAdmin && <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map(e => (
                  <tr key={e.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-sm text-slate-600">{formatDate(e.expense_date)}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">{e.category}</span>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">{e.description || '—'}</td>
                    <td className="px-4 py-3 text-sm text-slate-600 capitalize">{e.payment_method}</td>
                    <td className="px-4 py-3 text-sm font-semibold text-slate-900 text-right">{formatCurrency(e.amount)}</td>
                    {isAdmin && (
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button onClick={() => openEdit(e)} className="rounded-lg p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600">
                            <Pencil size={16} />
                          </button>
                          <button onClick={() => setDeleteId(e.id)} className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600">
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

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editingId ? 'Edit Expense' : 'Add Expense'}>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Category *</label>
            <select
              value={formData.category}
              onChange={e => setFormData({ ...formData, category: e.target.value })}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 outline-none"
            >
              {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
            <input
              type="text"
              value={formData.description}
              onChange={e => setFormData({ ...formData, description: e.target.value })}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 outline-none"
              placeholder="Optional details..."
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Amount *</label>
              <input
                type="number"
                step="0.01"
                value={formData.amount}
                onChange={e => setFormData({ ...formData, amount: e.target.value })}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 outline-none"
                placeholder="0"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Date</label>
              <input
                type="date"
                value={formData.expense_date}
                onChange={e => setFormData({ ...formData, expense_date: e.target.value })}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 outline-none"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Payment Method</label>
            <select
              value={formData.payment_method}
              onChange={e => setFormData({ ...formData, payment_method: e.target.value })}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 outline-none"
            >
              <option value="cash">Cash</option>
              <option value="mpesa">M-Pesa</option>
              <option value="bank">Bank</option>
              <option value="other">Other</option>
            </select>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <button onClick={() => setModalOpen(false)} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
          <button onClick={handleSave} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
            {editingId ? 'Save Changes' : 'Record Expense'}
          </button>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete Expense"
        message="Are you sure you want to delete this expense record? This action cannot be undone."
        confirmLabel="Delete"
        danger
      />
    </div>
  );
}
