import { FormEvent, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { isTenantContextActive, supabase } from '@/lib/supabase';
import { ArrowRight, Building2, Lock, Mail, Loader2, Eye, EyeOff, ShieldCheck, UserRoundPlus } from 'lucide-react';
import { BrandLogo } from '@/components/BrandLogo';

export function Login() {
  const { signIn, signUp, signOut } = useAuth();
  const { showToast } = useToast();
  const tenantMode = isTenantContextActive();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [registerMode, setRegisterMode] = useState(false);
  const [notice, setNotice] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [workspaceAddress, setWorkspaceAddress] = useState('');
  const [workspaceError, setWorkspaceError] = useState('');

  const openWorkspace = (e: FormEvent) => {
    e.preventDefault();
    const value = workspaceAddress.trim();
    let slug = value;

    if (/^https?:\/\//i.test(value)) {
      try {
        const url = new URL(value);
        const match = url.pathname.match(/^\/t\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/i);
        if (!match) throw new Error('Use a workspace link ending in /t/your-business-name.');
        slug = match[1];
      } catch (error) {
        setWorkspaceError(error instanceof Error ? error.message : 'Enter a valid workspace link or slug.');
        return;
      }
    } else {
      slug = value.replace(/^\/?t\//i, '').replace(/\/$/, '');
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(slug)) {
        setWorkspaceError('Enter the workspace slug from your invitation link.');
        return;
      }
    }

    window.location.assign(`/t/${slug.toLowerCase()}`);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await signIn(email.trim().toLowerCase(), password);
    if (error) {
      showToast(error, 'error');
      setLoading(false);
      return;
    }

    if (tenantMode) {
      const { data: membershipResult, error: membershipError } = await supabase.rpc('get_current_tenant_membership');
      if (membershipError) {
        await signOut();
        showToast('Could not verify your business access. Please try again.', 'error');
        setLoading(false);
        return;
      }
      const membership = Array.isArray(membershipResult) ? membershipResult[0] : membershipResult;
      if (!membership) {
        const { data: requestStatus, error: requestError } = await supabase.rpc('request_tenant_staff_registration');
        await signOut();
        if (requestError) showToast(requestError.message, 'error');
        else if (requestStatus === 'active') showToast('Your account is active. Sign in again to continue.', 'info');
        else setNotice('Your employee access request is waiting for administrator approval. You can sign in after it is approved.');
        setLoading(false);
        return;
      }
    }

    showToast('Welcome back!', 'success');
    setLoading(false);
  };

  const handleRegister = async (e: FormEvent) => {
    e.preventDefault();
    if (!tenantMode) return;
    setLoading(true);
    setNotice('');
    const { error, hasSession } = await signUp(email.trim().toLowerCase(), password, fullName.trim());
    if (error) {
      showToast(error, 'error');
      setLoading(false);
      return;
    }

    if (hasSession) {
      const { error: requestError } = await supabase.rpc('request_tenant_staff_registration');
      await signOut();
      if (requestError) {
        showToast(requestError.message, 'error');
        setLoading(false);
        return;
      }
      setNotice('Registration submitted. Your business administrator must approve your employee access before you can use the sales screen.');
    } else {
      setNotice('Account created. Verify your email, then sign in here. Your employee access request will be sent for administrator approval.');
    }
    setRegisterMode(false);
    setPassword('');
    setLoading(false);
  };

  const handlePasswordRecovery = async () => {
    const address = email.trim().toLowerCase();
    if (!address) {
      showToast('Enter your email address first.', 'error');
      return;
    }
    setRecoveryLoading(true);
    const redirectUrl = new URL(window.location.pathname, window.location.origin);
    redirectUrl.searchParams.set('set_password', '1');
    const { error } = await supabase.auth.resetPasswordForEmail(address, { redirectTo: redirectUrl.toString() });
    if (error) showToast(error.message, 'error');
    else showToast('If that address has a tenant account, a password setup link is on its way.', 'success');
    setRecoveryLoading(false);
  };

  return (
    <main className="relative isolate min-h-screen overflow-hidden bg-gradient-to-br from-white via-[#f5f7ff] to-[#e9efff] px-5 py-8 text-ink-900 sm:px-8 sm:py-10">
      <div aria-hidden="true" className="absolute -right-20 -top-24 -z-10 h-[460px] w-[460px] rounded-full bg-indigo-200/50 blur-3xl" />
      <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-7xl items-center gap-10 lg:grid-cols-[1fr_460px] lg:gap-16">
        <section className="max-w-2xl">
          <a href="/" className="inline-flex items-center gap-2.5"><BrandLogo size="sm" /></a>
          <p className="mt-10 inline-flex items-center gap-2 rounded-full border border-indigo-100 bg-white/80 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[.15em] text-accent-700">Your tenant workspace</p>
          <h1 className="mt-5 max-w-2xl text-4xl font-extrabold leading-[1.05] tracking-[-.045em] text-[#101b49] sm:text-6xl">Welcome back to your <span className="bg-gradient-to-r from-accent-500 to-violet-500 bg-clip-text text-transparent">business workspace.</span></h1>
          <p className="mt-5 max-w-xl text-sm leading-7 text-ink-600 sm:text-base">Sign in to manage the sales, inventory and customer work assigned to your account.</p>
          <div className="mt-7 flex flex-wrap gap-3 text-[11px] font-medium text-ink-600">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white bg-white/75 px-3 py-2"><ShieldCheck size={14} className="text-emerald-700" /> Tenant-secure access</span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white bg-white/75 px-3 py-2"><Building2 size={14} className="text-accent-700" /> Admin and staff roles</span>
          </div>
          <div className="relative mt-8 hidden h-[220px] max-w-lg overflow-hidden rounded-3xl shadow-xl shadow-indigo-950/10 sm:block">
            <img src="https://images.pexels.com/photos/36730435/pexels-photo-36730435/free-photo-of-fashion-retail-employee-using-digital-tablet-in-clothing-store.jpeg?auto=compress&dpr=1&h=750&w=1260" alt="Retail team member using a tablet in a shop" className="h-full w-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-[#111b48]/45 to-transparent" />
            <p className="absolute bottom-3 left-4 text-[9px] text-white">Photo by <a href="https://www.pexels.com/photo/fashion-retail-employee-using-digital-tablet-in-clothing-store-36730435/" target="_blank" rel="noreferrer" className="underline">Vitaly Gariev on Pexels</a></p>
          </div>
        </section>

        <section className="w-full max-w-[460px] justify-self-center lg:justify-self-end">
          <div className="rounded-3xl border border-white bg-white p-6 shadow-[0_24px_80px_rgba(48,62,131,0.18)] sm:p-8">
            <BrandLogo size="sm" />
            <h2 className="mt-5 text-xl font-bold tracking-tight text-[#101b49]">{registerMode ? 'Request employee access' : 'Sign in to your workspace'}</h2>
            <p className="mt-1 text-sm leading-5 text-ink-500">{registerMode ? 'Your business administrator will review your request.' : 'Use the account created for this business.'}</p>
            <form onSubmit={registerMode ? handleRegister : handleSubmit} className="mt-5 space-y-4">
              {registerMode && <label className="block text-xs font-semibold text-ink-700">Full name<input type="text" required autoComplete="name" value={fullName} onChange={event => setFullName(event.target.value)} className="mt-1.5 h-11 w-full rounded-xl border border-ink-200 bg-white px-3 text-sm text-ink-900 outline-none focus:border-accent-500 focus:ring-4 focus:ring-accent-100" placeholder="Your name" /></label>}
              <label className="block text-xs font-semibold text-ink-700">Email address<span className="relative mt-1.5 block"><Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" size={16} /><input type="email" required autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} className="h-11 w-full rounded-xl border border-ink-200 bg-white py-2 pl-10 pr-3 text-sm text-ink-900 outline-none focus:border-accent-500 focus:ring-4 focus:ring-accent-100" placeholder="you@business.com" /></span></label>
              <label className="block text-xs font-semibold text-ink-700"><span className="flex items-center justify-between">Password{!registerMode && tenantMode && <button type="button" onClick={handlePasswordRecovery} disabled={loading || recoveryLoading} className="font-medium text-accent-700 hover:text-accent-900 disabled:opacity-50">{recoveryLoading ? 'Sending link...' : 'Forgot password?'}</button>}</span><span className="relative mt-1.5 block"><Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" size={16} /><input type={showPassword ? 'text' : 'password'} required minLength={registerMode ? 8 : undefined} autoComplete={registerMode ? 'new-password' : 'current-password'} value={password} onChange={event => setPassword(event.target.value)} className="h-11 w-full rounded-xl border border-ink-200 bg-white py-2 pl-10 pr-11 text-sm text-ink-900 outline-none focus:border-accent-500 focus:ring-4 focus:ring-accent-100" placeholder={registerMode ? 'At least 8 characters' : 'Enter your password'} /><button type="button" onClick={() => setShowPassword(value => !value)} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-700" aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></span></label>
              <button type="submit" disabled={loading} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-accent-500 to-violet-500 text-sm font-semibold text-white shadow-md shadow-indigo-500/20 transition hover:-translate-y-0.5 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-50">{loading ? <><Loader2 className="animate-spin" size={17} /> Please wait...</> : registerMode ? <><UserRoundPlus size={16} /> Request access</> : <>Sign in <ArrowRight size={16} /></>}</button>
            </form>

            {!tenantMode && <form onSubmit={openWorkspace} className="mt-5 border-t border-ink-100 pt-4"><h3 className="text-xs font-semibold text-ink-800">Choose your workspace</h3><p className="mt-1 text-[11px] leading-5 text-ink-500">Enter the business slug or link provided by your administrator.</p><div className="mt-2 flex gap-2"><input type="text" value={workspaceAddress} onChange={event => { setWorkspaceAddress(event.target.value); setWorkspaceError(''); }} aria-label="Business workspace link or slug" placeholder="your-business" className="h-10 min-w-0 flex-1 rounded-xl border border-ink-200 bg-white px-3 text-sm text-ink-900 outline-none focus:border-accent-500" /><button type="submit" className="shrink-0 rounded-xl bg-accent-50 px-3 text-xs font-semibold text-accent-700 hover:bg-accent-100">Open</button></div>{workspaceError && <p role="alert" className="mt-2 text-xs text-danger">{workspaceError}</p>}</form>}
            {notice && <p role="status" className="mt-4 rounded-xl border border-accent-100 bg-accent-50 px-3 py-3 text-xs leading-5 text-accent-900">{notice}</p>}
            {tenantMode && <div className="mt-4 border-t border-ink-100 pt-4 text-center"><p className="text-[10px] leading-5 text-ink-500">Employee access is limited to approved tenant membership. An administrator must approve new registrations.</p><button type="button" onClick={() => { setRegisterMode(value => !value); setNotice(''); }} className="mt-2 text-xs font-semibold text-accent-700 hover:text-accent-900">{registerMode ? 'Back to sign in' : 'Employee? Request access'}</button></div>}
          </div>
          <p className="mt-4 flex items-center justify-center gap-1.5 text-[10px] text-ink-500"><ShieldCheck size={13} className="text-emerald-700" /> Access is based on your assigned business role.</p>
        </section>
      </div>
    </main>
  );
}
