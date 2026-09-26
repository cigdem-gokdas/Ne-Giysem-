import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import { createUserWithEmailAndPassword, GoogleAuthProvider, onAuthStateChanged, reload, sendEmailVerification, signInWithCredential, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { firebaseAuth, firestore } from '../config/firebase';
import { deleteUserAccount } from '../data/account';
import { ensureRegistrationAvailable, resolveLoginEmail, type GoogleProfile, type LocalUser } from '../data/auth';

type AuthContextValue = { user: LocalUser | null; sessionToken: string | null; initializing: boolean; initError: boolean; retryInit: () => void; login: (identifier: string, password: string) => Promise<void>; register: (username: string, email: string, password: string, acceptedTerms: boolean) => Promise<void>; confirmEmailVerification: () => Promise<void>; loginWithGoogle: (profile: GoogleProfile) => Promise<void>; logout: () => Promise<void>; deleteAccount: (currentPassword?: string) => Promise<void> };
const AuthContext = createContext<AuthContextValue | null>(null);

async function profileFor(uid: string, email: string | null): Promise<LocalUser | null> {
  const snapshot = await getDoc(doc(firestore, 'users', uid));
  if (!snapshot.exists()) return null;
  const data = snapshot.data();
  return { id: uid, username: String(data.username ?? 'Stil Dostu'), email, authProvider: data.authProvider === 'google' ? 'google' : 'local', role: data.role === 'admin' ? 'admin' : 'user' };
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<LocalUser | null>(null); const [initializing, setInitializing] = useState(true); const [initError, setInitError] = useState(false); const [retryKey, setRetryKey] = useState(0);
  useEffect(() => {
    let active = true;
    let generation = 0;
    const unsubscribe = onAuthStateChanged(firebaseAuth, (current) => {
      const request = ++generation;
      setInitializing(true);
      setInitError(false);
      void (async () => {
        try {
          const passwordUser = current?.providerData.some((p) => p.providerId === 'password');
          const next = !current || (passwordUser && !current.emailVerified) ? null : await profileFor(current.uid, current.email);
          if (active && request === generation) setUser(next);
        } catch {
          if (active && request === generation) setInitError(true);
        } finally {
          if (active && request === generation) setInitializing(false);
        }
      })();
    }, () => {
      if (active) { setInitError(true); setInitializing(false); }
    });
    return () => { active = false; generation += 1; unsubscribe(); };
  }, [retryKey]);
  const login = useCallback(async (identifier: string, password: string) => { const result = await signInWithEmailAndPassword(firebaseAuth, await resolveLoginEmail(identifier), password); if (!result.user.emailVerified) { await sendEmailVerification(result.user); throw new Error('E-posta adresin henüz doğrulanmamış. Doğrulama bağlantısını yeniden gönderdik.'); } }, []);
  const register = useCallback(async (username: string, email: string, password: string, acceptedTerms: boolean) => {
    if (!acceptedTerms) throw new Error('Kullanıcı Sözleşmesi ve KVKK metnini onaylamalısın.');
    const clean = await ensureRegistrationAvailable(username, email, password); const result = await createUserWithEmailAndPassword(firebaseAuth, clean.email, password);
    await setDoc(doc(firestore, 'users', result.user.uid), { username: clean.username, usernameLower: clean.username.toLocaleLowerCase('tr-TR'), avatarUri: null, avatarKey: null, bio: '', role: 'user', authProvider: 'local', termsAcceptedAt: new Date().toISOString(), shareGallery: true, shareBoards: true, createdAt: serverTimestamp() });
    await sendEmailVerification(result.user);
  }, []);
  const confirmEmailVerification = useCallback(async () => { const current = firebaseAuth.currentUser; if (!current) throw new Error('Doğrulanacak hesap bulunamadı.'); await reload(current); if (!current.emailVerified) throw new Error('E-posta henüz doğrulanmadı. Bağlantıya dokunduktan sonra tekrar dene.'); setUser(await profileFor(current.uid, current.email)); }, []);
  const loginWithGoogle = useCallback(async (profile: GoogleProfile) => { const result = await signInWithCredential(firebaseAuth, GoogleAuthProvider.credential(profile.idToken ?? null, profile.accessToken ?? null)); const ref = doc(firestore, 'users', result.user.uid); if (!(await getDoc(ref)).exists()) { const username = (profile.name.trim() || profile.email.split('@')[0] || 'Stil Dostu').slice(0, 32); await setDoc(ref, { username, usernameLower: username.toLocaleLowerCase('tr-TR'), avatarUri: profile.picture ?? null, avatarKey: null, bio: '', role: 'user', authProvider: 'google', shareGallery: true, shareBoards: true, createdAt: serverTimestamp() }); } setUser(await profileFor(result.user.uid, result.user.email)); }, []);
  const logout = useCallback(async () => { await signOut(firebaseAuth); setUser(null); }, []);
  const deleteAccount = useCallback(async (password?: string) => { if (user) await deleteUserAccount(user.id, password); setUser(null); }, [user]);
  const value = useMemo(() => ({ user, sessionToken: null, initializing, initError, retryInit: () => setRetryKey((v) => v + 1), login, register, confirmEmailVerification, loginWithGoogle, logout, deleteAccount }), [user, initializing, initError, login, register, confirmEmailVerification, loginWithGoogle, logout, deleteAccount]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth(): AuthContextValue { const value = useContext(AuthContext); if (!value) throw new Error('AuthProvider bulunamadı.'); return value; }
export function useUserId(): string { const { user } = useAuth(); if (!user) throw new Error('Oturum açılmadı.'); return user.id; }
