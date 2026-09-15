import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { formatCurrency, formatDate } from '@/lib/utils';
import { StatCard } from '@/components/ui/StatCard';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  TrendingUp, TrendingDown, Wallet, Package, AlertTriangle,
  Users, Target, ArrowUpRight, ArrowDownRight, BarChart3, ShoppingCart,
} from 'lucide-react';
import type { DashboardSummary, Sale, Product } from '@/types';

export function Dashboard() {
  const { isAdmin } = useAuth();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [recentSales, setRecentSales] = useState<Sale[]>([]);
  const [lowStockProducts, setLowStockProducts] = useState<Product[]>([]);
  const [salesChart, setSalesChart] = useState<{ date: string; total: number }[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    const today = new Date();
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

    const { data: summaryData } = await supabase.rpc('get_dashboard_summary', {
      p_start_date: monthStart.toISOString().split('T')[0],
      p_end_date: today.toISOString().split('T')[0],
    });

    if (summaryData) setSummary(summaryData as DashboardSummary);

    const { data: sales } = await supabase
      .from('sales')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(5);
    if (sales) setRecentSales(sales);

    const { data: lowStock } = await supabase
      .from('products')
      .select('*')
      .eq('status', 'active')
      .filter('current_stock', 'lte', 'minimum_stock')
      .order('current_stock', { ascending: true })
      .limit(10);
    if (lowStock) setLowStockProducts(lowStock);

    // Sales chart for last 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    const { data: chartData } = await supabase
      .from('sales')
      .select('sale_date, total_amount')
      .gte('sale_date', sevenDaysAgo.toISOString().split('T')[0])
      .order('sale_date', { ascending: true });

    if (chartData) {
      const grouped: Record<string, number> = {};
      for (const s of chartData as { sale_date: string; total_amount: number }[]) {
        grouped[s.sale_date] = (grouped[s.sale_date] || 0) + Number(s.total_amount);
      }
      const chart: { date: string; total: number }[] = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().split('T')[0];
        chart.push({ date: dateStr, total: grouped[dateStr] || 0 });
      }
      setSalesChart(chart);
    }

    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  const maxSale = Math.max(...salesChart.map(d => d.total), 1);

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={`${formatDate(summary?.start_date || new Date())} — ${formatDate(summary?.end_date || new Date())}`}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 mb-6">
        <StatCard label="Total Sales" value={formatCurrency(summary?.total_sales || 0)} icon={TrendingUp} color="blue" />
        <StatCard label="Gross Profit" value={formatCurrency(summary?.gross_profit || 0)} icon={BarChart3} color="emerald" />
        <StatCard label="Net Profit" value={formatCurrency(summary?.net_profit || 0)} icon={Target} color={summary && summary.net_profit >= 0 ? 'emerald' : 'rose'} />
        <StatCard label="Total Expenses" value={formatCurrency(summary?.total_expenses || 0)} icon={Wallet} color="amber" />
        <StatCard label="Stock Value" value={formatCurrency(summary?.stock_value || 0)} icon={Package} color="violet" />
        <StatCard label="Low Stock Items" value={String(summary?.low_stock_count || 0)} icon={AlertTriangle} color="rose" />
      </div>

      {/* Expected vs Actual */}
      <div className="mb-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/60">
        <h3 className="text-sm font-semibold text-slate-900 mb-4">Profit Target Performance</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-xl bg-slate-50 p-4">
            <p className="text-xs font-medium text-slate-500">Expected Profit</p>
            <p className="mt-1 text-xl font-bold text-slate-900">{formatCurrency(summary?.expected_profit || 0)}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-4">
            <p className="text-xs font-medium text-slate-500">Actual Net Profit</p>
            <p className="mt-1 text-xl font-bold text-slate-900">{formatCurrency(summary?.net_profit || 0)}</p>
          </div>
          <div className={`rounded-xl p-4 ${(summary?.deficit || 0) > 0 ? 'bg-rose-50' : 'bg-emerald-50'}`}>
            <p className="text-xs font-medium text-slate-500">{(summary?.deficit || 0) > 0 ? 'Deficit' : 'Surplus'}</p>
            <p className={`mt-1 text-xl font-bold ${(summary?.deficit || 0) > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
              {formatCurrency(Math.abs(summary?.deficit || 0))}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Sales Chart */}
        <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/60">
          <h3 className="text-sm font-semibold text-slate-900 mb-4">Sales — Last 7 Days</h3>
          {salesChart.length > 0 ? (
            <div className="flex items-end justify-between gap-2 h-48">
              {salesChart.map((d, i) => (
                <div key={i} className="flex flex-1 flex-col items-center gap-2">
                  <div className="w-full flex items-end h-40">
                    <div
                      className="w-full rounded-t-lg bg-gradient-to-t from-blue-500 to-emerald-400 transition-all hover:opacity-80"
                      style={{ height: `${(d.total / maxSale) * 100}%`, minHeight: d.total > 0 ? '4px' : '0' }}
                      title={formatCurrency(d.total)}
                    />
                  </div>
                  <span className="text-xs text-slate-400">
                    {new Date(d.date).toLocaleDateString('en', { weekday: 'short' })}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-400 text-center py-12">No sales data yet</p>
          )}
        </div>

        {/* Low Stock Alert */}
        <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/60">
          <h3 className="text-sm font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <AlertTriangle size={16} className="text-amber-500" />
            Low Stock Alerts
          </h3>
          {lowStockProducts.length > 0 ? (
            <div className="space-y-3 max-h-48 overflow-y-auto">
              {lowStockProducts.map(p => (
                <div key={p.id} className="flex items-center justify-between rounded-lg bg-amber-50 px-3 py-2">
                  <div>
                    <p className="text-sm font-medium text-slate-900">{p.name}</p>
                    <p className="text-xs text-slate-500">Min: {p.minimum_stock} {p.unit}</p>
                  </div>
                  <span className="text-sm font-bold text-amber-600">{p.current_stock} {p.unit}</span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={Package} title="All stock levels are healthy" />
          )}
        </div>

        {/* Recent Sales */}
        <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/60 lg:col-span-2">
          <h3 className="text-sm font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <ShoppingCart size={16} className="text-blue-500" />
            Recent Sales
          </h3>
          {recentSales.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="pb-2 text-left text-xs font-medium text-slate-500">Sale #</th>
                    <th className="pb-2 text-left text-xs font-medium text-slate-500">Date</th>
                    <th className="pb-2 text-left text-xs font-medium text-slate-500">Customer</th>
                    <th className="pb-2 text-left text-xs font-medium text-slate-500">Payment</th>
                    <th className="pb-2 text-right text-xs font-medium text-slate-500">Amount</th>
                    <th className="pb-2 text-right text-xs font-medium text-slate-500">Profit</th>
                  </tr>
                </thead>
                <tbody>
                  {recentSales.map(sale => (
                    <tr key={sale.id} className="border-b border-slate-50 hover:bg-slate-50">
                      <td className="py-3 text-sm font-medium text-slate-900">{sale.sale_number || '—'}</td>
                      <td className="py-3 text-sm text-slate-600">{formatDate(sale.sale_date)}</td>
                      <td className="py-3 text-sm text-slate-600">{sale.customer_name || 'Walk-in'}</td>
                      <td className="py-3 text-sm text-slate-600 capitalize">{sale.payment_method}</td>
                      <td className="py-3 text-sm font-semibold text-slate-900 text-right">{formatCurrency(sale.total_amount)}</td>
                      <td className="py-3 text-sm font-medium text-emerald-600 text-right">{formatCurrency(sale.total_profit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={ShoppingCart} title="No sales recorded yet" />
          )}
        </div>
      </div>
    </div>
  );
}
