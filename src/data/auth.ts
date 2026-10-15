import { EmailAuthProvider, reauthenticateWithCredential, sendPasswordResetEmail, updatePassword } from 'firebase/auth';
import { firebaseAuth } from '../config/firebase';

export type AuthProvider = 'local' | 'google' | 'apple';
export type UserRole = 'user' | 'admin';
export type LocalUser = { id: string; username: string; email: string | null; authProvider: AuthProvider; role: UserRole; deletionPending?: boolean };
export type GoogleProfile = { sub: string; email: string; name: string; picture?: string | null; idToken?: string | null; accessToken?: string | null };
export function normalizeUsername(value: string): string { return value.trim().replace(/\s+/g, ' '); }
export function normalizeEmail(value: string): string { return value.trim().toLowerCase(); }

export async function ensureRegistrationAvailable(username: string, email: string, password: string): Promise<{ username: string; email: string }> {
  const cleanedUsername = normalizeUsername(username); const cleanedEmail = normalizeEmail(email);
  if (cleanedUsername.length < 3 || cleanedUsername.length > 32) throw new Error('Kullanıcı adı 3–32 karakter olmalı.');
  if (cleanedEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanedEmail)) throw new Error('Geçerli bir e-posta adresi yazmalısın.');
  if (password.length < 12 || password.length > 128) throw new Error('Şifre 12–128 karakter olmalı.');
  return { username: cleanedUsername, email: cleanedEmail };
}

export async function resolveLoginEmail(identifier: string): Promise<string> {
  const email = normalizeEmail(identifier);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Geçerli bir e-posta adresi yazmalısın.');
  return email;
}

export async function ensurePasswordResettable(identifier: string): Promise<void> {
  try { await sendPasswordResetEmail(firebaseAuth, await resolveLoginEmail(identifier)); }
  catch (error) { if ((error as { code?: string }).code !== 'auth/user-not-found') throw error; }
}
export async function resetPassword(identifier: string): Promise<void> { await ensurePasswordResettable(identifier); }
export async function changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
  const current = firebaseAuth.currentUser;
  if (!current?.email || current.uid !== userId) throw new Error('Hesap bulunamadı.');
  if (newPassword.length < 12 || newPassword.length > 128) throw new Error('Şifre 12–128 karakter olmalı.');
  await reauthenticateWithCredential(current, EmailAuthProvider.credential(current.email, currentPassword));
  await updatePassword(current, newPassword);
}
