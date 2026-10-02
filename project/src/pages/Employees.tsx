import { useEffect, useState, useCallback } from 'react';
import { getActiveTenantId, supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { formatCurrency, formatDate } from '@/lib/utils';
import { logAudit } from '@/lib/audit';
import { PageHeader } from '@/components/ui/PageHeader';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { Users, Plus, Pencil, Trash2, Search, Lock } from 'lucide-react';
import type { Employee } from '@/types';

const EMPLOYEE_ID_BUCKET = 'employee-id-documents';

function normalizedEmail(value: string | null | undefined) {
  return (value || '').trim().toLowerCase();
}

function emailSimilarity(left: string, right: string) {
  const a = normalizedEmail(left);
  const b = normalizedEmail(right);
  if (!a || !b) return 0;
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = previous[j];
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return 1 - previous[b.length] / Math.max(a.length, b.length, 1);
}

function normalizedPhone(value: string | null | undefined) {
  return (value || '').replace(/\D/g, '');
}

function normalizedNationalId(value: string | null | undefined) {
  return (value || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
}

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
    full_name: '', national_id: '', phone: '', email: '', address: '', position: '',
    date_employed: '', basic_salary: '', employment_status: 'active', emergency_contact: '',
    id_document_front_path: '', id_document_back_path: '',
  });
  const [frontPhoto, setFrontPhoto] = useState<File | null>(null);
  const [backPhoto, setBackPhoto] = useState<File | null>(null);
  const [similarEmailConfirmed, setSimilarEmailConfirmed] = useState(false);

  const loadData = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    const { data } = isAdmin
      ? await supabase.from('employees').select('*').order('full_name')
      : await supabase.from('employee_directory').select('*').order('full_name');
    setEmployees((data || []) as Employee[]);
    if (!quiet) setLoading(false);
  }, [isAdmin]);

  useEffect(() => { loadData(); }, [loadData]);
  useRealtimeRefresh(loadData);

  const filtered = employees.filter(e =>
    e.full_name.toLowerCase().includes(search.toLowerCase()) ||
    (e.position || '').toLowerCase().includes(search.toLowerCase())
  );
  const similarEmailEmployee = formData.email.trim()
    ? employees.find(e => e.id !== editingId && e.email && normalizedEmail(e.email) !== normalizedEmail(formData.email)
      && emailSimilarity(e.email, formData.email) >= 0.82)
    : undefined;

  const openAdd = () => {
    setEditingId(null);
    setFormData({
      full_name: '', national_id: '', phone: '', email: '', address: '', position: '',
      date_employed: new Date().toISOString().split('T')[0], basic_salary: '', employment_status: 'active', emergency_contact: '',
      id_document_front_path: '', id_document_back_path: '',
    });
    setFrontPhoto(null);
    setBackPhoto(null);
    setSimilarEmailConfirmed(false);
    setModalOpen(true);
  };

  const openEdit = (e: Employee) => {
    setEditingId(e.id);
    setFormData({
      full_name: e.full_name, national_id: '', phone: e.phone || '', email: e.email || '',
      address: e.address || '', position: e.position || '',
      date_employed: e.date_employed || '', basic_salary: String(e.basic_salary ?? ''),
      employment_status: e.employment_status, emergency_contact: e.emergency_contact || '',
      id_document_front_path: e.id_document_front_path || '', id_document_back_path: e.id_document_back_path || '',
    });
    setFrontPhoto(null);
    setBackPhoto(null);
    setSimilarEmailConfirmed(false);
    setModalOpen(true);
  };

  const handleSave = async () => {
    const email = formData.email.trim().toLowerCase();
    const phoneDigits = normalizedPhone(formData.phone);
    const nationalId = normalizedNationalId(formData.national_id);
    const duplicateEmployee = employees.find(e => e.id !== editingId && (
      (email && normalizedEmail(e.email) === email)
      || (nationalId && normalizedNationalId(e.national_id) === nationalId)
      || (phoneDigits && (normalizedPhone(e.phone) === phoneDigits
        || (phoneDigits.length >= 9 && normalizedPhone(e.phone).length >= 9
          && phoneDigits.slice(-9) === normalizedPhone(e.phone).slice(-9))))
    ));
    if (duplicateEmployee) {
      showToast('This email, phone number or national ID is already assigned to another employee.', 'error');
      return;
    }
    if (similarEmailEmployee && !similarEmailConfirmed) {
      showToast('Review the similar email and confirm that this is a different person before saving.', 'error');
      return;
    }
    for (const file of [frontPhoto, backPhoto]) {
      if (file && (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024)) {
        showToast('ID photos must be JPEG, PNG or WebP images no larger than 5 MB.', 'error');
        return;
      }
    }

    const payload: Partial<Employee> = {
      full_name: formData.full_name,
      national_id: formData.national_id.trim() || null,
      phone: formData.phone || null,
      email: email || null,
      address: formData.address || null,
      position: formData.position || null,
      date_employed: formData.date_employed || null,
      basic_salary: parseFloat(formData.basic_salary) || 0,
      employment_status: formData.employment_status as Employee['employment_status'],
      emergency_contact: formData.emergency_contact || null,
    };
    if (editingId && !formData.national_id.trim()) delete payload.national_id;
    if (!payload.full_name) { showToast('Employee name is required', 'error'); return; }

    let employeeId = editingId;
    if (editingId) {
      const { error } = await supabase.from('employees').update(payload).eq('id', editingId);
      if (error) { showToast(error.message, 'error'); return; }
    } else {
      const { data, error } = await supabase.from('employees').insert(payload).select('id').single();
      if (error || !data) { showToast(error?.message || 'Could not create employee', 'error'); return; }
      employeeId = data.id;
    }

    const tenantFolder = getActiveTenantId() || 'legacy';
    const documentUpdates: Record<string, string> = {};
    for (const [side, file] of [['front', frontPhoto], ['back', backPhoto]] as const) {
      if (!file || !employeeId) continue;
      const path = `${tenantFolder}/${employeeId}/${side}`;
      const { error } = await supabase.storage.from(EMPLOYEE_ID_BUCKET).upload(path, file, {
        upsert: true,
        contentType: file.type,
        cacheControl: '0',
      });
      if (error) {
        showToast(`Employee saved, but the ${side} ID photo upload failed: ${error.message}`, 'error');
        setModalOpen(false);
        void loadData();
        return;
      }
      documentUpdates[side === 'front' ? 'id_document_front_path' : 'id_document_back_path'] = path;
    }
    if (employeeId && Object.keys(documentUpdates).length) {
      const { error } = await supabase.from('employees').update(documentUpdates).eq('id', employeeId);
      if (error) {
        showToast(`Employee saved, but ID photo paths could not be recorded: ${error.message}`, 'error');
        setModalOpen(false);
        void loadData();
        return;
      }
    }

    await logAudit(editingId ? 'UPDATE_EMPLOYEE' : 'CREATE_EMPLOYEE', 'employee', employeeId, `${editingId ? 'Updated' : 'Added'} employee record`);
    showToast(editingId ? 'Employee updated' : 'Employee added', 'success');
    setModalOpen(false);
    void loadData();
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
                  <th className="px-4 py-3 text-left text-xs font-medium text-ink-600 uppercase tracking-wide">Email</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-ink-600 uppercase tracking-wide">Employed</th>
                  {isAdmin && <th className="px-4 py-3 text-right text-xs font-medium text-ink-600 uppercase tracking-wide">Salary</th>}
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
                        {e.national_id ? `••••${e.national_id.slice(-4)}` : '—'}
                        {!isAdmin && e.national_id && <Lock size={12} className="text-ink-400" />}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-ink-600">{e.phone || '—'}</td>
                    <td className="px-4 py-3 text-sm text-ink-600">{e.email || '—'}</td>
                    <td className="px-4 py-3 text-sm text-ink-600" data-numeric>{e.date_employed ? formatDate(e.date_employed) : '—'}</td>
                    {isAdmin && <td className="px-4 py-3 text-sm font-semibold text-ink-900 text-right" data-numeric>{formatCurrency(e.basic_salary || 0)}</td>}
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
            <label className="block text-sm font-medium text-ink-700 mb-1">Email</label>
            <input
              type="email"
              value={formData.email}
              onChange={e => { setFormData({ ...formData, email: e.target.value }); setSimilarEmailConfirmed(false); }}
              className="w-full rounded-sm border px-3 py-2 text-sm outline-none h-10 border-ink-200 bg-paper focus:border-accent-500"
              placeholder="employee@business.com"
            />
            {similarEmailEmployee && <label className="mt-2 flex items-start gap-2 text-xs text-warning">
              <input type="checkbox" checked={similarEmailConfirmed} onChange={event => setSimilarEmailConfirmed(event.target.checked)} />
              <span>This email is similar to another employee’s. I checked the spelling and confirmed it belongs to a different person.</span>
            </label>}
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
          <div className="sm:col-span-2 rounded-md border border-ink-100 bg-ink-50 p-4">
            <h3 className="text-sm font-semibold text-ink-800">Identity card photos</h3>
            <p className="mt-1 text-xs text-ink-500">Private files, visible to tenant administrators only. JPEG, PNG or WebP up to 5 MB each.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="block text-sm font-medium text-ink-700">Front side
                <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={event => setFrontPhoto(event.target.files?.[0] || null)} className="mt-1 block w-full text-xs" />
                {frontPhoto ? <span className="mt-1 block truncate text-xs text-accent-700">Selected: {frontPhoto.name}</span> : formData.id_document_front_path && <span className="mt-1 block text-xs text-accent-700">Front photo already saved</span>}
              </label>
              <label className="block text-sm font-medium text-ink-700">Back side
                <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={event => setBackPhoto(event.target.files?.[0] || null)} className="mt-1 block w-full text-xs" />
                {backPhoto ? <span className="mt-1 block truncate text-xs text-accent-700">Selected: {backPhoto.name}</span> : formData.id_document_back_path && <span className="mt-1 block text-xs text-accent-700">Back photo already saved</span>}
              </label>
            </div>
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
