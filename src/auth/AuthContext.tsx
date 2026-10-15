import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import { createUserWithEmailAndPassword, GoogleAuthProvider, onIdTokenChanged, reload, sendEmailVerification, signInWithCredential, signInWithEmailAndPassword, signOut, updateProfile, type User } from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { firebaseAuth, firestore } from '../config/firebase';
import { deleteUserAccount } from '../data/account';
import { ensureRegistrationAvailable, resolveLoginEmail, type GoogleProfile, type LocalUser } from '../data/auth';
import { appleCredential } from './apple';
import { authErrorMessage } from './authErrors';

type AuthContextValue = {
  user: LocalUser | null; sessionToken: string | null; initializing: boolean; initError: boolean; verificationEmail: string | null;
  retryInit: () => void; login: (identifier: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string, acceptedTerms: boolean) => Promise<void>;
  confirmEmailVerification: () => Promise<void>; resendVerification: () => Promise<void>;
  loginWithGoogle: (profile: GoogleProfile, acceptedTerms: boolean) => Promise<void>; loginWithApple: (acceptedTerms: boolean) => Promise<void>;
  logout: () => Promise<void>; deleteAccount: (currentPassword?: string) => Promise<void>;
};
const AuthContext = createContext<AuthContextValue | null>(null);
function provider(user: User): LocalUser['authProvider'] {
  return user.providerData.some((p) => p.providerId === 'password') ? 'local' : user.providerData.some((p) => p.providerId === 'apple.com') ? 'apple' : 'google';
}
async function ensureProfile(current: User, preferredName?: string): Promise<LocalUser> {
  if ((await getDoc(doc(firestore, 'account_deletions', current.uid))).exists()) return { id: current.uid, username: 'Hesap siliniyor', email: current.email, authProvider: provider(current), role: 'user', deletionPending: true };
  const ref = doc(firestore, 'users', current.uid);
  let snapshot = await getDoc(ref);
  if (!snapshot.exists()) {
    const username = (preferredName?.trim() || current.displayName?.trim() || 'Stil Dostu').slice(0, 32);
    await setDoc(ref, { username, usernameLower: username.toLocaleLowerCase('tr-TR'), avatarUri: null, avatarKey: null, bio: '', role: 'user', authProvider: provider(current), shareGallery: false, shareBoards: false, createdAt: serverTimestamp() });
    snapshot = await getDoc(ref);
  }
  const claims = (await current.getIdTokenResult()).claims;
  return { id: current.uid, username: String(snapshot.data()?.username ?? 'Stil Dostu'), email: current.email, authProvider: provider(current), role: claims.admin === true ? 'admin' : 'user' };
}
async function saveTerms(uid: string) {
  const ref = doc(firestore, 'account_settings', uid);
  const before = await getDoc(ref);
  if (!before.exists()) await setDoc(ref, { aiConsent: false, termsVersion: '2026-10-03', termsAcceptedAt: serverTimestamp() });
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<LocalUser | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [initError, setInitError] = useState(false);
  const [verificationEmail, setVerificationEmail] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const mutation = useRef(false);
  const verificationSentAt = useRef(0);
  const refreshedVerifiedUser = useRef<string | null>(null);
  useEffect(() => {
    let active = true, generation = 0;
    const unsubscribe = onIdTokenChanged(firebaseAuth, (current) => {
      const request = ++generation;
      // Do not unmount forms during registration or sign-in; secrets stay only in form memory.
      if (mutation.current) return;
      setUser((previous) => previous?.id === current?.uid ? previous : null); setInitError(false);
      void (async () => {
        try {
          if (!current) refreshedVerifiedUser.current = null;
          if (current?.emailVerified && refreshedVerifiedUser.current !== current.uid) {
            // Firestore rules trust the token claim, not the cached User flag. A user who
            // verified by email can otherwise keep an old email_verified=false token until
            // its normal refresh and see every bounded list query rejected.
            refreshedVerifiedUser.current = current.uid;
            await current.getIdToken(true);
          }
          const next = current?.emailVerified ? await ensureProfile(current) : null;
          if (active && request === generation && firebaseAuth.currentUser?.uid === current?.uid) {
            setUser(next); setVerificationEmail(current && !current.emailVerified ? current.email : null);
          }
        } catch { if (active && request === generation) { setUser(null); setInitError(true); } }
        finally { if (active && request === generation) setInitializing(false); }
      })();
    }, () => { if (active) { setUser(null); setInitError(true); setInitializing(false); } });
    return () => { active = false; generation++; unsubscribe(); };
  }, [retryKey]);

  const run = useCallback(async (action: () => Promise<void>) => {
    if (mutation.current) throw new Error('Devam eden işlemin tamamlanmasını bekle.');
    mutation.current = true;
    try { await action(); }
    catch (error) { throw new Error(authErrorMessage(error)); }
    finally { mutation.current = false; setInitializing(false); }
  }, []);
  const resendVerification = useCallback(async () => {
    const current = firebaseAuth.currentUser;
    if (!current || current.emailVerified) throw new Error('Doğrulanacak hesap bulunamadı.');
    if (Date.now() - verificationSentAt.current < 60_000) throw new Error('Yeni bağlantı için bir dakika bekle.');
    verificationSentAt.current = Date.now();
    try { await sendEmailVerification(current); } catch (error) { throw new Error(authErrorMessage(error)); }
  }, []);
  const login = useCallback((identifier: string, password: string) => run(async () => {
    const result = await signInWithEmailAndPassword(firebaseAuth, await resolveLoginEmail(identifier), password);
    if (!result.user.emailVerified) { setUser(null); setVerificationEmail(result.user.email); return; }
    setUser(await ensureProfile(result.user)); setVerificationEmail(null);
  }), [run]);
  const register = useCallback((username: string, email: string, password: string, acceptedTerms: boolean) => run(async () => {
    if (!acceptedTerms) throw new Error('Kullanım koşullarını ve gizlilik metnini okumalısın.');
    const clean = await ensureRegistrationAvailable(username, email, password);
    const result = await createUserWithEmailAndPassword(firebaseAuth, clean.email, password);
    setUser(null); setVerificationEmail(result.user.email);
    await updateProfile(result.user, { displayName: clean.username });
    await ensureProfile(result.user, clean.username);
    await saveTerms(result.user.uid);
    await resendVerification();
  }), [run, resendVerification]);
  const confirmEmailVerification = useCallback(() => run(async () => {
    const current = firebaseAuth.currentUser;
    if (!current) throw new Error('Doğrulanacak hesap bulunamadı.');
    await reload(current);
    if (!current.emailVerified) throw new Error('E-posta henüz doğrulanmadı. Bağlantıya dokunduktan sonra tekrar dene.');
    await current.getIdToken(true); // Refresh email_verified claim before any Firestore/Worker request.
    const next = await ensureProfile(current);
    if (firebaseAuth.currentUser?.uid !== current.uid) throw new Error('Oturum değişti.');
    setUser(next); setVerificationEmail(null);
  }), [run]);
  const loginWithGoogle = useCallback((profile: GoogleProfile, acceptedTerms: boolean) => run(async () => {
    if (!acceptedTerms) throw new Error('Kullanım koşullarını ve gizlilik metnini onaylamalısın.');
    const result = await signInWithCredential(firebaseAuth, GoogleAuthProvider.credential(profile.idToken ?? null, profile.accessToken ?? null));
    if (!result.user.emailVerified) throw new Error('E-posta adresini önce Google hesabında doğrulamalısın.');
    // Only Firebase-verified user fields are trusted, not client-supplied Google profile fields.
    await saveTerms(result.user.uid); setUser(await ensureProfile(result.user)); setVerificationEmail(null);
  }), [run]);
  const loginWithApple = useCallback((acceptedTerms: boolean) => run(async () => {
    if (!acceptedTerms) throw new Error('Kullanım koşullarını ve gizlilik metnini onaylamalısın.');
    const apple = await appleCredential();
    const result = await signInWithCredential(firebaseAuth, apple.credential);
    if (!result.user.emailVerified) throw new Error('Apple e-posta adresini doğrulayamadı.');
    if (apple.name) await updateProfile(result.user, { displayName: apple.name });
    await saveTerms(result.user.uid); setUser(await ensureProfile(result.user)); setVerificationEmail(null);
  }), [run]);
  const logout = useCallback(async () => { await signOut(firebaseAuth); setUser(null); setVerificationEmail(null); }, []);
  const deleteAccount = useCallback(async (password?: string) => { if (!user) throw new Error('Oturum bulunamadı.'); await deleteUserAccount(user.id, password); setUser(null); setVerificationEmail(null); }, [user]);
  const value = useMemo(() => ({ user, sessionToken: null, initializing, initError, verificationEmail, retryInit: () => setRetryKey((v) => v + 1), login, register, confirmEmailVerification, resendVerification, loginWithGoogle, loginWithApple, logout, deleteAccount }), [user, initializing, initError, verificationEmail, login, register, confirmEmailVerification, resendVerification, loginWithGoogle, loginWithApple, logout, deleteAccount]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth(): AuthContextValue { const value = useContext(AuthContext); if (!value) throw new Error('AuthProvider bulunamadı.'); return value; }
export function useUserId(): string { const { user } = useAuth(); if (!user) throw new Error('Oturum açılmadı.'); return user.id; }
