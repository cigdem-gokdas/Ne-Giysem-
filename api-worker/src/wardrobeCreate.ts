import { adminToken, type AdminEnv } from './accountDeletion';
import { HttpError, validStorageKey } from './security';

export async function wardrobeCount(env: AdminEnv, uid: string): Promise<number> {
  const token = await adminToken(env);
  const database = `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
  const result = await fetch(`https://firestore.googleapis.com/v1/${database}:runAggregationQuery`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(5000),
    body: JSON.stringify({ structuredAggregationQuery: {
      structuredQuery: { from: [{ collectionId: 'wardrobe' }], where: { fieldFilter: { field: { fieldPath: 'userId' }, op: 'EQUAL', value: { stringValue: uid } } } },
      aggregations: [{ alias: 'total', count: {} }],
    } }),
  });
  if (!result.ok) throw new HttpError(503, 'Gardırop sınırı kontrol edilemedi.');
  const body = await result.json<Array<{ result?: { aggregateFields?: { total?: { integerValue?: string } } } }>>();
  const count = Number(body[0]?.result?.aggregateFields?.total?.integerValue ?? 0);
  if (!Number.isSafeInteger(count) || count < 0) throw new HttpError(503, 'Gardırop sınırı kontrol edilemedi.');
  return count;
}

// Called only inside the user's Durable Object serialization lock. Free creations cannot race.
export async function createWardrobe(env: AdminEnv, uid: string, input: any, pro: boolean) {
  if (!validStorageKey(input.key, uid) || !input.key.startsWith('wardrobe/')) throw new HttpError(400, 'Kıyafet fotoğrafı geçersiz.');
  const tags = input.tags;
  if (!tags || !['üst','alt','dış giyim','ayakkabı','aksesuar'].includes(tags.tur)
    || !['dar','normal','bol','bilinmiyor'].includes(tags.kesim)
    || !['tişört','gömlek','kazak','pantolon','etek','ceket','kaban','ayakkabı','çanta','kemer','diğer'].includes(tags.altTur)
    || typeof tags.kemerUygun !== 'boolean'
    || !['renk','desen','materialGuess'].every(k => typeof tags[k] === 'string' && tags[k].trim().length > 0 && tags[k].length <= 80)
    || !['secondaryColors','season','styleTags'].every(k => Array.isArray(tags[k]) && tags[k].length <= (k === 'styleTags' ? 8 : 4) && tags[k].every((value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 40))
    || !['günlük','smart casual','resmi','bilinmiyor'].includes(tags.formality)) throw new HttpError(400, 'Etiketler eksik veya geçersiz.');
  const image = await env.IMAGES.head(input.key);
  if (!image?.customMetadata?.accessToken) throw new HttpError(400, 'Fotoğraf yüklemesi bulunamadı.');
  const token = await adminToken(env);
  const database = `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
  const root = `https://firestore.googleapis.com/v1/${database}`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  // Image UUID doubles as an idempotency key: retries cannot create duplicate wardrobe items.
  const id = input.key.split('/').pop().split('.')[0];
  const existing = await fetch(`${root}/wardrobe/${id}`, { headers, signal: AbortSignal.timeout(5000) });
  if (existing.ok) {
    const row = await existing.json<any>();
    if (row.fields?.userId?.stringValue !== uid) throw new HttpError(403, 'Kıyafet başka bir hesaba ait.');
    return { id, imageUri: row.fields.imageUri.stringValue, tags };
  }
  if (existing.status !== 404) throw new HttpError(503, 'Gardırop kontrol edilemedi.');
  if (!pro) {
    if (await wardrobeCount(env, uid) >= 50) throw new HttpError(403, 'Ücretsiz gardırobun 50 parça ile doldu. Bir parça sil veya Ne Giysem Pro’ya geç.', 'wardrobe_limit');
  }
  const imageUri = `${input.origin}/media/${input.key.split('/').map(encodeURIComponent).join('/')}?token=${encodeURIComponent(image.customMetadata.accessToken)}`;
  const data = { userId: uid, imageUri, storageKey: input.key, tur: tags.tur, renk: tags.renk.trim(), desen: tags.desen.trim(), kesim: tags.kesim, altTur: tags.altTur, kemerUygun: tags.kemerUygun, secondaryColors: tags.secondaryColors, season: tags.season, styleTags: tags.styleTags, formality: tags.formality, materialGuess: tags.materialGuess.trim(), createdAt: new Date().toISOString() };
  const fields = Object.fromEntries(Object.entries(data).map(([key, value]) => [key, typeof value === 'boolean' ? { booleanValue: value } : Array.isArray(value) ? { arrayValue: { values: value.map(item => ({ stringValue: item })) } } : { stringValue: value }]));
  const saved = await fetch(`${root}:commit`, { method: 'POST', headers, signal: AbortSignal.timeout(5000), body: JSON.stringify({ writes: [{ update: { name: `${database}/wardrobe/${id}`, fields }, currentDocument: { exists: false } }] }) });
  if (!saved.ok) throw new HttpError(503, 'Kıyafet kaydedilemedi. Yeniden deneyebilirsin.');
  return { id, imageUri, tags };
}
