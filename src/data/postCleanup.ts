import { collection, deleteDoc, doc, getDoc, getDocs, query, where, writeBatch } from 'firebase/firestore';
import { firestore } from '../config/firebase';

const BATCH_LIMIT = 450;

async function deleteRefs(refs: Array<{ path: string }>): Promise<void> {
  for (let offset = 0; offset < refs.length; offset += BATCH_LIMIT) {
    const batch = writeBatch(firestore);
    refs.slice(offset, offset + BATCH_LIMIT).forEach((ref) => batch.delete(doc(firestore, ref.path)));
    await batch.commit();
  }
}

/** Deletes social children first, then the owned post. Firestore rules repeat the ownership check. */
export async function deleteOwnedPost(userId: string, postId: string, expectedKind: 'gallery' | 'board'): Promise<void> {
  const postRef = doc(firestore, 'posts', postId);
  const post = await getDoc(postRef);
  if (!post.exists() || post.data().userId !== userId || post.data().kind !== expectedKind) {
    throw new Error('Paylaşım bulunamadı veya bu işlemi yapma yetkin yok.');
  }

  const [likes, comments, notifications] = await Promise.all([
    getDocs(query(collection(firestore, 'likes'), where('postId', '==', postId))),
    getDocs(query(collection(firestore, 'comments'), where('postId', '==', postId))),
    getDocs(query(collection(firestore, 'notifications'), where('userId', '==', userId))),
  ]);
  const relatedNotifications = notifications.docs.filter((snapshot) => snapshot.data().postId === postId);
  await deleteRefs([...likes.docs, ...comments.docs, ...relatedNotifications].map((snapshot) => snapshot.ref));
  await deleteDoc(postRef);
}
