import { limitedSet, limitedUpdate } from './writeBudget';
import { limit, orderBy, collection, doc, getDoc, query, setDoc, where } from 'firebase/firestore';
import { getDocsWithIndexFallback } from './firestoreQuery';
import { firestore } from '../config/firebase';
import { deleteR2Object, uploadImageToR2 } from '../services/r2Storage';
import { sanitizeUserText } from '../utils/sanitize';
import { deleteOwnedPost } from './postCleanup';

export type GalleryEntry = { id: string; imageUri: string; note: string; createdAt: string; isPublic: boolean };
type GalleryDoc = { userId: string; kind: 'gallery'; imageUri: string; storageKey: string; title: string; createdAt: string; isPublic: boolean };

export async function getGalleryEntries(userId: string): Promise<GalleryEntry[]> {
  const base = collection(firestore, 'posts');
  const result = await getDocsWithIndexFallback(query(base, where('userId', '==', userId), orderBy('createdAt', 'desc'), limit(50)), query(base, where('userId', '==', userId), limit(50)));
  return result.docs
    .filter((snapshot) => snapshot.data().kind === 'gallery')
    .map((snapshot) => ({ id: snapshot.id, imageUri: snapshot.data().imageUri, note: sanitizeUserText(snapshot.data().title ?? '', 160), createdAt: snapshot.data().createdAt, isPublic: snapshot.data().isPublic === true }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function addGalleryEntry(userId: string, sourceUri: string, note: string): Promise<GalleryEntry> {
  const user = await getDoc(doc(firestore, 'users', userId));
  if (!user.exists()) throw new Error('Kullanıcı bulunamadı.');
  const ref = doc(collection(firestore, 'posts'));
  const upload = await uploadImageToR2(userId, 'gallery', sourceUri);
  const data: GalleryDoc = {
    userId,
    kind: 'gallery',
    imageUri: upload.url,
    storageKey: upload.key,
    title: sanitizeUserText(note, 160),
    createdAt: new Date().toISOString(),
    isPublic: user.data().shareGallery === true,
  };
  try {
    await limitedSet(ref, data);
    return { id: ref.id, imageUri: data.imageUri, note: data.title, createdAt: data.createdAt, isPublic: data.isPublic };
  } catch (error) {
    await deleteR2Object(upload.key).catch(() => undefined);
    throw error;
  }
}

export async function deleteGalleryEntry(userId: string, id: string): Promise<void> {
  const ref = doc(firestore, 'posts', id);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists() || snapshot.data().userId !== userId || snapshot.data().kind !== 'gallery') throw new Error('Fotoğraf bulunamadı.');
  await deleteR2Object(snapshot.data().storageKey);
  await deleteOwnedPost(userId, id, 'gallery');
}
