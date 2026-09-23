import * as Crypto from 'expo-crypto';
import { getDB } from './database';

export type AuthProvider = 'local' | 'google';
export type UserRole = 'user' | 'admin';
export type LocalUser = { id: string; username: string; email: string | null; authProvider: AuthProvider; role: UserRole };
export type GoogleProfile = { sub: string; email: string; name: string; picture?: string | null };
type UserRow = { id: string; username: string; email: string | null; password: string; auth_provider: AuthProvider; role: UserRole };

function normalizeUsername(username: string): string {
  return username.trim().replace(/\s+/g, ' ');
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function validateEmail(email: string): string {
  const cleaned = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned) || cleaned.length > 254) {
    throw new Error('Geçerli bir e-posta adresi yazmalısın.');
  }
  return cleaned;
}

function validatePassword(password: string): void {
  if (password.length < 6) throw new Error('Şifre en az 6 karakter olmalı.');
}

async function passwordRecord(password: string): Promise<string> {
  const salt = Array.from(await Crypto.getRandomBytesAsync(16), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${salt}:${password}`);
  return `${salt}$${digest}`;
}

async function passwordMatches(password: string, record: string): Promise<boolean> {
  const [salt, expected] = record.split('$');
  if (!salt || !expected) return false;
  const actual = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${salt}:${password}`);
  return actual === expected;
}

function toUser(row: UserRow): LocalUser {
  return { id: row.id, username: row.username, email: row.email, authProvider: row.auth_provider, role: row.role };
}

export async function ensureRegistrationAvailable(username: string, email: string, password: string): Promise<{ username: string; email: string }> {
  const cleanedUsername = normalizeUsername(username);
  const cleanedEmail = validateEmail(email);
  if (cleanedUsername.length < 3 || cleanedUsername.length > 32) throw new Error('Kullanıcı adı 3–32 karakter olmalı.');
  validatePassword(password);
  const db = await getDB();
  const exists = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM users WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE', cleanedUsername, cleanedEmail,
  );
  if (exists) throw new Error('Bu kullanıcı adı veya e-posta zaten kayıtlı.');
  return { username: cleanedUsername, email: cleanedEmail };
}

export async function registerUser(username: string, email: string, password: string, acceptedTerms: boolean): Promise<LocalUser> {
  if (!acceptedTerms) throw new Error('Kullanıcı Sözleşmesi ve KVKK metnini onaylamalısın.');
  const clean = await ensureRegistrationAvailable(username, email, password);
  const user: LocalUser = { id: Crypto.randomUUID(), username: clean.username, email: clean.email, authProvider: 'local', role: 'user' };
  const db = await getDB();
  try {
    await db.runAsync(
      'INSERT INTO users (id, username, email, password, auth_provider, role, terms_accepted_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      user.id, user.username, user.email, await passwordRecord(password), user.authProvider, user.role, new Date().toISOString(),
    );
    return user;
  } catch (error) {
    if (String(error).toLowerCase().includes('unique')) throw new Error('Bu kullanıcı adı veya e-posta zaten kayıtlı.');
    throw error;
  }
}

export async function signInUser(identifier: string, password: string): Promise<LocalUser> {
  const db = await getDB();
  const cleaned = identifier.trim();
  const row = await db.getFirstAsync<UserRow>(
    `SELECT id, username, email, password, auth_provider, role FROM users
     WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE`, cleaned, normalizeEmail(cleaned),
  );
  if (!row || row.auth_provider === 'google' || !(await passwordMatches(password, row.password))) {
    throw new Error('Kullanıcı adı/e-posta veya şifre hatalı.');
  }
  return toUser(row);
}

export async function ensurePasswordResettable(identifier: string): Promise<void> {
  const db = await getDB();
  const cleaned = identifier.trim();
  const row = await db.getFirstAsync<{ auth_provider: AuthProvider }>(
    'SELECT auth_provider FROM users WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE', cleaned, normalizeEmail(cleaned),
  );
  if (!row) throw new Error('Bu bilgilerle eşleşen bir hesap bulunamadı.');
  if (row.auth_provider === 'google') throw new Error('Bu hesap Google ile giriş kullanıyor.');
}

export async function resetPassword(identifier: string, newPassword: string): Promise<void> {
  validatePassword(newPassword);
  await ensurePasswordResettable(identifier);
  const db = await getDB();
  const cleaned = identifier.trim();
  const result = await db.runAsync(
    `UPDATE users SET password = ?
     WHERE (username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE) AND auth_provider = 'local'`,
    await passwordRecord(newPassword), cleaned, normalizeEmail(cleaned),
  );
  if (result.changes !== 1) throw new Error('Şifre güncellenemedi.');
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
  validatePassword(newPassword);
  const db = await getDB();
  const row = await db.getFirstAsync<{ password: string; auth_provider: AuthProvider }>(
    'SELECT password, auth_provider FROM users WHERE id = ?', userId,
  );
  if (!row) throw new Error('Hesap bulunamadı.');
  if (row.auth_provider === 'google') throw new Error('Google hesabının şifresi Google tarafından yönetilir.');
  if (!(await passwordMatches(currentPassword, row.password))) throw new Error('Mevcut şifren doğru değil.');
  await db.runAsync('UPDATE users SET password = ? WHERE id = ?', await passwordRecord(newPassword), userId);
}

export async function verifyAccountDeletion(userId: string, currentPassword?: string): Promise<void> {
  const db = await getDB();
  const row = await db.getFirstAsync<{ password: string; auth_provider: AuthProvider }>(
    'SELECT password, auth_provider FROM users WHERE id = ?', userId,
  );
  if (!row) throw new Error('Hesap bulunamadı.');
  if (row.auth_provider === 'local') {
    if (!currentPassword || !(await passwordMatches(currentPassword, row.password))) {
      throw new Error('Mevcut şifren doğru değil.');
    }
  }
}

function googleUsername(name: string, email: string): string {
  const source = normalizeUsername(name) || email.split('@')[0] || 'Stil Dostu';
  const cleaned = source.replace(/[^\p{L}\p{N}_. -]/gu, '').trim().slice(0, 32);
  return cleaned.length >= 3 ? cleaned : `Stil ${cleaned || 'Dostu'}`.slice(0, 32);
}

export async function upsertGoogleUser(profile: GoogleProfile): Promise<LocalUser> {
  const email = validateEmail(profile.email);
  if (!profile.sub.trim()) throw new Error('Google hesabı doğrulanamadı.');
  const db = await getDB();
  const existing = await db.getFirstAsync<UserRow>(
    `SELECT id, username, email, password, auth_provider, role FROM users
     WHERE google_sub = ? OR email = ? COLLATE NOCASE LIMIT 1`, profile.sub, email,
  );
  if (existing) {
    await db.runAsync(
      'UPDATE users SET google_sub = ?, email = COALESCE(email, ?), avatar_uri = COALESCE(avatar_uri, ?) WHERE id = ?',
      profile.sub, email, profile.picture ?? null, existing.id,
    );
    return toUser(existing);
  }

  const base = googleUsername(profile.name, email);
  let username = base;
  let suffix = 1;
  while (await db.getFirstAsync('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE', username)) {
    suffix += 1;
    username = `${base.slice(0, Math.max(3, 31 - String(suffix).length))} ${suffix}`;
  }
  const user: LocalUser = { id: Crypto.randomUUID(), username, email, authProvider: 'google', role: 'user' };
  await db.runAsync(
    `INSERT INTO users (id, username, email, password, auth_provider, google_sub, avatar_uri, role)
     VALUES (?, ?, ?, ?, 'google', ?, ?, 'user')`,
    user.id, user.username, user.email, await passwordRecord(Crypto.randomUUID()), profile.sub, profile.picture ?? null,
  );
  return user;
}

export async function getUserById(userId: string): Promise<LocalUser | null> {
  const db = await getDB();
  const row = await db.getFirstAsync<UserRow>(
    'SELECT id, username, email, password, auth_provider, role FROM users WHERE id = ?', userId,
  );
  return row ? toUser(row) : null;
}
