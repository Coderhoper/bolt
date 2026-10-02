import { FormEvent, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { isTenantContextActive, supabase } from '@/lib/supabase';
import { Building2, Lock, Mail, Loader2, Eye, EyeOff, UserRoundPlus } from 'lucide-react';

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
    <div className="flex min-h-screen items-center justify-center bg-ink-50 p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-accent-500">
            <Building2 className="text-white" size={22} />
          </div>
          <h1 className="mt-4 font-display text-xl font-semibold tracking-tight text-ink-900">Business Manager</h1>
          <p className="mt-1 text-sm text-ink-500">Inventory, Sales & Performance System</p>
        </div>

        <div className="w-full rounded-md border border-ink-100 bg-paper p-8 shadow-xs">
          <h2 className="mb-5 font-display text-lg font-semibold text-ink-900">
            {registerMode ? 'Employee registration' : 'Sign in'}
          </h2>
          <form onSubmit={registerMode ? handleRegister : handleSubmit} className="space-y-5">
            {registerMode && (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-700">Full name</label>
                <input
                  type="text"
                  required
                  autoComplete="name"
                  value={fullName}
                  onChange={e => setFullName(e.target.value)}
                  className="h-10 w-full rounded-sm border border-ink-200 bg-paper px-3 py-2 text-sm text-ink-900 outline-none focus:border-accent-500"
                  placeholder="Your name"
                />
              </div>
            )}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-ink-700">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" size={18} />
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="h-10 w-full rounded-sm border border-ink-200 bg-paper py-2 pl-10 pr-4 text-sm text-ink-900 outline-none focus:border-accent-500"
                  placeholder="you@business.com"
                />
              </div>
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="block text-sm font-medium text-ink-700">Password</label>
                {!registerMode && tenantMode && <button
                  type="button"
                  onClick={handlePasswordRecovery}
                  disabled={loading || recoveryLoading}
                  className="text-xs font-medium text-accent-700 hover:text-accent-900 disabled:opacity-50"
                >
                  {recoveryLoading ? 'Sending link...' : 'Forgot password?'}
                </button>}
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" size={18} />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={registerMode ? 8 : undefined}
                  autoComplete={registerMode ? 'new-password' : 'current-password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="h-10 w-full rounded-sm border border-ink-200 bg-paper py-2 pl-10 pr-10 text-sm text-ink-900 outline-none focus:border-accent-500"
                  placeholder={registerMode ? 'At least 8 characters' : '••••••••'}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-700"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-sm bg-accent-500 text-sm font-semibold text-white transition-colors hover:bg-accent-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? <><Loader2 className="animate-spin" size={18} /> Please wait...</> : registerMode
                ? <><UserRoundPlus size={18} /> Request employee access</>
                : 'Sign In'}
            </button>
          </form>

          {!tenantMode && (
            <form onSubmit={openWorkspace} className="mt-5 border-t border-ink-100 pt-4">
              <h3 className="text-sm font-semibold text-ink-800">Employee sign in or registration</h3>
              <p className="mt-1 text-xs leading-5 text-ink-500">
                Open the workspace link from your administrator, or enter its business slug.
              </p>
              <div className="mt-3 flex gap-2">
                <input
                  type="text"
                  value={workspaceAddress}
                  onChange={event => { setWorkspaceAddress(event.target.value); setWorkspaceError(''); }}
                  aria-label="Business workspace link or slug"
                  placeholder="your-business or https://app.example/t/your-business"
                  className="h-10 min-w-0 flex-1 rounded-sm border border-ink-200 bg-paper px-3 text-sm text-ink-900 outline-none focus:border-accent-500"
                />
                <button
                  type="submit"
                  className="shrink-0 rounded-sm border border-ink-300 px-3 text-sm font-medium text-ink-700 hover:bg-ink-50"
                >
                  Open workspace
                </button>
              </div>
              {workspaceError && <p role="alert" className="mt-2 text-xs text-danger">{workspaceError}</p>}
            </form>
          )}

          {notice && <p role="status" className="mt-4 rounded-sm border border-accent-100 bg-accent-50 px-3 py-3 text-sm leading-6 text-accent-900">{notice}</p>}
          {tenantMode && (
            <div className="mt-5 border-t border-ink-100 pt-4 text-center">
              <p className="text-xs leading-5 text-ink-500">
                Employee accounts can record sales and access their own receipts. An administrator must approve registration.
              </p>
              <button
                type="button"
                onClick={() => { setRegisterMode(value => !value); setNotice(''); }}
                className="mt-3 text-sm font-medium text-accent-700 hover:text-accent-900"
              >
                {registerMode ? 'Back to sign in' : 'Employee? Register here'}
              </button>
            </div>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-ink-500">
          {tenantMode ? 'Need administrator access? Contact your business administrator.' : 'Contact your administrator for account access'}
        </p>
      </div>
    </div>
  );
}
