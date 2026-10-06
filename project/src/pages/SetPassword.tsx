import { useState, type FormEvent } from 'react';
import { KeyRound, Loader2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { BrandLogo } from '@/components/BrandLogo';

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
    <div className="relative isolate flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-white via-[#f5f7ff] to-[#e9efff] p-4">
      <div aria-hidden="true" className="absolute -right-16 -top-20 -z-10 h-80 w-80 rounded-full bg-indigo-200/50 blur-3xl" />
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <BrandLogo size="md" tagline className="justify-center" />
          <p className="mt-1 text-sm text-ink-500">Set up your tenant account</p>
        </div>

        <section className="rounded-3xl border border-white bg-paper p-8 shadow-[0_24px_80px_rgba(48,62,131,0.16)]">
          {!session ? (
            <>
              <h2 className="font-display text-lg font-semibold text-ink-900">This link is no longer active</h2>
              <p className="mt-2 text-sm leading-6 text-ink-600">
                Open the latest invitation or password email. If you have already used the invitation, return to sign in and request a password setup link.
              </p>
              <button type="button" onClick={onReturnToLogin} className="mt-6 w-full rounded-xl bg-accent-500 py-3 text-sm font-semibold text-white hover:bg-accent-700">
                Return to sign in
              </button>
            </>
          ) : complete ? (
            <>
              <h2 className="font-display text-lg font-semibold text-ink-900">Password set</h2>
              <p className="mt-2 text-sm leading-6 text-ink-600">
                Your account is ready. Use this tenant link and your email and password to sign in next time.
              </p>
              <button type="button" onClick={onContinue} className="mt-6 w-full rounded-xl bg-accent-500 py-3 text-sm font-semibold text-white hover:bg-accent-700">
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
                    className="w-full rounded-xl border py-2.5 pl-10 pr-4 text-sm text-ink-900 outline-none focus:ring-4 focus:ring-accent-100 h-11 border-ink-200 bg-paper focus:border-accent-500"
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
                  className="mt-1.5 w-full rounded-xl border px-4 py-2.5 text-sm text-ink-900 outline-none focus:ring-4 focus:ring-accent-100 h-11 border-ink-200 bg-paper focus:border-accent-500"
                />
              </label>
              {error && <p role="alert" className="rounded-lg bg-danger/10 p-3 text-sm text-danger">{error}</p>}
              <button
                type="submit"
                disabled={busy}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent-500 text-sm font-semibold text-white transition-colors hover:bg-accent-700 disabled:cursor-not-allowed disabled:opacity-50"
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
