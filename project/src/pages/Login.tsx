import { useState, FormEvent } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { isTenantContextActive, supabase } from '@/lib/supabase';
import { Building2, Lock, Mail, Loader2, Eye, EyeOff } from 'lucide-react';

export function Login() {
  const { signIn } = useAuth();
  const { showToast } = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [recoveryLoading, setRecoveryLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await signIn(email, password);
    if (error) showToast(error, 'error');
    else showToast('Welcome back!', 'success');
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
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-ink-700">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" size={18} />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full rounded-sm border py-2 pl-10 pr-4 text-sm text-ink-900 placeholder-ink-400 outline-none transition-colors h-10 border-ink-200 bg-paper focus:border-accent-500"
                  placeholder="admin@business.com"
                />
              </div>
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="block text-sm font-medium text-ink-700">Password</label>
                {isTenantContextActive() && <button
                  type="button"
                  onClick={handlePasswordRecovery}
                  disabled={loading || recoveryLoading}
                  className="text-xs font-medium text-accent-700 hover:text-accent-900 disabled:opacity-50"
                >
                  {recoveryLoading ? 'Sending link…' : 'Forgot password?'}
                </button>}
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" size={18} />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full rounded-sm border py-2 pl-10 pr-10 text-sm text-ink-900 placeholder-ink-400 outline-none transition-colors h-10 border-ink-200 bg-paper focus:border-accent-500"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-700"
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
              {loading ? (
                <>
                  <Loader2 className="animate-spin" size={18} />
                  Signing in...
                </>
              ) : (
                'Sign In'
              )}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-ink-500">
          Contact your administrator for account access
        </p>
      </div>
    </div>
  );
}
