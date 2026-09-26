import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import App from './App';
import { setTenantSupabase } from '@/lib/supabase';

type TenantRuntime = { tenant_name: string; supabase_url: string; publishable_key: string };

export function TenantBootstrap({ slug }: { slug: string }) {
  const [state, setState] = useState<{ ready: boolean; error: string }>({ ready: false, error: '' });

  useEffect(() => {
    let mounted = true;
    const resolve = async () => {
      const ownerUrl = import.meta.env.VITE_OWNER_SUPABASE_URL;
      const ownerPublishableKey = import.meta.env.VITE_OWNER_SUPABASE_ANON_KEY;
      if (!ownerUrl || !ownerPublishableKey) {
        throw new Error('Tenant sign-in is not configured. Please contact your system administrator.');
      }

      // Do not let the owner resolver read or consume invitation tokens from
      // the URL. The tenant client handles those after the correct DB is known.
      const resolver = createClient(ownerUrl, ownerPublishableKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'tenant-runtime-resolver' },
      });
      const { data, error } = await resolver.rpc('resolve_tenant_runtime', { p_slug: slug });
      if (error) throw new Error('Could not load this tenant. Please try again or contact your system administrator.');
      const runtime = (Array.isArray(data) ? data[0] : data) as TenantRuntime | null;
      if (!runtime) throw new Error('This tenant is not active yet. Ask your system administrator to finish onboarding.');
      if (!/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(runtime.supabase_url)
        || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(runtime.publishable_key)) {
        throw new Error('This tenant has an invalid connection configuration. Please contact your system administrator.');
      }

      if (!mounted) return;
      setTenantSupabase(runtime.supabase_url, runtime.publishable_key);
      document.title = `${runtime.tenant_name} · Business Performance System`;
      setState({ ready: true, error: '' });
    };

    void resolve().catch(error => {
      if (mounted) setState({ ready: false, error: error instanceof Error ? error.message : 'Tenant setup could not be loaded.' });
    });
    return () => { mounted = false; };
  }, [slug]);

  if (state.ready) return <App />;
  return <div className="flex min-h-screen items-center justify-center bg-slate-50 p-5">
    <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
      {state.error
        ? <>
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-amber-50 text-amber-700">
            <span aria-hidden="true" className="text-2xl">!</span>
          </div>
          <h1 className="mt-4 text-xl font-bold text-slate-900">Tenant access unavailable</h1>
          <p role="alert" className="mt-2 text-sm leading-6 text-slate-600">{state.error}</p>
          <a href="/" className="mt-5 inline-flex rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Return to sign in</a>
        </>
        : <>
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-b-2 border-blue-600" />
          <h1 className="mt-4 text-lg font-semibold text-slate-900">Connecting to your workspace</h1>
          <p className="mt-2 text-sm text-slate-500">Loading the tenant’s isolated business database.</p>
        </>}
    </section>
  </div>;
}
