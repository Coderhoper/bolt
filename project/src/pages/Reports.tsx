import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { formatCurrency, formatDate, getMonthName } from '@/lib/utils';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatCard } from '@/components/ui/StatCard';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  TrendingUp, Wallet, ShoppingCart, Receipt,
  Target, DollarSign, Calendar, FileSpreadsheet,
} from 'lucide-react';
import type { Sale, Purchase, Expense, SaleItem } from '@/types';

type ReportPeriod = 'daily' | 'weekly' | 'monthly';

export function Reports() {
  const [period, setPeriod] = useState<ReportPeriod>('monthly');
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [loading, setLoading] = useState(true);
  const [reportData, setReportData] = useState({
    sales: [] as Sale[],
    purchases: [] as Purchase[],
    expenses: [] as Expense[],
    saleItems: [] as SaleItem[],
    totalSales: 0,
    totalPurchases: 0,
    totalExpenses: 0,
    totalCogs: 0,
    grossProfit: 0,
    netProfit: 0,
    expectedProfit: 0,
    deficit: 0,
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    let startDate: string;
    let endDate: string;

    if (period === 'daily') {
      startDate = selectedDate;
      endDate = selectedDate;
    } else if (period === 'weekly') {
      const d = new Date(selectedDate);
      const day = d.getDay();
      const monday = new Date(d);
      monday.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      startDate = monday.toISOString().split('T')[0];
      endDate = sunday.toISOString().split('T')[0];
    } else {
      const d = new Date(selectedDate);
      startDate = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0];
      endDate = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().split('T')[0];
    }

    const [{ data: sales }, { data: purchases }, { data: expenses }, { data: saleItems }] = await Promise.all([
      supabase.from('sales').select('*').gte('sale_date', startDate).lte('sale_date', endDate).order('sale_date', { ascending: false }),
      supabase.from('purchases').select('*, supplier:suppliers(*)').gte('purchase_date', startDate).lte('purchase_date', endDate).order('purchase_date', { ascending: false }),
      supabase.from('expenses').select('*').gte('expense_date', startDate).lte('expense_date', endDate).order('expense_date', { ascending: false }),
      supabase.from('sale_items').select('*, product:products(*), sale:sales(*)').gte('sale.created_at', startDate + 'T00:00:00').lte('sale.created_at', endDate + 'T23:59:59'),
    ]);

    const salesArr = sales || [];
    const purchasesArr = purchases || [];
    const expensesArr = expenses || [];
    const saleItemsArr = (saleItems || []) as SaleItem[];

    const totalSales = salesArr.reduce((s, x) => s + Number(x.total_amount), 0);
    const totalPurchases = purchasesArr.reduce((s, x) => s + Number(x.total_amount), 0);
    const totalExpenses = expensesArr.reduce((s, x) => s + Number(x.amount), 0);
    const totalCogs = salesArr.reduce((s, x) => s + Number(x.total_cost), 0);
    const grossProfit = totalSales - totalCogs;
    const netProfit = grossProfit - totalExpenses;

    const d = new Date(selectedDate);
    const { data: target } = await supabase
      .from('profit_targets')
      .select('*')
      .eq('target_year', d.getFullYear())
      .eq('target_month', d.getMonth() + 1)
      .maybeSingle();

    const expectedProfit = target ? Number(target.expected_profit) : 0;
    const deficit = expectedProfit - netProfit;

    setReportData({
      sales: salesArr, purchases: purchasesArr, expenses: expensesArr, saleItems: saleItemsArr,
      totalSales, totalPurchases, totalExpenses, totalCogs,
      grossProfit, netProfit, expectedProfit, deficit,
    });
    setLoading(false);
  }, [period, selectedDate]);

  useEffect(() => { loadData(); }, [loadData]);

  const escapeCsv = (val: string | number | null | undefined): string => {
    const s = String(val ?? '');
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const handleExportExcel = () => {
    const d = new Date(selectedDate);
    let periodLabel = '';
    if (period === 'daily') periodLabel = formatDate(selectedDate);
    else if (period === 'weekly') periodLabel = `Week of ${formatDate(selectedDate)}`;
    else periodLabel = `${getMonthName(d.getMonth() + 1)} ${d.getFullYear()}`;

    const rows: (string | number)[][] = [];

    // Summary sheet header
    rows.push(['BUSINESS PERFORMANCE REPORT']);
    rows.push(['Period', periodLabel]);
    rows.push([]);
    rows.push(['SUMMARY']);
    rows.push(['Total Sales', reportData.totalSales]);
    rows.push(['Total Purchases', reportData.totalPurchases]);
    rows.push(['Cost of Goods Sold (COGS)', reportData.totalCogs]);
    rows.push(['Gross Profit', reportData.grossProfit]);
    rows.push(['Total Expenses', reportData.totalExpenses]);
    rows.push(['Net Profit', reportData.netProfit]);
    rows.push(['Expected Profit', reportData.expectedProfit]);
    rows.push([reportData.deficit > 0 ? 'Deficit' : 'Surplus', Math.abs(reportData.deficit)]);
    rows.push([]);

    // Per-product sales detail
    rows.push(['SALES DETAIL — PER PRODUCT']);
    rows.push(['Sale Number', 'Date', 'Customer', 'Payment Method', 'Product', 'Quantity', 'Selling Price', 'Buying Price', 'Total', 'Profit']);

    for (const item of reportData.saleItems) {
      rows.push([
        item.sale?.sale_number || '',
        item.sale ? formatDate(item.sale.sale_date) : '',
        item.sale?.customer_name || 'Walk-in',
        item.sale?.payment_method || '',
        item.product?.name || '',
        String(item.quantity),
        String(item.selling_price),
        String(item.buying_price),
        String(item.total),
        String(item.profit),
      ]);
    }
    rows.push([]);

    // Product performance summary
    rows.push(['PRODUCT PERFORMANCE SUMMARY']);
    rows.push(['Product', 'Total Qty Sold', 'Total Revenue', 'Total Cost', 'Total Profit']);

    const productPerf: Record<string, { name: string; qty: number; revenue: number; cost: number; profit: number }> = {};
    for (const item of reportData.saleItems) {
      const key = item.product_id;
      if (!productPerf[key]) {
        productPerf[key] = { name: item.product?.name || 'Unknown', qty: 0, revenue: 0, cost: 0, profit: 0 };
      }
      productPerf[key].qty += item.quantity;
      productPerf[key].revenue += item.total;
      productPerf[key].cost += item.buying_price * item.quantity;
      productPerf[key].profit += item.profit;
    }

    for (const key of Object.keys(productPerf)) {
      const p = productPerf[key];
      rows.push([p.name, String(p.qty), String(p.revenue), String(p.cost), String(p.profit)]);
    }
    rows.push([]);

    // Purchases detail
    rows.push(['PURCHASES DETAIL']);
    rows.push(['Date', 'Supplier', 'Invoice #', 'Payment Status', 'Amount Paid', 'Total Amount']);

    for (const p of reportData.purchases) {
      rows.push([
        formatDate(p.purchase_date),
        p.supplier?.name || '—',
        p.invoice_number || '',
        p.payment_status,
        String(p.amount_paid || 0),
        String(p.total_amount),
      ]);
    }
    rows.push([]);

    // Expenses detail
    rows.push(['EXPENSES DETAIL']);
    rows.push(['Date', 'Category', 'Description', 'Payment Method', 'Amount']);

    for (const e of reportData.expenses) {
      rows.push([
        formatDate(e.expense_date),
        e.category,
        e.description || '',
        e.payment_method,
        String(e.amount),
      ]);
    }

    const csv = rows.map(r => r.map(escapeCsv).join(',')).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `business-report-${period}-${selectedDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>;
  }

  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle="View and export business performance reports"
        actions={
          <button onClick={handleExportExcel} className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 transition-colors">
            <FileSpreadsheet size={18} /> Export Excel (CSV)
          </button>
        }
      />

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex rounded-lg border border-slate-200 bg-white p-1">
          {(['daily', 'weekly', 'monthly'] as ReportPeriod[]).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`rounded-md px-4 py-1.5 text-sm font-medium capitalize transition-colors ${
                period === p ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
        <div className="relative">
          <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input
            type="date"
            value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm focus:border-blue-500 outline-none"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 mb-6">
        <StatCard label="Total Sales" value={formatCurrency(reportData.totalSales)} icon={ShoppingCart} color="blue" />
        <StatCard label="Total Purchases" value={formatCurrency(reportData.totalPurchases)} icon={Receipt} color="violet" />
        <StatCard label="Gross Profit" value={formatCurrency(reportData.grossProfit)} icon={TrendingUp} color="emerald" />
        <StatCard label="Total Expenses" value={formatCurrency(reportData.totalExpenses)} icon={Wallet} color="amber" />
        <StatCard label="Net Profit" value={formatCurrency(reportData.netProfit)} icon={DollarSign} color={reportData.netProfit >= 0 ? 'emerald' : 'rose'} />
        <StatCard label={reportData.deficit > 0 ? 'Deficit' : 'Surplus'} value={formatCurrency(Math.abs(reportData.deficit))} icon={Target} color={reportData.deficit > 0 ? 'rose' : 'emerald'} />
      </div>

      {/* Per-product performance table */}
      {reportData.saleItems.length > 0 && (
        <div className="mb-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/60">
          <h3 className="text-sm font-semibold text-slate-900 mb-4">Product Performance</h3>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-slate-600">Product</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold text-slate-600">Qty Sold</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold text-slate-600">Revenue</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold text-slate-600">Cost</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold text-slate-600">Profit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {Object.entries(
                  reportData.saleItems.reduce((acc, item) => {
                    const key = item.product_id;
                    if (!acc[key]) acc[key] = { name: item.product?.name || 'Unknown', qty: 0, revenue: 0, cost: 0, profit: 0 };
                    acc[key].qty += item.quantity;
                    acc[key].revenue += item.total;
                    acc[key].cost += item.buying_price * item.quantity;
                    acc[key].profit += item.profit;
                    return acc;
                  }, {} as Record<string, { name: string; qty: number; revenue: number; cost: number; profit: number }>)
                ).map(([key, p]) => (
                  <tr key={key} className="hover:bg-slate-50">
                    <td className="px-4 py-2 text-sm font-medium text-slate-900">{p.name}</td>
                    <td className="px-4 py-2 text-sm text-slate-600 text-right">{p.qty}</td>
                    <td className="px-4 py-2 text-sm text-slate-900 text-right">{formatCurrency(p.revenue)}</td>
                    <td className="px-4 py-2 text-sm text-rose-600 text-right">{formatCurrency(p.cost)}</td>
                    <td className="px-4 py-2 text-sm font-medium text-emerald-600 text-right">{formatCurrency(p.profit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/60">
          <h3 className="text-sm font-semibold text-slate-900 mb-4">Sales ({reportData.sales.length})</h3>
          {reportData.sales.length > 0 ? (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {reportData.sales.map(s => (
                <div key={s.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                  <div>
                    <p className="text-sm font-medium text-slate-900">{s.sale_number || '—'}</p>
                    <p className="text-xs text-slate-500">{formatDate(s.sale_date)} · {s.customer_name || 'Walk-in'}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-slate-900">{formatCurrency(s.total_amount)}</p>
                    <p className="text-xs text-emerald-600">+{formatCurrency(s.total_profit)}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={ShoppingCart} title="No sales in this period" />
          )}
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/60">
          <h3 className="text-sm font-semibold text-slate-900 mb-4">Purchases ({reportData.purchases.length})</h3>
          {reportData.purchases.length > 0 ? (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {reportData.purchases.map(p => (
                <div key={p.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                  <div>
                    <p className="text-sm font-medium text-slate-900">{p.invoice_number || 'Purchase'}</p>
                    <p className="text-xs text-slate-500">{formatDate(p.purchase_date)} · {p.supplier?.name || '—'}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-slate-900">{formatCurrency(p.total_amount)}</p>
                    <span className={`text-xs font-medium ${p.payment_status === 'paid' ? 'text-emerald-600' : p.payment_status === 'partial' ? 'text-amber-600' : 'text-rose-600'}`}>
                      {p.payment_status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={Receipt} title="No purchases in this period" />
          )}
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/60">
          <h3 className="text-sm font-semibold text-slate-900 mb-4">Expenses ({reportData.expenses.length})</h3>
          {reportData.expenses.length > 0 ? (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {reportData.expenses.map(e => (
                <div key={e.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                  <div>
                    <p className="text-sm font-medium text-slate-900">{e.category}</p>
                    <p className="text-xs text-slate-500">{formatDate(e.expense_date)} · {e.description || '—'}</p>
                  </div>
                  <p className="text-sm font-semibold text-rose-600">{formatCurrency(e.amount)}</p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={Wallet} title="No expenses in this period" />
          )}
        </div>
      </div>
    </div>
  );
}
