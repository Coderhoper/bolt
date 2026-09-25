import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  Activity, AlertTriangle, ArrowUpRight, BadgeCheck, Building2, Check, ChevronRight,
  CircleHelp, ClipboardList, CreditCard, Database, FileClock, GraduationCap, LayoutDashboard, Mail,
  LifeBuoy, LockKeyhole, LogOut, Menu, MessageCircle, MessageSquareText, Plus, RefreshCw,
  Search, Send, Settings2, ShieldCheck, Signal, Users, X,
} from 'lucide-react';
import { ownerSupabase } from '@/lib/ownerSupabase';

type Page = 'overview' | 'tenants' | 'onboarding' | 'analytics' | 'anomalies' | 'training' | 'support' | 'billing' | 'platform' | 'communications' | 'audit';
type Tenant = { id: string; name: string; slug: string; plan: string; region: string; status: string; isolation_level: string; primary_contact: string | null; contact_email: string | null; created_at: string };
type FeedRow = { id: string; tenant_id?: string | null; title?: string; summary?: string | null; status?: string; severity?: string; created_at: string; name?: string; kind?: string; state?: string; [key: string]: unknown };
type OwnerRole = 'platform_admin' | 'provisioner' | 'support' | 'analyst' | 'auditor';

const navigation: { id: Page; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'tenants', label: 'Tenants', icon: Building2 },
  { id: 'onboarding', label: 'Onboarding', icon: ClipboardList },
  { id: 'analytics', label: 'Analytics', icon: Activity },
  { id: 'anomalies', label: 'Anomalies', icon: AlertTriangle },
  { id: 'training', label: 'Training', icon: GraduationCap },
  { id: 'support', label: 'Support', icon: LifeBuoy },
  { id: 'billing', label: 'Billing', icon: CreditCard },
  { id: 'platform', label: 'Platform', icon: Settings2 },
  { id: 'communications', label: 'Communications', icon: Mail },
  { id: 'audit', label: 'Owner audit', icon: FileClock },
];

const pretty = (value?: string | null) => (value || 'unknown').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
const dateLabel = (value?: string) => value ? new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

export function OwnerConsole() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [mfaChecking, setMfaChecking] = useState(false);
  const [role, setRole] = useState<OwnerRole | null>(null);
  const [accessError, setAccessError] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaFactor, setMfaFactor] = useState('');
  const [enrollmentSecret, setEnrollmentSecret] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [mfaError, setMfaError] = useState('');
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState<Page>(() => (window.location.hash.slice(2) as Page) || 'overview');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [feed, setFeed] = useState<FeedRow[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', slug: '', plan: 'starter', region: 'africa-east', primary_contact: '', contact_email: '', isolation_level: 'database_per_tenant' });

  useEffect(() => {
    if (!ownerSupabase) { setAuthLoading(false); return; }
    ownerSupabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthLoading(false); });
    const { data: listener } = ownerSupabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let active = true;
    if (!session || !ownerSupabase) { setRole(null); setAccessError(''); return; }
    setAccessError('');
    ownerSupabase.from('owner_staff').select('role, is_active').eq('user_id', session.user.id).maybeSingle()
      .then(({ data, error: queryError }) => {
        if (!active) return;
        if (queryError || !data?.is_active) { setRole(null); setAccessError('This identity is not enabled for the owner control plane. Ask a platform administrator to provision your owner role.'); }
        else setRole(data.role as OwnerRole);
      });
    return () => { active = false; };
  }, [session]);

  useEffect(() => {
    let active = true;
    const client = ownerSupabase;
    if (!session || !client) { setMfaChecking(false); return; }
    setMfaChecking(true);
    Promise.all([
      client.auth.mfa.getAuthenticatorAssuranceLevel(),
      client.auth.mfa.listFactors(),
    ]).then(async ([{ data: assurance }, { data: factors }]) => {
      if (!active) return;
      if (assurance?.currentLevel === 'aal2') { setMfaFactor(''); setMfaChecking(false); return; }
      const factor = factors?.totp.find(item => item.status === 'verified');
      if (factor) setMfaFactor(factor.id);
      else {
        const { data: enrollment, error: enrollError } = await client.auth.mfa.enroll({
          factorType: 'totp', issuer: 'Hardware Platform Owner', friendlyName: 'Owner console authenticator',
        });
        if (enrollError || !enrollment?.totp?.secret) {
          setAccessError(enrollError?.message || 'Could not start authenticator enrollment.');
          await client.auth.signOut();
        } else {
          setMfaFactor(enrollment.id);
          setEnrollmentSecret(enrollment.totp.secret);
        }
      }
      if (active) setMfaChecking(false);
    }).catch(async () => {
      if (!active) return;
      setAccessError('Could not verify owner MFA assurance. Please sign in again.');
      await client.auth.signOut();
      if (active) setMfaChecking(false);
    });
    return () => { active = false; };
  }, [session]);

  const loadData = useCallback(async () => {
    if (!ownerSupabase || !session || !role) return;
    setLoadingData(true); setError('');
    const [tenantResult, activityResult] = await Promise.all([
      ownerSupabase.from('tenants').select('id,name,slug,plan,region,status,isolation_level,primary_contact,contact_email,created_at').order('created_at', { ascending: false }).limit(250),
      ownerSupabase.from(page === 'audit' ? 'owner_audit_log' : page === 'anomalies' ? 'platform_alerts' : page === 'support' ? 'support_tickets' : page === 'training' ? 'training_enrollments' : page === 'platform' || page === 'onboarding' ? 'provisioning_jobs' : 'tenant_metrics').select('*').order('created_at', { ascending: false }).limit(12),
    ]);
    if (!tenantResult.error) setTenants((tenantResult.data || []) as Tenant[]);
    if (!activityResult.error) setFeed((activityResult.data || []) as FeedRow[]);
    const failed = tenantResult.error || activityResult.error;
    if (failed) setError(failed.message);
    setLoadingData(false);
  }, [session, role, page]);

  useEffect(() => { void loadData(); }, [loadData]);
  useEffect(() => {
    const sync = () => {
      const requested = window.location.hash.slice(2) as Page;
      setPage(navigation.some(item => item.id === requested) ? requested : 'overview');
    };
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  const navigate = (next: Page) => { window.location.hash = `/${next}`; setPage(next); setSidebarOpen(false); };
  const signIn = async (event: FormEvent) => {
    event.preventDefault(); if (!ownerSupabase) return;
    setBusy(true); setAccessError('');
    const { error: signInError } = await ownerSupabase.auth.signInWithPassword({ email, password });
    if (signInError) setAccessError(signInError.message);

    setBusy(false);
  };
  const verifyMfa = async (event: FormEvent) => {
    event.preventDefault(); if (!ownerSupabase || !mfaFactor) return;
    setBusy(true); setMfaError('');
    const { data: challenge, error: challengeError } = await ownerSupabase.auth.mfa.challenge({ factorId: mfaFactor });
    if (challengeError) { setMfaError(challengeError.message); setBusy(false); return; }
    const { error: verifyError } = await ownerSupabase.auth.mfa.verify({ factorId: mfaFactor, challengeId: challenge.id, code: mfaCode });
    if (verifyError) setMfaError(verifyError.message);
    else {
      setMfaFactor(''); setMfaCode(''); setEnrollmentSecret('');
      const { data } = await ownerSupabase.auth.getSession();
      setSession(data.session);
    }
    setBusy(false);
  };
  const createTenant = async (event: FormEvent) => {
    event.preventDefault(); if (!ownerSupabase) return;
    setBusy(true); setError('');
    const { error: createError } = await ownerSupabase.rpc('owner_create_tenant', {
      p_name: form.name.trim(), p_slug: form.slug.trim().toLowerCase(), p_plan: form.plan,
      p_region: form.region, p_primary_contact: form.primary_contact.trim() || null,
      p_contact_email: form.contact_email.trim() || null, p_isolation_level: form.isolation_level,
    });
    setBusy(false);
    if (createError) { setError(createError.message); return; }
    setShowCreate(false); setForm({ name: '', slug: '', plan: 'starter', region: 'africa-east', primary_contact: '', contact_email: '', isolation_level: 'database_per_tenant' });
    await loadData();
  };

  const filteredTenants = useMemo(() => tenants.filter(t => `${t.name} ${t.slug} ${t.plan} ${t.region} ${t.status}`.toLowerCase().includes(search.toLowerCase())), [tenants, search]);
  const activeCount = tenants.filter(t => t.status === 'active').length;
  const onboardingCount = tenants.filter(t => ['pending', 'provisioning', 'training', 'trial'].includes(t.status)).length;

  if (authLoading) return <Loading />;
  if (!ownerSupabase) return <ConfigurationNotice />;
  if (session && mfaChecking) return <Loading />;
  if (session && enrollmentSecret) return <MfaEnrollment secret={enrollmentSecret} code={mfaCode} setCode={setMfaCode} onSubmit={verifyMfa} busy={busy} error={mfaError} />;
  if (session && mfaFactor) return <MfaChallenge code={mfaCode} setCode={setMfaCode} onSubmit={verifyMfa} busy={busy} error={mfaError} />;
  if (!session) return <SignIn email={email} password={password} setEmail={setEmail} setPassword={setPassword} onSubmit={signIn} busy={busy} error={accessError} />;
  if (!role) return <AccessDenied email={session.user.email || ''} error={accessError} signOut={() => ownerSupabase!.auth.signOut()} />;

  const canProvision = role === 'platform_admin' || role === 'provisioner';
  const title = navigation.find(item => item.id === page)?.label || 'Overview';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {sidebarOpen && <button aria-label="Close menu" className="fixed inset-0 z-30 bg-slate-950/50 lg:hidden" onClick={() => setSidebarOpen(false)} />}
      <aside className={`fixed inset-y-0 left-0 z-40 w-64 -translate-x-full bg-slate-900 transition-transform lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : ''}`}>
        <div className="flex h-full flex-col">
          <div className="flex items-center gap-3 border-b border-slate-800 px-5 py-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-emerald-500"><ShieldCheck size={21} className="text-white" /></div>
            <div><p className="text-sm font-bold text-white">Platform Owner</p><p className="text-xs text-slate-400">Control plane</p></div>
          </div>
          <div className="mx-3 mt-4 rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-2"><p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Access role</p><p className="mt-0.5 text-xs font-medium text-emerald-300">{pretty(role)}</p></div>
          <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
            {navigation.map(item => { const Icon = item.icon; return <button key={item.id} onClick={() => navigate(item.id)} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${page === item.id ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}><Icon size={18} />{item.label}</button>; })}
          </nav>
          <div className="border-t border-slate-800 p-3"><div className="mb-2 flex items-center gap-3 px-2 py-2"><div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-700 text-sm font-semibold text-white">{session.user.email?.charAt(0).toUpperCase()}</div><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-white">{session.user.email}</p><p className="text-xs text-slate-500">Owner staff</p></div></div><button onClick={() => ownerSupabase!.auth.signOut()} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-slate-400 hover:bg-slate-800 hover:text-white"><LogOut size={17} />Sign out</button></div>
        </div>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-slate-200 bg-white/90 px-4 backdrop-blur-md lg:px-8">
          <div className="flex items-center gap-3"><button className="text-slate-600 lg:hidden" onClick={() => setSidebarOpen(true)} aria-label="Open menu"><Menu size={22} /></button><div><p className="text-sm font-semibold text-slate-900">{title}</p><p className="hidden text-xs text-slate-500 sm:block">{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p></div></div>
          <div className="flex items-center gap-2"><span className="hidden items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 sm:flex"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Owner plane</span><button onClick={() => void loadData()} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" title="Refresh"><RefreshCw size={17} className={loadingData ? 'animate-spin' : ''} /></button></div>
        </header>
        <main className="p-4 lg:p-8">
          {error && <div className="mb-5 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"><AlertTriangle size={17} className="mt-0.5 shrink-0" /><span>{error}</span><button className="ml-auto" aria-label="Dismiss error" onClick={() => setError('')}><X size={16} /></button></div>}
          {page === 'overview' && <Overview tenants={tenants} activeCount={activeCount} onboardingCount={onboardingCount} feed={feed} loading={loadingData} navigate={navigate} />}
          {page === 'tenants' && <Tenants tenants={filteredTenants} search={search} setSearch={setSearch} onCreate={() => setShowCreate(true)} canProvision={canProvision} />}
          {page === 'onboarding' && <Onboarding tenants={tenants} jobs={feed} onCreate={() => setShowCreate(true)} canProvision={canProvision} />}
          {page === 'analytics' && <Analytics tenants={tenants} rows={feed} />}
          {page === 'anomalies' && <ResourcePage title="Technical alerts" subtitle="Health and reliability signals reported by tenant environments." rows={feed} empty="No technical alerts have been ingested." fields={['severity', 'status', 'tenant_id', 'created_at']} />}
          {page === 'training' && <ResourcePage title="Training progress" subtitle="Track assigned tenant onboarding courses and completion." rows={feed} empty="No training enrollments yet." fields={['tenant_id', 'course_id', 'status', 'created_at']} />}
          {page === 'support' && <Support rows={feed} onNavigate={navigate} />}
          {page === 'billing' && <ResourcePage title="Plans & billing" subtitle="Subscription and usage records from the owner plane." rows={feed} empty="Billing integrations are not connected yet. No invoice or payment data is fabricated." fields={['tenant_id', 'plan', 'status', 'created_at']} />}
          {page === 'platform' && <Platform jobs={feed} tenants={tenants} />}
          {page === 'communications' && <Communications role={role} />}
          {page === 'audit' && <Audit rows={feed} />}
          <div className="mt-8 flex items-start gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs leading-5 text-slate-500"><LockKeyhole size={15} className="mt-0.5 shrink-0 text-slate-400" /><p>Owner plane displays tenant metadata and aggregated telemetry only. Tenant product, price, staff, and transaction records stay in the tenant environment. Business-data access is not exposed from this console.</p></div>
        </main>
      </div>

      {showCreate && <TenantModal form={form} setForm={setForm} onClose={() => setShowCreate(false)} onSubmit={createTenant} busy={busy} />}
    </div>
  );
}

function Loading() { return <div className="flex min-h-screen items-center justify-center bg-slate-50"><div className="h-10 w-10 animate-spin rounded-full border-b-2 border-blue-600" /></div>; }
function ConfigurationNotice() { return <div className="flex min-h-screen items-center justify-center bg-slate-50 p-5"><div className="max-w-xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm"><div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-slate-900 text-white"><Database size={22} /></div><h1 className="text-xl font-bold">Owner plane is not configured</h1><p className="mt-2 text-sm leading-6 text-slate-600">Configure <code className="rounded bg-slate-100 px-1">VITE_OWNER_SUPABASE_URL</code> and <code className="rounded bg-slate-100 px-1">VITE_OWNER_SUPABASE_ANON_KEY</code> for a dedicated owner Supabase project. This console will not connect to the tenant database as a fallback.</p><p className="mt-4 text-xs text-slate-500">Apply the migrations in <code>supabase-owner/migrations</code> before enabling owner staff sign-in.</p></div></div>; }
function SignIn({ email, password, setEmail, setPassword, onSubmit, busy, error }: { email: string; password: string; setEmail: (v: string) => void; setPassword: (v: string) => void; onSubmit: (e: FormEvent) => void; busy: boolean; error: string }) { return <div className="flex min-h-screen items-center justify-center bg-slate-50 p-5"><form onSubmit={onSubmit} className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm"><div className="mb-6 flex h-12 w-12 items-center justify-center rounded-xl bg-slate-900 text-white"><ShieldCheck size={23} /></div><p className="text-xs font-semibold uppercase tracking-wider text-blue-700">Platform operations</p><h1 className="mt-2 text-2xl font-bold">Owner sign in</h1><p className="mt-2 text-sm text-slate-500">Use your separately provisioned platform staff identity.</p>{error && <p role="alert" className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}<label className="mt-6 block text-sm font-medium">Email<input required type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" /></label><label className="mt-4 block text-sm font-medium">Password<input required type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" /></label><button disabled={busy} className="mt-6 w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">{busy ? 'Signing in…' : 'Sign in securely'}</button><p className="mt-4 flex items-center justify-center gap-1 text-xs text-slate-500"><LockKeyhole size={13} /> Owner identity is separate from tenant accounts</p></form></div>; }
function MfaChallenge({ code, setCode, onSubmit, busy, error }: { code: string; setCode: (v: string) => void; onSubmit: (e: FormEvent) => void; busy: boolean; error: string }) { return <div className="flex min-h-screen items-center justify-center bg-slate-50 p-5"><form onSubmit={onSubmit} className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm"><div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><LockKeyhole size={22} /></div><h1 className="mt-4 text-xl font-bold">Verify your identity</h1><p className="mt-2 text-sm text-slate-500">Enter the current code from your enrolled authenticator app. Owner data stays locked until MFA succeeds.</p>{error && <p role="alert" className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}<label className="mt-5 block text-sm font-medium">Authenticator code<input required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-center text-xl tracking-[0.4em] outline-none focus:border-blue-500" /></label><button disabled={busy || code.length !== 6} className="mt-5 w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">{busy ? 'Verifying…' : 'Verify and continue'}</button></form></div>; }

function MfaEnrollment({ secret, code, setCode, onSubmit, busy, error }: { secret: string; code: string; setCode: (v: string) => void; onSubmit: (e: FormEvent) => void; busy: boolean; error: string }) {
  return <div className="flex min-h-screen items-center justify-center bg-slate-50 p-5"><form onSubmit={onSubmit} className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-700"><LockKeyhole size={22} /></div><p className="mt-5 text-xs font-semibold uppercase tracking-wider text-blue-700">One-time setup</p><h1 className="mt-1 text-2xl font-bold">Protect your owner account</h1>
    <p className="mt-2 text-sm leading-6 text-slate-600">Add this account to an authenticator app, then enter its six-digit code. Owner-console data remains locked until verification.</p>
    <label className="mt-5 block text-xs font-semibold text-slate-500">Authenticator setup key</label><code className="mt-1 block break-all rounded-lg bg-slate-100 p-3 font-mono text-sm text-slate-800">{secret}</code>
    {error && <p role="alert" className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
    <label className="mt-5 block text-sm font-medium">Authenticator code<input required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-center text-xl tracking-[0.4em] outline-none focus:border-blue-500" /></label>
    <button disabled={busy || code.length !== 6} className="mt-5 w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">{busy ? 'Verifying…' : 'Verify authenticator and continue'}</button>
  </form></div>;
}
function AccessDenied({ email, error, signOut }: { email: string; error: string; signOut: () => Promise<unknown> }) { return <div className="flex min-h-screen items-center justify-center bg-slate-50 p-5"><div className="max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-amber-100 text-amber-700"><LockKeyhole size={22} /></div><h1 className="mt-4 text-xl font-bold">Owner access is not enabled</h1><p className="mt-2 text-sm text-slate-600">Signed in as {email}. {error}</p><button onClick={() => void signOut()} className="mt-5 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium">Sign out</button></div></div>; }

function PageHeading({ eyebrow, title, subtitle, action }: { eyebrow?: string; title: string; subtitle: string; action?: React.ReactNode }) { return <div className="mb-6 flex flex-wrap items-end justify-between gap-4"><div>{eyebrow && <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-blue-700">{eyebrow}</p>}<h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1><p className="mt-1 text-sm text-slate-500">{subtitle}</p></div>{action}</div>; }
function Stat({ label, value, detail, icon: Icon, tone = 'blue' }: { label: string; value: string | number; detail: string; icon: typeof Users; tone?: string }) { const colors: Record<string, string> = { blue: 'bg-blue-50 text-blue-700', emerald: 'bg-emerald-50 text-emerald-700', amber: 'bg-amber-50 text-amber-700', slate: 'bg-slate-100 text-slate-700' }; return <div className="rounded-xl border border-slate-200 bg-white p-5"><div className="flex items-start justify-between"><div><p className="text-sm text-slate-500">{label}</p><p className="mt-2 text-2xl font-bold text-slate-900">{value}</p></div><div className={`rounded-lg p-2.5 ${colors[tone] || colors.blue}`}><Icon size={19} /></div></div><p className="mt-3 text-xs text-slate-500">{detail}</p></div>; }
function Overview({ tenants, activeCount, onboardingCount, feed, loading, navigate }: { tenants: Tenant[]; activeCount: number; onboardingCount: number; feed: FeedRow[]; loading: boolean; navigate: (p: Page) => void }) { const recent = tenants.slice(0, 5); return <><PageHeading eyebrow="Platform health" title="Good morning" subtitle="Cross-tenant operations at a glance. Aggregated metadata only." /><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Stat label="Total tenants" value={loading ? '—' : tenants.length} detail={`${activeCount} active environments`} icon={Building2} /><Stat label="In onboarding" value={loading ? '—' : onboardingCount} detail="Contracts, provisioning and training" icon={ClipboardList} tone="amber" /><Stat label="Active tenants" value={loading ? '—' : activeCount} detail="Go-live status from tenant registry" icon={BadgeCheck} tone="emerald" /><Stat label="Telemetry records" value={loading ? '—' : feed.length} detail="Recent aggregated signals available" icon={Signal} tone="slate" /></div><div className="mt-6 grid gap-5 xl:grid-cols-[1.4fr_1fr]"><section className="rounded-xl border border-slate-200 bg-white"><div className="flex items-center justify-between border-b border-slate-100 p-5"><div><h2 className="font-semibold">Tenant environments</h2><p className="mt-1 text-xs text-slate-500">Provisioning state and operating status</p></div><button onClick={() => navigate('tenants')} className="flex items-center gap-1 text-sm font-medium text-blue-700">All tenants<ChevronRight size={16} /></button></div>{recent.length ? <div className="divide-y divide-slate-100">{recent.map(t => <TenantRow key={t.id} tenant={t} />)}</div> : <Empty title="No tenant environments yet" text="Create a tenant record after the business contract is signed." />}</section><section className="rounded-xl border border-slate-200 bg-white"><div className="border-b border-slate-100 p-5"><h2 className="font-semibold">Latest platform signals</h2><p className="mt-1 text-xs text-slate-500">Technical health and reliability events</p></div>{feed.length ? <div className="divide-y divide-slate-100">{feed.slice(0, 6).map(item => <ActivityRow key={item.id} row={item} />)}</div> : <Empty title="Telemetry is waiting" text="Tenant health metrics and platform alerts will appear as tenant integrations report them." />}</section></div><div className="mt-5 grid gap-4 md:grid-cols-3"><WorkflowCard icon={ClipboardList} title="Onboard" text="Register the tenant, provision its isolated environment, then assign a training track." action="Open onboarding" onClick={() => navigate('onboarding')} /><WorkflowCard icon={Activity} title="Operate" text="Review aggregated service health, adoption signals and technical alerts." action="Review analytics" onClick={() => navigate('analytics')} /><WorkflowCard icon={LifeBuoy} title="Support" text="Work support tickets and submit a two-person, scoped access request when metadata is insufficient." action="Open support" onClick={() => navigate('support')} /></div></>; }
function WorkflowCard({ icon: Icon, title, text, action, onClick }: { icon: typeof Users; title: string; text: string; action: string; onClick: () => void }) { return <div className="rounded-xl border border-slate-200 bg-white p-5"><Icon size={20} className="text-blue-700" /><h3 className="mt-3 font-semibold">{title}</h3><p className="mt-1 min-h-10 text-sm leading-5 text-slate-500">{text}</p><button onClick={onClick} className="mt-4 flex items-center gap-1 text-sm font-medium text-blue-700">{action}<ArrowUpRight size={15} /></button></div>; }
function TenantRow({ tenant }: { tenant: Tenant }) { const tone = tenant.status === 'active' ? 'bg-emerald-50 text-emerald-700' : tenant.status === 'attention' ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-600'; return <div className="flex items-center gap-3 px-5 py-3.5"><div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-600"><Building2 size={17} /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{tenant.name}</p><p className="truncate text-xs text-slate-500">{tenant.slug} · {pretty(tenant.plan)}</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${tone}`}>{pretty(tenant.status)}</span></div>; }
function ActivityRow({ row }: { row: FeedRow }) { const label = String(row.title || row.name || row.event_type || row.action || row.kind || 'Platform update'); const detail = String(row.summary || row.status || row.severity || 'Recorded'); return <div className="flex gap-3 px-5 py-3.5"><div className="mt-0.5 rounded-md bg-amber-50 p-1.5 text-amber-700"><Activity size={15} /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{label}</p><p className="mt-0.5 text-xs text-slate-500">{detail} · {dateLabel(row.created_at)}</p></div></div>; }
function Empty({ title, text }: { title: string; text: string }) { return <div className="px-6 py-12 text-center"><div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-500"><CircleHelp size={19} /></div><h3 className="mt-3 text-sm font-semibold text-slate-800">{title}</h3><p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">{text}</p></div>; }

function Tenants({ tenants, search, setSearch, onCreate, canProvision }: { tenants: Tenant[]; search: string; setSearch: (v: string) => void; onCreate: () => void; canProvision: boolean }) { return <><PageHeading eyebrow="Tenant registry" title="Tenants" subtitle="Manage customer environments, lifecycle and isolation metadata." action={canProvision ? <button onClick={onCreate} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"><Plus size={17} /> Add tenant</button> : undefined} /><div className="mb-4 flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3"><Search size={17} className="text-slate-400" /><input aria-label="Search tenants" placeholder="Search by tenant, plan, region or status…" value={search} onChange={e => setSearch(e.target.value)} className="h-11 w-full bg-transparent text-sm outline-none" /></div><div className="overflow-hidden rounded-xl border border-slate-200 bg-white"><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr>{['Tenant', 'Plan', 'Region', 'Contact', 'Isolation', 'Status', 'Created'].map(h => <th key={h} className="px-4 py-3 font-semibold">{h}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{tenants.map(t => <tr key={t.id} className="hover:bg-slate-50"><td className="px-4 py-3"><p className="font-medium text-slate-900">{t.name}</p><p className="text-xs text-slate-500">{t.slug}</p></td><td className="px-4 py-3">{pretty(t.plan)}</td><td className="px-4 py-3">{pretty(t.region)}</td><td className="px-4 py-3"><p>{t.primary_contact || '—'}</p><p className="text-xs text-slate-500">{t.contact_email}</p></td><td className="px-4 py-3 text-xs">{pretty((t as Tenant & { isolation_level?: string }).isolation_level)}</td><td className="px-4 py-3"><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs">{pretty(t.status)}</span></td><td className="px-4 py-3 text-slate-500">{dateLabel(t.created_at)}</td></tr>)}</tbody></table></div>{!tenants.length && <Empty title="No matching tenants" text="Tenant records appear here after they are registered." />}</div></>; }
function Onboarding({ tenants, jobs, onCreate, canProvision }: { tenants: Tenant[]; jobs: FeedRow[]; onCreate: () => void; canProvision: boolean }) { const stages = ['pending', 'provisioning', 'training', 'active']; return <><PageHeading eyebrow="Tenant lifecycle" title="Onboarding pipeline" subtitle="Contract → environment provisioning → tenant admin training → go-live." action={canProvision ? <button onClick={onCreate} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white"><Plus size={17} /> Register tenant</button> : undefined} /><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{stages.map((stage, i) => { const count = tenants.filter(t => stage === 'active' ? t.status === stage : t.status === stage || (stage === 'pending' && ['trial', 'contracted'].includes(t.status))).length; return <div key={stage} className="rounded-xl border border-slate-200 bg-white p-5"><div className="flex items-center justify-between"><span className="text-sm font-medium text-slate-600">{pretty(stage)}</span><span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-50 text-xs font-bold text-blue-700">{i + 1}</span></div><p className="mt-3 text-3xl font-bold">{count}</p><p className="mt-1 text-xs text-slate-500">{i === 0 ? 'Contract signed, awaiting setup' : i === 1 ? 'Isolated environment setup' : i === 2 ? 'Tenant admin course progress' : 'Health checks active'}</p></div>; })}</div><div className="mt-6 grid gap-5 xl:grid-cols-[1.2fr_1fr]"><div className="rounded-xl border border-slate-200 bg-white"><div className="border-b border-slate-100 p-5"><h2 className="font-semibold">Tenant onboarding</h2><p className="mt-1 text-xs text-slate-500">Owner provisions the environment only; tenant admins configure products, pricing and staff.</p></div>{tenants.filter(t => t.status !== 'active').length ? tenants.filter(t => t.status !== 'active').map(t => <TenantRow key={t.id} tenant={t} />) : <Empty title="Pipeline is clear" text="Newly registered tenants will appear here." />}</div><div className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="font-semibold">Provisioning jobs</h2><p className="mt-1 text-xs text-slate-500">Async, auditable job records. Execution requires a configured provisioning service.</p>{jobs.length ? <div className="mt-4 space-y-3">{jobs.map(job => <div key={job.id} className="flex items-center gap-3 rounded-lg bg-slate-50 p-3"><Database size={17} className="text-blue-700" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{job.name || job.kind || 'Tenant environment'}</p><p className="text-xs text-slate-500">{pretty(job.status || job.state)} · {dateLabel(job.created_at)}</p></div></div>)}</div> : <div className="mt-5 rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500">No jobs queued. Registering a tenant records a provisioning job; it will remain queued until a provisioner integration is connected.</div>}</div></div></>; }
function Analytics({ tenants, rows }: { tenants: Tenant[]; rows: FeedRow[] }) { const healthy = tenants.filter(t => t.status === 'active').length; return <><PageHeading eyebrow="Aggregated telemetry" title="Analytics" subtitle="Platform usage and technical health signals. No tenant business rows or personal data." /><div className="grid gap-4 sm:grid-cols-3"><Stat label="Reporting tenants" value={new Set(rows.map(r => r.tenant_id).filter(Boolean)).size} detail="Tenants with recent metric records" icon={Signal} /><Stat label="Active environments" value={healthy} detail="Marked active in tenant registry" icon={Building2} tone="emerald" /><Stat label="Metrics received" value={rows.length} detail="Most recent records returned" icon={Activity} tone="slate" /></div><div className="mt-6 rounded-xl border border-slate-200 bg-white"><div className="border-b border-slate-100 p-5"><h2 className="font-semibold">Recent aggregated metrics</h2><p className="mt-1 text-xs text-slate-500">Counts, latency and health signals are the only supported cross-plane telemetry.</p></div>{rows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[600px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{['Tenant reference', 'Metric', 'Value', 'Window', 'Received'].map(v => <th key={v} className="px-4 py-3">{v}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{rows.map(row => <tr key={row.id}><td className="px-4 py-3 font-mono text-xs">{String(row.tenant_id || '—').slice(0, 12)}</td><td className="px-4 py-3">{String(row.metric_key || row.metric || row.event_type || 'Health signal')}</td><td className="px-4 py-3 font-medium">{String(row.metric_value ?? row.value ?? '—')}</td><td className="px-4 py-3">{String(row.period || row.window || '—')}</td><td className="px-4 py-3 text-slate-500">{dateLabel(row.created_at)}</td></tr>)}</tbody></table></div> : <Empty title="No telemetry received" text="Connect tenant-side aggregation before showing cross-tenant trends. Business-level peer benchmarks should remain tenant-visible insights." />}</div></>; }
function ResourcePage({ title, subtitle, rows, empty, fields }: { title: string; subtitle: string; rows: FeedRow[]; empty: string; fields: string[] }) { return <><PageHeading eyebrow="Operations" title={title} subtitle={subtitle} /><div className="rounded-xl border border-slate-200 bg-white">{rows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[650px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{fields.map(field => <th key={field} className="px-4 py-3">{pretty(field)}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{rows.map(row => <tr key={row.id}>{fields.map(field => <td key={field} className="max-w-64 truncate px-4 py-3 text-slate-700">{field === 'created_at' ? dateLabel(String(row[field] || '')) : String(row[field] ?? '—')}</td>)}</tr>)}</tbody></table></div> : <Empty title={empty} text="Connect the corresponding owner-plane workflow or telemetry source to populate this view." />}</div></>; }
function Support({ rows, onNavigate }: { rows: FeedRow[]; onNavigate: (p: Page) => void }) { return <><PageHeading eyebrow="Tenant support" title="Support desk" subtitle="Tenant-scoped tickets, support workflow, and controlled escalation." action={<button onClick={() => onNavigate('audit')} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium">View audit log</button>} /><div className="mb-5 grid gap-4 md:grid-cols-2"><div className="rounded-xl border border-slate-200 bg-white p-5"><div className="flex items-center gap-2"><LifeBuoy size={18} className="text-blue-700" /><h2 className="font-semibold">Support tickets</h2></div><p className="mt-2 text-sm text-slate-500">Tickets should contain enough metadata to diagnose issues without reading tenant business records.</p></div><div className="rounded-xl border border-amber-200 bg-amber-50 p-5"><div className="flex items-center gap-2 text-amber-800"><LockKeyhole size={18} /><h2 className="font-semibold">Break-glass access</h2></div><p className="mt-2 text-sm leading-5 text-amber-900/80">Business-data access requires a separate support proxy, mandatory reason and ticket, table scope, tenant notification, two distinct approvers, query recording and auto-revocation within 60 minutes. This console does not grant direct database access.</p><p className="mt-2 text-xs font-medium text-amber-800">Support proxy integration required before enabling access requests.</p></div></div><ResourcePage title="Ticket queue" subtitle="Open and recently updated customer support issues." rows={rows} empty="No support tickets" fields={['tenant_id', 'title', 'severity', 'status', 'created_at']} /></>; }
function Platform({ jobs, tenants }: { jobs: FeedRow[]; tenants: Tenant[] }) { return <><PageHeading eyebrow="Platform control" title="Platform operations" subtitle="Provisioning, release, feature flags, backups and system audit surfaces." /><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Stat label="Provisioning jobs" value={jobs.length} detail="Recent owner-plane jobs" icon={Database} /><Stat label="Registered environments" value={tenants.length} detail="Metadata registry records" icon={Building2} tone="emerald" /><Stat label="Release management" value="Not connected" detail="No deployment control API configured" icon={RefreshCw} tone="amber" /><Stat label="Feature flags" value="Not connected" detail="Flags must be delivered through a secured service" icon={Settings2} tone="slate" /></div><div className="mt-6 grid gap-4 md:grid-cols-2"><PlatformCard title="Provisioning" text="Create environment, apply tenant migrations, invite the first tenant administrator, register health checks and backups. Jobs are asynchronous and idempotent; execution needs a trusted provisioning API." icon={Database} /><PlatformCard title="Flags & releases" text="Keep releases and tenant feature configuration behind an authenticated server-side service. The owner UI does not hold deployment credentials." icon={Settings2} /><PlatformCard title="Backup & restore" text="Per-tenant encrypted backups and tested restore workflows belong to the infrastructure plane. Never expose raw tenant backup contents here." icon={ShieldCheck} /><PlatformCard title="Tenant trust" text="Telemetry can be opted out where it is behavioral. Keep technical health signals minimal, documented and free of tenant-user PII." icon={Users} /></div></>; }
function PlatformCard({ title, text, icon: Icon }: { title: string; text: string; icon: typeof Users }) { return <div className="rounded-xl border border-slate-200 bg-white p-5"><Icon size={19} className="text-blue-700" /><h3 className="mt-3 font-semibold">{title}</h3><p className="mt-1 text-sm leading-6 text-slate-500">{text}</p><span className="mt-4 inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600"><CircleHelp size={13} />Integration seam defined</span></div>; }

type CommChannel = 'email' | 'sms' | 'whatsapp';
type CommConfig = { channel: CommChannel; provider: string; sender_name: string; sender_address: string; reply_to: string; is_enabled: boolean };
type CommLog = { id: string; channel: CommChannel; provider: string; status: string; error_code: string | null; recipient_hash: string; created_at: string };
const commDefaults: Record<CommChannel, CommConfig> = {
  email: { channel: 'email', provider: 'postmark', sender_name: 'Platform', sender_address: '', reply_to: '', is_enabled: false },
  sms: { channel: 'sms', provider: 'twilio', sender_name: 'Platform', sender_address: '', reply_to: '', is_enabled: false },
  whatsapp: { channel: 'whatsapp', provider: 'meta_cloud', sender_name: 'Platform', sender_address: '', reply_to: '', is_enabled: false },
};

function Communications({ role }: { role: OwnerRole | null }) {
  const client = ownerSupabase;
  const [configs, setConfigs] = useState(commDefaults);
  const [logs, setLogs] = useState<CommLog[]>([]);
  const [channel, setChannel] = useState<CommChannel>('email');
  const [recipient, setRecipient] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState<CommChannel | null>(null);
  const [notice, setNotice] = useState('');
  const [failure, setFailure] = useState('');
  const canConfigure = role === 'platform_admin';

  const load = useCallback(async () => {
    if (!client) return;
    const [{ data: configRows }, { data: logRows }] = await Promise.all([
      client.from('owner_comm_channels').select('*'),
      client.from('owner_comm_messages').select('id,channel,provider,status,error_code,recipient_hash,created_at').order('created_at', { ascending: false }).limit(25),
    ]);
    setConfigs(current => ({ ...current, ...Object.fromEntries((configRows || []).map(row => [row.channel, row])) }));
    setLogs((logRows || []) as CommLog[]);
  }, [client]);
  useEffect(() => { void load(); }, [load]);

  const patchConfig = (key: CommChannel, field: keyof CommConfig, value: string | boolean) =>
    setConfigs(current => ({ ...current, [key]: { ...current[key], [field]: value } }));

  const saveConfig = async (key: CommChannel) => {
    if (!client) return;
    const config = configs[key]; setSaving(key); setFailure(''); setNotice('');
    const { error: saveError } = await client.rpc('owner_set_comm_channel', {
      p_channel: key, p_provider: config.provider, p_sender_name: config.sender_name,
      p_sender_address: config.sender_address, p_reply_to: config.reply_to || null, p_is_enabled: config.is_enabled,
    });
    setSaving(null);
    if (saveError) setFailure(saveError.message); else { setNotice(`${pretty(key)} settings saved.`); await load(); }
  };

  const sendMessage = async (event: FormEvent) => {
    event.preventDefault(); if (!client) return;
    setBusy(true); setFailure(''); setNotice('');
    const { data, error: sendError } = await client.functions.invoke('owner-communications', {
      body: { channel, to: recipient, subject: channel === 'email' ? subject : undefined, text: message, idempotencyKey: crypto.randomUUID() },
    });
    setBusy(false);
    if (sendError || data?.error) setFailure(data?.error || sendError?.message || 'Message could not be sent.');
    else { setNotice(`${pretty(channel)} message accepted by the provider.`); setRecipient(''); setSubject(''); setMessage(''); await load(); }
  };

  const channelCards: { id: CommChannel; provider: string; secretNames: string[]; fieldLabel: string; placeholder: string }[] = [
    { id: 'email', provider: 'Postmark', secretNames: ['POSTMARK_SERVER_TOKEN'], fieldLabel: 'From address', placeholder: 'Platform <noreply@example.com>' },
    { id: 'sms', provider: 'Twilio', secretNames: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER'], fieldLabel: 'Sender number', placeholder: '+254700000000' },
    { id: 'whatsapp', provider: 'WhatsApp Cloud', secretNames: ['META_WHATSAPP_ACCESS_TOKEN', 'META_WHATSAPP_PHONE_NUMBER_ID', 'META_GRAPH_API_VERSION'], fieldLabel: 'Business number', placeholder: '+254700000000' },
  ];

  return <>
    <PageHeading eyebrow="Owner communications" title="Messages & delivery" subtitle="Configure owner-plane delivery channels, send a direct message, and review privacy-safe provider results." />
    {notice && <div role="status" className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</div>}
    {failure && <div role="alert" className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{failure}</div>}
    <div className="grid gap-4 xl:grid-cols-3">
      {channelCards.map(card => { const config = configs[card.id]; return <section key={card.id} className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex items-start justify-between"><div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-700">{card.id === 'email' ? <Mail size={19} /> : <MessageIcon channel={card.id} />}</div><div><h2 className="font-semibold">{pretty(card.id)}</h2><p className="text-xs text-slate-500">{card.provider}</p></div></div><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${config.is_enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{config.is_enabled ? 'Enabled' : 'Disabled'}</span></div>
        <div className="mt-4 space-y-3">
          <label className="block text-xs font-medium text-slate-600">{card.fieldLabel}<input value={config.sender_address} onChange={e => patchConfig(card.id, 'sender_address', e.target.value)} disabled={!canConfigure} placeholder={card.placeholder} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 disabled:bg-slate-50" /></label>
          {card.id === 'email' && <label className="block text-xs font-medium text-slate-600">Reply-to address<input value={config.reply_to} onChange={e => patchConfig(card.id, 'reply_to', e.target.value)} disabled={!canConfigure} placeholder="support@example.com" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 disabled:bg-slate-50" /></label>}
          <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs font-semibold text-slate-700">Server secrets</p><p className="mt-1 break-words font-mono text-[10px] leading-5 text-slate-500">{card.secretNames.join(' · ')}</p><p className="mt-1 text-xs text-slate-500">Set these in the owner Supabase Edge Function secrets. They are never stored in the browser or database.</p></div>
          {canConfigure && <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={config.is_enabled} onChange={e => patchConfig(card.id, 'is_enabled', e.target.checked)} className="rounded border-slate-300" />Enable this channel</label>}
          {canConfigure && <button onClick={() => void saveConfig(card.id)} disabled={saving === card.id} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50">{saving === card.id ? 'Saving…' : 'Save channel settings'}</button>}
        </div>
      </section>; })}
    </div>

    <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
      <form onSubmit={sendMessage} className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex items-center gap-2"><Send size={18} className="text-blue-700" /><h2 className="font-semibold">Send a direct message</h2></div>
        <p className="mt-1 text-sm text-slate-500">Owner-plane, one-recipient notifications only. No marketing or bulk sends.</p>
        <label className="mt-4 block text-sm font-medium">Channel<select value={channel} onChange={e => setChannel(e.target.value as CommChannel)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"><option value="email">Email</option><option value="sms">SMS</option><option value="whatsapp">WhatsApp direct</option></select></label>
        <label className="mt-3 block text-sm font-medium">Recipient<input required type={channel === 'email' ? 'email' : 'tel'} value={recipient} onChange={e => setRecipient(e.target.value)} placeholder={channel === 'email' ? 'name@example.com' : '+254700000000'} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
        {channel === 'email' && <label className="mt-3 block text-sm font-medium">Subject<input required maxLength={160} value={subject} onChange={e => setSubject(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>}
        <label className="mt-3 block text-sm font-medium">Message<textarea required maxLength={2000} rows={5} value={message} onChange={e => setMessage(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
        {channel === 'whatsapp' && <p className="mt-2 rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-900">WhatsApp free-form messages are subject to the platform's conversation window and policy. Use an approved template when required.</p>}
        <button disabled={busy || !configs[channel].is_enabled} className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Sending…' : <><Send size={15} /> Send message</>}</button>
        {!configs[channel].is_enabled && <p className="mt-2 text-center text-xs text-slate-500">Enable and configure this channel first.</p>}
      </form>

      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 p-5"><h2 className="font-semibold">Recent delivery activity</h2><p className="mt-1 text-xs text-slate-500">Only channel, provider, status, and a recipient hash are retained. Message bodies and addresses are not logged.</p></div>
        {logs.length ? <div className="overflow-x-auto"><table className="w-full min-w-[580px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{['Channel', 'Provider', 'Status', 'Result', 'Time'].map(label => <th key={label} className="px-4 py-3">{label}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{logs.map(row => <tr key={row.id}><td className="px-4 py-3">{pretty(row.channel)}</td><td className="px-4 py-3 text-slate-600">{pretty(row.provider)}</td><td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs ${row.status === 'accepted' ? 'bg-emerald-50 text-emerald-700' : row.status === 'failed' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'}`}>{pretty(row.status)}</span></td><td className="px-4 py-3 text-xs text-slate-500">{row.error_code || '—'}</td><td className="px-4 py-3 text-xs text-slate-500">{new Date(row.created_at).toLocaleString()}</td></tr>)}</tbody></table></div> : <Empty title="No messages yet" text="Successful and failed sends will appear here without storing message bodies or recipient addresses." />}
      </section>
    </div>
  </>;
}

function MessageIcon({ channel }: { channel: 'sms' | 'whatsapp' }) { return channel === 'sms' ? <MessageSquareText size={19} /> : <MessageCircle size={19} />; }

function Audit({ rows }: { rows: FeedRow[] }) { return <><PageHeading eyebrow="Security & accountability" title="Owner audit log" subtitle="Append-only, hash-chained record of owner-plane actions." /><div className="mb-5 flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900"><ShieldCheck size={19} className="mt-0.5 shrink-0" /><p>Audit records are generated by database triggers and cannot be changed or deleted by owner staff. The hash chain can be verified by the owner database function.</p></div><div className="rounded-xl border border-slate-200 bg-white">{rows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{['Actor', 'Action', 'Target', 'Time', 'Record hash'].map(h => <th key={h} className="px-4 py-3">{h}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{rows.map(row => <tr key={row.id}><td className="px-4 py-3">{String(row.actor_email || row.actor_id || 'System')}</td><td className="px-4 py-3 font-medium">{String(row.action || row.action_type || 'Owner action')}</td><td className="px-4 py-3 text-slate-500">{String(row.target_type || row.target_id || '—')}</td><td className="px-4 py-3 text-slate-500">{new Date(row.created_at).toLocaleString()}</td><td className="px-4 py-3 font-mono text-xs text-slate-500">{String(row.record_hash || '—').slice(0, 20)}…</td></tr>)}</tbody></table></div> : <Empty title="No owner actions recorded" text="Tenant registration and subsequent owner control-plane activity will be written here." />}</div></>; }

function TenantModal({ form, setForm, onClose, onSubmit, busy }: { form: { name: string; slug: string; plan: string; region: string; primary_contact: string; contact_email: string; isolation_level: string }; setForm: (v: { name: string; slug: string; plan: string; region: string; primary_contact: string; contact_email: string; isolation_level: string }) => void; onClose: () => void; onSubmit: (e: FormEvent) => void; busy: boolean }) { const update = (key: keyof typeof form, value: string) => setForm({ ...form, [key]: value, ...(key === 'name' && !form.slug ? { slug: value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') } : {}) }); return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"><form onSubmit={onSubmit} className="max-h-[95vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl"><div className="flex items-start justify-between border-b border-slate-100 p-5"><div><h2 className="text-lg font-bold">Register tenant environment</h2><p className="mt-1 text-sm text-slate-500">Environment metadata only. Tenant admins own business setup.</p></div><button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100" aria-label="Close"><X size={19} /></button></div><div className="grid gap-4 p-5 sm:grid-cols-2">{([['name', 'Company name'], ['slug', 'Tenant slug'], ['primary_contact', 'Primary contact'], ['contact_email', 'Contact email']] as [keyof typeof form, string][]).map(([key, label]) => <label key={key} className="text-sm font-medium">{label}<input required={key === 'name' || key === 'slug'} type={key === 'contact_email' ? 'email' : 'text'} value={form[key]} onChange={e => update(key, e.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-blue-500" /></label>)}<label className="text-sm font-medium">Plan<select value={form.plan} onChange={e => update('plan', e.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2"><option value="starter">Starter</option><option value="growth">Growth</option><option value="enterprise">Enterprise</option></select></label><label className="text-sm font-medium">Region<select value={form.region} onChange={e => update('region', e.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2"><option value="africa-east">Africa East</option><option value="africa-south">Africa South</option><option value="eu-west">Europe West</option><option value="us-east">US East</option></select></label><label className="text-sm font-medium sm:col-span-2">Isolation model<select value={form.isolation_level} onChange={e => update('isolation_level', e.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2"><option value="database_per_tenant">Dedicated database per tenant</option><option value="schema_per_tenant">Dedicated schema per tenant</option></select></label><div className="sm:col-span-2 rounded-lg bg-blue-50 p-3 text-xs leading-5 text-blue-900">This queues an auditable provisioning job. It does not create the database or user until a trusted provisioning service is connected. No product catalog, pricing, or staff data is entered here.</div></div><div className="flex justify-end gap-2 border-t border-slate-100 p-5"><button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm">Cancel</button><button disabled={busy} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{busy ? 'Registering…' : <><Check size={16} /> Create tenant record</>}</button></div></form></div>; }
