import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where, writeBatch, type QueryDocumentSnapshot } from 'firebase/firestore';
import { firestore } from '../config/firebase';
import { deleteR2Object, uploadImageToR2, type ImageUploadMetadata } from '../services/r2Storage';
import { deleteOwnedPost } from './postCleanup';

export const FIT_TYPES = ['dar', 'normal', 'bol', 'bilinmiyor'] as const;
export const SUBTYPES = ['tişört', 'gömlek', 'kazak', 'pantolon', 'etek', 'ceket', 'kaban', 'ayakkabı', 'çanta', 'kemer', 'diğer'] as const;
export type ClothingFit = typeof FIT_TYPES[number];
export type ClothingSubtype = typeof SUBTYPES[number];
export type ClothingTags = { tur: string; renk: string; desen: string; kesim?: ClothingFit; altTur?: ClothingSubtype; kemerUygun?: boolean };
export type ClothingItem = { id: string; imageUri: string; tags: ClothingTags };
export const CLOTHING_TYPES = ['üst', 'alt', 'dış giyim', 'ayakkabı', 'aksesuar'] as const;
type WardrobeDoc = { userId: string; imageUri: string; storageKey?: string; tur: string; renk: string; desen: string; kesim?: ClothingFit; altTur?: ClothingSubtype; kemerUygun?: boolean; createdAt: string };

function item(id: string, data: WardrobeDoc): ClothingItem {
  return { id, imageUri: data.imageUri, tags: { tur: data.tur, renk: data.renk, desen: data.desen, kesim: data.kesim ?? 'bilinmiyor', altTur: data.altTur ?? 'diğer', kemerUygun: data.kemerUygun ?? false } };
}

async function deleteInBatches(rows: QueryDocumentSnapshot[]): Promise<void> {
  for (let offset = 0; offset < rows.length; offset += 450) {
    const batch = writeBatch(firestore);
    rows.slice(offset, offset + 450).forEach((row) => batch.delete(row.ref));
    await batch.commit();
  }
}

export async function getClothingItems(userId: string): Promise<ClothingItem[]> {
  const rows = await getDocs(query(collection(firestore, 'wardrobe'), where('userId', '==', userId)));
  return rows.docs.map((row) => item(row.id, row.data() as WardrobeDoc)).sort((a, b) => b.id.localeCompare(a.id));
}

export async function addClothingItem(userId: string, sourceUri: string, tags: ClothingTags, uploadMetadata?: ImageUploadMetadata): Promise<ClothingItem> {
  const ref = doc(collection(firestore, 'wardrobe'));
  const upload = await uploadImageToR2(userId, 'wardrobe', sourceUri, uploadMetadata);
  const data: WardrobeDoc = { userId, imageUri: upload.url, storageKey: upload.key, tur: tags.tur, renk: tags.renk, desen: tags.desen, kesim: tags.kesim ?? 'bilinmiyor', altTur: tags.altTur ?? 'diğer', kemerUygun: tags.kemerUygun ?? false, createdAt: new Date().toISOString() };
  try { await setDoc(ref, data); return item(ref.id, data); }
  catch (error) { await deleteR2Object(upload.key).catch(() => undefined); throw error; }
}

export async function updateClothingTags(userId: string, id: string, tags: ClothingTags): Promise<ClothingItem> {
  const ref = doc(firestore, 'wardrobe', id);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists() || snapshot.data().userId !== userId) throw new Error('Kıyafet bulunamadı.');
  const cleaned = { tur: tags.tur.trim().toLocaleLowerCase('tr-TR'), renk: tags.renk.trim(), desen: tags.desen.trim(), kesim: tags.kesim ?? 'bilinmiyor', altTur: tags.altTur ?? 'diğer', kemerUygun: tags.kemerUygun ?? false };
  if (!CLOTHING_TYPES.includes(cleaned.tur as typeof CLOTHING_TYPES[number]) || !cleaned.renk || !cleaned.desen || !FIT_TYPES.includes(cleaned.kesim) || !SUBTYPES.includes(cleaned.altTur)) throw new Error('Etiketler eksik veya geçersiz.');
  await updateDoc(ref, cleaned);
  return item(id, { ...(snapshot.data() as WardrobeDoc), ...cleaned });
}

export async function deleteClothingItem(userId: string, id: string): Promise<void> {
  const ref = doc(firestore, 'wardrobe', id);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists() || snapshot.data().userId !== userId) throw new Error('Kıyafet bulunamadı.');
  await deleteDoc(ref);
  await deleteR2Object(snapshot.data().storageKey).catch(() => undefined);
}

export async function clearClothingItems(userId: string): Promise<void> {
  const rows = await getDocs(query(collection(firestore, 'wardrobe'), where('userId', '==', userId)));
  await deleteInBatches(rows.docs);
  await Promise.all(rows.docs.map((row) => deleteR2Object(row.data().storageKey).catch(() => undefined)));
}

export async function resetLocalData(userId: string): Promise<void> {
  const posts = await getDocs(query(collection(firestore, 'posts'), where('userId', '==', userId)));
  for (const post of posts.docs) {
    const kind = post.data().kind;
    if (kind === 'gallery' || kind === 'board') await deleteOwnedPost(userId, post.id, kind);
    await deleteR2Object(post.data().storageKey).catch(() => undefined);
  }
  await clearClothingItems(userId);
  for (const name of ['mood_boards', 'chat_sessions', 'outfit_history', 'likes', 'comments', 'notifications']) {
    const rows = await getDocs(query(collection(firestore, name), where('userId', '==', userId)));
    await deleteInBatches(rows.docs);
  }
}
