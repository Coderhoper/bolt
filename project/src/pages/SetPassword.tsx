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
    <div className="flex min-h-screen items-center justify-center bg-ink-50 p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-accent-500">
            <Building2 className="text-white" size={22} />
          </div>
          <h1 className="mt-4 font-display text-xl font-semibold tracking-tight text-ink-900">Business Manager</h1>
          <p className="mt-1 text-sm text-ink-500">Set up your tenant account</p>
        </div>

        <section className="rounded-md border border-ink-100 bg-paper p-8 shadow-xs">
          {!session ? (
            <>
              <h2 className="font-display text-lg font-semibold text-ink-900">This link is no longer active</h2>
              <p className="mt-2 text-sm leading-6 text-ink-600">
                Open the latest invitation or password email. If you have already used the invitation, return to sign in and request a password setup link.
              </p>
              <button type="button" onClick={onReturnToLogin} className="mt-6 w-full rounded-sm bg-accent-500 py-2.5 text-sm font-semibold text-white hover:bg-accent-700">
                Return to sign in
              </button>
            </>
          ) : complete ? (
            <>
              <h2 className="font-display text-lg font-semibold text-ink-900">Password set</h2>
              <p className="mt-2 text-sm leading-6 text-ink-600">
                Your account is ready. Use this tenant link and your email and password to sign in next time.
              </p>
              <button type="button" onClick={onContinue} className="mt-6 w-full rounded-sm bg-accent-500 py-2.5 text-sm font-semibold text-white hover:bg-accent-700">
                Continue to workspace
              </button>
            </>
          ) : (
            <form onSubmit={updatePassword} className="space-y-5">
              <div>
                <h2 className="font-display text-lg font-semibold text-ink-900">Choose your password</h2>
                <p className="mt-1 text-sm text-ink-500">{session.user.email}</p>
              </div>
              <label className="block text-sm font-medium text-ink-700">
                New password
                <span className="relative mt-1.5 block">
                  <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" size={17} />
                  <input
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    required
                    value={password}
                    onChange={event => setPassword(event.target.value)}
                    className="w-full rounded-sm border py-2.5 pl-10 pr-4 text-sm text-ink-900 outline-none focus:ring-2 focus:ring-accent-100 h-10 border-ink-200 bg-paper focus:border-accent-500"
                  />
                </span>
              </label>
              <label className="block text-sm font-medium text-ink-700">
                Confirm password
                <input
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  required
                  value={confirmation}
                  onChange={event => setConfirmation(event.target.value)}
                  className="mt-1.5 w-full rounded-sm border px-4 py-2.5 text-sm text-ink-900 outline-none focus:ring-2 focus:ring-accent-100 h-10 border-ink-200 bg-paper focus:border-accent-500"
                />
              </label>
              {error && <p role="alert" className="rounded-lg bg-danger/10 p-3 text-sm text-danger">{error}</p>}
              <button
                type="submit"
                disabled={busy}
                className="flex h-10 w-full items-center justify-center gap-2 rounded-sm bg-accent-500 text-sm font-semibold text-white transition-colors hover:bg-accent-700 disabled:cursor-not-allowed disabled:opacity-50"
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
