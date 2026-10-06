import { FormEvent, useState } from 'react';
import {
  ArrowRight,
  BarChart,
  BarChart3,
  Boxes,
  Building2,
  Check,
  ClipboardCheck,
  CreditCard,
  LayoutDashboard,
  LineChart,
  LockKeyhole,
  Menu,
  Package,
  PackageCheck,
  Play,
  Search,
  ShieldCheck,
  Smartphone,
  ShoppingCart,
  Truck,
  UsersRound,
  X,
} from 'lucide-react';
import { BrandLogo, BrandMark } from '@/components/BrandLogo';

const retailPhoto = 'https://images.pexels.com/photos/36730435/pexels-photo-36730435/free-photo-of-fashion-retail-employee-using-digital-tablet-in-clothing-store.jpeg?auto=compress&dpr=1&h=750&w=1260';
const stockPhoto = 'https://images.pexels.com/photos/12280949/pexels-photo-12280949.jpeg?auto=compress&dpr=1&h=750&w=1260';

function WorkspaceEntry() {
  const [workspace, setWorkspace] = useState('');
  const [error, setError] = useState('');

  const openWorkspace = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = workspace.trim();
    let slug = value;

    if (/^https?:\/\//i.test(value)) {
      try {
        const pathMatch = new URL(value).pathname.match(/^\/t\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/i);
        if (!pathMatch) throw new Error('Use the workspace link ending in /t/your-business.');
        slug = pathMatch[1];
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Enter a valid workspace link or business name.');
        return;
      }
    } else {
      slug = value.replace(/^\/?t\//i, '').replace(/\/$/, '');
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(slug)) {
        setError('Enter the workspace name from your business invitation.');
        return;
      }
    }

    window.location.assign(`/t/${slug.toLowerCase()}`);
  };

  return (
    <div id="workspace" className="scroll-mt-24 relative z-20 w-full max-w-[410px]">
      <form onSubmit={openWorkspace} className="rounded-3xl border border-white/80 bg-white p-6 shadow-[0_24px_80px_rgba(48,62,131,0.18)] sm:p-7">
        <div className="flex items-center gap-2.5">
          <BrandLogo size="sm" />
        </div>
        <h2 className="mt-5 text-xl font-bold tracking-tight text-[#101b48]">Sign in to your workspace</h2>
        <p className="mt-1 text-sm text-slate-500">First, choose your tenant business.</p>
        <label htmlFor="workspace-name" className="mt-5 block text-xs font-semibold text-slate-700">Workspace / Company</label>
        <div className="relative mt-1.5">
          <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input
            id="workspace-name"
            value={workspace}
            onChange={(event) => { setWorkspace(event.target.value); setError(''); }}
            autoComplete="url"
            className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-[#6251f4] focus:ring-4 focus:ring-[#6251f4]/10"
            placeholder="Workspace name or tenant link"
            aria-describedby={error ? 'workspace-error' : 'workspace-help'}
            required
          />
        </div>
        <p id="workspace-help" className="mt-1.5 text-[11px] leading-4 text-slate-400">Use the workspace name or link provided by your administrator.</p>
        {error && <p id="workspace-error" role="alert" className="mt-2 text-xs text-red-700">{error}</p>}
        <button type="submit" className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#5147ec] to-[#7048ef] px-5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/20 transition hover:-translate-y-0.5 hover:shadow-indigo-500/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600">
          Continue to tenant sign in <ArrowRight size={16} />
        </button>
        <div className="mt-4 flex items-center justify-center gap-1.5 text-[10px] text-slate-400"><LockKeyhole size={12} /><span>Secure tenant access · Admin and staff roles</span></div>
      </form>
    </div>
  );
}

function DashboardPreview() {
  return (
    <div className="overflow-hidden rounded-2xl border border-[#e1e7f5] bg-white shadow-[0_18px_60px_rgba(40,69,121,0.16)]">
      <div className="flex h-11 items-center justify-between border-b border-slate-100 px-4 sm:px-5">
        <div className="flex items-center gap-2"><BrandMark className="h-6 w-6" /><span className="text-[10px] font-bold text-[#18254f]">AuditGuard workspace</span></div>
        <div className="hidden h-6 w-40 items-center gap-1.5 rounded-md border border-slate-100 px-2 text-[9px] text-slate-400 sm:flex"><Search size={11} /> Search your business</div>
        <span className="rounded-full bg-violet-50 px-2.5 py-1 text-[9px] font-semibold text-violet-700">Illustrative preview</span>
      </div>
      <div className="grid min-h-[345px] grid-cols-[92px_1fr] sm:grid-cols-[130px_1fr]">
        <aside className="bg-[#101b3d] px-2.5 py-4 text-[9px] text-white/70 sm:px-3.5">
          <p className="mb-4 px-1 text-[8px] font-bold uppercase tracking-widest text-white/35">Menu</p>
          {[[LayoutDashboard, 'Overview'], [ShoppingCart, 'Sales'], [Package, 'Products'], [Truck, 'Suppliers'], [UsersRound, 'Customers'], [BarChart3, 'Analytics']].map(([Icon, label]) => {
            const SideIcon = Icon as typeof LayoutDashboard;
            return <div key={label as string} className={`mb-1.5 flex items-center gap-2 rounded-md px-1.5 py-2 ${label === 'Overview' ? 'bg-[#5244e8] text-white' : ''}`}><SideIcon size={12} /><span>{label as string}</span></div>;
          })}
        </aside>
        <div className="min-w-0 bg-[#f8faff] p-3 sm:p-5">
          <div className="flex items-center justify-between gap-2"><div><p className="text-[9px] text-slate-400">Your business at a glance</p><h3 className="mt-0.5 text-xs font-bold text-[#18254f] sm:text-sm">Today’s overview</h3></div><button type="button" className="hidden rounded-md bg-[#5b4df0] px-2.5 py-1.5 text-[9px] font-semibold text-white sm:block">+ Add sale</button></div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[['Sales', 'KSh 482,500', 'green'], ['Orders', '1,284', 'blue'], ['Customers', '8,492', 'purple'], ['Stock value', 'KSh 6.84M', 'orange']].map(([label, value, color]) => <div key={label} className="rounded-lg border border-slate-100 bg-white p-2 sm:p-2.5"><div className="flex items-center gap-1.5"><span className={`h-5 w-5 rounded-md ${color === 'green' ? 'bg-emerald-100' : color === 'blue' ? 'bg-blue-100' : color === 'purple' ? 'bg-violet-100' : 'bg-amber-100'}`} /><span className="text-[8px] text-slate-500 sm:text-[9px]">{label}</span></div><p className="mt-1.5 text-[10px] font-bold text-[#17234b] sm:text-xs">{value}</p></div>)}
          </div>
          <div className="mt-2.5 grid gap-2 sm:grid-cols-[1.7fr_1fr]">
            <div className="rounded-lg border border-slate-100 bg-white p-2.5 sm:p-3"><div className="flex items-center justify-between"><p className="text-[9px] font-bold text-[#1c2a50]">Sales overview</p><span className="rounded-full bg-violet-50 px-2 py-0.5 text-[8px] font-semibold text-violet-600">This month</span></div><svg viewBox="0 0 420 125" className="mt-2 h-[98px] w-full" role="img" aria-label="Illustrative sales trend chart"><defs><linearGradient id="previewFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#7667ff" stopOpacity=".22" /><stop offset="100%" stopColor="#7667ff" stopOpacity="0" /></linearGradient></defs>{[22, 52, 82, 112].map(y => <line key={y} x1="10" x2="410" y1={y} y2={y} stroke="#e9edf5" strokeDasharray="3 5" />)}<path d="M12 102 C45 91 56 61 92 70 S135 93 169 54 S215 67 246 46 S289 61 322 32 S365 57 408 18 L408 115 L12 115Z" fill="url(#previewFill)" /><path d="M12 102 C45 91 56 61 92 70 S135 93 169 54 S215 67 246 46 S289 61 322 32 S365 57 408 18" fill="none" stroke="#635bff" strokeWidth="3" strokeLinecap="round" />{[12, 92, 169, 246, 322, 408].map((x, index) => <circle key={x} cx={x} cy={[102, 70, 54, 46, 32, 18][index]} r="3" fill="white" stroke="#635bff" strokeWidth="2" />)}</svg><div className="flex justify-between text-[8px] text-slate-400"><span>Week 1</span><span>Week 2</span><span>Week 3</span><span>Week 4</span></div></div>
            <div className="rounded-lg border border-slate-100 bg-white p-2.5 sm:p-3"><p className="text-[9px] font-bold text-[#1c2a50]">Inventory status</p><div className="mx-auto mt-3 flex h-[92px] w-[92px] items-center justify-center rounded-full" style={{ background: 'conic-gradient(#15b994 0 68%, #ffc44d 68% 87%, #fb7185 87% 100%)' }}><div className="flex h-[62px] w-[62px] flex-col items-center justify-center rounded-full bg-white"><span className="text-xs font-bold text-[#1c2a50]">Stock</span><span className="text-[8px] text-slate-400">overview</span></div></div><div className="mt-2 space-y-1 text-[8px] text-slate-500"><p><span className="mr-1 text-emerald-500">●</span>In stock</p><p><span className="mr-1 text-amber-500">●</span>Low stock</p><p><span className="mr-1 text-rose-400">●</span>Out of stock</p></div></div>
          </div>
          <div className="mt-2.5 rounded-lg border border-slate-100 bg-white p-2.5"><div className="flex items-center justify-between"><p className="text-[9px] font-bold text-[#1c2a50]">Recent activity</p><span className="text-[8px] text-violet-600">View reports →</span></div><div className="mt-2 grid grid-cols-3 gap-2 border-t border-slate-100 pt-2 text-[8px] text-slate-500"><span>Sale recorded</span><span>Stock received</span><span>Customer payment</span></div></div>
        </div>
      </div>
    </div>
  );
}

export function LandingPage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <main className="min-h-screen overflow-hidden bg-[#f8faff] text-[#111c49] selection:bg-violet-200">
      <header className="sticky top-0 z-30 border-b border-slate-100 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-[68px] max-w-7xl items-center justify-between px-5 sm:px-8">
          <a href="#home" className="flex items-center gap-2.5" aria-label="AuditGuard home">
            <BrandLogo size="sm" tagline />
          </a>
          <nav aria-label="Main navigation" className="hidden items-center gap-7 text-xs font-medium text-slate-600 lg:flex">
            <a className="transition hover:text-[#5948ed]" href="#product">Product</a>
            <a className="transition hover:text-[#5948ed]" href="#features">Features</a>
            <a className="transition hover:text-[#5948ed]" href="#insights">Insights</a>
            <a className="transition hover:text-[#5948ed]" href="#how-it-works">How it works</a>
          </nav>
          <div className="hidden items-center gap-3 sm:flex">
            <a href="#workspace" className="px-3 py-2 text-xs font-semibold text-slate-700 transition hover:text-[#5948ed]">Sign in</a>
            <a href="#workspace" className="inline-flex items-center gap-2 rounded-lg bg-[#5948ed] px-4 py-2.5 text-xs font-semibold text-white shadow-md shadow-indigo-500/20 transition hover:bg-[#483bd7]">Access your workspace <ArrowRight size={14} /></a>
          </div>
          <button type="button" aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'} aria-expanded={mobileMenuOpen} className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 sm:hidden" onClick={() => setMobileMenuOpen(open => !open)}>
            {mobileMenuOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
        {mobileMenuOpen && <nav aria-label="Mobile navigation" className="grid gap-1 border-t border-slate-100 bg-white px-5 py-3 sm:hidden">
          {[['Product', '#product'], ['Features', '#features'], ['Insights', '#insights'], ['How it works', '#how-it-works'], ['Sign in', '#workspace']].map(([label, href]) => <a key={href} onClick={() => setMobileMenuOpen(false)} className="rounded-lg px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-violet-50" href={href}>{label}</a>)}
        </nav>}
      </header>

      <section id="home" className="relative isolate bg-gradient-to-br from-white via-[#f4f7ff] to-[#e9efff]">
        <div aria-hidden="true" className="absolute -right-20 -top-24 -z-10 h-[440px] w-[440px] rounded-full bg-[#cfdcff]/60 blur-3xl" />
        <div aria-hidden="true" className="absolute -bottom-36 -left-24 -z-10 h-[300px] w-[420px] rounded-full bg-[#e6e3ff] blur-3xl" />
        <div className="mx-auto grid max-w-7xl items-center gap-9 px-5 pb-14 pt-10 sm:px-8 sm:pb-20 sm:pt-14 lg:grid-cols-[.96fr_1.04fr] lg:gap-12 lg:pb-16 lg:pt-12">
          <div className="relative z-10">
            <div className="inline-flex items-center gap-2 rounded-full border border-indigo-100 bg-indigo-50/90 px-3 py-1.5 text-[10px] font-semibold text-[#5948ed] sm:text-[11px]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#6a57f4]" /> Multi-tenant business management platform
            </div>
            <h1 className="mt-5 max-w-[590px] text-[2.7rem] font-extrabold leading-[1.02] tracking-[-0.045em] text-[#101b49] sm:text-6xl lg:text-[3.8rem]">Run your business from one <span className="bg-gradient-to-r from-[#5147ec] to-[#923ff0] bg-clip-text text-transparent">powerful workspace.</span></h1>
            <p className="mt-5 max-w-[560px] text-sm leading-6 text-slate-600 sm:text-[15px] sm:leading-7">Manage sales, inventory, suppliers, customers and business insights in one place. Built for teams that want a clearer view of their day-to-day work.</p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <a href="#workspace" className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#5948ed] px-5 text-xs font-semibold text-white shadow-lg shadow-indigo-500/20 transition hover:-translate-y-0.5 hover:bg-[#483bd7]">Access your workspace <ArrowRight size={15} /></a>
              <a href="#how-it-works" className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-[#cdd5f5] bg-white/80 px-5 text-xs font-semibold text-[#26325f] transition hover:border-indigo-300 hover:bg-white"><Play size={14} className="fill-[#6655ee] text-[#6655ee]" /> See how it works</a>
            </div>
            <div className="mt-7 flex flex-wrap gap-x-5 gap-y-3 text-[10px] font-medium text-slate-600 sm:text-[11px]">
              <span className="inline-flex items-center gap-1.5"><ShieldCheck size={15} className="text-emerald-700" /> Secure tenant access</span>
              <span className="inline-flex items-center gap-1.5"><Check size={15} className="text-emerald-700" /> Admin and staff roles</span>
              <span className="inline-flex items-center gap-1.5"><BarChart size={15} className="text-indigo-600" /> Clear business insights</span>
            </div>
            <div className="mt-8 hidden max-w-[310px] items-center gap-3 rounded-xl border border-white/80 bg-white/70 p-2.5 shadow-sm sm:flex lg:hidden xl:flex">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-50 text-violet-600"><PackageCheck size={16} /></span>
              <span className="text-[10px] leading-4 text-slate-600">Products, suppliers and customer activity<br /><strong className="text-slate-800">connected in one business view</strong></span>
            </div>
          </div>

          <div className="relative mx-auto min-h-[590px] w-full max-w-[540px] pb-14 sm:min-h-[560px] lg:min-h-[550px]">
            <div className="absolute bottom-0 right-0 h-[290px] w-[83%] overflow-hidden rounded-[1.8rem] bg-slate-200 shadow-xl sm:h-[335px] sm:w-[82%]">
              <img src={retailPhoto} alt="Retail team member reviewing her business on a tablet" className="h-full w-full object-cover object-center" fetchPriority="high" />
              <div className="absolute inset-0 bg-gradient-to-t from-[#121b47]/50 via-transparent to-transparent" />
              <div className="absolute bottom-4 right-4 rounded-lg bg-white/90 px-3 py-2 text-[9px] font-semibold text-[#202c5b] shadow-lg backdrop-blur">A clearer view, every day</div>
            </div>
            <div className="relative z-10 pt-0 sm:pt-2">
              <WorkspaceEntry />
            </div>
            <div className="absolute bottom-10 left-0 z-20 hidden rounded-xl border border-white bg-white/95 px-3 py-2.5 shadow-xl sm:block">
              <div className="flex items-center gap-2"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700"><PackageCheck size={16} /></span><span><span className="block text-[9px] text-slate-500">Inventory view</span><span className="block text-[11px] font-bold text-[#1b2853]">Know what needs attention</span></span></div>
            </div>
            <p className="absolute bottom-0 right-1 text-[9px] text-slate-500">Photo by <a className="underline underline-offset-2" href="https://www.pexels.com/photo/fashion-retail-employee-using-digital-tablet-in-clothing-store-36730435/" target="_blank" rel="noreferrer">Vitaly Gariev on Pexels</a></p>
          </div>
        </div>
      </section>

      <section id="product" className="scroll-mt-20 border-y border-[#e8ecf5] bg-white px-5 py-16 sm:px-8 lg:py-20">
        <div className="mx-auto grid max-w-7xl items-center gap-9 lg:grid-cols-[.62fr_1.38fr] lg:gap-12">
          <div>
            <p className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-2.5 py-1 text-[9px] font-bold uppercase tracking-wide text-[#5948ed]"><Check size={11} /> The complete solution</p>
            <h2 className="mt-4 max-w-md text-3xl font-extrabold leading-tight tracking-[-0.04em] text-[#101b49] sm:text-4xl">Everything you need in one place.</h2>
            <p className="mt-4 max-w-md text-sm leading-6 text-slate-600">Get a clearer picture of sales, stock, suppliers and customers. Keep everyday work organized and use analytics to decide what needs your attention.</p>
            <ul className="mt-6 space-y-3 text-xs font-medium text-slate-600">
              {['Sales and inventory analytics', 'Product and supplier performance', 'Customer purchase and payment history', 'Tenant workspaces with role-based access'].map(text => <li key={text} className="flex items-center gap-2"><span className="flex h-4 w-4 items-center justify-center rounded-full bg-violet-100 text-[#5948ed]"><Check size={10} /></span>{text}</li>)}
            </ul>
          </div>
          <DashboardPreview />
        </div>
      </section>

      <section id="features" className="scroll-mt-20 bg-gradient-to-b from-white to-[#f8faff] px-5 py-16 sm:px-8 lg:py-20">
        <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[.75fr_1.25fr] lg:items-center lg:gap-12">
          <div>
            <p className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-2.5 py-1 text-[9px] font-bold uppercase tracking-wide text-[#5948ed]"><Boxes size={11} /> Key features</p>
            <h2 className="mt-4 max-w-lg text-3xl font-extrabold leading-tight tracking-[-0.04em] text-[#101b49] sm:text-4xl">Powerful features for every part of your business.</h2>
            <p className="mt-4 max-w-md text-sm leading-6 text-slate-600">From sales to stock, from suppliers to customers, find the tools your team needs to stay organized and make informed decisions.</p>
            <div className="relative mt-6 max-w-md overflow-hidden rounded-2xl shadow-lg shadow-slate-900/10">
              <img src={stockPhoto} alt="Products arranged on shelves in a neighborhood shop" loading="lazy" className="h-[220px] w-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-[#0e1c48]/45 to-transparent" />
              <div className="absolute bottom-3 right-3 rounded-xl border border-white/80 bg-white/95 p-3 shadow-xl">
                <div className="flex items-center gap-2.5"><span className="flex h-8 w-8 items-center justify-center rounded-full border-[5px] border-emerald-100 border-t-emerald-500 text-[7px] font-bold text-emerald-700">82%</span><span><span className="block text-[8px] text-slate-400">Stock overview</span><span className="block text-[10px] font-bold text-[#1b2853]">Monitor stock levels</span></span></div>
              </div>
              <p className="absolute bottom-2 left-3 text-[8px] text-white/90">Photo by <a href="https://www.pexels.com/photo/foods-on-wooden-shelves-in-a-store-12280949/" target="_blank" rel="noreferrer" className="underline">Tarikul Raana on Pexels</a></p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              { icon: ShoppingCart, title: 'Sales & orders', body: 'Track sales, record payments and keep customer purchase history together.', tone: 'bg-violet-500', tint: 'text-violet-700' },
              { icon: Boxes, title: 'Inventory & products', body: 'Monitor product levels, stock movements and items that need attention.', tone: 'bg-emerald-500', tint: 'text-emerald-700' },
              { icon: Truck, title: 'Suppliers & receiving', body: 'Manage supplier purchases and follow incoming stock through receiving.', tone: 'bg-amber-500', tint: 'text-amber-700' },
              { icon: UsersRound, title: 'Customers & analytics', body: 'Understand customer activity and compare product and supplier performance.', tone: 'bg-blue-500', tint: 'text-blue-700' },
            ].map(({ icon: Icon, title, body, tone, tint }) => <article key={title} className="rounded-xl border border-[#e5eaf5] bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-lg hover:shadow-indigo-950/5">
              <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${tone} text-white shadow-md`}><Icon size={18} /></span>
              <h3 className="mt-4 text-sm font-bold text-[#17224d]">{title}</h3>
              <p className="mt-1.5 min-h-[48px] text-[11px] leading-5 text-slate-500">{body}</p>
              <a href="#insights" className={`mt-3 inline-flex items-center gap-1 text-[10px] font-semibold ${tint}`}>Learn more <ArrowRight size={12} /></a>
            </article>)}
          </div>
        </div>
      </section>

      <section id="insights" className="scroll-mt-20 bg-white px-5 py-14 sm:px-8 lg:py-16">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-8 md:grid-cols-[.8fr_1.2fr] md:items-end">
            <div><p className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-2.5 py-1 text-[9px] font-bold uppercase tracking-wide text-[#5948ed]"><LineChart size={11} /> Built for useful decisions</p><h2 className="mt-4 text-3xl font-extrabold leading-tight tracking-[-0.04em] text-[#101b49]">See the trends behind your business.</h2></div>
            <p className="max-w-2xl text-sm leading-6 text-slate-600">Use charts and reports to follow product performance, supplier activity, stock movement and sales over time. Keep customer payments and loyalty history connected to the right workspace.</p>
          </div>
          <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { icon: BarChart3, title: 'Product trends', body: 'Compare what sells and when.' },
              { icon: ClipboardCheck, title: 'Supplier activity', body: 'Follow purchasing and deliveries.' },
              { icon: CreditCard, title: 'Customer balances', body: 'Keep payments and purchase records linked.' },
              { icon: Smartphone, title: 'Loyalty and SMS', body: 'Set year-end points rules; send opted-in payment and balance messages through Africa’s Talking.' },
            ].map(({ icon: Icon, title, body }) => <div key={title} className="flex gap-3 rounded-xl border border-slate-100 bg-[#fcfdff] p-4"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-[#5948ed]"><Icon size={17} /></span><div><h3 className="text-xs font-bold text-[#17224d]">{title}</h3><p className="mt-1 text-[10px] leading-4 text-slate-500">{body}</p></div></div>)}
          </div>
        </div>
      </section>

      <section id="how-it-works" className="scroll-mt-20 border-y border-[#edf0fb] bg-gradient-to-r from-[#f1f4ff] via-[#fafaff] to-[#eef3ff] px-5 py-14 sm:px-8 lg:py-16">
        <div className="mx-auto max-w-7xl">
          <div className="text-center"><p className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[9px] font-bold uppercase tracking-wide text-[#5948ed] shadow-sm"><Check size={11} /> How it works</p><h2 className="mt-3 text-2xl font-extrabold tracking-tight text-[#101b49] sm:text-3xl">Simple steps to better business.</h2><p className="mx-auto mt-2 max-w-xl text-xs leading-5 text-slate-600">Each tenant gets a business-specific workspace. Your sign-in and permissions stay within that tenant.</p></div>
          <div className="mt-9 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { icon: ShoppingCart, title: '1. Sell', body: 'Record orders and serve your customers.' },
              { icon: BarChart3, title: '2. Track', body: 'Monitor stock, payments and performance.' },
              { icon: PackageCheck, title: '3. Replenish', body: 'Receive purchases and keep stock moving.' },
              { icon: LineChart, title: '4. Grow', body: 'Use business insights to plan your next step.' },
            ].map(({ icon: Icon, title, body }) => <div key={title} className="rounded-xl border border-white bg-white/80 p-4 text-center shadow-sm"><span className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#5e50ee] to-[#8750ef] text-white shadow-md shadow-indigo-500/20"><Icon size={18} /></span><h3 className="mt-3 text-xs font-bold text-[#17224d]">{title}</h3><p className="mx-auto mt-1 max-w-[190px] text-[10px] leading-4 text-slate-500">{body}</p></div>)}
          </div>
        </div>
      </section>

      <section className="px-5 py-12 sm:px-8 lg:py-14">
        <div className="mx-auto grid max-w-7xl gap-5 rounded-2xl border border-[#e6eaf5] bg-white p-6 shadow-sm sm:grid-cols-3 sm:p-8">
          {[
            { icon: ShieldCheck, title: 'Tenant data stays scoped', body: 'Your workspace opens against the business selected at sign-in.' },
            { icon: UsersRound, title: 'The right access for each role', body: 'Administrators and staff use their approved tenant accounts.' },
            { icon: Smartphone, title: 'Customer details stay useful', body: 'Link phone-based payment history, rewards and opted-in messages.' },
          ].map(({ icon: Icon, title, body }) => <div key={title} className="flex gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700"><Icon size={17} /></span><div><h3 className="text-xs font-bold text-[#17224d]">{title}</h3><p className="mt-1 text-[10px] leading-4 text-slate-500">{body}</p></div></div>)}
        </div>
      </section>

      <section className="bg-[#101a42] px-5 py-11 text-white sm:px-8 lg:py-14">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div><p className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[9px] font-bold uppercase tracking-wide text-violet-200"><ShieldCheck size={11} /> Ready to get started</p><h2 className="mt-3 text-2xl font-extrabold tracking-tight sm:text-3xl">Access your workspace today.</h2><p className="mt-2 text-xs text-white/65">Join your company’s tenant and start managing your business with ease.</p></div>
          <a href="#workspace" className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-[#6551f0] px-5 text-xs font-semibold text-white shadow-lg shadow-black/20 transition hover:bg-[#7767ff]">Access your workspace <ArrowRight size={15} /></a>
        </div>
      </section>

      <footer className="bg-[#0c1435] px-5 py-7 text-white/60 sm:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <a href="#home" className="flex items-center gap-2 text-xs font-semibold text-white"><BrandLogo size="sm" inverse /></a>
          <p className="text-[10px]">Inventory, sales and business performance tools for your team.</p>
          <a href="#workspace" className="inline-flex items-center gap-1 text-[10px] font-semibold text-violet-200 hover:text-white">Tenant sign in <ArrowRight size={12} /></a>
        </div>
      </footer>
    </main>
  );
}
