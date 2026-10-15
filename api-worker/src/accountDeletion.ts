import { importPKCS8, SignJWT } from 'jose';
import { HttpError } from './security';

export interface AdminEnv { FIREBASE_PROJECT_ID: string; FIREBASE_WEB_API_KEY: string; FIREBASE_SERVICE_ACCOUNT?: string; IMAGES: R2Bucket }
let cached: { identity: string; token: string; expires: number } | undefined;
export async function adminToken(env: AdminEnv): Promise<string> {
  if (!env.FIREBASE_SERVICE_ACCOUNT) throw new HttpError(503, 'Sunucu veri servisi henüz yapılandırılmadı. Verilerin değiştirilmedi.');
  let account: { project_id: string; client_email: string; private_key: string };
  try { account = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT); } catch { throw new HttpError(503, 'Sunucu veri servisi kullanılamıyor.'); }
  if (account.project_id !== env.FIREBASE_PROJECT_ID || !account.client_email || !account.private_key) throw new HttpError(503, 'Sunucu veri servisi kullanılamıyor.');
  if (cached?.identity === account.client_email && cached.expires > Date.now()) return cached.token;
  const key = await importPKCS8(account.private_key, 'RS256');
  const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/datastore' }).setProtectedHeader({ alg: 'RS256' })
    .setIssuer(account.client_email).setAudience('https://oauth2.googleapis.com/token').setIssuedAt().setExpirationTime('1h').sign(key);
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }), signal: AbortSignal.timeout(8000) });
  const body = await response.json<{ access_token?: string }>();
  if (!response.ok || !body.access_token) throw new HttpError(503, 'Sunucu veri servisi yetkilendirilemedi.');
  cached = { identity: account.client_email, token: body.access_token, expires: Date.now() + 3_000_000 };
  return body.access_token;
}

/** Each call deletes at most 100 documents or 100 images; safe to resume after disconnects. */
export async function deleteAccountChunk(env: AdminEnv, uid: string, idToken: string): Promise<{ done: boolean }> {
  const token = await adminToken(env); // Validate infrastructure BEFORE any destructive operation.
  const database = `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
  const root = `https://firestore.googleapis.com/v1/${database}`;
  async function api(path: string, body: unknown) {
    const response = await fetch(`${root}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new HttpError(503, 'Hesap temizliği tamamlanamadı. Aynı işlemi tekrar deneyebilirsin.');
    return response;
  }
  // Tombstone denies all client data access even while an old ID token is still valid.
  await api(':commit', { writes: [{ update: { name: `${database}/account_deletions/${uid}`, fields: { started: { timestampValue: new Date().toISOString() } } } }] });
  const targets = [
    ['wardrobe','userId'], ['posts','userId'], ['mood_boards','userId'], ['chat_sessions','userId'], ['outfit_history','userId'],
    ['likes','userId'], ['comments','userId'], ['notifications','userId'], ['notifications','actorId'],
    ['reports','reporterId'], ['reports','reportedId'], ['blocked_users','blockerId'], ['blocked_users','blockedId'],
    ['follows','followerId'], ['follows','followedId'],
  ];
  async function rows(collectionId: string, field: string, value: string) {
    return (await api(':runQuery', { structuredQuery: { from: [{ collectionId }], select: { fields: [{ fieldPath: '__name__' }] }, where: { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: { stringValue: value } } }, limit: 100 } })).json<Array<{ document?: { name: string } }>>();
  }
  for (const [collectionId, field] of targets) {
    const names = (await rows(collectionId, field, uid)).flatMap((row) => row.document ? [row.document.name] : []);
    // Remove social children while their post still exists, including other people's comments.
    if (collectionId === 'posts') {
      for (const name of names) {
        for (const child of ['likes','comments','notifications']) {
          const children = (await rows(child, 'postId', name.split('/').pop()!)).flatMap((row) => row.document ? [row.document.name] : []);
          if (children.length) { await api(':commit', { writes: children.map((name) => ({ delete: name })) }); return { done: false }; }
        }
        // One post per call keeps subrequests bounded independently of social volume.
        await api(':commit', { writes: [{ delete: name }] });
        return { done: false };
      }
    }
    if (names.length) { await api(':commit', { writes: names.map((name) => ({ delete: name })) }); return { done: false }; }
  }
  for (const folder of ['wardrobe','gallery','avatars']) {
    const objects = await env.IMAGES.list({ prefix: `${folder}/${uid}/`, limit: 100 });
    if (objects.objects.length) { await env.IMAGES.delete(objects.objects.map((item) => item.key)); return { done: false }; }
  }
  await api(':commit', { writes: ['users','account_settings','write_limits'].map((collection) => ({ delete: `${database}/${collection}/${uid}` })) });
  const deleted = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${encodeURIComponent(env.FIREBASE_WEB_API_KEY)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken }), signal: AbortSignal.timeout(8000) });
  if (!deleted.ok) throw new HttpError(503, 'Veri temizliği tamamlandı; hesabı kapatmak için yeniden giriş yapıp silmeyi tekrar dene.');
  return { done: true };
}
