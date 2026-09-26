import { collection, deleteDoc, doc, getDoc, getDocs, query, where, writeBatch } from 'firebase/firestore';
import { firestore } from '../config/firebase';
import { sanitizeUserText } from '../utils/sanitize';
import { deleteOwnedPost } from './postCleanup';
import type { ClothingItem } from './wardrobe';

export type MoodBoard = { id: string; title: string; itemIds: string[]; createdAt: string; isPublic: boolean };
type BoardDoc = Omit<MoodBoard, 'id'> & { userId: string };

export async function getMoodBoards(userId: string): Promise<MoodBoard[]> {
  const rows = await getDocs(query(collection(firestore, 'mood_boards'), where('userId', '==', userId)));
  return rows.docs
    .map((snapshot) => ({ id: snapshot.id, ...(snapshot.data() as BoardDoc) }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function createMoodBoard(userId: string, title: string, itemIds: string[]): Promise<MoodBoard> {
  const unique = [...new Set(itemIds)];
  if (!unique.length) throw new Error('Panoya en az bir parça seçmelisin.');
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
    isPublic: user.data().shareBoards !== false,
  };
  const batch = writeBatch(firestore);
  batch.set(ref, { userId, title: board.title, itemIds: board.itemIds, createdAt: board.createdAt, isPublic: board.isPublic });
  batch.set(doc(firestore, 'posts', ref.id), {
    userId,
    kind: 'board',
    title: board.title,
    itemIds: board.itemIds,
    items,
    imageUri: null,
    createdAt: board.createdAt,
    isPublic: board.isPublic,
  });
  await batch.commit();
  return board;
}

export async function deleteMoodBoard(userId: string, id: string): Promise<void> {
  const boardRef = doc(firestore, 'mood_boards', id);
  const board = await getDoc(boardRef);
  if (!board.exists() || board.data().userId !== userId) throw new Error('İlham panosu bulunamadı.');
  if ((await getDoc(doc(firestore, 'posts', id))).exists()) await deleteOwnedPost(userId, id, 'board');
  await deleteDoc(boardRef);
}
