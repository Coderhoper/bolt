import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { formatCurrency, formatDate, maskNationalId } from '@/lib/utils';
import { logAudit } from '@/lib/audit';
import { PageHeader } from '@/components/ui/PageHeader';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Users, Plus, Pencil, Trash2, Search, Lock, Eye, EyeOff } from 'lucide-react';
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
  const [showSensitive, setShowSensitive] = useState(false);
  const [formData, setFormData] = useState({
    full_name: '', national_id: '', phone: '', address: '', position: '',
    date_employed: '', basic_salary: '', employment_status: 'active', emergency_contact: '',
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('employees').select('*').order('full_name');
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
      full_name: e.full_name, national_id: e.national_id || '', phone: e.phone || '',
      address: e.address || '', position: e.position || '',
      date_employed: e.date_employed || '', basic_salary: String(e.basic_salary),
      employment_status: e.employment_status, emergency_contact: e.emergency_contact || '',
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    const payload = {
      full_name: formData.full_name,
      national_id: formData.national_id || null,
      phone: formData.phone || null,
      address: formData.address || null,
      position: formData.position || null,
      date_employed: formData.date_employed || null,
      basic_salary: parseFloat(formData.basic_salary) || 0,
      employment_status: formData.employment_status,
      emergency_contact: formData.emergency_contact || null,
    };
    if (!payload.full_name) { showToast('Employee name is required', 'error'); return; }

    if (editingId) {
      const { error } = await supabase.from('employees').update(payload).eq('id', editingId);
      if (error) { showToast('Failed to update employee', 'error'); return; }
      await logAudit('UPDATE_EMPLOYEE', 'employee', editingId, `Updated employee: ${payload.full_name}`);
      showToast('Employee updated', 'success');
    } else {
      const { data, error } = await supabase.from('employees').insert(payload).select().single();
      if (error) { showToast('Failed to add employee', 'error'); return; }
      await logAudit('CREATE_EMPLOYEE', 'employee', data.id, `Added employee: ${payload.full_name}`);
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
    return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>;
  }

  return (
    <div>
      <PageHeader
        title="Employees"
        subtitle={`${employees.filter(e => e.employment_status === 'active').length} active employees`}
        actions={isAdmin && (
          <button onClick={openAdd} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors">
            <Plus size={18} /> Add Employee
          </button>
        )}
      />

      <div className="mb-4 flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search employees..."
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-10 pr-4 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none"
          />
        </div>
        {isAdmin && (
          <button
            onClick={() => setShowSensitive(!showSensitive)}
            className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
          >
            {showSensitive ? <EyeOff size={16} /> : <Eye size={16} />}
            {showSensitive ? 'Hide' : 'Show'} IDs
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
          <EmptyState icon={Users} title="No employees found" description="Add your first employee to start managing records." action={isAdmin && (
            <button onClick={openAdd} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
              <Plus size={18} /> Add Employee
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
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Position</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">National ID</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Phone</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Employed</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600">Salary</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-slate-600">Status</th>
                  {isAdmin && <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map(e => (
                  <tr key={e.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-sm font-medium text-slate-900">{e.full_name}</td>
                    <td className="px-4 py-3 text-sm text-slate-600">{e.position || '—'}</td>
                    <td className="px-4 py-3 text-sm text-slate-600">
                      <span className="flex items-center gap-1">
                        {isAdmin && showSensitive ? e.national_id || '—' : maskNationalId(e.national_id)}
                        {!isAdmin && e.national_id && <Lock size={12} className="text-slate-400" />}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">{e.phone || '—'}</td>
                    <td className="px-4 py-3 text-sm text-slate-600">{e.date_employed ? formatDate(e.date_employed) : '—'}</td>
                    <td className="px-4 py-3 text-sm font-semibold text-slate-900 text-right">{formatCurrency(e.basic_salary)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        e.employment_status === 'active' ? 'bg-emerald-100 text-emerald-700' :
                        e.employment_status === 'inactive' ? 'bg-amber-100 text-amber-700' :
                        'bg-rose-100 text-rose-700'
                      }`}>
                        {e.employment_status}
                      </span>
                    </td>
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

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editingId ? 'Edit Employee' : 'Add Employee'} size="lg">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-slate-700 mb-1">Full Name *</label>
            <input
              type="text"
              value={formData.full_name}
              onChange={e => setFormData({ ...formData, full_name: e.target.value })}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 outline-none"
              placeholder="John Doe"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">National ID</label>
            <input
              type="text"
              value={formData.national_id}
              onChange={e => setFormData({ ...formData, national_id: e.target.value })}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 outline-none"
              placeholder="12345678"
            />
          </div>
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
            <label className="block text-sm font-medium text-slate-700 mb-1">Position</label>
            <input
              type="text"
              value={formData.position}
              onChange={e => setFormData({ ...formData, position: e.target.value })}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 outline-none"
              placeholder="Shop Assistant"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Date Employed</label>
            <input
              type="date"
              value={formData.date_employed}
              onChange={e => setFormData({ ...formData, date_employed: e.target.value })}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Basic Salary</label>
            <input
              type="number"
              step="0.01"
              value={formData.basic_salary}
              onChange={e => setFormData({ ...formData, basic_salary: e.target.value })}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 outline-none"
              placeholder="0"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Employment Status</label>
            <select
              value={formData.employment_status}
              onChange={e => setFormData({ ...formData, employment_status: e.target.value })}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 outline-none"
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="terminated">Terminated</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-slate-700 mb-1">Emergency Contact</label>
            <input
              type="text"
              value={formData.emergency_contact}
              onChange={e => setFormData({ ...formData, emergency_contact: e.target.value })}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 outline-none"
              placeholder="0712345678 - Jane Doe"
            />
          </div>
          <div className="sm:col-span-2">
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
