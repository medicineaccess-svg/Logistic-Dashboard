import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { Profile } from '../lib/types';
import { ROLE_DEPARTMENT, type Department } from '../lib/constants';

type Scope = Department | 'ALL';

interface AuthState {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  isAdmin: boolean;
  /** Department filter in effect. Non-admins are pinned to their own department (RLS enforces it anyway). */
  scope: Scope;
  setScope: (s: Scope) => void;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

const SCOPE_KEY = 'ikris.scope';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [adminScope, setAdminScope] = useState<Scope>(() => {
    try {
      const v = localStorage.getItem(SCOPE_KEY);
      return v === 'NPP' || v === 'RARE_DISEASE' ? v : 'ALL';
    } catch {
      return 'ALL';
    }
  });

  const loadProfile = useCallback(async (uid: string | undefined) => {
    if (!uid) {
      setProfile(null);
      return;
    }
    const { data } = await supabase.from('profiles').select('*').eq('id', uid).maybeSingle();
    setProfile((data as unknown as Profile | null) ?? null);
  }, []);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      setSession(data.session);
      await loadProfile(data.session?.user.id);
      if (active) setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      // Defer the query out of the auth callback (recommended by supabase-js).
      setTimeout(() => {
        loadProfile(s?.user.id).finally(() => setLoading(false));
      }, 0);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const isAdmin = profile?.role === 'admin' && profile.is_active;
  const pinned = profile ? ROLE_DEPARTMENT[profile.role] : null;
  const scope: Scope = isAdmin ? adminScope : (pinned ?? 'ALL');

  const value = useMemo<AuthState>(
    () => ({
      session,
      profile,
      loading,
      isAdmin,
      scope,
      setScope: (s) => {
        setAdminScope(s);
        try {
          localStorage.setItem(SCOPE_KEY, s);
        } catch {
          /* storage unavailable */
        }
      },
      signOut: async () => {
        await supabase.auth.signOut();
        setProfile(null);
      },
      refreshProfile: () => loadProfile(session?.user.id),
    }),
    [session, profile, loading, isAdmin, scope, loadProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
