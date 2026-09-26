import { EmailAuthProvider, reauthenticateWithCredential, sendPasswordResetEmail, updatePassword } from 'firebase/auth';
import { firebaseAuth } from '../config/firebase';

export type AuthProvider = 'local' | 'google';
export type UserRole = 'user' | 'admin';
export type LocalUser = { id: string; username: string; email: string | null; authProvider: AuthProvider; role: UserRole };
export type GoogleProfile = { sub: string; email: string; name: string; picture?: string | null; idToken?: string | null; accessToken?: string | null };
export function normalizeUsername(value: string): string { return value.trim().replace(/\s+/g, ' '); }
export function normalizeEmail(value: string): string { return value.trim().toLowerCase(); }

export async function ensureRegistrationAvailable(username: string, email: string, password: string): Promise<{ username: string; email: string }> {
  const cleanedUsername = normalizeUsername(username); const cleanedEmail = normalizeEmail(email);
  if (cleanedUsername.length < 3 || cleanedUsername.length > 32) throw new Error('Kullanıcı adı 3–32 karakter olmalı.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanedEmail)) throw new Error('Geçerli bir e-posta adresi yazmalısın.');
  if (password.length < 6) throw new Error('Şifre en az 6 karakter olmalı.');
  return { username: cleanedUsername, email: cleanedEmail };
}

export async function resolveLoginEmail(identifier: string): Promise<string> {
  const email = normalizeEmail(identifier);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Geçerli bir e-posta adresi yazmalısın.');
  return email;
}

export async function ensurePasswordResettable(identifier: string): Promise<void> { await sendPasswordResetEmail(firebaseAuth, await resolveLoginEmail(identifier)); }
export async function resetPassword(identifier: string): Promise<void> { await ensurePasswordResettable(identifier); }
export async function changePassword(_userId: string, currentPassword: string, newPassword: string): Promise<void> {
  const current = firebaseAuth.currentUser;
  if (!current?.email) throw new Error('Hesap bulunamadı.');
  if (newPassword.length < 6) throw new Error('Şifre en az 6 karakter olmalı.');
  await reauthenticateWithCredential(current, EmailAuthProvider.credential(current.email, currentPassword));
  await updatePassword(current, newPassword);
}
