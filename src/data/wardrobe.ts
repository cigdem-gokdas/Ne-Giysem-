import { workerPost } from '../services/workerApi';
import { forEachPage } from './paging';
import { limitedSet, limitedUpdate } from './writeBudget';
import { startAfter, limit, orderBy, collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where, writeBatch, type QueryDocumentSnapshot } from 'firebase/firestore';
import { getDocsWithIndexFallback } from './firestoreQuery';
import { firestore } from '../config/firebase';
import { deleteR2Object, uploadImageToR2, type ImageUploadMetadata } from '../services/r2Storage';
import { deleteOwnedPost } from './postCleanup';

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

export async function getWardrobeCapacity(userId: string): Promise<{ canAdd: boolean; count: number; limit: number | null; pro: boolean }> {
  return workerPost(userId, '/wardrobe-capacity', {});
}

export async function addClothingItem(userId: string, sourceUri: string, tags: ClothingTags, uploadMetadata?: ImageUploadMetadata): Promise<ClothingItem> {
  const upload = await uploadImageToR2(userId, 'wardrobe', sourceUri, uploadMetadata);
  const normalized = { ...tags, kesim: tags.kesim ?? 'bilinmiyor', altTur: tags.altTur ?? 'diğer', kemerUygun: tags.kemerUygun ?? false, secondaryColors: tags.secondaryColors ?? [], season: tags.season ?? [], styleTags: tags.styleTags ?? [], formality: tags.formality ?? 'bilinmiyor', materialGuess: tags.materialGuess ?? 'bilinmiyor' };
  // Retry the same image key once: the server uses it as an idempotency key.
  // Never delete on an ambiguous network failure: the server may already have committed.
  try { return await workerPost<ClothingItem>(userId, '/wardrobe-create', { key: upload.key, tags: normalized }); }
  catch (error) {
    if (error instanceof Error && error.name === 'ProRequiredError') { await deleteR2Object(upload.key).catch(() => undefined); throw error; }
    return workerPost<ClothingItem>(userId, '/wardrobe-create', { key: upload.key, tags: normalized });
  }
}

export async function updateClothingTags(userId: string, id: string, tags: ClothingTags): Promise<ClothingItem> {
  const ref = doc(firestore, 'wardrobe', id);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists() || snapshot.data().userId !== userId) throw new Error('Kıyafet bulunamadı.');
  const cleaned = { tur: tags.tur.trim().toLocaleLowerCase('tr-TR'), renk: tags.renk.trim(), desen: tags.desen.trim(), kesim: tags.kesim ?? 'bilinmiyor', altTur: tags.altTur ?? 'diğer', kemerUygun: tags.kemerUygun ?? false };
  if (!CLOTHING_TYPES.includes(cleaned.tur as typeof CLOTHING_TYPES[number]) || !cleaned.renk || !cleaned.desen || !FIT_TYPES.includes(cleaned.kesim) || !SUBTYPES.includes(cleaned.altTur)) throw new Error('Etiketler eksik veya geçersiz.');
  await limitedUpdate(ref, cleaned);
  return item(id, { ...(snapshot.data() as WardrobeDoc), ...cleaned });
}

export async function deleteClothingItem(userId: string, id: string): Promise<void> {
  const ref = doc(firestore, 'wardrobe', id);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists() || snapshot.data().userId !== userId) throw new Error('Kıyafet bulunamadı.');
  await deleteR2Object(snapshot.data().storageKey);
  await deleteDoc(ref);
}

export async function clearClothingItems(userId: string): Promise<void> {
  await forEachPage(query(collection(firestore, 'wardrobe'), where('userId', '==', userId)), async (rows) => {
    for (const row of rows) { await deleteR2Object(row.data().storageKey); await deleteDoc(row.ref); }
  });
}

export async function resetLocalData(userId: string): Promise<void> {
  await forEachPage(query(collection(firestore, 'posts'), where('userId', '==', userId)), async (rows) => {
    for (const post of rows) {
      const kind = post.data().kind;
      if (kind === 'gallery' || kind === 'board') {
        await deleteR2Object(post.data().storageKey);
        await deleteOwnedPost(userId, post.id, kind);
      }
    }
  });
  await clearClothingItems(userId);
  for (const name of ['mood_boards', 'chat_sessions', 'outfit_history', 'likes', 'comments', 'notifications']) {
    await forEachPage(query(collection(firestore, name), where('userId', '==', userId)), deleteInBatches, name === 'chat_sessions' ? 20 : 50);
  }
}
