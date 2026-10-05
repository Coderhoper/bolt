import { FormEvent, useState } from 'react';
import {
  ArrowDown,
  ArrowRight,
  BarChart3,
  Boxes,
  Check,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  CreditCard,
  LineChart,
  Menu,
  PackageCheck,
  ShieldCheck,
  Smartphone,
  Truck,
  UsersRound,
  X,
} from 'lucide-react';

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
    <section id="workspace" className="scroll-mt-24 bg-[#102c27] px-5 py-20 text-white sm:px-8 lg:py-24">
      <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-[1fr_0.85fr] lg:items-center">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-300">Your business, in focus</p>
          <h2 className="mt-4 max-w-xl font-display text-4xl leading-tight sm:text-5xl">Go straight to your workspace.</h2>
          <p className="mt-5 max-w-lg text-base leading-7 text-emerald-50/75">
            Use the business name in your invitation or paste your workspace link. Your sign-in will open that business’s secure tenant site.
          </p>
          <div className="mt-7 flex items-start gap-3 text-sm leading-6 text-emerald-50/75">
            <ShieldCheck className="mt-0.5 shrink-0 text-emerald-300" size={19} />
            <span>Administrators and team members sign in through their own business workspace. Your role controls what you can access.</span>
          </div>
        </div>
        <form onSubmit={openWorkspace} className="rounded-3xl bg-white p-6 text-[#15231f] shadow-2xl shadow-black/20 sm:p-8">
          <label htmlFor="workspace-name" className="text-sm font-semibold">Business workspace</label>
          <p className="mt-1 text-sm text-slate-500">Enter the workspace name shared by your administrator.</p>
          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <input
              id="workspace-name"
              value={workspace}
              onChange={(event) => { setWorkspace(event.target.value); setError(''); }}
              autoComplete="url"
              className="h-12 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none transition focus:border-emerald-700 focus:ring-4 focus:ring-emerald-700/10"
              placeholder="e.g. acme-store or /t/acme-store"
              aria-describedby={error ? 'workspace-error' : undefined}
              required
            />
            <button type="submit" className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-[#11765d] px-5 text-sm font-semibold text-white transition hover:bg-[#0d614d] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700">
              Continue <ArrowRight size={17} />
            </button>
          </div>
          {error && <p id="workspace-error" role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
          <p className="mt-5 border-t border-slate-100 pt-4 text-xs leading-5 text-slate-500">Need access? Ask your business administrator for an invitation or workspace link.</p>
        </form>
      </div>
    </section>
  );
}

function MiniChart() {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-white/65">Sales performance</p>
          <p className="mt-1 font-display text-3xl text-white">See the pattern</p>
        </div>
        <span className="rounded-full bg-emerald-300/15 px-3 py-1 text-xs font-semibold text-emerald-200">Live view</span>
      </div>
      <div className="mt-5 overflow-hidden rounded-xl bg-[#143b33] px-3 pt-4">
        <svg viewBox="0 0 560 190" role="img" aria-label="Illustrative line chart showing sales activity over time" className="h-44 w-full">
          <defs>
            <linearGradient id="salesFill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#7fe0b1" stopOpacity=".28" />
              <stop offset="100%" stopColor="#7fe0b1" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[35, 75, 115, 155].map((y) => <line key={y} x1="20" y1={y} x2="545" y2={y} stroke="white" strokeOpacity=".11" strokeDasharray="4 6" />)}
          <path d="M22 146 C58 139 66 105 104 117 S157 142 190 103 S239 100 270 88 S324 109 355 69 S411 89 443 48 S501 75 543 28 L543 170 L22 170Z" fill="url(#salesFill)" />
          <path d="M22 146 C58 139 66 105 104 117 S157 142 190 103 S239 100 270 88 S324 109 355 69 S411 89 443 48 S501 75 543 28" fill="none" stroke="#7fe0b1" strokeWidth="4" strokeLinecap="round" />
          {[22, 104, 190, 270, 355, 443, 543].map((x, index) => {
            const y = [146, 117, 103, 88, 69, 48, 28][index];
            return <circle key={x} cx={x} cy={y} r="4" fill="#c8ffe1" />;
          })}
        </svg>
        <div className="flex justify-between px-2 pb-4 text-[11px] text-white/50"><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span></div>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-3">
        <div className="rounded-xl bg-white/[0.06] p-3"><p className="text-[11px] text-white/55">Products</p><p className="mt-1 text-sm font-semibold text-white">Top performers</p></div>
        <div className="rounded-xl bg-white/[0.06] p-3"><p className="text-[11px] text-white/55">Suppliers</p><p className="mt-1 text-sm font-semibold text-white">Purchase trends</p></div>
        <div className="rounded-xl bg-white/[0.06] p-3"><p className="text-[11px] text-white/55">Stock</p><p className="mt-1 text-sm font-semibold text-white">Movement & cover</p></div>
      </div>
    </div>
  );
}

export function LandingPage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <main className="min-h-screen bg-[#f7f8f3] text-[#16231f] selection:bg-emerald-200">
      <header className="sticky top-0 z-30 border-b border-[#e7eae2] bg-[#f7f8f3]/95 backdrop-blur">
        <div className="mx-auto flex h-[76px] max-w-7xl items-center justify-between px-5 sm:px-8">
          <a href="#home" className="flex items-center gap-2.5" aria-label="Business Manager home">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#11765d] text-white"><Boxes size={20} /></span>
            <span className="text-[15px] font-bold tracking-tight">Business Manager</span>
          </a>
          <nav aria-label="Main navigation" className="hidden items-center gap-8 text-sm font-medium text-slate-600 md:flex">
            <a className="transition hover:text-[#11765d]" href="#platform">Platform</a>
            <a className="transition hover:text-[#11765d]" href="#insights">Insights</a>
            <a className="transition hover:text-[#11765d]" href="#how-it-works">How it works</a>
          </nav>
          <div className="hidden items-center gap-3 md:flex">
            <a href="#workspace" className="rounded-full px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-emerald-50">Sign in</a>
            <a href="#workspace" className="inline-flex items-center gap-2 rounded-full bg-[#11765d] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#0d614d]">Open workspace <ArrowRight size={16} /></a>
          </div>
          <button type="button" aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'} aria-expanded={mobileMenuOpen} className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 md:hidden" onClick={() => setMobileMenuOpen((open) => !open)}>
            {mobileMenuOpen ? <X size={19} /> : <Menu size={19} />}
          </button>
        </div>
        {mobileMenuOpen && <nav aria-label="Mobile navigation" className="grid gap-1 border-t border-[#e7eae2] bg-[#f7f8f3] px-5 py-3 md:hidden">
          {[['Platform', '#platform'], ['Insights', '#insights'], ['How it works', '#how-it-works'], ['Sign in to your workspace', '#workspace']].map(([label, href]) => <a key={href} onClick={() => setMobileMenuOpen(false)} className="rounded-lg px-3 py-3 text-sm font-medium text-slate-700 hover:bg-emerald-50" href={href}>{label}</a>)}
        </nav>}
      </header>

      <section id="home" className="relative overflow-hidden">
        <div className="absolute -right-36 -top-28 h-[520px] w-[520px] rounded-full bg-[#dcefe5] blur-3xl" aria-hidden="true" />
        <div className="relative mx-auto grid max-w-7xl gap-12 px-5 pb-16 pt-14 sm:px-8 sm:pb-20 sm:pt-20 lg:grid-cols-[.88fr_1.12fr] lg:items-center lg:gap-14 lg:pb-24 lg:pt-24">
          <div className="relative z-10">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#d6e7dd] bg-white/70 px-3.5 py-2 text-xs font-semibold text-[#246c52] shadow-sm">
              <span className="h-2 w-2 rounded-full bg-[#43a77a]" /> A clearer way to run your business
            </div>
            <h1 className="mt-6 max-w-2xl font-display text-[2.8rem] leading-[1.06] tracking-[-0.04em] sm:text-6xl lg:text-[4.25rem]">Know your stock.<br /><span className="text-[#11765d]">Grow with confidence.</span></h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-slate-600 sm:text-lg sm:leading-8">Bring products, sales, suppliers and customer records together. Spend less time chasing numbers and more time making your next good decision.</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a href="#workspace" className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-[#11765d] px-6 text-sm font-semibold text-white shadow-lg shadow-emerald-900/10 transition hover:-translate-y-0.5 hover:bg-[#0d614d]">Sign in to your workspace <ArrowRight size={17} /></a>
              <a href="#platform" className="inline-flex h-12 items-center justify-center gap-2 rounded-full border border-[#d5ddd6] bg-white/80 px-6 text-sm font-semibold text-[#22362e] transition hover:border-[#97bca8] hover:bg-white">Explore the platform <ArrowDown size={16} /></a>
            </div>
            <div className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-xs font-medium text-slate-500">
              <span className="inline-flex items-center gap-1.5"><Check className="text-[#11765d]" size={15} /> Inventory at a glance</span>
              <span className="inline-flex items-center gap-1.5"><Check className="text-[#11765d]" size={15} /> Clear business insights</span>
              <span className="inline-flex items-center gap-1.5"><Check className="text-[#11765d]" size={15} /> Business-specific access</span>
            </div>
          </div>

          <div className="relative mx-auto w-full max-w-[690px] lg:ml-auto">
            <div className="absolute -left-5 top-12 z-10 hidden rounded-2xl border border-white/70 bg-white/95 p-4 shadow-xl sm:block lg:-left-8">
              <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#e4f4eb] text-[#177656]"><PackageCheck size={19} /></span><span><span className="block text-[11px] text-slate-500">Stock control</span><span className="mt-0.5 block text-sm font-semibold">Know what needs attention</span></span></div>
            </div>
            <div className="relative aspect-[1.18] overflow-hidden rounded-[2rem] bg-[#d9ded6] shadow-2xl shadow-[#284b3c]/20 sm:aspect-[1.36]">
              <img src={retailPhoto} alt="Shop team member reviewing store information on a tablet" className="absolute inset-0 h-full w-full object-cover" fetchPriority="high" />
              <div className="absolute inset-0 bg-gradient-to-t from-[#102c27]/75 via-[#102c27]/5 to-transparent" />
              <div className="absolute bottom-0 left-0 right-0 p-5 text-white sm:p-7">
                <div className="max-w-[440px] rounded-2xl border border-white/25 bg-[#102c27]/80 p-4 shadow-xl backdrop-blur-md sm:p-5">
                  <div className="flex items-center justify-between gap-4"><div><p className="text-[11px] font-medium text-white/65">Business overview</p><p className="mt-1 text-lg font-semibold">One workspace. The full picture.</p></div><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-300/15 text-emerald-200"><BarChart3 size={18} /></span></div>
                  <div className="mt-4 grid grid-cols-3 gap-2.5">
                    {[['Products', 'Inventory'], ['Today', 'Sales'], ['Partners', 'Suppliers']].map(([heading, label]) => <div key={label} className="rounded-xl border border-white/10 bg-white/[0.07] px-3 py-2"><p className="text-[10px] text-white/50">{heading}</p><p className="mt-1 text-xs font-semibold">{label}</p></div>)}
                  </div>
                </div>
              </div>
              <div className="absolute right-4 top-4 rounded-full border border-white/40 bg-white/85 px-3 py-1.5 text-[11px] font-semibold text-[#18392d] shadow-sm">Inside your workspace</div>
            </div>
            <p className="mt-2 text-right text-[10px] text-slate-500">Photo by <a className="underline decoration-slate-300 underline-offset-2 hover:text-[#11765d]" href="https://www.pexels.com/photo/fashion-retail-employee-using-digital-tablet-in-clothing-store-36730435/" target="_blank" rel="noreferrer">Vitaly Gariev on Pexels</a></p>
          </div>
        </div>
      </section>

      <section id="platform" className="scroll-mt-20 border-y border-[#e8ebe5] bg-white px-5 py-20 sm:px-8 lg:py-24">
        <div className="mx-auto max-w-7xl">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#11765d]">A connected toolkit</p>
            <h2 className="mt-4 font-display text-4xl leading-tight tracking-[-0.03em] sm:text-5xl">The daily work, all in one place.</h2>
            <p className="mt-4 text-base leading-7 text-slate-600">From receiving a delivery to understanding what sells, keep your business operations moving with one clear view.</p>
          </div>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { icon: Boxes, title: 'Products & stock', body: 'Keep product details, stock levels and stock movements together. Spot low stock before it interrupts a sale.', color: 'bg-emerald-50 text-emerald-700' },
              { icon: CircleDollarSign, title: 'Sales & payments', body: 'Record sales and payment methods, then follow the activity that moves your business forward.', color: 'bg-amber-50 text-amber-700' },
              { icon: Truck, title: 'Suppliers & receiving', body: 'Track supplier purchases and incoming deliveries from order through receiving.', color: 'bg-sky-50 text-sky-700' },
              { icon: UsersRound, title: 'Customers & loyalty', body: 'Keep customer purchase history and phone details together, with configurable loyalty points.', color: 'bg-violet-50 text-violet-700' },
            ].map(({ icon: Icon, title, body, color }) => <article key={title} className="group rounded-2xl border border-[#e8ece7] bg-[#fcfdfb] p-6 transition duration-200 hover:-translate-y-1 hover:border-[#c6dfd1] hover:shadow-lg hover:shadow-emerald-950/5">
              <span className={`flex h-11 w-11 items-center justify-center rounded-xl ${color}`}><Icon size={21} /></span>
              <h3 className="mt-5 text-base font-bold">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">{body}</p>
              <span className="mt-5 inline-flex items-center gap-1 text-xs font-semibold text-[#11765d]">Built into your workspace <ChevronRight size={14} /></span>
            </article>)}
          </div>
        </div>
      </section>

      <section id="insights" className="scroll-mt-20 bg-[#102c27] px-5 py-20 text-white sm:px-8 lg:py-24">
        <div className="mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-[.85fr_1.15fr] lg:gap-16">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-300">Useful answers, not just totals</p>
            <h2 className="mt-4 font-display text-4xl leading-tight tracking-[-0.03em] sm:text-5xl">See what is working and where to look next.</h2>
            <p className="mt-5 max-w-xl text-base leading-7 text-emerald-50/70">Use visual reports to understand product performance, supplier activity, stock movement and sales trends. Filter the view and follow the details behind the numbers.</p>
            <div className="mt-8 space-y-4">
              {[
                { icon: LineChart, title: 'Product performance', body: 'Compare sales and movement over time.' },
                { icon: ClipboardCheck, title: 'Supplier activity', body: 'Review purchases, deliveries and outstanding work.' },
                { icon: CreditCard, title: 'Customer payment history', body: 'Keep customer purchases and payment records connected.' },
                { icon: Smartphone, title: 'Phone based loyalty and SMS', body: 'Set year end reward rules, and send payment or balance updates through Africa’s Talking to customers who opt in.' },
              ].map(({ icon: FeatureIcon, title, body }) => <div key={title} className="flex items-start gap-3"><span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 text-emerald-200"><FeatureIcon size={17} /></span><div><p className="text-sm font-semibold">{title}</p><p className="mt-1 text-sm text-white/60">{body}</p></div></div>)}
            </div>
          </div>
          <MiniChart />
        </div>
      </section>

      <section id="how-it-works" className="scroll-mt-20 bg-[#f7f8f3] px-5 py-20 sm:px-8 lg:py-24">
        <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-[.9fr_1.1fr] lg:items-center">
          <div className="relative min-h-[390px] overflow-hidden rounded-[2rem] bg-[#d6dfd7] sm:min-h-[470px]">
            <img src={stockPhoto} alt="Shelves of goods arranged in a neighborhood shop" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-[#122d26]/65 via-transparent to-transparent" />
            <p className="absolute bottom-4 left-5 text-xs text-white/90">Photo by <a href="https://www.pexels.com/photo/foods-on-wooden-shelves-in-a-store-12280949/" target="_blank" rel="noreferrer" className="underline underline-offset-2">Tarikul Raana on Pexels</a></p>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#11765d]">Easy to find. Ready for your team.</p>
            <h2 className="mt-4 font-display text-4xl leading-tight tracking-[-0.03em] sm:text-5xl">Your team has a clear place to start.</h2>
            <p className="mt-5 max-w-xl text-base leading-7 text-slate-600">Each business has its own workspace. Administrators manage the business setup and team access. Staff sign in to the same business site with access based on their role.</p>
            <div className="mt-8 space-y-5">
              {[
                ['01', 'Open your business link', 'Use the workspace name or link from your administrator.'],
                ['02', 'Sign in to that business', 'Your details are checked against the selected tenant workspace.'],
                ['03', 'Get the right tools', 'Administrators and staff see the features allowed for their role.'],
              ].map(([number, title, body]) => <div key={number} className="flex gap-4"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#b8d6c5] text-xs font-bold text-[#11765d]">{number}</span><div><h3 className="text-sm font-bold">{title}</h3><p className="mt-1 text-sm leading-6 text-slate-600">{body}</p></div></div>)}
            </div>
            <a href="#workspace" className="mt-8 inline-flex items-center gap-2 text-sm font-semibold text-[#11765d] hover:text-[#0d614d]">Find your workspace <ArrowRight size={17} /></a>
          </div>
        </div>
      </section>

      <section className="px-5 pb-20 sm:px-8 lg:pb-24">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 rounded-[2rem] bg-[#e4f1e8] p-7 sm:p-10 md:flex-row md:items-center md:justify-between lg:p-12">
          <div className="max-w-2xl"><p className="text-xs font-bold uppercase tracking-[0.2em] text-[#11765d]">For owners and their teams</p><h2 className="mt-3 font-display text-3xl leading-tight tracking-[-0.03em] sm:text-4xl">Make your next business decision with a clearer view.</h2><p className="mt-3 text-sm leading-6 text-slate-600">Sign in to the workspace set up for your business.</p></div>
          <a href="#workspace" className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-full bg-[#11765d] px-6 text-sm font-semibold text-white transition hover:bg-[#0d614d]">Go to sign in <ArrowRight size={17} /></a>
        </div>
      </section>

      <WorkspaceEntry />

      <footer className="bg-[#0b211c] px-5 py-8 text-white/70 sm:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 text-xs sm:flex-row sm:items-center sm:justify-between">
          <a href="#home" className="flex items-center gap-2 font-semibold text-white"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-700"><Boxes size={15} /></span> Business Manager</a>
          <p>Tools for inventory, sales and business performance.</p>
          <a href="#workspace" className="font-semibold text-emerald-200 hover:text-white">Tenant sign in <ArrowRight className="ml-1 inline" size={13} /></a>
        </div>
      </footer>
    </main>
  );
}
