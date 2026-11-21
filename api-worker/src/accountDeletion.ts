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

export type DeletedObject = { size?: number; uploaded?: Date };
const POST_BATCH = 20;

/**
 * Each call removes a bounded amount of data and is safe to resume after disconnects. Posts are deleted in
 * batches of up to 20 per commit (with their likes / comments / notifications) so the whole deletion finishes well
 * inside the 5-minute recent-login window. `onObjectsDeleted` lets the caller refund storage accounting.
 */
export async function deleteAccountChunk(env: AdminEnv, uid: string, idToken: string, onObjectsDeleted?: (objects: DeletedObject[]) => Promise<void>): Promise<{ done: boolean }> {
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
  // Reports FILED AGAINST this user (reportedId) are deliberately kept so abusers cannot erase them by deleting their account.
  // Reports filed BY this user are anonymised below instead of deleted.
  const targets = [
    ['wardrobe','userId'], ['posts','userId'], ['mood_boards','userId'], ['chat_sessions','userId'], ['outfit_history','userId'],
    ['likes','userId'], ['comments','userId'], ['notifications','userId'], ['notifications','actorId'],
    ['reports','reporterId'], ['blocked_users','blockerId'], ['blocked_users','blockedId'],
    ['follows','followerId'], ['follows','followedId'],
  ];
  async function query(collectionId: string, filter: unknown, select = true) {
    return (await api(':runQuery', { structuredQuery: { from: [{ collectionId }], ...(select ? { select: { fields: [{ fieldPath: '__name__' }] } } : {}), where: { fieldFilter: filter }, limit: 100 } })).json<Array<{ document?: { name: string; fields?: Record<string, unknown> } }>>();
  }
  const rows = (collectionId: string, field: string, value: string) => query(collectionId, { field: { fieldPath: field }, op: 'EQUAL', value: { stringValue: value } });
  const rowsIn = (collectionId: string, field: string, values: string[]) => query(collectionId, { field: { fieldPath: field }, op: 'IN', value: { arrayValue: { values: values.map((stringValue) => ({ stringValue })) } } });
  for (const [collectionId, field] of targets) {
    if (collectionId === 'reports') {
      const reports = (await query('reports', { field: { fieldPath: 'reporterId' }, op: 'EQUAL', value: { stringValue: uid } }, false)).flatMap((row) => row.document ? [row.document] : []);
      if (reports.length) {
        // The document id embeds the reporter uid, so recreate each report under a random id with reporterId "deleted".
        await api(':commit', { writes: reports.flatMap((report) => [
          { update: { name: `${database}/reports/deleted_${crypto.randomUUID()}`, fields: { ...report.fields, reporterId: { stringValue: 'deleted' } } }, currentDocument: { exists: false } },
          { delete: report.name },
        ]) });
        return { done: false };
      }
      continue;
    }
    const names = (await rows(collectionId, field, uid)).flatMap((row) => row.document ? [row.document.name] : []);
    // Remove social children while their posts still exist, including other people's comments.
    if (collectionId === 'posts' && names.length) {
      const batch = names.slice(0, POST_BATCH);
      const postIds = batch.map((name) => name.split('/').pop()!);
      const children: string[] = [];
      for (const child of ['likes','comments','notifications']) children.push(...(await rowsIn(child, 'postId', postIds)).flatMap((row) => row.document ? [row.document.name] : []));
      if (children.length) { await api(':commit', { writes: children.map((name) => ({ delete: name })) }); return { done: false }; }
      await api(':commit', { writes: batch.map((name) => ({ delete: name })) });
      return { done: false };
    }
    if (names.length) { await api(':commit', { writes: names.map((name) => ({ delete: name })) }); return { done: false }; }
  }
  for (const folder of ['wardrobe','gallery','avatars']) {
    const objects = await env.IMAGES.list({ prefix: `${folder}/${uid}/`, limit: 100 });
    if (objects.objects.length) {
      await env.IMAGES.delete(objects.objects.map((item) => item.key));
      await onObjectsDeleted?.(objects.objects.map((item) => ({ size: item.size, uploaded: item.uploaded }))).catch(() => undefined);
      return { done: false };
    }
  }
  await api(':commit', { writes: ['users','account_settings','write_limits'].map((collection) => ({ delete: `${database}/${collection}/${uid}` })) });
  const deleted = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${encodeURIComponent(env.FIREBASE_WEB_API_KEY)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken }), signal: AbortSignal.timeout(8000) });
  if (!deleted.ok) throw new HttpError(503, 'Veri temizliği tamamlandı; hesabı kapatmak için yeniden giriş yapıp silmeyi tekrar dene.');
  return { done: true };
}
