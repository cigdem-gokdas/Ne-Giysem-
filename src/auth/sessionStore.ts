import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { getUserById, type LocalUser, type UserRole } from '../data/auth';

const SESSION_KEY = 'ne_giysem_session_v1';
const SECRET_KEY = 'ne_giysem_session_secret_v1';
const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const TOKEN_HEADER = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');

export type SessionClaims = { sub: string; role: UserRole; iat: number; exp: number; jti: string };
export type SecureSession = { token: string; claims: SessionClaims; user: LocalUser };

function encodePayload(claims: SessionClaims): string {
  return btoa(JSON.stringify(claims)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodePayload(payload: string): SessionClaims | null {
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '=');
    const value: unknown = JSON.parse(atob(base64));
    if (!value || typeof value !== 'object') return null;
    const claims = value as Partial<SessionClaims>;
    return typeof claims.sub === 'string' && (claims.role === 'user' || claims.role === 'admin')
      && typeof claims.iat === 'number' && typeof claims.exp === 'number' && typeof claims.jti === 'string'
      ? claims as SessionClaims : null;
  } catch { return null; }
}

async function secureOptions(): Promise<SecureStore.SecureStoreOptions> {
  return { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
}

async function getSecret(): Promise<string> {
  const existing = await SecureStore.getItemAsync(SECRET_KEY);
  if (existing) return existing;
  const created = Crypto.randomUUID() + Crypto.randomUUID();
  await SecureStore.setItemAsync(SECRET_KEY, created, await secureOptions());
  return created;
}

async function sign(payload: string, secret: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${secret}:${payload}`);
}

export async function createSecureSession(user: LocalUser): Promise<SecureSession> {
  const now = Date.now();
  const claims: SessionClaims = {
    sub: user.id, role: user.role, iat: now, exp: now + SESSION_LIFETIME_MS, jti: Crypto.randomUUID(),
  };
  const payload = encodePayload(claims);
  const unsignedToken = `${TOKEN_HEADER}.${payload}`;
  const token = `${unsignedToken}.${await sign(unsignedToken, await getSecret())}`;
  await SecureStore.setItemAsync(SESSION_KEY, token, await secureOptions());
  return { token, claims, user };
}

export async function restoreSecureSession(): Promise<SecureSession | null> {
  const token = await SecureStore.getItemAsync(SESSION_KEY);
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_HEADER) { await clearSecureSession(); return null; }
  const payload = parts[1];
  const signature = parts[2];
  const unsignedToken = `${parts[0]}.${payload}`;
  const claims = decodePayload(payload);
  if (!claims || claims.exp <= Date.now() || signature !== await sign(unsignedToken, await getSecret())) {
    await clearSecureSession();
    return null;
  }
  const user = await getUserById(claims.sub);
  if (!user || user.role !== claims.role) { await clearSecureSession(); return null; }
  return { token, claims, user };
}

export async function clearSecureSession(): Promise<void> {
  await SecureStore.deleteItemAsync(SESSION_KEY);
}
