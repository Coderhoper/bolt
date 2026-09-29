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
import { Users, Plus, Pencil, Trash2, Search, Lock } from 'lucide-react';
import type { Employee } from '@/types';

export function Employees() {
  const { isAdmin } = useAuth();
  const { showToast } = useToast();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    full_name: '', national_id: '', phone: '', address: '', position: '',
    date_employed: '', basic_salary: '', employment_status: 'active', emergency_contact: '',
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('employee_directory').select('*').order('full_name');
    setEmployees(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const filtered = employees.filter(e =>
    e.full_name.toLowerCase().includes(search.toLowerCase()) ||
    (e.position || '').toLowerCase().includes(search.toLowerCase())
  );

  const openAdd = () => {
    setEditingId(null);
    setFormData({
      full_name: '', national_id: '', phone: '', address: '', position: '',
      date_employed: new Date().toISOString().split('T')[0], basic_salary: '', employment_status: 'active', emergency_contact: '',
    });
    setModalOpen(true);
  };

  const openEdit = (e: Employee) => {
    setEditingId(e.id);
    setFormData({
      full_name: e.full_name, national_id: '', phone: e.phone || '',
      address: e.address || '', position: e.position || '',
      date_employed: e.date_employed || '', basic_salary: String(e.basic_salary),
      employment_status: e.employment_status, emergency_contact: e.emergency_contact || '',
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    const payload: Partial<Employee> = {
      full_name: formData.full_name,
      national_id: formData.national_id.trim() || null,
      phone: formData.phone || null,
      address: formData.address || null,
      position: formData.position || null,
      date_employed: formData.date_employed || null,
      basic_salary: parseFloat(formData.basic_salary) || 0,
      employment_status: formData.employment_status as Employee['employment_status'],
      emergency_contact: formData.emergency_contact || null,
    };
    if (editingId && !formData.national_id.trim()) delete payload.national_id;
    if (!payload.full_name) { showToast('Employee name is required', 'error'); return; }

    if (editingId) {
      const { error } = await supabase.from('employees').update(payload).eq('id', editingId);
      if (error) { showToast('Failed to update employee', 'error'); return; }
      await logAudit('UPDATE_EMPLOYEE', 'employee', editingId, `Updated employee: ${payload.full_name}`);
      showToast('Employee updated', 'success');
    } else {
      const { error } = await supabase.from('employees').insert(payload);
      if (error) { showToast('Failed to add employee', 'error'); return; }
      await logAudit('CREATE_EMPLOYEE', 'employee', null, `Added employee: ${payload.full_name}`);
      showToast('Employee added', 'success');
    }
    setModalOpen(false);
    loadData();
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    const emp = employees.find(e => e.id === deleteId);
    const { error } = await supabase.from('employees').update({ employment_status: 'terminated' }).eq('id', deleteId);
    if (error) { showToast('Failed to update employee status', 'error'); return; }
    await logAudit('TERMINATE_EMPLOYEE', 'employee', deleteId, `Terminated employee: ${emp?.full_name || ''}`);
    showToast('Employee marked as terminated', 'success');
    setDeleteId(null);
    loadData();
  };

  if (loading) {
    return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent-500" /></div>;
  }

  return (
    <div>
      <PageHeader
        title="Employees"
        subtitle={`${employees.filter(e => e.employment_status === 'active').length} active employees`}
        actions={isAdmin && (
          <button onClick={openAdd} className="flex items-center gap-2 rounded-sm bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-700 transition-colors">
            <Plus size={18} /> Add Employee
          </button>
        )}
      />

      <div className="mb-4 flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" size={18} />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search employees..."
            className="w-full rounded-sm border py-2 pl-10 pr-4 text-sm focus:ring-2 focus:ring-accent-500/20 outline-none h-10 border-ink-200 bg-paper focus:border-accent-500"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-md bg-paper shadow-xs border border-ink-100">
          <EmptyState icon={Users} title="No employees found" description="Add your first employee to start managing records." action={isAdmin && (
            <button onClick={openAdd} className="flex items-center gap-2 rounded-sm bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-700">
              <Plus size={18} /> Add Employee
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
                  <th className="px-4 py-3 text-left text-xs font-medium text-ink-600 uppercase tracking-wide">Position</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-ink-600 uppercase tracking-wide">National ID</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-ink-600 uppercase tracking-wide">Phone</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-ink-600 uppercase tracking-wide">Employed</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-ink-600 uppercase tracking-wide">Salary</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-ink-600 uppercase tracking-wide">Status</th>
                  {isAdmin && <th className="px-4 py-3 text-right text-xs font-medium text-ink-600 uppercase tracking-wide">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {filtered.map(e => (
                  <tr key={e.id} className="hover:bg-ink-50">
                    <td className="px-4 py-3 text-sm font-medium text-ink-900">{e.full_name}</td>
                    <td className="px-4 py-3 text-sm text-ink-600">{e.position || '—'}</td>
                    <td className="px-4 py-3 text-sm text-ink-600">
                      <span className="flex items-center gap-1">
                        {e.national_id || '—'}
                        {!isAdmin && e.national_id && <Lock size={12} className="text-ink-400" />}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-ink-600">{e.phone || '—'}</td>
                    <td className="px-4 py-3 text-sm text-ink-600" data-numeric>{e.date_employed ? formatDate(e.date_employed) : '—'}</td>
                    <td className="px-4 py-3 text-sm font-semibold text-ink-900 text-right" data-numeric>{formatCurrency(e.basic_salary)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        e.employment_status === 'active' ? 'bg-accent-100 text-accent-700' :
                        e.employment_status === 'inactive' ? 'bg-warning/10 text-warning' :
                        'bg-danger/10 text-danger'
                      }`}>
                        {e.employment_status}
                      </span>
                    </td>
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

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editingId ? 'Edit Employee' : 'Add Employee'} size="lg">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-ink-700 mb-1">Full Name *</label>
            <input
              type="text"
              value={formData.full_name}
              onChange={e => setFormData({ ...formData, full_name: e.target.value })}
              className="w-full rounded-sm border px-3 py-2 text-sm outline-none h-10 border-ink-200 bg-paper focus:border-accent-500"
              placeholder="John Doe"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-700 mb-1">National ID</label>
            <input
              type="text"
              value={formData.national_id}
              onChange={e => setFormData({ ...formData, national_id: e.target.value })}
              className="w-full rounded-sm border px-3 py-2 text-sm outline-none h-10 border-ink-200 bg-paper focus:border-accent-500"
              placeholder={editingId ? 'Leave blank to keep unchanged' : '12345678'}
            />
          </div>
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
            <label className="block text-sm font-medium text-ink-700 mb-1">Position</label>
            <input
              type="text"
              value={formData.position}
              onChange={e => setFormData({ ...formData, position: e.target.value })}
              className="w-full rounded-sm border px-3 py-2 text-sm outline-none h-10 border-ink-200 bg-paper focus:border-accent-500"
              placeholder="Shop Assistant"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-700 mb-1">Date Employed</label>
            <input
              type="date"
              value={formData.date_employed}
              onChange={e => setFormData({ ...formData, date_employed: e.target.value })}
              className="w-full rounded-sm border px-3 py-2 text-sm outline-none h-10 border-ink-200 bg-paper focus:border-accent-500 font-mono tabular-nums"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-700 mb-1">Basic Salary</label>
            <input
              type="number"
              step="0.01"
              value={formData.basic_salary}
              onChange={e => setFormData({ ...formData, basic_salary: e.target.value })}
              className="w-full rounded-sm border px-3 py-2 text-sm outline-none h-10 border-ink-200 bg-paper focus:border-accent-500 font-mono tabular-nums"
              placeholder="0"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-700 mb-1">Employment Status</label>
            <select
              value={formData.employment_status}
              onChange={e => setFormData({ ...formData, employment_status: e.target.value })}
              className="w-full rounded-sm border px-3 py-2 text-sm outline-none h-10 border-ink-200 bg-paper focus:border-accent-500"
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="terminated">Terminated</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-ink-700 mb-1">Emergency Contact</label>
            <input
              type="text"
              value={formData.emergency_contact}
              onChange={e => setFormData({ ...formData, emergency_contact: e.target.value })}
              className="w-full rounded-sm border px-3 py-2 text-sm outline-none h-10 border-ink-200 bg-paper focus:border-accent-500"
              placeholder="0712345678 - Jane Doe"
            />
          </div>
          <div className="sm:col-span-2">
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
            {editingId ? 'Save Changes' : 'Add Employee'}
          </button>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Terminate Employee"
        message="This will mark the employee as terminated. Their records will be preserved for audit purposes."
        confirmLabel="Terminate"
        danger
      />
    </div>
  );
}
