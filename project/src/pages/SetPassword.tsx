import { useState, type FormEvent } from 'react';
import { Building2, KeyRound, Loader2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';

export function SetPassword({ onContinue, onReturnToLogin }: { onContinue: () => void; onReturnToLogin: () => void }) {
  const { session } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [complete, setComplete] = useState(false);

  const updatePassword = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (password.length < 8) {
      setError('Choose a password with at least 8 characters.');
      return;
    }
    if (password !== confirmation) {
      setError('The passwords do not match.');
      return;
    }

    setBusy(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) setError(updateError.message);
    else setComplete(true);
    setBusy(false);
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 p-4">
      <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900" />
      <div className="relative w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-emerald-500 shadow-lg shadow-blue-500/25">
            <Building2 className="text-white" size={32} />
          </div>
          <h1 className="mt-4 text-2xl font-bold text-white">Business Manager</h1>
          <p className="mt-1 text-sm text-slate-400">Set up your tenant account</p>
        </div>

        <section className="rounded-2xl bg-white/95 p-8 shadow-2xl backdrop-blur-xl">
          {!session ? (
            <>
              <h2 className="text-lg font-semibold text-slate-900">This link is no longer active</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Open the latest invitation or password email. If you have already used the invitation, return to sign in and request a password setup link.
              </p>
              <button type="button" onClick={onReturnToLogin} className="mt-6 w-full rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">
                Return to sign in
              </button>
            </>
          ) : complete ? (
            <>
              <h2 className="text-lg font-semibold text-slate-900">Password set</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Your account is ready. Use this tenant link and your email and password to sign in next time.
              </p>
              <button type="button" onClick={onContinue} className="mt-6 w-full rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">
                Continue to workspace
              </button>
            </>
          ) : (
            <form onSubmit={updatePassword} className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Choose your password</h2>
                <p className="mt-1 text-sm text-slate-500">{session.user.email}</p>
              </div>
              <label className="block text-sm font-medium text-slate-700">
                New password
                <span className="relative mt-1.5 block">
                  <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={17} />
                  <input
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    required
                    value={password}
                    onChange={event => setPassword(event.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-4 text-sm text-slate-900 outline-none focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/20"
                  />
                </span>
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Confirm password
                <input
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  required
                  value={confirmation}
                  onChange={event => setConfirmation(event.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/20"
                />
              </label>
              {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
              <button
                type="submit"
                disabled={busy}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-emerald-600 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-500/20 hover:from-blue-700 hover:to-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? <><Loader2 className="animate-spin" size={17} /> Saving password…</> : 'Set password'}
              </button>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}
