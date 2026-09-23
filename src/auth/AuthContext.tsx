import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import { registerUser, signInUser, type LocalUser } from '../data/auth';
import { initDB } from '../data/database';
import { migrateLegacyDataForUser } from '../data/legacyMigration';

type AuthContextValue = {
  user: LocalUser | null;
  initializing: boolean;
  initError: boolean;
  retryInit: () => void;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<LocalUser | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [initError, setInitError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let active = true;
    setInitializing(true);
    setInitError(false);
    initDB()
      .catch(() => { if (active) setInitError(true); })
      .finally(() => { if (active) setInitializing(false); });
    return () => { active = false; };
  }, [retryKey]);

  const login = useCallback(async (username: string, password: string) => {
    const signedIn = await signInUser(username, password);
    await migrateLegacyDataForUser(signedIn.id);
    setUser(signedIn);
  }, []);

  const register = useCallback(async (username: string, password: string) => {
    const created = await registerUser(username, password);
    await migrateLegacyDataForUser(created.id);
    setUser(created);
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user, initializing, initError,
    retryInit: () => setRetryKey((current) => current + 1),
    login, register, logout: () => setUser(null),
  }), [user, initializing, initError, login, register]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('AuthProvider bulunamadı.');
  return context;
}

export function useUserId(): string {
  const { user } = useAuth();
  if (!user) throw new Error('Oturum açılmadı.');
  return user.id;
}
