import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  Activity, AlertTriangle, ArrowUpRight, BadgeCheck, Building2, Check, ChevronRight,
  CalendarDays, CircleHelp, ClipboardList, CreditCard, Database, FileClock, GraduationCap, Inbox, LayoutDashboard, Mail,
  LifeBuoy, LockKeyhole, LogOut, Menu, MessageCircle, MessageSquareText, Plus, RefreshCw,
  Search, Send, Settings2, ShieldCheck, Signal, Users, X,
} from 'lucide-react';
import { ownerSupabase } from '@/lib/ownerSupabase';
import { getTimeGreeting, useCurrentTime } from '@/hooks/useCurrentTime';
import { AlertsPage, BillingPage, MeetingsPage, OwnerTenant, SupportDesk, TenantInboxPage, TrainingPage } from '@/owner/OwnerOperations';

type Page = 'overview' | 'tenants' | 'onboarding' | 'analytics' | 'anomalies' | 'training' | 'meetings' | 'support' | 'inbox' | 'billing' | 'platform' | 'communications' | 'audit';
type Tenant = { id: string; name: string; slug: string; plan: string; region: string; status: string; isolation_level: string; primary_contact: string | null; contact_email: string | null; provisioning_step?: string; supabase_project_ref?: string | null; created_at: string };
type TenantEdit = { name: string; plan: string; region: string; primary_contact: string; contact_email: string; status: string };
type PackageOption = { plan_key: string; display_name: string; amount: number | null; currency: string; billing_interval: string; is_active: boolean };
type FeedRow = { id: string; tenant_id?: string | null; title?: string; summary?: string | null; status?: string; severity?: string; created_at: string; name?: string; kind?: string; state?: string; [key: string]: unknown };
type OwnerRole = 'platform_admin' | 'provisioner' | 'support' | 'analyst' | 'auditor';
type MfaPreparation = { factorId: string; secret: string; error: string };

const localMfaBypass = import.meta.env.DEV
  && import.meta.env.VITE_OWNER_LOCAL_MFA_BYPASS === 'true'
  && ['localhost', '127.0.0.1'].includes(window.location.hostname);

const navigation: { id: Page; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'tenants', label: 'Tenants', icon: Building2 },
  { id: 'onboarding', label: 'Onboarding', icon: ClipboardList },
  { id: 'analytics', label: 'Analytics', icon: Activity },
  { id: 'anomalies', label: 'Anomalies', icon: AlertTriangle },
  { id: 'training', label: 'Training', icon: GraduationCap },
  { id: 'meetings', label: 'Meetings', icon: CalendarDays },
  { id: 'support', label: 'Support', icon: LifeBuoy },
  { id: 'inbox', label: 'Tenant inbox', icon: Inbox },
  { id: 'billing', label: 'Billing', icon: CreditCard },
  { id: 'platform', label: 'Platform', icon: Settings2 },
  { id: 'communications', label: 'Communications', icon: Mail },
  { id: 'audit', label: 'Owner audit', icon: FileClock },
];

const pretty = (value?: string | null) => (value || 'unknown').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
const tenantIsProvisioned = (tenant: Tenant) => tenant.status === 'active' && Boolean(tenant.supabase_project_ref);
const dateLabel = (value?: string) => value ? new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const packageLabel = (item: PackageOption) => `${item.display_name} · ${item.amount == null ? 'Price not set' : `${item.currency} ${Number(item.amount).toLocaleString('en-KE')}`}/${item.billing_interval}`;
const packageSizeOrder: Record<string, number> = { starter: 0, growth: 1, enterprise: 2 };

export function OwnerConsole() {
  const currentTime = useCurrentTime();
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
  const [mfaRetry, setMfaRetry] = useState(0);
  const mfaPreparationRef = useRef<{ key: string; promise: Promise<MfaPreparation> } | null>(null);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState<Page>(() => (window.location.hash.slice(2) as Page) || 'overview');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [packages, setPackages] = useState<PackageOption[]>([
    { plan_key: 'starter', display_name: 'Small Business', amount: 20000, currency: 'KES', billing_interval: 'monthly', is_active: true },
    { plan_key: 'growth', display_name: 'Medium Business', amount: 35000, currency: 'KES', billing_interval: 'monthly', is_active: true },
    { plan_key: 'enterprise', display_name: 'Large Business', amount: 40000, currency: 'KES', billing_interval: 'monthly', is_active: true },
  ]);
  const [feed, setFeed] = useState<FeedRow[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null);
  const [tenantEditForm, setTenantEditForm] = useState<TenantEdit>({ name: '', plan: 'starter', region: 'africa-east', primary_contact: '', contact_email: '', status: 'pending' });
  const [managementCheck, setManagementCheck] = useState<{ loading: boolean; message: string; ok: boolean | null }>({ loading: false, message: '', ok: null });
  const [showProvision, setShowProvision] = useState<Tenant | null>(null);
  const [adminEmail, setAdminEmail] = useState('');
  const [provisioningTenantId, setProvisioningTenantId] = useState('');
  const [provisioningMessage, setProvisioningMessage] = useState('');
  const [provisioningError, setProvisioningError] = useState('');
  const [successNotice, setSuccessNotice] = useState('');
  const [form, setForm] = useState({ name: '', slug: '', plan: packages.find(item => item.is_active)?.plan_key || 'starter', region: 'africa-east', primary_contact: '', contact_email: '', isolation_level: 'shared_database' });

  useEffect(() => {
    const firstActive = packages.find(item => item.is_active);
    if (firstActive && !packages.some(item => item.is_active && item.plan_key === form.plan)) {
      setForm(current => ({ ...current, plan: firstActive.plan_key }));
    }
  }, [packages, form.plan]);

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

  const sessionUserId = session?.user.id;
  useEffect(() => {
    let active = true;
    const client = ownerSupabase;
    if (!sessionUserId || !client || localMfaBypass) {
      mfaPreparationRef.current = null;
      setMfaChecking(false);
      setMfaError('');
      setMfaFactor('');
      setEnrollmentSecret('');
      return;
    }
    setMfaChecking(true);
    setMfaError('');
    setMfaFactor('');
    setEnrollmentSecret('');
    const key = `${sessionUserId}:${mfaRetry}`;
    if (mfaPreparationRef.current?.key !== key) {
      const promise = (async (): Promise<MfaPreparation> => {
        try {
          const [assuranceResult, factorResult] = await Promise.all([
            client.auth.mfa.getAuthenticatorAssuranceLevel(),
            client.auth.mfa.listFactors(),
          ]);
          if (assuranceResult.error) throw assuranceResult.error;
          if (factorResult.error) throw factorResult.error;

          if (assuranceResult.data?.currentLevel === 'aal2') return { factorId: '', secret: '', error: '' };
          const verifiedFactor = factorResult.data?.totp.find(item => item.status === 'verified');
          if (verifiedFactor) return { factorId: verifiedFactor.id, secret: '', error: '' };

          // Supabase's `totp` list contains verified factors only; pending enrollments
          // are exposed in `all`. Remove them so a previous setup cannot block a retry
          // with the duplicate friendly-name error.
          const unfinishedFactors = factorResult.data?.all.filter(
            item => item.factor_type === 'totp' && item.status === 'unverified',
          ) || [];
          for (const factor of unfinishedFactors) {
            const { error: cleanupError } = await client.auth.mfa.unenroll({ factorId: factor.id });
            if (cleanupError) throw cleanupError;
          }

          const { data: enrollment, error: enrollError } = await client.auth.mfa.enroll({
            factorType: 'totp', issuer: 'Hardware Platform Owner', friendlyName: 'Owner console authenticator',
          });
          if (enrollError) throw enrollError;
          if (!enrollment?.totp?.secret) throw new Error('Supabase did not return an authenticator setup key. Retry the setup.');
          return { factorId: enrollment.id, secret: enrollment.totp.secret, error: '' };
        } catch (error) {
          return {
            factorId: '', secret: '',
            error: error instanceof Error ? error.message : 'Could not reach owner authentication. Check your connection and retry.',
          };
        }
      })();
      mfaPreparationRef.current = { key, promise };
    }
    void mfaPreparationRef.current.promise.then(result => {
      if (!active) return;
      setMfaFactor(result.factorId);
      setEnrollmentSecret(result.secret);
      setMfaError(result.error);
    }).finally(() => {
      if (active) setMfaChecking(false);
    });
    return () => { active = false; };
  }, [sessionUserId, mfaRetry]);

  const loadData = useCallback(async () => {
    if (!ownerSupabase || !session || !role) return;
    setLoadingData(true); setError('');
    const [tenantResult, activityResult, packageResult] = await Promise.all([
      ownerSupabase.from('tenants').select('id,name,slug,plan,region,status,isolation_level,primary_contact,contact_email,provisioning_step,supabase_project_ref,created_at').order('created_at', { ascending: false }).limit(250),
      ownerSupabase.from(page === 'audit' ? 'owner_audit_log' : page === 'anomalies' ? 'platform_alerts' : page === 'support' ? 'support_tickets' : page === 'training' ? 'training_enrollments' : page === 'platform' || page === 'onboarding' ? 'provisioning_jobs' : 'tenant_metrics')
        .select(page === 'platform' || page === 'onboarding' ? 'id,tenant_id,status,current_step,step_index,error_code,attempts,created_at,started_at,completed_at' : '*')
        .order('created_at', { ascending: false }).limit(12),
      ownerSupabase.from('billing_plans').select('plan_key,display_name,amount,currency,billing_interval,is_active').order('business_size'),
    ]);
    if (!tenantResult.error) setTenants((tenantResult.data || []) as Tenant[]);
    if (!packageResult.error && packageResult.data) setPackages([...(packageResult.data as PackageOption[])].sort((a, b) => (packageSizeOrder[a.plan_key] ?? 9) - (packageSizeOrder[b.plan_key] ?? 9)));
    if (!activityResult.error) setFeed((activityResult.data || []) as unknown as FeedRow[]);
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
    setShowCreate(false); setForm({ name: '', slug: '', plan: packages.find(item => item.is_active)?.plan_key || 'starter', region: 'africa-east', primary_contact: '', contact_email: '', isolation_level: 'shared_database' });
    await loadData();
  };
  const saveTenantEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ownerSupabase || !editingTenant) return;
    setBusy(true); setError('');
    const { error: updateError } = await ownerSupabase.rpc('owner_update_tenant', {
      p_tenant_id: editingTenant.id,
      p_name: tenantEditForm.name.trim(),
      p_plan: tenantEditForm.plan,
      p_region: tenantEditForm.region,
      p_primary_contact: tenantEditForm.primary_contact.trim() || null,
      p_contact_email: tenantEditForm.contact_email.trim() || null,
      p_status: tenantEditForm.status,
    });
    setBusy(false);
    if (updateError) { setError(updateError.message); return; }
    setEditingTenant(null);
    setSuccessNotice(`${tenantEditForm.name.trim()} was updated.`);
    await loadData();
  };
  const checkManagementConnection = async () => {
    if (!ownerSupabase) return;
    setManagementCheck({ loading: true, message: '', ok: null });
    const { data, error: invokeError } = await ownerSupabase.functions.invoke('owner-provisioning', { body: { action: 'check' } });
    const message = invokeError?.message || data?.detail || data?.error || 'Connection check completed.';
    setManagementCheck({ loading: false, message, ok: !invokeError && data?.status === 'connected' });
  };

  const prepareProvisioning = (tenant: Tenant) => {
    setError('');
    setProvisioningMessage('');
    setProvisioningError('');
    setAdminEmail(tenant.contact_email || '');
    setShowProvision(tenant);
  };

  const startProvisioning = async (event: FormEvent) => {
    event.preventDefault();
    if (!ownerSupabase || !showProvision) return;
    const tenant = showProvision;
    const email = adminEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setProvisioningError('Enter a valid first tenant administrator email.'); return; }

    setProvisioningTenantId(tenant.id);
    setError(''); setProvisioningError(''); setSuccessNotice('');
    setProvisioningMessage('Checking the tenant job and Supabase organization…');
    const formatFailure = (payload: unknown, fallback: string) => {
      if (!payload || typeof payload !== 'object') return fallback;
      const detail = payload as Record<string, unknown>;
      const parts = [typeof detail.error === 'string' ? detail.error : fallback];
      if (typeof detail.step === 'string') parts.push(`Step: ${detail.step.replace(/_/g, ' ')}`);
      if (typeof detail.code === 'string') parts.push(`Code: ${detail.code}`);
      return parts.join(' · ');
    };
    try {
      if (email !== tenant.contact_email) {
        const { error: emailError } = await ownerSupabase.rpc('owner_set_tenant_admin_email', {
          p_tenant_id: tenant.id, p_email: email,
        });
        if (emailError) throw new Error(emailError.message);
      }

      for (let attempt = 0; attempt < 180; attempt += 1) {
        const { data, error: invokeError } = await ownerSupabase.functions.invoke('owner-provisioning', {
          body: { action: 'advance', tenantId: tenant.id },
        });
        if (invokeError) {
          let detail = invokeError.message;
          const response = (invokeError as unknown as { context?: Response }).context;
          if (response) {
            try { detail = formatFailure(await response.clone().json(), detail); }
            catch { /* retain the Functions client's message */ }
          }
          throw new Error(detail);
        }
        if (data?.error) throw new Error(formatFailure(data, String(data.error)));
        if (data?.complete) {
          const url = data.tenantUrl || `${window.location.origin}/t/${tenant.slug}`;
          setProvisioningMessage('Shared tenant workspace, catalogue access and administrator invite are ready.');
          setSuccessNotice(`${tenant.name} is active. Tenant access: ${url}`);
          setShowProvision(null);
          await loadData();
          return;
        }
        setProvisioningMessage(data?.message || `Tenant setup is at ${String(data?.step || 'the next step').replace(/_/g, ' ')}.`);
        const waitSeconds = Number(data?.waitSeconds || (data?.busy ? 5 : 0));
        if (waitSeconds > 0) await new Promise(resolve => window.setTimeout(resolve, Math.min(waitSeconds, 30) * 1000));
      }
      setProvisioningMessage('Provisioning is still in progress. Close this window and choose Resume when it is ready.');
      await loadData();
    } catch (provisionError) {
      const detail = provisionError instanceof Error ? provisionError.message : 'Tenant provisioning failed unexpectedly.';
      setProvisioningMessage('');
      setProvisioningError(`${detail} You can retry; provisioning resumes from its last saved step.`);
      setError(detail);
      await loadData();
    } finally {
      setProvisioningTenantId('');
    }
  };

  const filteredTenants = useMemo(() => tenants.filter(t => `${t.name} ${t.slug} ${t.plan} ${t.region} ${t.status}`.toLowerCase().includes(search.toLowerCase())), [tenants, search]);
  const activeCount = tenants.filter(tenantIsProvisioned).length;
  const onboardingCount = tenants.filter(t => !tenantIsProvisioned(t) && ['pending', 'provisioning', 'training', 'trial', 'active'].includes(t.status)).length;

  if (authLoading) return <Loading />;
  if (!ownerSupabase) return <ConfigurationNotice />;
  if (session && !localMfaBypass && mfaChecking) return <Loading />;
  if (session && !localMfaBypass && enrollmentSecret) return <MfaEnrollment secret={enrollmentSecret} code={mfaCode} setCode={setMfaCode} onSubmit={verifyMfa} busy={busy} error={mfaError} />;
  if (session && !localMfaBypass && mfaFactor) return <MfaChallenge code={mfaCode} setCode={setMfaCode} onSubmit={verifyMfa} busy={busy} error={mfaError} />;
  if (session && !localMfaBypass && mfaError) return <MfaSetupError error={mfaError} onRetry={() => setMfaRetry(value => value + 1)} onSignOut={() => void ownerSupabase!.auth.signOut()} />;
  if (!session) return <SignIn email={email} password={password} setEmail={setEmail} setPassword={setPassword} onSubmit={signIn} busy={busy} error={accessError} />;
  if (!role) return <AccessDenied email={session.user.email || ''} error={accessError} signOut={() => ownerSupabase!.auth.signOut()} />;

  const canProvision = role === 'platform_admin' || role === 'provisioner';
  const title = navigation.find(item => item.id === page)?.label || 'Overview';

  return (
    <div className="min-h-screen bg-ink-50 text-ink-900">
      {sidebarOpen && <button aria-label="Close menu" className="fixed inset-0 z-30 bg-ink-900/50 lg:hidden" onClick={() => setSidebarOpen(false)} />}
      <aside className={`fixed inset-y-0 left-0 z-40 w-64 -translate-x-full bg-ink-900 transition-transform lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : ''}`}>
        <div className="flex h-full flex-col">
          <div className="flex items-center gap-3 border-b border-ink-800 px-5 py-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-500"><ShieldCheck size={21} className="text-white" /></div>
            <div><p className="font-display text-sm font-semibold tracking-tight text-white">Platform Owner</p><p className="text-xs text-ink-400">Control plane</p></div>
          </div>
          <div className="mx-3 mt-4 rounded-lg border border-ink-700 bg-ink-800/50 px-3 py-2"><p className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">Access role</p><p className="mt-0.5 text-xs font-medium text-accent-300">{pretty(role)}</p></div>
          <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
            {navigation.map(item => { const Icon = item.icon; return <button key={item.id} onClick={() => navigate(item.id)} className={`flex w-full items-center gap-3 rounded-sm px-3 py-2.5 text-sm font-medium transition ${page === item.id ? 'bg-accent-500 text-white shadow-xs ' : 'text-ink-400 hover:bg-ink-800 hover:text-white'}`}><Icon size={18} />{item.label}</button>; })}
          </nav>
          <div className="border-t border-ink-800 p-3"><div className="mb-2 flex items-center gap-3 px-2 py-2"><div className="flex h-9 w-9 items-center justify-center rounded-full bg-ink-700 text-sm font-semibold text-white">{session.user.email?.charAt(0).toUpperCase()}</div><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-white">{session.user.email}</p><p className="text-xs text-ink-500">Owner staff</p></div></div><button onClick={() => ownerSupabase!.auth.signOut()} className="flex w-full items-center gap-3 rounded-sm px-3 py-2.5 text-sm text-ink-400 hover:bg-ink-800 hover:text-white"><LogOut size={17} />Sign out</button></div>
        </div>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-ink-200 bg-paper/90 px-4 backdrop-blur-md lg:px-8">
          <div className="flex items-center gap-3"><button className="text-ink-600 lg:hidden" onClick={() => setSidebarOpen(true)} aria-label="Open menu"><Menu size={22} /></button><div><p className="text-sm font-semibold text-ink-900">{title}</p><p className="hidden text-xs text-ink-500 sm:block" data-numeric>{currentTime.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p></div></div>
          <div className="flex items-center gap-2"><span className="hidden items-center gap-1.5 rounded-full bg-accent-50 px-2.5 py-1 text-xs font-medium text-accent-700 sm:flex"><span className="h-1.5 w-1.5 rounded-full bg-accent-500" />Owner plane</span><button onClick={() => void loadData()} className="rounded-sm p-2 text-ink-500 hover:bg-ink-100" title="Refresh"><RefreshCw size={17} className={loadingData ? 'animate-spin' : ''} /></button></div>
        </header>
        <main className="p-4 lg:p-8">
          {error && <div className="mb-5 flex items-start gap-2 rounded-md border border-danger/20 bg-danger/10 p-3 text-sm text-danger"><AlertTriangle size={17} className="mt-0.5 shrink-0" /><span>{error}</span><button className="ml-auto" aria-label="Dismiss error" onClick={() => setError('')}><X size={16} /></button></div>}
          {successNotice && <div role="status" className="mb-5 flex items-start gap-2 rounded-md border border-accent-100 bg-accent-50 p-3 text-sm text-accent-900"><BadgeCheck size={17} className="mt-0.5 shrink-0" /><span>{successNotice}</span><button className="ml-auto" aria-label="Dismiss notice" onClick={() => setSuccessNotice('')}><X size={16} /></button></div>}
          {page === 'overview' && <Overview tenants={tenants} activeCount={activeCount} onboardingCount={onboardingCount} feed={feed} loading={loadingData} navigate={navigate} />}
          {page === 'tenants' && <Tenants tenants={filteredTenants} search={search} setSearch={setSearch} onCreate={() => setShowCreate(true)} onEdit={tenant => { setEditingTenant(tenant); setTenantEditForm({ name: tenant.name, plan: tenant.plan, region: tenant.region, primary_contact: tenant.primary_contact || '', contact_email: tenant.contact_email || '', status: tenant.status }); }} onProvision={prepareProvisioning} canProvision={canProvision} busyTenantId={provisioningTenantId} />}
          {page === 'onboarding' && <Onboarding tenants={tenants} jobs={feed} onCreate={() => setShowCreate(true)} onProvision={prepareProvisioning} canProvision={canProvision} busyTenantId={provisioningTenantId} />}
          {page === 'analytics' && <Analytics tenants={tenants} rows={feed} />}
          {page === 'anomalies' && <AlertsPage rows={feed} role={role} />}
          {page === 'training' && <TrainingPage tenants={tenants as OwnerTenant[]} rows={feed} role={role} />}
          {page === 'meetings' && <MeetingsPage tenants={tenants as OwnerTenant[]} role={role} />}
          {page === 'support' && <SupportDesk tenants={tenants as OwnerTenant[]} rows={feed} role={role} />}
          {page === 'inbox' && <TenantInboxPage tenants={tenants as OwnerTenant[]} role={role} />}
          {page === 'billing' && <BillingPage tenants={tenants as OwnerTenant[]} role={role} />}
          {page === 'platform' && <Platform jobs={feed} tenants={tenants} managementCheck={managementCheck} onCheckManagement={checkManagementConnection} />}
          {page === 'communications' && <Communications role={role} />}
          {page === 'audit' && <Audit rows={feed} />}
          <div className="mt-8 flex items-start gap-2 rounded-md border border-ink-100 bg-paper px-4 py-3 text-xs leading-5 text-ink-500"><LockKeyhole size={15} className="mt-0.5 shrink-0 text-ink-400" /><p>Owner plane displays tenant metadata and aggregated telemetry only. Tenant product, price, staff, and transaction records stay in the tenant environment. Business-data access is not exposed from this console.</p></div>
        </main>
      </div>

      {showCreate && <TenantModal packages={packages.filter(item => item.is_active)} form={form} setForm={setForm} onClose={() => setShowCreate(false)} onSubmit={createTenant} busy={busy} />}
      {editingTenant && <TenantEditModal tenant={editingTenant} packages={packages} form={tenantEditForm} setForm={setTenantEditForm} onClose={() => setEditingTenant(null)} onSubmit={saveTenantEdit} busy={busy} />}
      {showProvision && <ProvisionTenantModal tenant={showProvision} email={adminEmail} setEmail={setAdminEmail} message={provisioningMessage} error={provisioningError} onClearError={() => setProvisioningError('')} onClose={() => { if (!provisioningTenantId) setShowProvision(null); }} onSubmit={startProvisioning} busy={provisioningTenantId === showProvision.id} />}
    </div>
  );
}

function Loading() { return <div className="flex min-h-screen items-center justify-center bg-ink-50"><div className="h-10 w-10 animate-spin rounded-full border-b-2 border-accent-500" /></div>; }
function ConfigurationNotice() { return <div className="flex min-h-screen items-center justify-center bg-ink-50 p-5"><div className="max-w-xl rounded-md border border-ink-100 bg-paper p-8 shadow-xs"><div className="mb-4 flex h-12 w-12 items-center justify-center rounded-md bg-ink-900 text-white"><Database size={22} /></div><h1 className="text-xl font-semibold font-display">Owner plane is not configured</h1><p className="mt-2 text-sm leading-6 text-ink-600">Configure <code className="rounded bg-ink-100 px-1">VITE_OWNER_SUPABASE_URL</code> and <code className="rounded bg-ink-100 px-1">VITE_OWNER_SUPABASE_ANON_KEY</code> for a dedicated owner Supabase project. This console will not connect to the tenant database as a fallback.</p><p className="mt-4 text-xs text-ink-500">Apply the migrations in <code>supabase-owner/migrations</code> before enabling owner staff sign-in.</p></div></div>; }
function SignIn({ email, password, setEmail, setPassword, onSubmit, busy, error }: { email: string; password: string; setEmail: (v: string) => void; setPassword: (v: string) => void; onSubmit: (e: FormEvent) => void; busy: boolean; error: string }) { return <div className="flex min-h-screen items-center justify-center bg-ink-50 p-5"><form onSubmit={onSubmit} className="w-full max-w-md rounded-md border border-ink-100 bg-paper p-8 shadow-xs"><div className="mb-6 flex h-12 w-12 items-center justify-center rounded-md bg-ink-900 text-white"><ShieldCheck size={23} /></div><p className="text-xs font-semibold uppercase tracking-wider text-accent-700">Platform operations</p><h1 className="mt-2 text-2xl font-semibold font-display">Owner sign in</h1><p className="mt-2 text-sm text-ink-500">Use your separately provisioned platform staff identity.</p>{error && <p role="alert" className="mt-4 rounded-lg bg-danger/10 p-3 text-sm text-danger">{error}</p>}<label className="mt-6 block text-sm font-medium">Email<input required type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} className="mt-1.5 w-full rounded-sm border px-3 py-2.5 outline-none focus:ring-2 focus:ring-accent-100 h-10 border-ink-200 bg-paper focus:border-accent-500" /></label><label className="mt-4 block text-sm font-medium">Password<input required type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} className="mt-1.5 w-full rounded-sm border px-3 py-2.5 outline-none focus:ring-2 focus:ring-accent-100 h-10 border-ink-200 bg-paper focus:border-accent-500" /></label><button disabled={busy} className="mt-6 w-full rounded-sm bg-accent-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-700 disabled:opacity-60">{busy ? 'Signing in…' : 'Sign in securely'}</button><p className="mt-4 flex items-center justify-center gap-1 text-xs text-ink-500"><LockKeyhole size={13} /> Owner identity is separate from tenant accounts</p></form></div>; }
function MfaChallenge({ code, setCode, onSubmit, busy, error }: { code: string; setCode: (v: string) => void; onSubmit: (e: FormEvent) => void; busy: boolean; error: string }) { return <div className="flex min-h-screen items-center justify-center bg-ink-50 p-5"><form onSubmit={onSubmit} className="w-full max-w-md rounded-md border border-ink-100 bg-paper p-8 shadow-xs"><div className="flex h-12 w-12 items-center justify-center rounded-md bg-accent-50 text-accent-700"><LockKeyhole size={22} /></div><h1 className="mt-4 text-xl font-semibold font-display">Verify your identity</h1><p className="mt-2 text-sm text-ink-500">Enter the current code from your enrolled authenticator app. Owner data stays locked until MFA succeeds.</p>{error && <p role="alert" className="mt-4 rounded-lg bg-danger/10 p-3 text-sm text-danger">{error}</p>}<label className="mt-5 block text-sm font-medium">Authenticator code<input required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} className="mt-1.5 w-full rounded-sm border px-3 py-2.5 text-center text-xl tracking-[0.4em] outline-none h-10 border-ink-200 bg-paper focus:border-accent-500" /></label><button disabled={busy || code.length !== 6} className="mt-5 w-full rounded-sm bg-accent-500 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">{busy ? 'Verifying…' : 'Verify and continue'}</button></form></div>; }

function MfaSetupError({ error, onRetry, onSignOut }: { error: string; onRetry: () => void; onSignOut: () => void }) {
  return <div className="flex min-h-screen items-center justify-center bg-ink-50 p-5"><div className="w-full max-w-md rounded-md border border-ink-100 bg-paper p-8 shadow-xs">
    <div className="flex h-12 w-12 items-center justify-center rounded-md bg-warning/10 text-warning"><AlertTriangle size={22} /></div>
    <h1 className="mt-4 text-xl font-semibold font-display">Authenticator setup could not start</h1>
    <p className="mt-2 text-sm leading-6 text-ink-600">Your sign-in is still active. Retry to request a fresh authenticator key.</p>
    <p role="alert" className="mt-4 break-words rounded-lg bg-danger/10 p-3 text-sm text-danger">{error}</p>
    <button type="button" onClick={onRetry} className="mt-5 w-full rounded-sm bg-accent-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-700">Retry setup</button>
    <button type="button" onClick={onSignOut} className="mt-3 w-full rounded-sm border border-ink-300 px-4 py-2.5 text-sm font-medium text-ink-700 hover:bg-ink-50">Sign out</button>
  </div></div>;
}

function MfaEnrollment({ secret, code, setCode, onSubmit, busy, error }: { secret: string; code: string; setCode: (v: string) => void; onSubmit: (e: FormEvent) => void; busy: boolean; error: string }) {
  return <div className="flex min-h-screen items-center justify-center bg-ink-50 p-5"><form onSubmit={onSubmit} className="w-full max-w-lg rounded-md border border-ink-100 bg-paper p-8 shadow-xs">
    <div className="flex h-12 w-12 items-center justify-center rounded-md bg-accent-50 text-accent-700"><LockKeyhole size={22} /></div><p className="mt-5 text-xs font-semibold uppercase tracking-wider text-accent-700">One-time setup</p><h1 className="mt-1 text-2xl font-semibold font-display">Protect your owner account</h1>
    <p className="mt-2 text-sm leading-6 text-ink-600">Add this account to an authenticator app, then enter its six-digit code. Owner-console data remains locked until verification.</p>
    <label className="mt-5 block text-xs font-semibold text-ink-500">Authenticator setup key</label><code className="mt-1 block break-all rounded-lg bg-ink-100 p-3 font-mono text-sm text-ink-800">{secret}</code>
    {error && <p role="alert" className="mt-4 rounded-lg bg-danger/10 p-3 text-sm text-danger">{error}</p>}
    <label className="mt-5 block text-sm font-medium">Authenticator code<input required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} className="mt-1.5 w-full rounded-sm border px-3 py-2.5 text-center text-xl tracking-[0.4em] outline-none h-10 border-ink-200 bg-paper focus:border-accent-500" /></label>
    <button disabled={busy || code.length !== 6} className="mt-5 w-full rounded-sm bg-accent-500 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">{busy ? 'Verifying…' : 'Verify authenticator and continue'}</button>
  </form></div>;
}
function AccessDenied({ email, error, signOut }: { email: string; error: string; signOut: () => Promise<unknown> }) { return <div className="flex min-h-screen items-center justify-center bg-ink-50 p-5"><div className="max-w-md rounded-md border border-ink-100 bg-paper p-8 text-center shadow-xs"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-md bg-warning/10 text-warning"><LockKeyhole size={22} /></div><h1 className="mt-4 text-xl font-semibold font-display">Owner access is not enabled</h1><p className="mt-2 text-sm text-ink-600">Signed in as {email}. {error}</p><button onClick={() => void signOut()} className="mt-5 rounded-sm border border-ink-300 px-4 py-2 text-sm font-medium">Sign out</button></div></div>; }

function PageHeading({ eyebrow, title, subtitle, action }: { eyebrow?: string; title: string; subtitle: string; action?: React.ReactNode }) { const now = useCurrentTime(); const displayTitle = title === 'Good morning' ? getTimeGreeting(now) : title; return <div className="mb-6 flex flex-wrap items-end justify-between gap-4"><div>{eyebrow && <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-accent-700">{eyebrow}</p>}<h1 className="font-display text-2xl font-semibold tracking-tight text-ink-900">{displayTitle}</h1><p className="mt-1 text-sm text-ink-500">{subtitle}</p></div>{action}</div>; }
function Stat({ label, value, detail, icon: Icon, tone = 'blue' }: { label: string; value: string | number; detail: string; icon: typeof Users; tone?: string }) { const colors: Record<string, string> = { blue: 'bg-accent-50 text-accent-700', emerald: 'bg-accent-50 text-accent-700', amber: 'bg-warning/10 text-warning', slate: 'bg-ink-100 text-ink-700' }; return <div className="rounded-md border border-ink-100 bg-paper p-5 shadow-xs"><div className="flex items-start justify-between"><div><p className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</p><p className="mt-2 font-mono text-2xl font-medium tabular-nums text-ink-900" data-numeric>{value}</p></div><div className={`rounded-md p-2.5 ${colors[tone] || colors.blue}`}><Icon size={19} /></div></div><p className="mt-3 text-xs text-ink-500">{detail}</p></div>; }
function Overview({ tenants, activeCount, onboardingCount, feed, loading, navigate }: { tenants: Tenant[]; activeCount: number; onboardingCount: number; feed: FeedRow[]; loading: boolean; navigate: (p: Page) => void }) { const recent = tenants.slice(0, 5); return <><PageHeading eyebrow="Platform health" title="Good morning" subtitle="Cross-tenant operations at a glance. Aggregated metadata only." /><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Stat label="Total tenants" value={loading ? '—' : tenants.length} detail={`${activeCount} active environments`} icon={Building2} /><Stat label="In onboarding" value={loading ? '—' : onboardingCount} detail="Contracts, provisioning and training" icon={ClipboardList} tone="amber" /><Stat label="Active tenants" value={loading ? '—' : activeCount} detail="Go-live status from tenant registry" icon={BadgeCheck} tone="emerald" /><Stat label="Telemetry records" value={loading ? '—' : feed.length} detail="Recent aggregated signals available" icon={Signal} tone="slate" /></div><div className="mt-6 grid gap-5 xl:grid-cols-[1.4fr_1fr]"><section className="rounded-md border border-ink-100 bg-paper"><div className="flex items-center justify-between border-b border-ink-100 p-5"><div><h2 className="font-semibold font-display">Tenant environments</h2><p className="mt-1 text-xs text-ink-500">Provisioning state and operating status</p></div><button onClick={() => navigate('tenants')} className="flex items-center gap-1 text-sm font-medium text-accent-700">All tenants<ChevronRight size={16} /></button></div>{recent.length ? <div className="divide-y divide-ink-100">{recent.map(t => <TenantRow key={t.id} tenant={t} />)}</div> : <Empty title="No tenant environments yet" text="Create a tenant record after the business contract is signed." />}</section><section className="rounded-md border border-ink-100 bg-paper"><div className="border-b border-ink-100 p-5"><h2 className="font-semibold font-display">Latest platform signals</h2><p className="mt-1 text-xs text-ink-500">Technical health and reliability events</p></div>{feed.length ? <div className="divide-y divide-ink-100">{feed.slice(0, 6).map(item => <ActivityRow key={item.id} row={item} />)}</div> : <Empty title="Telemetry is waiting" text="Tenant health metrics and platform alerts will appear as tenant integrations report them." />}</section></div><div className="mt-5 grid gap-4 md:grid-cols-3"><WorkflowCard icon={ClipboardList} title="Onboard" text="Register the tenant, provision its isolated environment, then assign a training track." action="Open onboarding" onClick={() => navigate('onboarding')} /><WorkflowCard icon={Activity} title="Operate" text="Review aggregated service health, adoption signals and technical alerts." action="Review analytics" onClick={() => navigate('analytics')} /><WorkflowCard icon={LifeBuoy} title="Support" text="Work support tickets and submit a two-person, scoped access request when metadata is insufficient." action="Open support" onClick={() => navigate('support')} /></div></>; }
function WorkflowCard({ icon: Icon, title, text, action, onClick }: { icon: typeof Users; title: string; text: string; action: string; onClick: () => void }) { return <div className="rounded-md border border-ink-100 bg-paper p-5"><Icon size={20} className="text-accent-700" /><h3 className="mt-3 font-semibold">{title}</h3><p className="mt-1 min-h-10 text-sm leading-5 text-ink-500">{text}</p><button onClick={onClick} className="mt-4 flex items-center gap-1 text-sm font-medium text-accent-700">{action}<ArrowUpRight size={15} /></button></div>; }
function TenantRow({ tenant }: { tenant: Tenant }) { const tone = tenantIsProvisioned(tenant) ? 'bg-accent-50 text-accent-700' : tenant.status === 'attention' ? 'bg-danger/10 text-danger' : 'bg-warning/10 text-warning'; return <div className="flex items-center gap-3 px-5 py-3.5"><div className="flex h-9 w-9 items-center justify-center rounded-lg bg-ink-100 text-ink-600"><Building2 size={17} /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{tenant.name}</p><p className="truncate text-xs text-ink-500">{tenant.slug} · {pretty(tenant.plan)}</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${tone}`}>{tenantIsProvisioned(tenant) ? 'Active' : tenant.status === 'active' ? 'Setup required' : pretty(tenant.status)}</span></div>; }
function ActivityRow({ row }: { row: FeedRow }) { const label = String(row.title || row.name || row.event_type || row.action || row.kind || 'Platform update'); const detail = String(row.summary || row.status || row.severity || 'Recorded'); return <div className="flex gap-3 px-5 py-3.5"><div className="mt-0.5 rounded-md bg-warning/10 p-1.5 text-warning"><Activity size={15} /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{label}</p><p className="mt-0.5 text-xs text-ink-500" data-numeric>{detail} · {dateLabel(row.created_at)}</p></div></div>; }
function Empty({ title, text }: { title: string; text: string }) { return <div className="px-6 py-12 text-center"><div className="mx-auto flex h-10 w-10 items-center justify-center rounded-md bg-ink-100 text-ink-500"><CircleHelp size={19} /></div><h3 className="mt-3 text-sm font-semibold text-ink-800">{title}</h3><p className="mx-auto mt-1 max-w-sm text-sm text-ink-500">{text}</p></div>; }

function Tenants({ tenants, search, setSearch, onCreate, onEdit, onProvision, canProvision, busyTenantId }: { tenants: Tenant[]; search: string; setSearch: (v: string) => void; onCreate: () => void; onEdit: (tenant: Tenant) => void; onProvision: (tenant: Tenant) => void; canProvision: boolean; busyTenantId: string }) {
  return <>
    <PageHeading eyebrow="Tenant registry" title="Tenants" subtitle="Register and manage customer workspaces on the shared database." action={canProvision ? <button onClick={onCreate} className="flex items-center gap-2 rounded-sm bg-accent-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-700"><Plus size={17} /> Add tenant</button> : undefined} />
    <div className="mb-4 flex items-center gap-2 rounded-md border border-ink-100 bg-paper px-3"><Search size={17} className="text-ink-400" /><input aria-label="Search tenants" placeholder="Search by tenant, plan, region or status?" value={search} onChange={e => setSearch(e.target.value)} className="w-full bg-transparent text-sm outline-none rounded-sm border h-10 border-ink-200 bg-paper focus:border-accent-500" /></div>
    <div className="overflow-hidden rounded-md border border-ink-100 bg-paper"><div className="overflow-x-auto"><table className="w-full min-w-[920px] text-left text-sm">
      <thead className="bg-ink-50 text-xs uppercase tracking-wide text-ink-500"><tr>{['Tenant', 'Plan', 'Region', 'Admin contact', 'Isolation', 'Status', 'Created', 'Access'].map(h => <th key={h} className="px-4 py-3 font-medium uppercase tracking-wide">{h}</th>)}</tr></thead>
      <tbody className="divide-y divide-ink-100">{tenants.map(t => <tr key={t.id} className="hover:bg-ink-50">
        <td className="px-4 py-3"><p className="font-medium text-ink-900">{t.name}</p><p className="text-xs text-ink-500">{t.slug}</p>{t.provisioning_step && t.status !== 'active' && <p className="mt-1 text-xs text-accent-700">{pretty(t.provisioning_step)}</p>}</td>
        <td className="px-4 py-3">{pretty(t.plan)}</td><td className="px-4 py-3">{pretty(t.region)}</td>
        <td className="px-4 py-3"><p>{t.primary_contact || '?'}</p><p className="text-xs text-ink-500">{t.contact_email || 'Admin email required'}</p></td>
        <td className="px-4 py-3 text-xs">{pretty(t.isolation_level)}</td>
        <td className="px-4 py-3"><span className={['rounded-full px-2.5 py-1 text-xs', tenantIsProvisioned(t) ? 'bg-accent-50 text-accent-700' : t.status === 'attention' ? 'bg-danger/10 text-danger' : 'bg-warning/10 text-warning'].join(' ')}>{tenantIsProvisioned(t) ? 'Active' : t.status === 'active' ? 'Setup required' : pretty(t.status)}</span></td>
        <td className="px-4 py-3 text-ink-500" data-numeric>{dateLabel(t.created_at)}</td>
        <td className="px-4 py-3"><div className="flex items-center gap-2">{tenantIsProvisioned(t) && <a href={'/t/' + t.slug} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-accent-700">Open<ArrowUpRight size={13} /></a>}{canProvision && <button type="button" onClick={() => onEdit(t)} className="rounded-sm border border-ink-300 px-2.5 py-1.5 text-xs font-semibold text-ink-700 hover:bg-ink-50">Edit</button>}{!tenantIsProvisioned(t) && canProvision && <button type="button" disabled={busyTenantId === t.id} onClick={() => onProvision(t)} className="rounded-sm border border-accent-100 px-2.5 py-1.5 text-xs font-semibold text-accent-700 hover:bg-accent-50 disabled:opacity-50">{busyTenantId === t.id ? 'Working...' : t.status === 'provisioning' || t.status === 'attention' ? 'Resume' : 'Provision'}</button>}{!canProvision && !tenantIsProvisioned(t) && <span className="text-xs text-ink-400">Setup required</span>}</div></td>
      </tr>)}</tbody>
    </table></div>{!tenants.length && <Empty title="No matching tenants" text="Tenant records appear here after they are registered." />}</div>
  </>;
}

function Onboarding({ tenants, jobs, onCreate, onProvision, canProvision, busyTenantId }: { tenants: Tenant[]; jobs: FeedRow[]; onCreate: () => void; onProvision: (tenant: Tenant) => void; canProvision: boolean; busyTenantId: string }) {
  const stages = ['pending', 'provisioning', 'training', 'active'];
  const onboardingTenants = tenants.filter(t => !tenantIsProvisioned(t));
  return <>
    <PageHeading eyebrow="Tenant lifecycle" title="Onboarding pipeline" subtitle="Register the customer, create its isolated workspace inside the shared database, then invite its administrator." action={canProvision ? <button onClick={onCreate} className="flex items-center gap-2 rounded-sm bg-accent-500 px-4 py-2.5 text-sm font-semibold text-white"><Plus size={17} /> Register tenant</button> : undefined} />
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{stages.map((stage, i) => { const count = tenants.filter(t => stage === 'active' ? tenantIsProvisioned(t) : t.status === stage || (stage === 'pending' && (['trial', 'contracted'].includes(t.status) || (t.status === 'active' && !tenantIsProvisioned(t))))).length; return <div key={stage} className="rounded-md border border-ink-100 bg-paper p-5"><div className="flex items-center justify-between"><span className="text-sm font-medium text-ink-600">{pretty(stage)}</span><span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-50 text-xs font-bold text-accent-700" data-numeric>{i + 1}</span></div><p className="mt-3 text-3xl font-bold" data-numeric>{count}</p><p className="mt-1 text-xs text-ink-500">{i === 0 ? 'Contract signed, awaiting setup' : i === 1 ? 'Isolated environment setup' : i === 2 ? 'Tenant admin course progress' : 'Health checks active'}</p></div>; })}</div>
    <div className="mt-6 grid gap-5 xl:grid-cols-[1.2fr_1fr]"><div className="rounded-md border border-ink-100 bg-paper"><div className="border-b border-ink-100 p-5"><h2 className="font-semibold font-display">Tenant onboarding</h2><p className="mt-1 text-sm text-ink-500">Each tenant gets its own isolated workspace and an administrator invite in the shared database.</p></div>{onboardingTenants.length ? <div className="divide-y divide-ink-100">{onboardingTenants.map(t => <div key={t.id} className="flex items-center gap-3 py-1"><div className="min-w-0 flex-1"><TenantRow tenant={t} /></div>{canProvision && <button type="button" disabled={busyTenantId === t.id} onClick={() => onProvision(t)} className="mr-4 shrink-0 rounded-sm border border-accent-100 px-3 py-1.5 text-xs font-semibold text-accent-700 hover:bg-accent-50 disabled:opacity-50">{busyTenantId === t.id ? 'Working?' : t.status === 'provisioning' || t.status === 'attention' ? 'Resume' : 'Provision'}</button>}</div>)}</div> : <Empty title="Pipeline is clear" text="Newly registered tenants will appear here." />}</div>
      <div className="rounded-md border border-ink-100 bg-paper p-5"><h2 className="font-semibold font-display">Provisioning jobs</h2><p className="mt-1 text-sm text-ink-500">Durable job state; retries resume at the last committed step.</p>{jobs.length ? <div className="mt-4 space-y-3">{jobs.map(job => { const tenant = tenants.find(t => t.id === job.tenant_id); return <div key={job.id} className="flex items-center gap-3 rounded-lg bg-ink-50 p-3"><Database size={17} className="text-accent-700" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{tenant?.name || 'Tenant environment'}</p><p className="text-xs text-ink-500" data-numeric>{pretty(job.status)} ? {pretty(String(job.current_step || 'queued'))} ? {dateLabel(job.created_at)}</p></div>{tenant && !tenantIsProvisioned(tenant) && canProvision && <button type="button" disabled={busyTenantId === tenant.id} onClick={() => onProvision(tenant)} className="rounded-sm border border-ink-300 px-2.5 py-1.5 text-xs font-semibold disabled:opacity-50">Resume</button>}</div>; })}</div> : <div className="mt-5 rounded-lg border border-dashed border-ink-300 p-4 text-sm text-ink-500">No onboarding jobs are queued.</div>}</div>
    </div>
  </>;
}
function Analytics({ tenants, rows }: { tenants: Tenant[]; rows: FeedRow[] }) { const healthy = tenants.filter(tenantIsProvisioned).length; return <><PageHeading eyebrow="Aggregated telemetry" title="Analytics" subtitle="Tenant app usage buckets and reported technical alerts. No tenant business records or personal data." /><div className="grid gap-4 sm:grid-cols-3"><Stat label="Reporting tenants" value={new Set(rows.map(r => r.tenant_id).filter(Boolean)).size} detail="Tenants with recent metric records" icon={Signal} /><Stat label="Active environments" value={healthy} detail="Marked active in tenant registry" icon={Building2} tone="emerald" /><Stat label="Metrics received" value={rows.length} detail="Most recent hourly aggregates" icon={Activity} tone="slate" /></div><div className="mt-6 rounded-md border border-ink-100 bg-paper"><div className="border-b border-ink-100 p-5"><h2 className="font-semibold font-display">Recent aggregated metrics</h2><p className="mt-1 text-xs text-ink-500">Hourly page-view bucket counts only; product, sales and customer details are never sent.</p></div>{rows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[600px] text-left text-sm"><thead className="bg-ink-50 text-xs uppercase text-ink-500"><tr>{['Tenant reference', 'Metric', 'Page visits', 'Hourly window', 'Recorded'].map(v => <th key={v} className="px-4 py-3 uppercase tracking-wide font-medium">{v}</th>)}</tr></thead><tbody className="divide-y divide-ink-100">{rows.map(row => <tr key={row.id}><td className="px-4 py-3 font-mono text-xs" data-numeric>{String(row.tenant_id || '—').slice(0, 12)}</td><td className="px-4 py-3">{String(row.metric_key || row.metric || row.event_type || 'Health signal')}</td><td className="px-4 py-3 font-medium">{String(row.metric_value ?? row.value ?? '—')}</td><td className="px-4 py-3">{(row.period_start ? new Date(String(row.period_start)).toLocaleString() : '—')}</td><td className="px-4 py-3 text-ink-500" data-numeric>{dateLabel(row.created_at)}</td></tr>)}</tbody></table></div> : <Empty title="No telemetry received" text="Hourly page-use records appear here after tenant users access their workspaces. Trends are limited to aggregate counts." />}</div></>; }
function ResourcePage({ title, subtitle, rows, empty, fields }: { title: string; subtitle: string; rows: FeedRow[]; empty: string; fields: string[] }) { return <><PageHeading eyebrow="Operations" title={title} subtitle={subtitle} /><div className="rounded-md border border-ink-100 bg-paper">{rows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[650px] text-left text-sm"><thead className="bg-ink-50 text-xs uppercase text-ink-500"><tr>{fields.map(field => <th key={field} className="px-4 py-3 uppercase tracking-wide font-medium">{pretty(field)}</th>)}</tr></thead><tbody className="divide-y divide-ink-100">{rows.map(row => <tr key={row.id}>{fields.map(field => <td key={field} className="max-w-64 truncate px-4 py-3 text-ink-700" data-numeric>{field === 'created_at' ? dateLabel(String(row[field] || '')) : String(row[field] ?? '—')}</td>)}</tr>)}</tbody></table></div> : <Empty title={empty} text="Connect the corresponding owner-plane workflow or telemetry source to populate this view." />}</div></>; }
function Support({ rows, onNavigate }: { rows: FeedRow[]; onNavigate: (p: Page) => void }) { return <><PageHeading eyebrow="Tenant support" title="Support desk" subtitle="Tenant-scoped tickets, support workflow, and controlled escalation." action={<button onClick={() => onNavigate('audit')} className="rounded-sm border border-ink-300 bg-paper px-3 py-2 text-sm font-medium">View audit log</button>} /><div className="mb-5 grid gap-4 md:grid-cols-2"><div className="rounded-md border border-ink-100 bg-paper p-5"><div className="flex items-center gap-2"><LifeBuoy size={18} className="text-accent-700" /><h2 className="font-semibold font-display">Support tickets</h2></div><p className="mt-2 text-sm text-ink-500">Tickets should contain enough metadata to diagnose issues without reading tenant business records.</p></div><div className="rounded-md border border-warning/20 bg-warning/10 p-5"><div className="flex items-center gap-2 text-warning"><LockKeyhole size={18} /><h2 className="font-semibold font-display">Break-glass access</h2></div><p className="mt-2 text-sm leading-5 text-warning/80">Business-data access requires a separate support proxy, mandatory reason and ticket, table scope, tenant notification, two distinct approvers, query recording and auto-revocation within 60 minutes. This console does not grant direct database access.</p><p className="mt-2 text-xs font-medium text-warning">Support proxy integration required before enabling access requests.</p></div></div><ResourcePage title="Ticket queue" subtitle="Open and recently updated customer support issues." rows={rows} empty="No support tickets" fields={['tenant_id', 'title', 'severity', 'status', 'created_at']} /></>; }
function Platform({ jobs, tenants, managementCheck, onCheckManagement }: { jobs: FeedRow[]; tenants: Tenant[]; managementCheck: { loading: boolean; message: string; ok: boolean | null }; onCheckManagement: () => void }) { return <><PageHeading eyebrow="Platform control" title="Platform operations" subtitle="Provisioning, release, feature flags, backups and system audit surfaces." /><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Stat label="Provisioning jobs" value={jobs.length} detail="Recent owner-plane jobs" icon={Database} /><Stat label="Registered environments" value={tenants.length} detail="Metadata registry records" icon={Building2} tone="emerald" /><Stat label="Release management" value="Not connected" detail="No deployment control API configured" icon={RefreshCw} tone="amber" /><Stat label="Feature flags" value="Not connected" detail="Flags must be delivered through a secured service" icon={Settings2} tone="slate" /></div><div className="mt-6 rounded-md border border-ink-100 bg-paper p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-semibold font-display">Supabase organization connection</h2><p className="mt-1 text-sm text-ink-500">Checks read access to the configured organization and confirms the shared tenant project. This check never creates or changes a project.</p></div><button type="button" onClick={onCheckManagement} disabled={managementCheck.loading} className="inline-flex items-center justify-center gap-2 rounded-sm bg-accent-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"><RefreshCw size={15} className={managementCheck.loading ? 'animate-spin' : ''} />{managementCheck.loading ? 'Checking…' : 'Check connection'}</button></div>{managementCheck.message && <p role="status" className={`mt-3 rounded-lg p-3 text-sm ${managementCheck.ok ? 'bg-accent-50 text-accent-900' : 'bg-danger/10 text-danger'}`}>{managementCheck.message}</p>}</div><div className="mt-6 grid gap-4 md:grid-cols-2"><PlatformCard title="Provisioning" text="Reuses the configured shared tenant project, applies the schema and hardware catalogue once, creates a tenant workspace and membership, configures slug-based sign-in, and invites its administrator." icon={Database} /><PlatformCard title="Flags & releases" text="Keep releases and tenant feature configuration behind an authenticated server-side service. The owner UI does not hold deployment credentials." icon={Settings2} /><PlatformCard title="Backup & restore" text="The shared database needs encrypted backups and tested point-in-time restores. Never expose raw tenant backup contents here." icon={ShieldCheck} /><PlatformCard title="Tenant trust" text="Businesses share one Supabase project. Tenant membership, row-level policies and matching tenant foreign keys isolate their business records." icon={Users} /></div></>; }
function PlatformCard({ title, text, icon: Icon }: { title: string; text: string; icon: typeof Users }) { return <div className="rounded-md border border-ink-100 bg-paper p-5"><Icon size={19} className="text-accent-700" /><h3 className="mt-3 font-semibold">{title}</h3><p className="mt-1 text-sm leading-6 text-ink-500">{text}</p><span className="mt-4 inline-flex items-center gap-1 rounded-full bg-ink-100 px-2.5 py-1 text-xs text-ink-600"><CircleHelp size={13} />Integration seam defined</span></div>; }

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
    if (sendError || data?.error) {
      let failureMessage = data?.error || sendError?.message || 'Message could not be sent.';
      const response = (sendError as unknown as { context?: Response } | null)?.context;
      if (response) {
        try {
          const detail = await response.clone().json();
          if (detail?.providerCode) failureMessage = `${detail.error || failureMessage} (Twilio error ${detail.providerCode})`;
          else if (detail?.error) failureMessage = detail.error;
        } catch { /* retain the Functions client's message */ }
      }
      setFailure(failureMessage);
      await load();
    } else { setNotice(`${pretty(channel)} message accepted by the provider.`); setRecipient(''); setSubject(''); setMessage(''); await load(); }
  };

  const channelCards: { id: CommChannel; provider: string; secretNames: string[]; fieldLabel: string; placeholder: string }[] = [
    { id: 'email', provider: 'Postmark', secretNames: ['POSTMARK_SERVER_TOKEN'], fieldLabel: 'From address', placeholder: 'Platform <noreply@example.com>' },
    { id: 'sms', provider: 'Twilio', secretNames: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER'], fieldLabel: 'Sender number', placeholder: '+254700000000' },
    { id: 'whatsapp', provider: 'WhatsApp Cloud', secretNames: ['META_WHATSAPP_ACCESS_TOKEN', 'META_WHATSAPP_PHONE_NUMBER_ID', 'META_GRAPH_API_VERSION'], fieldLabel: 'Business number', placeholder: '+254700000000' },
  ];

  return <>
    <PageHeading eyebrow="Owner communications" title="Messages & delivery" subtitle="Configure owner-plane delivery channels, send a direct message, and review privacy-safe provider results." />
    {notice && <div role="status" className="mb-4 rounded-lg border border-accent-100 bg-accent-50 p-3 text-sm text-accent-900">{notice}</div>}
    {failure && <div role="alert" className="mb-4 rounded-lg border border-danger/20 bg-danger/10 p-3 text-sm text-danger">{failure}</div>}
    <div className="grid gap-4 xl:grid-cols-3">
      {channelCards.map(card => { const config = configs[card.id]; return <section key={card.id} className="rounded-md border border-ink-100 bg-paper p-5">
        <div className="flex items-start justify-between"><div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-50 text-accent-700">{card.id === 'email' ? <Mail size={19} /> : <MessageIcon channel={card.id} />}</div><div><h2 className="font-semibold font-display">{pretty(card.id)}</h2><p className="text-xs text-ink-500">{card.provider}</p></div></div><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${config.is_enabled ? 'bg-accent-50 text-accent-700' : 'bg-ink-100 text-ink-600'}`}>{config.is_enabled ? 'Enabled' : 'Disabled'}</span></div>
        <div className="mt-4 space-y-3">
          <label className="block text-xs font-medium text-ink-600">{card.fieldLabel}<input value={config.sender_address} onChange={e => patchConfig(card.id, 'sender_address', e.target.value)} disabled={!canConfigure} placeholder={card.placeholder} className="mt-1 w-full rounded-sm border px-3 py-2 text-sm outline-none disabled:bg-ink-50 h-10 border-ink-200 bg-paper focus:border-accent-500" /></label>
          {card.id === 'email' && <label className="block text-xs font-medium text-ink-600">Reply-to address<input value={config.reply_to} onChange={e => patchConfig(card.id, 'reply_to', e.target.value)} disabled={!canConfigure} placeholder="support@example.com" className="mt-1 w-full rounded-sm border px-3 py-2 text-sm outline-none disabled:bg-ink-50 h-10 border-ink-200 bg-paper focus:border-accent-500" /></label>}
          <div className="rounded-lg bg-ink-50 p-3"><p className="text-xs font-semibold text-ink-700">Server secrets</p><p className="mt-1 break-words font-mono text-[10px] leading-5 text-ink-500">{card.secretNames.join(' · ')}</p><p className="mt-1 text-xs text-ink-500">Set these in the owner Supabase Edge Function secrets. They are never stored in the browser or database.</p></div>
          {canConfigure && <label className="flex items-center gap-2 text-sm text-ink-700"><input type="checkbox" checked={config.is_enabled} onChange={e => patchConfig(card.id, 'is_enabled', e.target.checked)} className="rounded border-ink-300" />Enable this channel</label>}
          {canConfigure && <button onClick={() => void saveConfig(card.id)} disabled={saving === card.id} className="w-full rounded-sm border border-ink-300 px-3 py-2 text-sm font-semibold hover:bg-ink-50 disabled:opacity-50">{saving === card.id ? 'Saving…' : 'Save channel settings'}</button>}
        </div>
      </section>; })}
    </div>

    <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
      <form onSubmit={sendMessage} className="rounded-md border border-ink-100 bg-paper p-5">
        <div className="flex items-center gap-2"><Send size={18} className="text-accent-700" /><h2 className="font-semibold font-display">Send a direct message</h2></div>
        <p className="mt-1 text-sm text-ink-500">Owner-plane, one-recipient notifications only. No marketing or bulk sends.</p>
        <label className="mt-4 block text-sm font-medium">Channel<select value={channel} onChange={e => setChannel(e.target.value as CommChannel)} className="mt-1 w-full rounded-sm border px-3 py-2 h-10 border-ink-200 bg-paper focus:border-accent-500"><option value="email">Email</option><option value="sms">SMS</option><option value="whatsapp">WhatsApp direct</option></select></label>
        <label className="mt-3 block text-sm font-medium">Recipient<input required type={channel === 'email' ? 'email' : 'tel'} value={recipient} onChange={e => setRecipient(e.target.value)} placeholder={channel === 'email' ? 'name@example.com' : '+254700000000'} className="mt-1 w-full rounded-sm border px-3 py-2 h-10 border-ink-200 bg-paper focus:border-accent-500" /></label>
        {channel === 'email' && <label className="mt-3 block text-sm font-medium">Subject<input required maxLength={160} value={subject} onChange={e => setSubject(e.target.value)} className="mt-1 w-full rounded-sm border px-3 py-2 h-10 border-ink-200 bg-paper focus:border-accent-500" /></label>}
        <label className="mt-3 block text-sm font-medium">Message<textarea required maxLength={2000} rows={5} value={message} onChange={e => setMessage(e.target.value)} className="mt-1 w-full rounded-sm border px-3 py-2 border-ink-200 bg-paper focus:border-accent-500" /></label>
        {channel === 'whatsapp' && <p className="mt-2 rounded-lg bg-warning/10 p-3 text-xs leading-5 text-warning">WhatsApp free-form messages are subject to the platform's conversation window and policy. Use an approved template when required.</p>}
        <button disabled={busy || !configs[channel].is_enabled} className="mt-4 flex w-full items-center justify-center gap-2 rounded-sm bg-accent-500 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Sending…' : <><Send size={15} /> Send message</>}</button>
        {!configs[channel].is_enabled && <p className="mt-2 text-center text-xs text-ink-500">Enable and configure this channel first.</p>}
      </form>

      <section className="rounded-md border border-ink-100 bg-paper">
        <div className="border-b border-ink-100 p-5"><h2 className="font-semibold font-display">Recent delivery activity</h2><p className="mt-1 text-xs text-ink-500">Only channel, provider, status, and a recipient hash are retained. Message bodies and addresses are not logged.</p></div>
        {logs.length ? <div className="overflow-x-auto"><table className="w-full min-w-[580px] text-left text-sm"><thead className="bg-ink-50 text-xs uppercase text-ink-500"><tr>{['Channel', 'Provider', 'Status', 'Result', 'Time'].map(label => <th key={label} className="px-4 py-3 uppercase tracking-wide font-medium">{label}</th>)}</tr></thead><tbody className="divide-y divide-ink-100">{logs.map(row => <tr key={row.id}><td className="px-4 py-3">{pretty(row.channel)}</td><td className="px-4 py-3 text-ink-600">{pretty(row.provider)}</td><td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs ${row.status === 'accepted' ? 'bg-accent-50 text-accent-700' : row.status === 'failed' ? 'bg-danger/10 text-danger' : 'bg-warning/10 text-warning'}`}>{pretty(row.status)}</span></td><td className="px-4 py-3 text-xs text-ink-500">{row.error_code || '—'}</td><td className="px-4 py-3 text-xs text-ink-500" data-numeric>{new Date(row.created_at).toLocaleString()}</td></tr>)}</tbody></table></div> : <Empty title="No messages yet" text="Successful and failed sends will appear here without storing message bodies or recipient addresses." />}
      </section>
    </div>
  </>;
}

function MessageIcon({ channel }: { channel: 'sms' | 'whatsapp' }) { return channel === 'sms' ? <MessageSquareText size={19} /> : <MessageCircle size={19} />; }

function Audit({ rows }: { rows: FeedRow[] }) { return <><PageHeading eyebrow="Security & accountability" title="Owner audit log" subtitle="Append-only, hash-chained record of owner-plane actions." /><div className="mb-5 flex items-start gap-3 rounded-md border border-accent-100 bg-accent-50 p-4 text-sm text-accent-900"><ShieldCheck size={19} className="mt-0.5 shrink-0" /><p>Audit records are generated by database triggers and cannot be changed or deleted by owner staff. The hash chain can be verified by the owner database function.</p></div><div className="rounded-md border border-ink-100 bg-paper">{rows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-sm"><thead className="bg-ink-50 text-xs uppercase text-ink-500"><tr>{['Actor', 'Action', 'Target', 'Time', 'Record hash'].map(h => <th key={h} className="px-4 py-3 uppercase tracking-wide font-medium">{h}</th>)}</tr></thead><tbody className="divide-y divide-ink-100">{rows.map(row => <tr key={row.id}><td className="px-4 py-3">{String(row.actor_email || row.actor_id || 'System')}</td><td className="px-4 py-3 font-medium">{String(row.action || row.action_type || 'Owner action')}</td><td className="px-4 py-3 text-ink-500">{String(row.target_type || row.target_id || '—')}</td><td className="px-4 py-3 text-ink-500" data-numeric>{new Date(row.created_at).toLocaleString()}</td><td className="px-4 py-3 font-mono text-xs text-ink-500" data-numeric>{String(row.record_hash || '—').slice(0, 20)}…</td></tr>)}</tbody></table></div> : <Empty title="No owner actions recorded" text="Tenant registration and subsequent owner control-plane activity will be written here." />}</div></>; }

function TenantModal({ packages, form, setForm, onClose, onSubmit, busy }: { packages: PackageOption[]; form: { name: string; slug: string; plan: string; region: string; primary_contact: string; contact_email: string; isolation_level: string }; setForm: (v: { name: string; slug: string; plan: string; region: string; primary_contact: string; contact_email: string; isolation_level: string }) => void; onClose: () => void; onSubmit: (e: FormEvent) => void; busy: boolean }) {
  const update = (key: keyof typeof form, value: string) => setForm({ ...form, [key]: value, ...(key === 'name' && !form.slug ? { slug: value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') } : {}) });
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/50 p-4"><form onSubmit={onSubmit} className="max-h-[95vh] w-full max-w-2xl overflow-y-auto rounded-md bg-paper shadow-xs border border-ink-100">
    <div className="flex items-start justify-between border-b border-ink-100 p-5"><div><h2 className="text-lg font-semibold font-display">Register tenant</h2><p className="mt-1 text-sm text-ink-500">Set up the customer record and first administrator invite.</p></div><button type="button" onClick={onClose} className="rounded-sm p-1.5 text-ink-400 hover:bg-ink-100" aria-label="Close"><X size={19} /></button></div>
    <div className="grid gap-4 p-5 sm:grid-cols-2">{([['name', 'Company name'], ['slug', 'Tenant slug'], ['primary_contact', 'Primary contact'], ['contact_email', 'First tenant admin email']] as [keyof typeof form, string][]).map(([key, label]) => <label key={key} className="text-sm font-medium">{label}<input required={key !== 'primary_contact'} type={key === 'contact_email' ? 'email' : 'text'} autoComplete={key === 'contact_email' ? 'email' : undefined} value={form[key]} onChange={e => update(key, e.target.value)} className="mt-1.5 w-full rounded-sm border px-3 py-2 outline-none h-10 border-ink-200 bg-paper focus:border-accent-500" /></label>)}
      <label className="text-sm font-medium">Business package<select required value={form.plan} onChange={e => update('plan', e.target.value)} className="mt-1.5 w-full rounded-sm border px-3 py-2 h-10 border-ink-200 bg-paper focus:border-accent-500">{packages.map(item => <option key={item.plan_key} value={item.plan_key}>{packageLabel(item)}</option>)}</select></label>
      <label className="text-sm font-medium">Region<select value={form.region} onChange={e => update('region', e.target.value)} className="mt-1.5 w-full rounded-sm border px-3 py-2 h-10 border-ink-200 bg-paper focus:border-accent-500"><option value="africa-east">East Africa ? Mumbai</option><option value="africa-south">Southern Africa ? Ireland</option><option value="eu-west">Europe West ? Ireland</option><option value="us-east">US East ? Virginia</option></select></label>
      <div className="sm:col-span-2 rounded-lg bg-accent-50 p-3 text-xs leading-5 text-accent-900">Each tenant receives a workspace in the shared Supabase database. Database row security separates business records. The first admin receives an invitation link for this tenant?s sign-in page.</div>
    </div>
    <div className="flex justify-end gap-2 border-t border-ink-100 p-5"><button type="button" onClick={onClose} className="rounded-sm border border-ink-300 px-4 py-2 text-sm">Cancel</button><button disabled={busy} className="flex items-center gap-2 rounded-sm bg-accent-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{busy ? 'Registering?' : <><Check size={16} /> Create tenant</>}</button></div>
  </form></div>;
}

function TenantEditModal({ tenant, packages, form, setForm, onClose, onSubmit, busy }: { tenant: Tenant; packages: PackageOption[]; form: TenantEdit; setForm: (value: TenantEdit) => void; onClose: () => void; onSubmit: (event: FormEvent) => void; busy: boolean }) {
  const update = (key: keyof TenantEdit, value: string) => setForm({ ...form, [key]: value });
  const tenantPackages = packages.some(item => item.plan_key === form.plan) ? packages : [{ plan_key: form.plan, display_name: pretty(form.plan), amount: null, currency: 'KES', billing_interval: 'monthly', is_active: false }, ...packages];
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/50 p-4"><form onSubmit={onSubmit} className="max-h-[95vh] w-full max-w-2xl overflow-y-auto rounded-md bg-paper shadow-xs border border-ink-100">
    <div className="flex items-start justify-between border-b border-ink-100 p-5"><div><p className="text-xs font-semibold uppercase tracking-wider text-accent-700">Tenant registry</p><h2 className="mt-1 text-lg font-semibold font-display">Edit business</h2><p className="mt-1 text-sm text-ink-500">{tenant.slug} · shared database workspace</p></div><button type="button" onClick={onClose} className="rounded-sm p-1.5 text-ink-400 hover:bg-ink-100" aria-label="Close"><X size={19}/></button></div>
    <div className="grid gap-4 p-5 sm:grid-cols-2">
      <label className="text-sm font-medium">Business name<input required minLength={2} maxLength={160} value={form.name} onChange={event=>update('name',event.target.value)} className="mt-1.5 w-full rounded-sm border px-3 py-2 h-10 border-ink-200 bg-paper focus:border-accent-500"/></label>
      <label className="text-sm font-medium">Business package<select value={form.plan} onChange={event=>update('plan',event.target.value)} className="mt-1.5 w-full rounded-sm border px-3 py-2 h-10 border-ink-200 bg-paper focus:border-accent-500">{tenantPackages.map(item=><option key={item.plan_key} value={item.plan_key}>{packageLabel(item)}{!item.is_active?' · inactive':''}</option>)}</select></label>
      <label className="text-sm font-medium">Region<select value={form.region} onChange={event=>update('region',event.target.value)} className="mt-1.5 w-full rounded-sm border px-3 py-2 h-10 border-ink-200 bg-paper focus:border-accent-500"><option value="africa-east">East Africa</option><option value="africa-south">Southern Africa</option><option value="eu-west">Europe West</option><option value="us-east">US East</option></select></label>
      <label className="text-sm font-medium">Workspace status<select value={form.status} onChange={event=>update('status',event.target.value)} className="mt-1.5 w-full rounded-sm border px-3 py-2 h-10 border-ink-200 bg-paper focus:border-accent-500"><option value="pending">Pending</option><option value="trial">Trial</option><option value="active">Active</option><option value="suspended">Suspended</option><option value="attention">Needs attention</option><option value="closed">Closed</option></select></label>
      <label className="text-sm font-medium">Primary contact<input value={form.primary_contact} onChange={event=>update('primary_contact',event.target.value)} className="mt-1.5 w-full rounded-sm border px-3 py-2 h-10 border-ink-200 bg-paper focus:border-accent-500"/></label>
      <label className="text-sm font-medium">Administrator email<input type="email" value={form.contact_email} onChange={event=>update('contact_email',event.target.value)} className="mt-1.5 w-full rounded-sm border px-3 py-2 h-10 border-ink-200 bg-paper focus:border-accent-500"/></label>
      {!tenant.supabase_project_ref && form.status==='active' && <p className="sm:col-span-2 rounded-lg bg-warning/10 p-3 text-sm text-warning">Provision this tenant workspace before setting its status to active.</p>}
    </div>
    <div className="flex justify-end gap-2 border-t border-ink-100 p-5"><button type="button" onClick={onClose} className="rounded-sm border border-ink-300 px-4 py-2 text-sm">Cancel</button><button disabled={busy || (!tenant.supabase_project_ref && form.status==='active')} className="rounded-sm bg-accent-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Saving...' : 'Save tenant'}</button></div>
  </form></div>;
}

function ProvisionTenantModal({ tenant, email, setEmail, message, error, onClearError, onClose, onSubmit, busy }: { tenant: Tenant; email: string; setEmail: (value: string) => void; message: string; error: string; onClearError: () => void; onClose: () => void; onSubmit: (event: FormEvent) => void; busy: boolean }) {
  const isResume = tenant.status === 'provisioning' || tenant.status === 'attention';
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/50 p-4"><form onSubmit={onSubmit} className="w-full max-w-lg rounded-md bg-paper shadow-xs border border-ink-100">
    <div className="flex items-start justify-between border-b border-ink-100 p-5"><div><p className="text-xs font-semibold uppercase tracking-wider text-accent-700">Tenant onboarding</p><h2 className="mt-1 text-lg font-semibold font-display">{isResume ? 'Resume setup' : 'Provision tenant'}</h2><p className="mt-1 text-sm text-ink-500">{tenant.name} ? {tenant.slug}</p></div><button type="button" disabled={busy} onClick={onClose} className="rounded-sm p-1.5 text-ink-400 hover:bg-ink-100 disabled:opacity-40" aria-label="Close"><X size={19} /></button></div>
    <div className="space-y-4 p-5"><label className="block text-sm font-medium">First tenant administrator email<input required type="email" autoComplete="email" value={email} onChange={e => { setEmail(e.target.value); if (error) onClearError(); }} disabled={busy} className="mt-1.5 w-full rounded-sm border px-3 py-2.5 outline-none disabled:bg-ink-50 h-10 border-ink-200 bg-paper focus:border-accent-500" /></label>
      <div className="rounded-lg border border-warning/20 bg-warning/10 p-3 text-xs leading-5 text-warning">Provisioning adds this tenant to the configured shared Supabase project. Business data remains separated by tenant membership and database row policies.</div>
      {error && <p role="alert" className="rounded-lg border border-danger/20 bg-danger/10 p-3 text-sm leading-5 text-danger">{error}</p>}
      {message && <div role="status" className="flex items-start gap-2 rounded-lg bg-accent-50 p-3 text-sm text-accent-900">{busy && <RefreshCw size={15} className="mt-0.5 shrink-0 animate-spin" />}<span>{message}</span></div>}
    </div>
    <div className="flex justify-end gap-2 border-t border-ink-100 p-5"><button type="button" disabled={busy} onClick={onClose} className="rounded-sm border border-ink-300 px-4 py-2 text-sm disabled:opacity-50">{busy ? 'Provisioning?' : 'Cancel'}</button><button disabled={busy} className="flex items-center gap-2 rounded-sm bg-accent-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{busy ? 'Working?' : <><Database size={16} /> {isResume ? 'Resume provisioning' : 'Provision and invite admin'}</>}</button></div>
  </form></div>;
}
