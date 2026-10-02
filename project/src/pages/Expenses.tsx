import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
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

  const loadData = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    const { data } = await supabase.from('expenses').select('*').order('expense_date', { ascending: false });
    setExpenses(data || []);
    if (!quiet) setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);
  useRealtimeRefresh(loadData);

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
    return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent-500" /></div>;
  }

  return (
    <div>
      <PageHeader
        title="Expenses"
        subtitle={`Total: ${formatCurrency(totalAmount)}`}
        actions={isAdmin && (
          <button onClick={openAdd} className="flex items-center gap-2 rounded-sm bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-700 transition-colors">
            <Plus size={18} /> Add Expense
          </button>
        )}
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" size={18} />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search expenses..."
            className="w-full rounded-sm border py-2 pl-10 pr-4 text-sm focus:ring-2 focus:ring-accent-500/20 outline-none h-10 border-ink-200 bg-paper focus:border-accent-500"
          />
        </div>
        <select
          value={filterCategory}
          onChange={e => setFilterCategory(e.target.value)}
          className="rounded-sm border px-3 py-2 text-sm outline-none h-10 border-ink-200 bg-paper focus:border-accent-500"
        >
          <option value="all">All Categories</option>
          {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-md bg-paper shadow-xs border border-ink-100">
          <EmptyState icon={Wallet} title="No expenses recorded" description="Track business expenses like rent, utilities, and transport." action={isAdmin && (
            <button onClick={openAdd} className="flex items-center gap-2 rounded-sm bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-700">
              <Plus size={18} /> Add Expense
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
                  <th className="px-4 py-3 text-left text-xs font-medium text-ink-600 uppercase tracking-wide">Category</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-ink-600 uppercase tracking-wide">Description</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-ink-600 uppercase tracking-wide">Payment</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-ink-600 uppercase tracking-wide">Amount</th>
                  {isAdmin && <th className="px-4 py-3 text-right text-xs font-medium text-ink-600 uppercase tracking-wide">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {filtered.map(e => (
                  <tr key={e.id} className="hover:bg-ink-50">
                    <td className="px-4 py-3 text-sm text-ink-600" data-numeric>{formatDate(e.expense_date)}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">{e.category}</span>
                    </td>
                    <td className="px-4 py-3 text-sm text-ink-600">{e.description || '—'}</td>
                    <td className="px-4 py-3 text-sm text-ink-600 capitalize">{e.payment_method}</td>
                    <td className="px-4 py-3 text-sm font-semibold text-ink-900 text-right" data-numeric>{formatCurrency(e.amount)}</td>
                    {isAdmin && (
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button onClick={() => openEdit(e)} className="rounded-sm p-1.5 text-ink-400 hover:bg-accent-50 hover:text-accent-500">
                            <Pencil size={16} />
                          </button>
                          <button onClick={() => setDeleteId(e.id)} className="rounded-sm p-1.5 text-ink-400 hover:bg-danger/10 hover:text-danger">
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
            <label className="block text-sm font-medium text-ink-700 mb-1">Category *</label>
            <select
              value={formData.category}
              onChange={e => setFormData({ ...formData, category: e.target.value })}
              className="w-full rounded-sm border px-3 py-2 text-sm outline-none h-10 border-ink-200 bg-paper focus:border-accent-500"
            >
              {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-700 mb-1">Description</label>
            <input
              type="text"
              value={formData.description}
              onChange={e => setFormData({ ...formData, description: e.target.value })}
              className="w-full rounded-sm border px-3 py-2 text-sm outline-none h-10 border-ink-200 bg-paper focus:border-accent-500"
              placeholder="Optional details..."
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-ink-700 mb-1">Amount *</label>
              <input
                type="number"
                step="0.01"
                value={formData.amount}
                onChange={e => setFormData({ ...formData, amount: e.target.value })}
                className="w-full rounded-sm border px-3 py-2 text-sm outline-none h-10 border-ink-200 bg-paper focus:border-accent-500 font-mono tabular-nums"
                placeholder="0"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-700 mb-1">Date</label>
              <input
                type="date"
                value={formData.expense_date}
                onChange={e => setFormData({ ...formData, expense_date: e.target.value })}
                className="w-full rounded-sm border px-3 py-2 text-sm outline-none h-10 border-ink-200 bg-paper focus:border-accent-500 font-mono tabular-nums"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-700 mb-1">Payment Method</label>
            <select
              value={formData.payment_method}
              onChange={e => setFormData({ ...formData, payment_method: e.target.value })}
              className="w-full rounded-sm border px-3 py-2 text-sm outline-none h-10 border-ink-200 bg-paper focus:border-accent-500"
            >
              <option value="cash">Cash</option>
              <option value="mpesa">M-Pesa</option>
              <option value="bank">Bank</option>
              <option value="other">Other</option>
            </select>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <button onClick={() => setModalOpen(false)} className="rounded-sm px-4 py-2 text-sm font-medium text-ink-600 hover:bg-ink-100">Cancel</button>
          <button onClick={handleSave} className="rounded-sm bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-700">
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
