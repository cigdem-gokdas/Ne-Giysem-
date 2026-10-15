import { budgetWrites } from './writeBudget';
import { limit, orderBy, collection, deleteDoc, doc, getDoc, query, where, writeBatch } from 'firebase/firestore';
import { getDocsWithIndexFallback } from './firestoreQuery';
import { firestore } from '../config/firebase';
import { sanitizeUserText } from '../utils/sanitize';
import { deleteOwnedPost } from './postCleanup';
import type { ClothingItem } from './wardrobe';

export type MoodBoard = { id: string; title: string; itemIds: string[]; createdAt: string; isPublic: boolean };
type BoardDoc = Omit<MoodBoard, 'id'> & { userId: string };

export async function getMoodBoards(userId: string): Promise<MoodBoard[]> {
  const base = collection(firestore, 'mood_boards');
  const rows = await getDocsWithIndexFallback(query(base, where('userId', '==', userId), orderBy('createdAt', 'desc'), limit(50)), query(base, where('userId', '==', userId), limit(50)));
  return rows.docs
    .map((snapshot) => ({ id: snapshot.id, ...(snapshot.data() as BoardDoc) }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function createMoodBoard(userId: string, title: string, itemIds: string[]): Promise<MoodBoard> {
  const unique = [...new Set(itemIds)];
  if (!unique.length || unique.length > 12) throw new Error('Panoya 1–12 parça seçmelisin.');
  const user = await getDoc(doc(firestore, 'users', userId));
  if (!user.exists()) throw new Error('Kullanıcı bulunamadı.');

  const clothingRows = await Promise.all(unique.map((id) => getDoc(doc(firestore, 'wardrobe', id))));
  const items: ClothingItem[] = clothingRows.map((clothing, index) => {
    const data = clothing.data();
    if (!clothing.exists() || data?.userId !== userId) throw new Error('Seçilen parçalardan biri gardırobunda bulunamadı.');
    return { id: unique[index], imageUri: data.imageUri, tags: { tur: data.tur, renk: data.renk, desen: data.desen } };
  });

  const ref = doc(collection(firestore, 'mood_boards'));
  const board: MoodBoard = {
    id: ref.id,
    title: sanitizeUserText(title, 80) || 'Benim ilham panom',
    itemIds: unique,
    createdAt: new Date().toISOString(),
    isPublic: user.data().shareBoards === true,
  };
  const writes = [{ ref, data: { userId, title: board.title, itemIds: board.itemIds, createdAt: board.createdAt, isPublic: board.isPublic } }, { ref: doc(firestore, 'posts', ref.id), data: {
    userId,
    kind: 'board',
    title: board.title,
    itemIds: board.itemIds,
    items,
    imageUri: null,
    createdAt: board.createdAt,
    isPublic: board.isPublic,
  } }];
  await budgetWrites(writes);
  return board;
}

export async function deleteMoodBoard(userId: string, id: string): Promise<void> {
  const boardRef = doc(firestore, 'mood_boards', id);
  const board = await getDoc(boardRef);
  if (!board.exists() || board.data().userId !== userId) throw new Error('İlham panosu bulunamadı.');
  if ((await getDoc(doc(firestore, 'posts', id))).exists()) await deleteOwnedPost(userId, id, 'board');
  await deleteDoc(boardRef);
}
