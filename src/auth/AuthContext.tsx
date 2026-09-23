import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import { registerUser, signInUser, upsertGoogleUser, type GoogleProfile, type LocalUser } from '../data/auth';
import { initDB } from '../data/database';
import { migrateLegacyDataForUser } from '../data/legacyMigration';
import { deleteUserAccount } from '../data/account';
import { clearSecureSession, createSecureSession, restoreSecureSession, type SecureSession } from './sessionStore';

type AuthContextValue = {
  session: SecureSession | null;
  user: LocalUser | null;
  sessionToken: string | null;
  initializing: boolean;
  initError: boolean;
  retryInit: () => void;
  login: (identifier: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string, acceptedTerms: boolean) => Promise<void>;
  loginWithGoogle: (profile: GoogleProfile) => Promise<void>;
  logout: () => Promise<void>;
  deleteAccount: (currentPassword?: string) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<SecureSession | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [initError, setInitError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let active = true;
    setInitializing(true);
    setInitError(false);
    initDB().then(restoreSecureSession)
      .then((restored) => { if (active) setSession(restored); })
      .catch(() => { if (active) setInitError(true); })
      .finally(() => { if (active) setInitializing(false); });
    return () => { active = false; };
  }, [retryKey]);

  const activate = useCallback(async (user: LocalUser) => {
    await migrateLegacyDataForUser(user.id);
    setSession(await createSecureSession(user));
  }, []);

  const login = useCallback(async (identifier: string, password: string) => {
    await activate(await signInUser(identifier, password));
  }, [activate]);

  const register = useCallback(async (username: string, email: string, password: string, acceptedTerms: boolean) => {
    await activate(await registerUser(username, email, password, acceptedTerms));
  }, [activate]);

  const loginWithGoogle = useCallback(async (profile: GoogleProfile) => {
    await activate(await upsertGoogleUser(profile));
  }, [activate]);

  const logout = useCallback(async () => {
    await clearSecureSession();
    setSession(null);
  }, []);

  const deleteAccount = useCallback(async (currentPassword?: string) => {
    if (!session) throw new Error('Oturum açılmadı.');
    await deleteUserAccount(session.claims.sub, currentPassword);
    try { await clearSecureSession(); }
    finally { setSession(null); }
  }, [session]);

  const value = useMemo<AuthContextValue>(() => ({
    session, user: session?.user ?? null, sessionToken: session?.token ?? null,
    initializing, initError,
    retryInit: () => setRetryKey((current) => current + 1),
    login, register, loginWithGoogle, logout, deleteAccount,
  }), [session, initializing, initError, login, register, loginWithGoogle, logout, deleteAccount]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('AuthProvider bulunamadı.');
  return context;
}

export function useUserId(): string {
  const { session } = useAuth();
  if (!session) throw new Error('Oturum açılmadı.');
  return session.claims.sub;
}
