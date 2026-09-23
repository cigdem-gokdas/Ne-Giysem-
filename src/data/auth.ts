import * as Crypto from 'expo-crypto';
import { getDB } from './database';

export type LocalUser = { id: string; username: string };
type UserRow = LocalUser & { password: string };

function normalizeUsername(username: string): string {
  return username.trim().replace(/\s+/g, ' ');
}

async function hashPassword(password: string, salt: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${salt}:${password}`);
}

export async function registerUser(username: string, password: string): Promise<LocalUser> {
  const cleaned = normalizeUsername(username);
  if (cleaned.length < 3 || cleaned.length > 32) throw new Error('Kullanıcı adı 3–32 karakter olmalı.');
  if (password.length < 6) throw new Error('Şifre en az 6 karakter olmalı.');
  const salt = Array.from(await Crypto.getRandomBytesAsync(16), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const digest = await hashPassword(password, salt);
  const user: LocalUser = { id: Crypto.randomUUID(), username: cleaned };
  const db = await getDB();
  try {
    await db.runAsync('INSERT INTO users (id, username, password) VALUES (?, ?, ?)', user.id, user.username, `${salt}$${digest}`);
    return user;
  } catch (error) {
    if (String(error).toLowerCase().includes('unique')) throw new Error('Bu kullanıcı adı zaten kayıtlı.');
    throw error;
  }
}

export async function signInUser(username: string, password: string): Promise<LocalUser> {
  const db = await getDB();
  const row = await db.getFirstAsync<UserRow>('SELECT id, username, password FROM users WHERE username = ? COLLATE NOCASE', normalizeUsername(username));
  if (!row) throw new Error('Kullanıcı adı veya şifre hatalı.');
  const [salt, expected] = row.password.split('$');
  if (!salt || !expected || (await hashPassword(password, salt)) !== expected) {
    throw new Error('Kullanıcı adı veya şifre hatalı.');
  }
  return { id: row.id, username: row.username };
}
