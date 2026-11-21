import { workerPost } from '../services/workerApi';
import { reportError } from '../services/telemetry';
import { forEachPage } from './paging';
import { limitedSet, limitedUpdate } from './writeBudget';
import { startAfter, limit, orderBy, collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where, writeBatch, type QueryDocumentSnapshot } from 'firebase/firestore';
import { getDocsWithIndexFallback } from './firestoreQuery';
import { firestore } from '../config/firebase';
import { deleteR2Object, uploadImageToR2, type ImageUploadMetadata } from '../services/r2Storage';
import { deleteOwnedPost } from './postCleanup';
import { sanitizeUserText } from '../utils/sanitize';
import { isTransientError } from '../utils/retry';

export const FIT_TYPES = ['dar', 'normal', 'bol', 'bilinmiyor'] as const;
export const SUBTYPES = ['tişört', 'gömlek', 'kazak', 'pantolon', 'etek', 'ceket', 'kaban', 'ayakkabı', 'çanta', 'kemer', 'diğer'] as const;
export type ClothingFit = typeof FIT_TYPES[number];
export type ClothingSubtype = typeof SUBTYPES[number];
export type ClothingFormality = 'günlük' | 'smart casual' | 'resmi' | 'bilinmiyor';
export type ClothingTags = {
  tur: string; renk: string; desen: string; kesim?: ClothingFit; altTur?: ClothingSubtype; kemerUygun?: boolean;
  secondaryColors?: string[]; season?: string[]; styleTags?: string[]; formality?: ClothingFormality; materialGuess?: string;
};
export type ClothingItem = { id: string; imageUri: string; tags: ClothingTags };
export const CLOTHING_TYPES = ['üst', 'alt', 'dış giyim', 'ayakkabı', 'aksesuar'] as const;
type WardrobeDoc = { userId: string; imageUri: string; storageKey?: string; tur: string; renk: string; desen: string; kesim?: ClothingFit; altTur?: ClothingSubtype; kemerUygun?: boolean; secondaryColors?: string[]; season?: string[]; styleTags?: string[]; formality?: ClothingFormality; materialGuess?: string; createdAt: string };

function item(id: string, data: WardrobeDoc): ClothingItem {
  return { id, imageUri: data.imageUri, tags: { tur: data.tur, renk: data.renk, desen: data.desen, kesim: data.kesim ?? 'bilinmiyor', altTur: data.altTur ?? 'diğer', kemerUygun: data.kemerUygun ?? false, secondaryColors: data.secondaryColors ?? [], season: data.season ?? [], styleTags: data.styleTags ?? [], formality: data.formality ?? 'bilinmiyor', materialGuess: data.materialGuess ?? 'bilinmiyor' } };
}

async function deleteInBatches(rows: QueryDocumentSnapshot[]): Promise<void> {
  for (let offset = 0; offset < rows.length; offset += 450) {
    const batch = writeBatch(firestore);
    rows.slice(offset, offset + 450).forEach((row) => batch.delete(row.ref));
    await batch.commit();
  }
}

export async function getClothingPage(userId: string, cursor?: QueryDocumentSnapshot): Promise<{ items: ClothingItem[]; cursor?: QueryDocumentSnapshot }> {
  const base = collection(firestore, 'wardrobe');
  const tail = cursor ? [startAfter(cursor)] : [];
  const rows = await getDocsWithIndexFallback(
    query(base, where('userId', '==', userId), orderBy('createdAt', 'desc'), ...tail, limit(100)),
    query(base, where('userId', '==', userId), ...tail, limit(100)),
  );
  const ordered = [...rows.docs].sort((a, b) => String(b.data().createdAt).localeCompare(String(a.data().createdAt)));
  return { items: ordered.map(row => item(row.id, row.data() as WardrobeDoc)), cursor: rows.size === 100 ? rows.docs[rows.docs.length - 1] : undefined };
}

// AI summaries deliberately stay bounded to the latest 100 pieces.
export async function getClothingItems(userId: string): Promise<ClothingItem[]> {
  return (await getClothingPage(userId)).items;
}

/** Fetches pieces by id (boards/chat can reference items older than the loaded 100). Missing or foreign ids are skipped. */
export async function getClothingItemsByIds(userId: string, ids: string[]): Promise<ClothingItem[]> {
  const unique = [...new Set(ids)].filter((id) => typeof id === 'string' && id.length > 0 && !id.includes('/')).slice(0, 200);
  const found: ClothingItem[] = [];
  for (let offset = 0; offset < unique.length; offset += 10) {
    const rows = await Promise.all(unique.slice(offset, offset + 10).map((id) => getDoc(doc(firestore, 'wardrobe', id)).catch(() => null)));
    rows.forEach((row) => { if (row?.exists() && row.data().userId === userId) found.push(item(row.id, row.data() as WardrobeDoc)); });
  }
  return found;
}

/** Items referenced by id that are not in `known`, loaded individually. */
export async function loadMissingClothing(userId: string, known: ClothingItem[], referencedIds: string[]): Promise<ClothingItem[]> {
  const have = new Set(known.map((entry) => entry.id));
  return getClothingItemsByIds(userId, referencedIds.filter((id) => !have.has(id)));
}

export async function getWardrobeCapacity(userId: string): Promise<{ canAdd: boolean; count: number; limit: number | null; pro: boolean }> {
  return workerPost(userId, '/wardrobe-capacity', {});
}

export async function addClothingItem(userId: string, sourceUri: string, tags: ClothingTags, uploadMetadata?: ImageUploadMetadata): Promise<ClothingItem> {
  const upload = await uploadImageToR2(userId, 'wardrobe', sourceUri, uploadMetadata);
  const normalized = { ...tags, renk: sanitizeUserText(tags.renk, 80), desen: sanitizeUserText(tags.desen, 80), kesim: tags.kesim ?? 'bilinmiyor', altTur: tags.altTur ?? 'diğer', kemerUygun: tags.kemerUygun ?? false, secondaryColors: tags.secondaryColors ?? [], season: tags.season ?? [], styleTags: tags.styleTags ?? [], formality: tags.formality ?? 'bilinmiyor', materialGuess: tags.materialGuess ?? 'bilinmiyor' };
  // The server uses the image key as an idempotency key, so a retry cannot create a duplicate piece.
  // Only transient failures (network / 5xx / timeout) are retried.
  let failure: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { return await workerPost<ClothingItem>(userId, '/wardrobe-create', { key: upload.key, tags: normalized }); }
    catch (error) { failure = error; if (!isTransientError(error)) break; }
  }
  // A definitive rejection (limit, validation, Pro required...) means nothing was stored: remove the uploaded image.
  // After repeated transient failures the server may still have committed, so the object is kept rather than risking a broken item.
  if (!isTransientError(failure)) await deleteR2Object(upload.key).catch(() => undefined);
  throw failure;
}

export async function updateClothingTags(userId: string, id: string, tags: ClothingTags): Promise<ClothingItem> {
  const ref = doc(firestore, 'wardrobe', id);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists() || snapshot.data().userId !== userId) throw new Error('Kıyafet bulunamadı.');
  const cleaned = { tur: tags.tur.trim().toLocaleLowerCase('tr-TR'), renk: sanitizeUserText(tags.renk, 80), desen: sanitizeUserText(tags.desen, 80), kesim: tags.kesim ?? 'bilinmiyor', altTur: tags.altTur ?? 'diğer', kemerUygun: tags.kemerUygun ?? false };
  if (!CLOTHING_TYPES.includes(cleaned.tur as typeof CLOTHING_TYPES[number]) || !cleaned.renk || !cleaned.desen || !FIT_TYPES.includes(cleaned.kesim) || !SUBTYPES.includes(cleaned.altTur)) throw new Error('Etiketler eksik veya geçersiz.');
  await limitedUpdate(ref, cleaned);
  return item(id, { ...(snapshot.data() as WardrobeDoc), ...cleaned });
}

export async function deleteClothingItem(userId: string, id: string): Promise<void> {
  const ref = doc(firestore, 'wardrobe', id);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists() || snapshot.data().userId !== userId) throw new Error('Kıyafet bulunamadı.');
  const storageKey = snapshot.data().storageKey;
  // Firestore first: a failed image delete only leaves an orphaned object, never a document with a broken image.
  await deleteDoc(ref);
  await deleteR2Object(storageKey).catch((error) => reportError('r2_delete_after_wardrobe_delete', error));
}

export async function clearClothingItems(userId: string): Promise<void> {
  await forEachPage(query(collection(firestore, 'wardrobe'), where('userId', '==', userId)), async (rows) => {
    for (const row of rows) { const storageKey = row.data().storageKey; await deleteDoc(row.ref); await deleteR2Object(storageKey).catch(() => undefined); }
  });
}

export async function resetLocalData(userId: string): Promise<void> {
  await forEachPage(query(collection(firestore, 'posts'), where('userId', '==', userId)), async (rows) => {
    for (const post of rows) {
      const kind = post.data().kind;
      if (kind === 'gallery' || kind === 'board') {
        const storageKey = post.data().storageKey;
        await deleteOwnedPost(userId, post.id, kind);
        await deleteR2Object(storageKey).catch(() => undefined);
      }
    }
  });
  await clearClothingItems(userId);
  for (const name of ['mood_boards', 'chat_sessions', 'outfit_history', 'likes', 'comments', 'notifications']) {
    await forEachPage(query(collection(firestore, name), where('userId', '==', userId)), deleteInBatches, name === 'chat_sessions' ? 20 : 50);
  }
}
