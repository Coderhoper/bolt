import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { isTenantContextActive, supabase } from '@/lib/supabase';
import type { Profile, UserRole } from '@/types';

interface AuthContextValue {
  session: import('@supabase/supabase-js').Session | null;
  profile: Profile | null;
  loading: boolean;
  isAdmin: boolean;
  canRecordSales: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string, name: string) => Promise<{ error: string | null; hasSession: boolean }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthContextValue['session']>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (!session) setLoading(false);
    }).catch(() => {
      setSession(null);
      setProfile(null);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (!session) {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) {
      setProfile(null);
      return;
    }

    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .maybeSingle();
      let role = data?.role;
      let status = data?.status;
      if (isTenantContextActive()) {
        const { data: membershipResult, error: membershipError } = await supabase.rpc('get_current_tenant_membership');
        const membership = Array.isArray(membershipResult) ? membershipResult[0] : membershipResult;
        if (membershipError || !membership) {
          if (!cancelled) { setProfile(null); setLoading(false); }
          return;
        }
        role = membership.role;
        status = membership.status;
      }

      if (!cancelled) {
        if (data && !error && status === 'active') {
          const profileData: Profile = {
            ...data,
            role,
            status,
            email: session.user.email || '',
          };
          setProfile(profileData);
        } else {
          setProfile(null);
        }
        setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [session]);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message || null };
  };

  const signUp = async (email: string, password: string, name: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      // Tenant membership grants the role after administrator approval. Never
      // accept an administrator role or tenant id from public signup metadata.
      options: {
        data: { name },
        emailRedirectTo: new URL(window.location.pathname, window.location.origin).toString(),
      },
    });
    return { error: error?.message || null, hasSession: Boolean(data.session) };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setProfile(null);
    setSession(null);
  };

  const isAdmin = profile?.role === 'admin';
  const canRecordSales = profile?.role === 'user';

  return (
    <AuthContext.Provider value={{ session, profile, loading, isAdmin, canRecordSales, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function useRequireAdmin() {
  const { isAdmin } = useAuth();
  return isAdmin;
}

export type { UserRole };
