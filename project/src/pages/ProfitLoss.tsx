import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { formatCurrency, getMonthName } from '@/lib/utils';
import { logAudit } from '@/lib/audit';
import { PageHeader } from '@/components/ui/PageHeader';
import { Modal } from '@/components/ui/Modal';
import { StatCard } from '@/components/ui/StatCard';
import { Target, TrendingUp, TrendingDown, DollarSign, Wallet, BarChart3, CheckCircle } from 'lucide-react';
import type { ProfitTarget } from '@/types';

export function ProfitLoss() {
  const { isAdmin } = useAuth();
  const { showToast } = useToast();
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState({
    total_sales: 0, total_cogs: 0, gross_profit: 0, total_expenses: 0,
    net_profit: 0, expected_profit: 0, deficit: 0,
  });
  const [targets, setTargets] = useState<ProfitTarget[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [targetAmount, setTargetAmount] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    const startDate = new Date(selectedYear, selectedMonth - 1, 1).toISOString().split('T')[0];
    const endDate = new Date(selectedYear, selectedMonth, 0).toISOString().split('T')[0];

    const { data } = await supabase.rpc('get_dashboard_summary', {
      p_start_date: startDate,
      p_end_date: endDate,
    });

    if (data) {
      setSummary({
        total_sales: data.total_sales || 0,
        total_cogs: data.total_cogs || 0,
        gross_profit: data.gross_profit || 0,
        total_expenses: data.total_expenses || 0,
        net_profit: data.net_profit || 0,
        expected_profit: data.expected_profit || 0,
        deficit: data.deficit || 0,
      });
    }

    const { data: targetData } = await supabase
      .from('profit_targets')
      .select('*')
      .order('target_year', { ascending: false })
      .order('target_month', { ascending: false })
      .limit(12);

    setTargets(targetData || []);
    setLoading(false);
  }, [selectedMonth, selectedYear]);

  useEffect(() => { loadData(); }, [loadData]);

  const currentTarget = targets.find(t => t.target_month === selectedMonth && t.target_year === selectedYear);

  const openSetTarget = () => {
    setTargetAmount(currentTarget ? String(currentTarget.expected_profit) : '');
    setModalOpen(true);
  };

  const handleSaveTarget = async () => {
    const amount = parseFloat(targetAmount) || 0;
    if (currentTarget) {
      const { error } = await supabase.from('profit_targets').update({ expected_profit: amount }).eq('id', currentTarget.id);
      if (error) { showToast('Failed to update target', 'error'); return; }
      await logAudit('UPDATE_PROFIT_TARGET', 'profit_target', currentTarget.id, `Updated profit target for ${getMonthName(selectedMonth)} ${selectedYear}: ${formatCurrency(amount)}`);
    } else {
      const { error } = await supabase.from('profit_targets').insert({
        target_month: selectedMonth, target_year: selectedYear, expected_profit: amount,
      });
      if (error) { showToast('Failed to set target', 'error'); return; }
      await logAudit('CREATE_PROFIT_TARGET', 'profit_target', null, `Set profit target for ${getMonthName(selectedMonth)} ${selectedYear}: ${formatCurrency(amount)}`);
    }
    showToast('Profit target saved', 'success');
    setModalOpen(false);
    loadData();
  };

  if (loading) {
    return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>;
  }

  const revenue = summary.total_sales;
  const cogs = summary.total_cogs;
  const grossProfit = summary.gross_profit;
  const expenses = summary.total_expenses;
  const netProfit = summary.net_profit;
  const expected = summary.expected_profit;
  const deficit = summary.deficit;
  const achieved = expected > 0 && netProfit >= expected;

  return (
    <div>
      <PageHeader
        title="Profit & Loss"
        subtitle={`${getMonthName(selectedMonth)} ${selectedYear}`}
        actions={isAdmin && (
          <button onClick={openSetTarget} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors">
            <Target size={18} /> Set Profit Target
          </button>
        )}
      />

      <div className="mb-6 flex items-center gap-3">
        <select
          value={selectedMonth}
          onChange={e => setSelectedMonth(parseInt(e.target.value))}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 outline-none"
        >
          {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>{getMonthName(m)}</option>)}
        </select>
        <select
          value={selectedYear}
          onChange={e => setSelectedYear(parseInt(e.target.value))}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 outline-none"
        >
          {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i).map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 mb-6">
        <StatCard label="Revenue (Total Sales)" value={formatCurrency(revenue)} icon={DollarSign} color="blue" />
        <StatCard label="Cost of Goods Sold" value={formatCurrency(cogs)} icon={TrendingDown} color="rose" />
        <StatCard label="Gross Profit" value={formatCurrency(grossProfit)} icon={TrendingUp} color="emerald" />
        <StatCard label="Total Expenses" value={formatCurrency(expenses)} icon={Wallet} color="amber" />
        <StatCard label="Net Profit" value={formatCurrency(netProfit)} icon={BarChart3} color={netProfit >= 0 ? 'emerald' : 'rose'} />
        <StatCard label="Expected Profit" value={formatCurrency(expected)} icon={Target} color="violet" />
      </div>

      {/* P&L Breakdown */}
      <div className="mb-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/60">
        <h3 className="text-sm font-semibold text-slate-900 mb-4">Profit & Loss Statement</h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between py-2 border-b border-slate-100">
            <span className="text-sm text-slate-600">Revenue</span>
            <span className="text-sm font-semibold text-slate-900">{formatCurrency(revenue)}</span>
          </div>
          <div className="flex items-center justify-between py-2 border-b border-slate-100">
            <span className="text-sm text-slate-600">Less: Cost of Goods Sold</span>
            <span className="text-sm font-semibold text-rose-600">({formatCurrency(cogs)})</span>
          </div>
          <div className="flex items-center justify-between py-2 border-b-2 border-slate-200">
            <span className="text-sm font-medium text-slate-900">Gross Profit</span>
            <span className="text-sm font-bold text-emerald-600">{formatCurrency(grossProfit)}</span>
          </div>
          <div className="flex items-center justify-between py-2 border-b border-slate-100">
            <span className="text-sm text-slate-600">Less: Operating Expenses</span>
            <span className="text-sm font-semibold text-rose-600">({formatCurrency(expenses)})</span>
          </div>
          <div className="flex items-center justify-between py-2 border-b-2 border-slate-200">
            <span className="text-sm font-medium text-slate-900">Net Profit</span>
            <span className="text-base font-bold text-slate-900">{formatCurrency(netProfit)}</span>
          </div>
        </div>
      </div>

      {/* Expected vs Actual */}
      <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/60">
        <h3 className="text-sm font-semibold text-slate-900 mb-4">Target Performance</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-xl bg-violet-50 p-4">
            <p className="text-xs font-medium text-slate-500">Expected Profit</p>
            <p className="mt-1 text-xl font-bold text-slate-900">{formatCurrency(expected)}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-4">
            <p className="text-xs font-medium text-slate-500">Actual Net Profit</p>
            <p className="mt-1 text-xl font-bold text-slate-900">{formatCurrency(netProfit)}</p>
          </div>
          <div className={`rounded-xl p-4 ${deficit > 0 ? 'bg-rose-50' : 'bg-emerald-50'}`}>
            <p className="text-xs font-medium text-slate-500 flex items-center gap-1">
              {deficit > 0 ? 'Deficit' : (achieved ? 'Surplus' : 'On Track')}
              {achieved && <CheckCircle size={14} className="text-emerald-600" />}
            </p>
            <p className={`mt-1 text-xl font-bold ${deficit > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
              {formatCurrency(Math.abs(deficit))}
            </p>
          </div>
        </div>
        {expected > 0 && (
          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-slate-500">Progress toward target</span>
              <span className="text-xs font-medium text-slate-700">{Math.min(100, Math.round((netProfit / expected) * 100))}%</span>
            </div>
            <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${achieved ? 'bg-emerald-500' : 'bg-blue-500'}`}
                style={{ width: `${Math.min(100, (netProfit / expected) * 100)}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Profit Target History */}
      {targets.length > 0 && (
        <div className="mt-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/60">
          <h3 className="text-sm font-semibold text-slate-900 mb-4">Profit Target History</h3>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="pb-2 text-left text-xs font-medium text-slate-500">Period</th>
                  <th className="pb-2 text-right text-xs font-medium text-slate-500">Expected</th>
                </tr>
              </thead>
              <tbody>
                {targets.map(t => (
                  <tr key={t.id} className="border-b border-slate-50">
                    <td className="py-2 text-sm text-slate-900">{getMonthName(t.target_month)} {t.target_year}</td>
                    <td className="py-2 text-sm font-medium text-slate-900 text-right">{formatCurrency(t.expected_profit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={`Profit Target — ${getMonthName(selectedMonth)} ${selectedYear}`}>
        <div className="space-y-4">
          <p className="text-sm text-slate-600">Set the expected monthly profit target. The system will compare actual net profit against this target to calculate deficits or surpluses.</p>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Expected Profit Amount</label>
            <input
              type="number"
              step="0.01"
              value={targetAmount}
              onChange={e => setTargetAmount(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 outline-none"
              placeholder="e.g. 500000"
            />
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <button onClick={() => setModalOpen(false)} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
          <button onClick={handleSaveTarget} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">Save Target</button>
        </div>
      </Modal>
    </div>
  );
}
