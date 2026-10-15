import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT } from 'jose';
import { HttpError } from './security';
export interface AppleEnv { APPLE_TEAM_ID?: string; APPLE_KEY_ID?: string; APPLE_CLIENT_ID?: string; APPLE_PRIVATE_KEY?: string }
const keys = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));
export async function revokeApple(env: AppleEnv, code: string, subject: string): Promise<void> {
  if (!env.APPLE_TEAM_ID || !env.APPLE_KEY_ID || !env.APPLE_CLIENT_ID || !env.APPLE_PRIVATE_KEY) throw new HttpError(503, 'Apple hesabı silme servisi henüz hazır değil. Verilerin değiştirilmedi.');
  const key = await importPKCS8(env.APPLE_PRIVATE_KEY, 'ES256');
  const secret = await new SignJWT({}).setProtectedHeader({ alg: 'ES256', kid: env.APPLE_KEY_ID }).setIssuer(env.APPLE_TEAM_ID).setSubject(env.APPLE_CLIENT_ID).setAudience('https://appleid.apple.com').setIssuedAt().setExpirationTime('5m').sign(key);
  const tokenResult = await fetch('https://appleid.apple.com/auth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: env.APPLE_CLIENT_ID, client_secret: secret, code, grant_type: 'authorization_code' }), signal: AbortSignal.timeout(8000) });
  const result = await tokenResult.json<{ id_token?: string; refresh_token?: string }>();
  if (!tokenResult.ok || !result.id_token || !result.refresh_token) throw new HttpError(400, 'Apple oturumu yenilenemedi. Hesap silmeyi yeniden dene.');
  try { await jwtVerify(result.id_token, keys, { algorithms: ['RS256'], issuer: 'https://appleid.apple.com', audience: env.APPLE_CLIENT_ID, subject }); }
  catch { throw new HttpError(403, 'Apple hesabı eşleşmedi.'); }
  const revoked = await fetch('https://appleid.apple.com/auth/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: env.APPLE_CLIENT_ID, client_secret: secret, token: result.refresh_token, token_type_hint: 'refresh_token' }), signal: AbortSignal.timeout(8000) });
  if (!revoked.ok) throw new HttpError(503, 'Apple erişimi kaldırılamadı. Silmeyi yeniden dene.');
}
