import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { formatCurrency, formatDate } from '@/lib/utils';
import { PageHeader } from '@/components/ui/PageHeader';
import { TenantOwnerDesk } from '@/components/TenantOwnerDesk';
import { isTenantContextActive } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { getTimeGreeting, useCurrentTime } from '@/hooks/useCurrentTime';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { ArrowUpRight, BarChart3, Box, CircleDollarSign, Package, ShoppingCart, TriangleAlert } from 'lucide-react';
import type { DashboardSummary, Sale, Product } from '@/types';

type DailySales = { date: string; total: number };
type StockProduct = Pick<Product, 'id' | 'name' | 'catalog_sku' | 'unit' | 'current_stock' | 'minimum_stock'>;
const localDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

function TrendChart({ data }: { data: DailySales[] }) {
  const width = 720;
  const height = 230;
  const plotTop = 18;
  const plotBottom = 184;
  const max = Math.max(...data.map(item => item.total), 1);
  const points = data.map((item, index) => {
    const x = data.length <= 1 ? width / 2 : 18 + index * ((width - 36) / (data.length - 1));
    const y = plotBottom - (item.total / max) * (plotBottom - plotTop);
    return { x, y, item };
  });
  const line = points.map(point => `${point.x},${point.y}`).join(' ');
  const area = points.length ? `M ${points[0].x} ${plotBottom} L ${points.map(point => `${point.x} ${point.y}`).join(' L ')} L ${points[points.length - 1].x} ${plotBottom} Z` : '';

  return (
    <div>
      <div className="overflow-hidden">
        <svg viewBox={`0 0 ${width} ${height}`} className="h-[230px] w-full" role="img" aria-label="Daily sales trend">
          <defs><linearGradient id="sales-area" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#635BFF" stopOpacity=".22" /><stop offset="100%" stopColor="#635BFF" stopOpacity="0" /></linearGradient></defs>
          {[0, 1, 2, 3].map(index => {
            const y = plotTop + index * ((plotBottom - plotTop) / 3);
            return <line key={index} x1="0" x2={width} y1={y} y2={y} stroke="#E8EDF5" strokeDasharray="4 6" />;
          })}
          {area && <path d={area} fill="url(#sales-area)" />}
          {points.length > 1 && <polyline points={line} fill="none" stroke="#635BFF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />}
          {points.map(point => <circle key={point.item.date} cx={point.x} cy={point.y} r="3.5" fill="#fff" stroke="#635BFF" strokeWidth="2" />)}
        </svg>
      </div>
      <div className="mt-1 grid grid-cols-8 gap-1 text-center text-[11px] text-ink-400">
        {data.filter((_, index) => index % Math.max(1, Math.ceil(data.length / 7)) === 0 || index === data.length - 1).map(item => (
          <span key={item.date}>{new Date(`${item.date}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
        ))}
      </div>
    </div>
  );
}

export function Dashboard() {
  const { isAdmin, profile } = useAuth();
  const now = useCurrentTime();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [recentSales, setRecentSales] = useState<Sale[]>([]);
  const [lowStockProducts, setLowStockProducts] = useState<StockProduct[]>([]);
  const [salesChart, setSalesChart] = useState<DailySales[]>([]);
  const [inventoryCounts, setInventoryCounts] = useState({ healthy: 0, low: 0, out: 0 });
  const [orderCount, setOrderCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    const today = new Date();
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthStartText = localDate(monthStart);
    const todayText = localDate(today);
    const from = new Date(today);
    from.setDate(from.getDate() - 13);
    const fromText = localDate(from);

    const [summaryResult, salesResult, recentResult, productsResult] = await Promise.all([
      supabase.rpc('get_dashboard_summary', { p_start_date: monthStartText, p_end_date: todayText }),
      supabase.from('sales').select('id,sale_date,total_amount,payment_status').gte('sale_date', fromText).order('sale_date'),
      supabase.from('sales').select('*').order('created_at', { ascending: false }).limit(6),
      supabase.from('products').select('id,name,catalog_sku,unit,current_stock,minimum_stock,status').eq('status', 'active').order('current_stock').limit(1000),
    ]);

    if (summaryResult.data) setSummary(summaryResult.data as DashboardSummary);
    setRecentSales((recentResult.data || []) as Sale[]);
    const daily = new Map<string, number>();
    for (const sale of (salesResult.data || []) as { sale_date: string; total_amount: number; payment_status?: string }[]) {
      if (!['failed', 'pending'].includes(sale.payment_status || '')) {
        daily.set(sale.sale_date, (daily.get(sale.sale_date) || 0) + Number(sale.total_amount));
      }
    }
    const trend: DailySales[] = [];
    for (let offset = 13; offset >= 0; offset -= 1) {
      const day = new Date(today);
      day.setDate(day.getDate() - offset);
      const date = localDate(day);
      trend.push({ date, total: daily.get(date) || 0 });
    }
    setSalesChart(trend);
    setOrderCount((salesResult.data || []).length);

    const products = (productsResult.data || []) as StockProduct[] & { status?: string }[];
    const stockCounts = products.reduce((counts, product) => {
      const stock = Number(product.current_stock || 0);
      if (stock <= 0) counts.out += 1;
      else if (stock <= Number(product.minimum_stock || 0)) counts.low += 1;
      else counts.healthy += 1;
      return counts;
    }, { healthy: 0, low: 0, out: 0 });
    setInventoryCounts(stockCounts);
    setLowStockProducts(products.filter(product => Number(product.current_stock) <= Number(product.minimum_stock))
      .sort((a, b) => Number(a.current_stock) - Number(b.current_stock)).slice(0, 5));
    if (!quiet) setLoading(false);
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);
  useRealtimeRefresh(loadData);

  const stockTotal = Math.max(1, inventoryCounts.healthy + inventoryCounts.low + inventoryCounts.out);
  const inventoryGradient = useMemo(() => {
    const healthy = inventoryCounts.healthy / stockTotal * 100;
    const low = inventoryCounts.low / stockTotal * 100;
    return `conic-gradient(#12B981 0 ${healthy}%, #F5A623 ${healthy}% ${healthy + low}%, #F04452 ${healthy + low}% 100%)`;
  }, [inventoryCounts, stockTotal]);
  const monthLabel = now.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  if (loading) return <div className="flex min-h-[50vh] items-center justify-center"><div className="h-9 w-9 animate-spin rounded-full border-2 border-accent-100 border-t-accent-500" /></div>;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${getTimeGreeting(now)}${profile?.name ? `, ${profile.name.split(/\s+/)[0]}` : ''}`}
        subtitle={`Here’s what’s happening in your business · ${monthLabel}`}
        actions={<span className="inline-flex items-center gap-2 rounded-full border border-ink-100 bg-paper px-3 py-2 text-xs font-medium text-ink-600"><span className="h-2 w-2 rounded-full bg-success" />Live business overview</span>}
      />

      {isTenantContextActive() && isAdmin && <TenantOwnerDesk />}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Sales this month" value={formatCurrency(summary?.total_sales || 0)} icon={CircleDollarSign} change="Revenue recorded" tone="indigo" />
        <KpiCard label="Gross profit" value={formatCurrency(summary?.gross_profit || 0)} icon={BarChart3} change="Before expenses" tone="green" />
        <KpiCard label="Orders · last 14 days" value={orderCount.toLocaleString()} icon={ShoppingCart} change="Sales activity" tone="blue" />
        <KpiCard label="Inventory value" value={formatCurrency(summary?.stock_value || 0)} icon={Box} change={`${summary?.total_products || 0} active products`} tone="amber" />
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.8fr)_minmax(280px,.8fr)]">
        <div className="rounded-xl border border-ink-100 bg-paper p-5 shadow-sm sm:p-6">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
            <div><h2 className="text-base font-semibold text-ink-900">Sales overview</h2><p className="mt-1 text-sm text-ink-500">Daily revenue over the last two weeks</p></div>
            <span className="rounded-full bg-accent-50 px-3 py-1.5 text-xs font-semibold text-accent-700">{formatCurrency(salesChart.reduce((sum, day) => sum + day.total, 0))}</span>
          </div>
          {salesChart.length ? <TrendChart data={salesChart} /> : <ChartEmpty />}
        </div>

        <div className="rounded-xl border border-ink-100 bg-paper p-5 shadow-sm sm:p-6">
          <div><h2 className="text-base font-semibold text-ink-900">Inventory health</h2><p className="mt-1 text-sm text-ink-500">Active catalogue products</p></div>
          <div className="mt-6 flex items-center gap-5">
            <div className="relative h-36 w-36 shrink-0 rounded-full" style={{ background: inventoryGradient }}>
              <div className="absolute inset-4 flex flex-col items-center justify-center rounded-full bg-paper"><span className="text-2xl font-bold tracking-tight text-ink-900">{stockTotal === 1 && !inventoryCounts.healthy && !inventoryCounts.low && !inventoryCounts.out ? 0 : stockTotal}</span><span className="text-[11px] text-ink-500">products</span></div>
            </div>
            <div className="min-w-0 flex-1 space-y-3">
              <LegendRow color="bg-emerald-500" label="Healthy stock" value={inventoryCounts.healthy} />
              <LegendRow color="bg-amber-400" label="Low stock" value={inventoryCounts.low} />
              <LegendRow color="bg-rose-500" label="Out of stock" value={inventoryCounts.out} />
            </div>
          </div>
          <div className="mt-5 rounded-lg bg-ink-50 p-3 text-xs leading-5 text-ink-600">{inventoryCounts.low + inventoryCounts.out} products need a stock review.</div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(300px,.65fr)]">
        <div className="overflow-hidden rounded-xl border border-ink-100 bg-paper shadow-sm">
          <div className="flex items-center justify-between border-b border-ink-100 px-5 py-4 sm:px-6">
            <div><h2 className="text-base font-semibold text-ink-900">Recent sales</h2><p className="mt-1 text-sm text-ink-500">Latest completed and pending transactions</p></div>
            <ShoppingCart className="text-ink-300" size={19} />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-left">
              <thead className="bg-ink-50/70"><tr>{['Sale', 'Customer', 'Payment', 'Date', 'Total'].map(label => <th key={label} className="px-5 py-3 text-[10px] font-semibold uppercase tracking-[.13em] text-ink-500">{label}</th>)}</tr></thead>
              <tbody className="divide-y divide-ink-100">
                {recentSales.map(sale => <tr key={sale.id} className="transition-colors hover:bg-ink-50/60">
                  <td className="px-5 py-3.5 text-sm font-semibold text-ink-800">{sale.sale_number || '—'}</td>
                  <td className="px-5 py-3.5 text-sm text-ink-600">{sale.customer_name || 'Walk-in'}</td>
                  <td className="px-5 py-3.5"><span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${sale.payment_status === 'paid' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{sale.payment_status || sale.payment_method}</span></td>
                  <td className="px-5 py-3.5 text-sm text-ink-500">{formatDate(sale.sale_date)}</td>
                  <td className="px-5 py-3.5 text-right text-sm font-semibold text-ink-900" data-numeric>{formatCurrency(sale.total_amount)}</td>
                </tr>)}
                {!recentSales.length && <tr><td colSpan={5} className="px-5 py-8 text-center text-sm text-ink-400">No sales have been recorded yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-ink-100 bg-paper shadow-sm">
          <div className="flex items-center justify-between border-b border-ink-100 px-5 py-4">
            <div><h2 className="text-base font-semibold text-ink-900">Reorder attention</h2><p className="mt-1 text-sm text-ink-500">Products at or below their minimum</p></div>
            <TriangleAlert className="text-amber-500" size={19} />
          </div>
          <div className="divide-y divide-ink-100">
            {lowStockProducts.map(product => <div key={product.id} className="flex items-center gap-3 px-5 py-3.5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600"><Package size={18} /></div>
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-ink-800">{product.name}</p><p className="mt-0.5 truncate text-xs text-ink-400">{product.catalog_sku || 'Catalogue item'}</p></div>
              <div className="text-right"><p className="text-sm font-semibold text-rose-600" data-numeric>{product.current_stock} {product.unit}</p><p className="text-[11px] text-ink-400">min {product.minimum_stock}</p></div>
            </div>)}
            {!lowStockProducts.length && <div className="px-5 py-10 text-center"><div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-emerald-50 text-emerald-600"><ArrowUpRight size={19} /></div><p className="mt-3 text-sm font-medium text-ink-700">Stock levels look healthy</p><p className="mt-1 text-xs text-ink-400">No products need reordering right now.</p></div>}
          </div>
        </div>
      </section>
    </div>
  );
}

function KpiCard({ label, value, icon: Icon, change, tone }: { label: string; value: string; icon: typeof CircleDollarSign; change: string; tone: 'indigo' | 'green' | 'blue' | 'amber' }) {
  const tones = {
    indigo: 'bg-accent-50 text-accent-700', green: 'bg-emerald-50 text-emerald-700',
    blue: 'bg-sky-50 text-sky-700', amber: 'bg-amber-50 text-amber-700',
  };
  return <article className="rounded-xl border border-ink-100 bg-paper p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
    <div className="flex items-start justify-between gap-3"><p className="text-xs font-semibold uppercase tracking-[.1em] text-ink-500">{label}</p><div className={`flex h-10 w-10 items-center justify-center rounded-xl ${tones[tone]}`}><Icon size={19} /></div></div>
    <p className="mt-5 truncate text-[26px] font-bold tracking-tight text-ink-900" data-numeric>{value}</p>
    <p className="mt-2 flex items-center gap-1.5 text-xs text-ink-400"><span className="h-1.5 w-1.5 rounded-full bg-accent-400" />{change}</p>
  </article>;
}

function LegendRow({ color, label, value }: { color: string; label: string; value: number }) {
  return <div className="flex items-center gap-2.5"><span className={`h-2.5 w-2.5 rounded-full ${color}`} /><span className="flex-1 truncate text-xs text-ink-500">{label}</span><span className="text-xs font-semibold tabular-nums text-ink-800">{value}</span></div>;
}

function ChartEmpty() { return <div className="flex h-[230px] items-center justify-center rounded-lg bg-ink-50 text-sm text-ink-400">Sales trend will appear when you record transactions.</div>; }
