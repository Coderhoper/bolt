import { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, Boxes, CalendarDays, CircleDollarSign, PackageSearch, Search, Truck, TrendingUp } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/utils';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';

type PeriodDays = 30 | 90 | 365;
type ProductMetric = { id: string; name: string; catalog_sku: string | null; supplier_id: string | null; supplier_name: string | null; units_sold: number | string; revenue: number | string; gross_profit: number | string; orders: number | string };
type SupplierMetric = { id: string; name: string; status: string | null; tier: string | null; purchase_orders: number | string; units_received: number | string; purchased: number | string; outstanding: number | string };
type AnalyticsPayload = {
  summary: { revenue: number | string; gross_profit: number | string; orders: number | string; average_order: number | string };
  trend: { date: string; revenue: number | string; orders: number | string }[];
  products: ProductMetric[];
  suppliers: SupplierMetric[];
};

function localDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
const number = (value: number | string | null | undefined) => Number(value || 0);

export function Analytics() {
  const [period, setPeriod] = useState<PeriodDays>(30);
  const [tab, setTab] = useState<'products' | 'suppliers'>('products');
  const [payload, setPayload] = useState<AnalyticsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [selectedProductId, setSelectedProductId] = useState('');
  const [selectedSupplierId, setSelectedSupplierId] = useState('');

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - (period - 1));
    const { data, error: queryError } = await supabase.rpc('get_business_analytics', {
      p_start_date: localDate(start), p_end_date: localDate(end),
    });
    if (queryError) setError(queryError.message);
    else {
      setError('');
      setPayload(data as AnalyticsPayload);
    }
    if (!quiet) setLoading(false);
  }, [period]);

  useEffect(() => { void load(); }, [load]);
  useRealtimeRefresh(load);

  const products = payload?.products || [];
  const suppliers = payload?.suppliers || [];
  const selectedProduct = products.find(item => item.id === selectedProductId) || products[0];
  const selectedSupplier = suppliers.find(item => item.id === selectedSupplierId) || suppliers[0];
  const filteredProducts = useMemo(() => products.filter(item => `${item.name} ${item.catalog_sku || ''} ${item.supplier_name || ''}`.toLowerCase().includes(search.toLowerCase())), [products, search]);
  const filteredSuppliers = useMemo(() => suppliers.filter(item => `${item.name} ${item.status || ''}`.toLowerCase().includes(search.toLowerCase())), [suppliers, search]);
  const summary = payload?.summary;
  const trend = payload?.trend || [];
  const trendTotal = trend.reduce((sum, item) => sum + number(item.revenue), 0);
  const activeListCount = tab === 'products' ? products.length : suppliers.length;

  return (
    <div className="space-y-6">
      <PageHeader title="Business analytics" subtitle="See what’s selling, where your margin comes from, and how suppliers perform."
        actions={<label className="flex items-center gap-2 rounded-lg border border-ink-200 bg-paper px-3 py-2 text-sm text-ink-700 shadow-xs"><CalendarDays size={16} className="text-ink-400" /><span className="sr-only">Date range</span><select value={period} onChange={event => setPeriod(Number(event.target.value) as PeriodDays)} className="border-0 bg-transparent p-0 pr-6 text-sm font-medium focus:ring-0"><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option><option value={365}>Last 12 months</option></select></label>}
      />

      {error && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">Analytics could not load. Apply the customer and analytics database migration to this tenant project, then refresh. <span className="block pt-1 text-xs text-amber-700">{error}</span></div>}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Revenue" value={formatCurrency(number(summary?.revenue))} icon={CircleDollarSign} tone="indigo" />
        <MetricCard label="Gross profit" value={formatCurrency(number(summary?.gross_profit))} icon={TrendingUp} tone="green" />
        <MetricCard label="Orders" value={number(summary?.orders).toLocaleString()} icon={Boxes} tone="blue" />
        <MetricCard label="Average order" value={formatCurrency(number(summary?.average_order))} icon={BarChart3} tone="amber" />
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(300px,.8fr)]">
        <div className="rounded-xl border border-ink-100 bg-paper p-5 shadow-sm sm:p-6">
          <div className="mb-4 flex items-start justify-between gap-3"><div><h2 className="font-semibold text-ink-900">Revenue trend</h2><p className="mt-1 text-sm text-ink-500">Daily paid sales and approved credit activity</p></div><span className="rounded-full bg-accent-50 px-3 py-1.5 text-xs font-semibold text-accent-700">{formatCurrency(trendTotal)}</span></div>
          {trend.length ? <RevenueChart data={trend} /> : <div className="flex h-[240px] items-center justify-center rounded-lg bg-ink-50 text-sm text-ink-400">No sales in this date range.</div>}
        </div>
        <div className="rounded-xl border border-ink-100 bg-paper p-5 shadow-sm sm:p-6">
          <h2 className="font-semibold text-ink-900">Top {tab === 'products' ? 'products' : 'suppliers'}</h2>
          <p className="mt-1 text-sm text-ink-500">Ranked by {tab === 'products' ? 'sales revenue' : 'purchase value'}</p>
          <div className="mt-5 space-y-4">
            {tab === 'products' ? products.slice(0, 6).map(item => <BarRow key={item.id} label={item.name} detail={`${number(item.units_sold).toLocaleString()} units`} amount={number(item.revenue)} max={Math.max(...products.slice(0, 6).map(row => number(row.revenue)), 1)} />)
              : suppliers.slice(0, 6).map(item => <BarRow key={item.id} label={item.name} detail={`${number(item.purchase_orders)} purchase orders`} amount={number(item.purchased)} max={Math.max(...suppliers.slice(0, 6).map(row => number(row.purchased)), 1)} />)}
            {!activeListCount && <p className="rounded-lg bg-ink-50 p-4 text-sm text-ink-500">No records in this period yet.</p>}
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-ink-100 bg-paper shadow-sm">
        <div className="flex flex-col gap-4 border-b border-ink-100 p-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div><h2 className="font-semibold text-ink-900">Performance detail</h2><p className="mt-1 text-sm text-ink-500">Select a record to inspect its results for this period.</p></div>
          <div className="flex gap-1 rounded-lg bg-ink-50 p-1">
            <button onClick={() => { setTab('products'); setSearch(''); }} className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium ${tab === 'products' ? 'bg-white text-accent-700 shadow-xs' : 'text-ink-500 hover:text-ink-800'}`}><PackageSearch size={16} />Products</button>
            <button onClick={() => { setTab('suppliers'); setSearch(''); }} className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium ${tab === 'suppliers' ? 'bg-white text-accent-700 shadow-xs' : 'text-ink-500 hover:text-ink-800'}`}><Truck size={16} />Suppliers</button>
          </div>
        </div>
        <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(300px,.78fr)]">
          <div className="border-b border-ink-100 lg:border-b-0 lg:border-r">
            <div className="relative border-b border-ink-100 p-4 sm:px-6"><Search className="absolute left-7 top-1/2 -translate-y-1/2 text-ink-400" size={16} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder={`Search ${tab}…`} className="w-full rounded-lg border border-ink-200 bg-ink-50 py-2.5 pl-9 pr-3 text-sm focus:bg-white" /></div>
            <div className="max-h-[420px] overflow-y-auto">
              {tab === 'products' ? filteredProducts.map(item => <button key={item.id} onClick={() => setSelectedProductId(item.id)} className={`flex w-full items-center gap-3 border-b border-ink-100 px-5 py-4 text-left transition hover:bg-ink-50 sm:px-6 ${selectedProduct?.id === item.id ? 'bg-accent-50/70' : ''}`}>
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-50 text-accent-700"><PackageSearch size={18} /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-ink-800">{item.name}</p><p className="mt-0.5 truncate text-xs text-ink-400">{item.catalog_sku || 'No SKU'} · {item.supplier_name || 'No supplier'}</p></div><div className="text-right"><p className="text-sm font-semibold text-ink-900" data-numeric>{formatCurrency(number(item.revenue))}</p><p className="text-xs text-ink-400">{number(item.units_sold)} units</p></div>
              </button>) : filteredSuppliers.map(item => <button key={item.id} onClick={() => setSelectedSupplierId(item.id)} className={`flex w-full items-center gap-3 border-b border-ink-100 px-5 py-4 text-left transition hover:bg-ink-50 sm:px-6 ${selectedSupplier?.id === item.id ? 'bg-accent-50/70' : ''}`}>
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-700"><Truck size={18} /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-ink-800">{item.name}</p><p className="mt-0.5 text-xs capitalize text-ink-400">{item.tier?.replace('_',' ') || 'Supplier'} · {item.status?.toLowerCase() || 'active'}</p></div><div className="text-right"><p className="text-sm font-semibold text-ink-900" data-numeric>{formatCurrency(number(item.purchased))}</p><p className="text-xs text-ink-400">{number(item.purchase_orders)} orders</p></div>
              </button>)}
              {!loading && !(tab === 'products' ? filteredProducts.length : filteredSuppliers.length) && <div className="px-6 py-12 text-center text-sm text-ink-400">No matching {tab} found.</div>}
            </div>
          </div>
          <div className="p-5 sm:p-6">
            {tab === 'products' && selectedProduct ? <ProductDetail product={selectedProduct} /> : tab === 'suppliers' && selectedSupplier ? <SupplierDetail supplier={selectedSupplier} /> : <div className="flex h-full min-h-[220px] items-center justify-center text-sm text-ink-400">Performance details will appear here.</div>}
          </div>
        </div>
      </section>
      {loading && <div className="fixed bottom-5 right-5 rounded-full bg-ink-900 px-4 py-2 text-xs font-medium text-white shadow-lg">Updating analytics…</div>}
    </div>
  );
}

function MetricCard({ label, value, icon: Icon, tone }: { label: string; value: string; icon: typeof CircleDollarSign; tone: 'indigo' | 'green' | 'blue' | 'amber' }) {
  const themes = { indigo: 'bg-accent-50 text-accent-700', green: 'bg-emerald-50 text-emerald-700', blue: 'bg-sky-50 text-sky-700', amber: 'bg-amber-50 text-amber-700' };
  return <article className="rounded-xl border border-ink-100 bg-paper p-5 shadow-sm"><div className="flex items-center justify-between"><span className="text-xs font-semibold uppercase tracking-[.1em] text-ink-500">{label}</span><span className={`flex h-10 w-10 items-center justify-center rounded-xl ${themes[tone]}`}><Icon size={19} /></span></div><p className="mt-5 truncate text-2xl font-bold tracking-tight text-ink-900" data-numeric>{value}</p></article>;
}

function RevenueChart({ data }: { data: AnalyticsPayload['trend'] }) {
  const max = Math.max(...data.map(item => number(item.revenue)), 1);
  const points = data.map((item, index) => ({ item, x: data.length === 1 ? 360 : 14 + index * (692 / (data.length - 1)), y: 196 - (number(item.revenue) / max) * 164 }));
  const path = points.map(point => `${point.x},${point.y}`).join(' ');
  const area = points.length ? `M ${points[0].x} 196 L ${points.map(point => `${point.x} ${point.y}`).join(' L ')} L ${points[points.length - 1].x} 196 Z` : '';
  const visible = points.filter((_, index) => index === 0 || index === points.length - 1 || index % Math.max(1, Math.ceil(points.length / 6)) === 0);
  return <div><svg viewBox="0 0 720 230" className="h-[240px] w-full" role="img" aria-label="Revenue trend">
    <defs><linearGradient id="analytics-area" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#635BFF" stopOpacity=".20" /><stop offset="100%" stopColor="#635BFF" stopOpacity="0" /></linearGradient></defs>
    {[32, 86, 141, 196].map(y => <line key={y} x1="0" x2="720" y1={y} y2={y} stroke="#E8EDF5" strokeDasharray="4 6" />)}
    {area && <path d={area} fill="url(#analytics-area)" />}{points.length > 1 && <polyline points={path} fill="none" stroke="#635BFF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />}
    {points.map(point => <circle key={point.item.date} cx={point.x} cy={point.y} r="2.8" fill="white" stroke="#635BFF" strokeWidth="2" />)}
  </svg><div className="grid gap-1 text-center text-[10px] text-ink-400" style={{ gridTemplateColumns: `repeat(${Math.max(visible.length, 1)}, minmax(0, 1fr))` }}>{visible.map(point => <span key={point.item.date}>{new Date(`${point.item.date}T12:00:00`).toLocaleDateString('en-GB',{day:'numeric',month:'short'})}</span>)}</div></div>;
}

function BarRow({ label, detail, amount, max }: { label: string; detail: string; amount: number; max: number }) {
  return <div><div className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="truncate text-xs font-semibold text-ink-700">{label}</p><p className="mt-0.5 text-[10px] text-ink-400">{detail}</p></div><span className="shrink-0 text-xs font-semibold text-ink-700" data-numeric>{formatCurrency(amount)}</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-100"><div className="h-full rounded-full bg-accent-500" style={{ width: `${Math.max(2, amount / max * 100)}%` }} /></div></div>;
}

function ProductDetail({ product }: { product: ProductMetric }) {
  const margin = number(product.revenue) ? number(product.gross_profit) / number(product.revenue) * 100 : 0;
  return <div><div className="flex items-start gap-3"><div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-accent-50 text-accent-700"><PackageSearch size={22} /></div><div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-[.12em] text-ink-400">Product performance</p><h3 className="mt-1 truncate text-lg font-bold text-ink-900">{product.name}</h3><p className="mt-1 text-xs text-ink-500">{product.catalog_sku || 'No catalogue SKU'}</p></div></div>
    <div className="mt-5 grid grid-cols-2 gap-3"><DetailStat label="Units sold" value={number(product.units_sold).toLocaleString()} /><DetailStat label="Orders" value={number(product.orders).toLocaleString()} /><DetailStat label="Revenue" value={formatCurrency(number(product.revenue))} /><DetailStat label="Gross profit" value={formatCurrency(number(product.gross_profit))} /></div>
    <div className="mt-4 rounded-lg bg-ink-50 p-4"><div className="flex items-center justify-between text-xs"><span className="text-ink-500">Gross margin</span><span className="font-semibold text-ink-800">{margin.toFixed(1)}%</span></div><div className="mt-2 h-2 rounded-full bg-ink-200"><div className="h-2 rounded-full bg-emerald-500" style={{ width: `${Math.max(0, Math.min(margin, 100))}%` }} /></div><div className="mt-4 flex items-center justify-between gap-3 text-xs"><span className="text-ink-500">Main supplier</span><span className="truncate font-medium text-ink-800">{product.supplier_name || 'Not assigned'}</span></div></div>
  </div>;
}

function SupplierDetail({ supplier }: { supplier: SupplierMetric }) {
  return <div><div className="flex items-start gap-3"><div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-700"><Truck size={22} /></div><div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-[.12em] text-ink-400">Supplier performance</p><h3 className="mt-1 truncate text-lg font-bold text-ink-900">{supplier.name}</h3><p className="mt-1 text-xs capitalize text-ink-500">{supplier.tier?.replace('_',' ') || 'Supplier'} · {supplier.status?.toLowerCase() || 'active'}</p></div></div>
    <div className="mt-5 grid grid-cols-2 gap-3"><DetailStat label="Purchase orders" value={number(supplier.purchase_orders).toLocaleString()} /><DetailStat label="Units received" value={number(supplier.units_received).toLocaleString()} /><DetailStat label="Purchase value" value={formatCurrency(number(supplier.purchased))} /><DetailStat label="Outstanding" value={formatCurrency(number(supplier.outstanding))} /></div>
    <div className="mt-4 rounded-lg border border-ink-100 p-4"><div className="flex items-center justify-between gap-2 text-xs"><span className="text-ink-500">Share of supplier purchases</span><span className="font-semibold text-ink-800">{number(supplier.purchase_orders)} recorded orders</span></div><p className="mt-3 text-xs leading-5 text-ink-500">Compare order volume, received units, purchasing value, and outstanding balances across the selected period.</p></div>
  </div>;
}

function DetailStat({ label, value }: { label: string; value: string }) { return <div className="rounded-lg bg-ink-50 p-3"><p className="text-[10px] font-semibold uppercase tracking-[.1em] text-ink-400">{label}</p><p className="mt-1.5 truncate text-sm font-bold text-ink-900" data-numeric>{value}</p></div>; }
