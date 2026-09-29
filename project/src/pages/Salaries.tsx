import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { formatCurrency, formatDate, getMonthName } from '@/lib/utils';
import { logAudit } from '@/lib/audit';
import { PageHeader } from '@/components/ui/PageHeader';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { Wallet, Plus, Trash2 } from 'lucide-react';
import type { SalaryRecord, Employee } from '@/types';

export function Salaries() {
  const { isAdmin } = useAuth();
  const { showToast } = useToast();
  const [salaries, setSalaries] = useState<SalaryRecord[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    employee_id: '', pay_period_month: new Date().getMonth() + 1,
    pay_period_year: new Date().getFullYear(), basic_salary: '',
    allowances: '', deductions: '', payment_date: new Date().toISOString().split('T')[0], note: '',
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    const [{ data: s }, { data: e }] = await Promise.all([
      supabase.from('salary_records').select('*, employee:employees(*)').order('created_at', { ascending: false }),
      supabase.from('employees').select('*').eq('employment_status', 'active').order('full_name'),
    ]);
    setSalaries(s || []);
    setEmployees(e || []);
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const openAdd = () => {
    setFormData({
      employee_id: '', pay_period_month: new Date().getMonth() + 1,
      pay_period_year: new Date().getFullYear(), basic_salary: '',
      allowances: '', deductions: '', payment_date: new Date().toISOString().split('T')[0], note: '',
    });
    setModalOpen(true);
  };

  const handleEmployeeChange = (id: string) => {
    const emp = employees.find(e => e.id === id);
    setFormData({ ...formData, employee_id: id, basic_salary: emp ? String(emp.basic_salary) : '' });
  };

  const netSalary = (parseFloat(formData.basic_salary) || 0) + (parseFloat(formData.allowances) || 0) - (parseFloat(formData.deductions) || 0);

  const handleSave = async () => {
    if (!formData.employee_id) { showToast('Please select an employee', 'error'); return; }
    const payload = {
      employee_id: formData.employee_id,
      pay_period_month: formData.pay_period_month,
      pay_period_year: formData.pay_period_year,
      basic_salary: parseFloat(formData.basic_salary) || 0,
      allowances: parseFloat(formData.allowances) || 0,
      deductions: parseFloat(formData.deductions) || 0,
      net_salary: netSalary,
      payment_date: formData.payment_date,
      note: formData.note || null,
    };
    const { data, error } = await supabase.from('salary_records').insert(payload).select().single();
    if (error) { showToast('Failed to record salary', 'error'); return; }
    await logAudit('CREATE_SALARY', 'salary_record', data.id, `Recorded salary for ${getMonthName(formData.pay_period_month)} ${formData.pay_period_year}`);
    showToast('Salary recorded', 'success');
    setModalOpen(false);
    loadData();
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    const { error } = await supabase.from('salary_records').delete().eq('id', deleteId);
    if (error) { showToast('Failed to delete salary record', 'error'); return; }
    await logAudit('DELETE_SALARY', 'salary_record', deleteId, 'Deleted salary record');
    showToast('Salary record deleted', 'success');
    setDeleteId(null);
    loadData();
  };

  if (loading) {
    return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent-500" /></div>;
  }

  return (
    <div>
      <PageHeader
        title="Salaries"
        subtitle={`${salaries.length} salary records`}
        actions={isAdmin && (
          <button onClick={openAdd} className="flex items-center gap-2 rounded-sm bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-700 transition-colors">
            <Plus size={18} /> Record Salary
          </button>
        )}
      />

      {salaries.length === 0 ? (
        <div className="rounded-md bg-paper shadow-xs border border-ink-100">
          <EmptyState icon={Wallet} title="No salary records" description="Record monthly salary payments for your employees." action={isAdmin && (
            <button onClick={openAdd} className="flex items-center gap-2 rounded-sm bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-700">
              <Plus size={18} /> Record Salary
            </button>
          )} />
        </div>
      ) : (
        <div className="overflow-hidden rounded-md bg-paper shadow-xs border border-ink-100">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-ink-50 border-b border-ink-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-ink-600 uppercase tracking-wide">Employee</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-ink-600 uppercase tracking-wide">Period</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-ink-600 uppercase tracking-wide">Basic</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-ink-600 uppercase tracking-wide">Allowances</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-ink-600 uppercase tracking-wide">Deductions</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-ink-600 uppercase tracking-wide">Net Salary</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-ink-600 uppercase tracking-wide">Paid On</th>
                  {isAdmin && <th className="px-4 py-3 text-right text-xs font-medium text-ink-600 uppercase tracking-wide">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {salaries.map(s => (
                  <tr key={s.id} className="hover:bg-ink-50">
                    <td className="px-4 py-3 text-sm font-medium text-ink-900">{s.employee?.full_name || '—'}</td>
                    <td className="px-4 py-3 text-sm text-ink-600" data-numeric>{getMonthName(s.pay_period_month)} {s.pay_period_year}</td>
                    <td className="px-4 py-3 text-sm text-ink-600 text-right" data-numeric>{formatCurrency(s.basic_salary)}</td>
                    <td className="px-4 py-3 text-sm text-accent-500 text-right" data-numeric>{formatCurrency(s.allowances)}</td>
                    <td className="px-4 py-3 text-sm text-danger text-right" data-numeric>{formatCurrency(s.deductions)}</td>
                    <td className="px-4 py-3 text-sm font-semibold text-ink-900 text-right" data-numeric>{formatCurrency(s.net_salary)}</td>
                    <td className="px-4 py-3 text-sm text-ink-600" data-numeric>{formatDate(s.payment_date)}</td>
                    {isAdmin && (
                      <td className="px-4 py-3 text-right">
                        <button onClick={() => setDeleteId(s.id)} className="rounded-sm p-1.5 text-ink-400 hover:bg-danger/10 hover:text-danger">
                          <Trash2 size={16} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Record Salary Payment">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-ink-700 mb-1">Employee *</label>
            <select
              value={formData.employee_id}
              onChange={e => handleEmployeeChange(e.target.value)}
              className="w-full rounded-sm border px-3 py-2 text-sm outline-none h-10 border-ink-200 bg-paper focus:border-accent-500"
            >
              <option value="">Select employee...</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.full_name} — {e.position || 'Staff'}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-ink-700 mb-1">Month</label>
              <select
                value={formData.pay_period_month}
                onChange={e => setFormData({ ...formData, pay_period_month: parseInt(e.target.value) })}
                className="w-full rounded-sm border px-3 py-2 text-sm outline-none h-10 border-ink-200 bg-paper focus:border-accent-500"
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>{getMonthName(m)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-700 mb-1">Year</label>
              <input
                type="number"
                value={formData.pay_period_year}
                onChange={e => setFormData({ ...formData, pay_period_year: parseInt(e.target.value) })}
                className="w-full rounded-sm border px-3 py-2 text-sm outline-none h-10 border-ink-200 bg-paper focus:border-accent-500 font-mono tabular-nums"
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-ink-700 mb-1">Basic Salary</label>
              <input
                type="number"
                step="0.01"
                value={formData.basic_salary}
                onChange={e => setFormData({ ...formData, basic_salary: e.target.value })}
                className="w-full rounded-sm border px-3 py-2 text-sm outline-none h-10 border-ink-200 bg-paper focus:border-accent-500 font-mono tabular-nums"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-700 mb-1">Allowances</label>
              <input
                type="number"
                step="0.01"
                value={formData.allowances}
                onChange={e => setFormData({ ...formData, allowances: e.target.value })}
                className="w-full rounded-sm border px-3 py-2 text-sm outline-none h-10 border-ink-200 bg-paper focus:border-accent-500 font-mono tabular-nums"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-700 mb-1">Deductions</label>
              <input
                type="number"
                step="0.01"
                value={formData.deductions}
                onChange={e => setFormData({ ...formData, deductions: e.target.value })}
                className="w-full rounded-sm border px-3 py-2 text-sm outline-none h-10 border-ink-200 bg-paper focus:border-accent-500 font-mono tabular-nums"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-700 mb-1">Payment Date</label>
            <input
              type="date"
              value={formData.payment_date}
              onChange={e => setFormData({ ...formData, payment_date: e.target.value })}
              className="w-full rounded-sm border px-3 py-2 text-sm outline-none h-10 border-ink-200 bg-paper focus:border-accent-500 font-mono tabular-nums"
            />
          </div>
          <div className="rounded-lg bg-ink-50 px-4 py-3 flex items-center justify-between">
            <span className="text-sm font-medium text-ink-600">Net Salary</span>
            <span className="text-lg font-bold text-accent-500" data-numeric>{formatCurrency(netSalary)}</span>
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-700 mb-1">Note</label>
            <textarea
              value={formData.note}
              onChange={e => setFormData({ ...formData, note: e.target.value })}
              rows={2}
              className="w-full rounded-sm border px-3 py-2 text-sm outline-none border-ink-200 bg-paper focus:border-accent-500"
            />
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <button onClick={() => setModalOpen(false)} className="rounded-sm px-4 py-2 text-sm font-medium text-ink-600 hover:bg-ink-100">Cancel</button>
          <button onClick={handleSave} className="rounded-sm bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-700">Record Salary</button>
        </div>
      </Modal>

      {deleteId && (
        <div className="fixed bottom-4 right-4 z-50 rounded-md bg-paper shadow-xs border border-ink-100 p-4 max-w-xs">
          <p className="text-sm text-ink-700 mb-3">Delete this salary record?</p>
          <div className="flex justify-end gap-2">
            <button onClick={() => setDeleteId(null)} className="rounded-sm px-3 py-1.5 text-sm text-ink-600 hover:bg-ink-100">Cancel</button>
            <button onClick={handleDelete} className="rounded-sm bg-danger px-3 py-1.5 text-sm text-white hover:bg-danger">Delete</button>
          </div>
        </div>
      )}
    </div>
  );
}
