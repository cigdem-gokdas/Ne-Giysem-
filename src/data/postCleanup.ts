import { forEachPage } from './paging';
import { limit, orderBy, collection, deleteDoc, doc, getDoc, getDocs, query, where, writeBatch } from 'firebase/firestore';
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

  for (const name of ['likes', 'comments']) {
    await forEachPage(query(collection(firestore, name), where('postId', '==', postId)), async (rows) => deleteRefs(rows.map((row) => row.ref)));
  }
  await forEachPage(query(collection(firestore, 'notifications'), where('userId', '==', userId)), async (rows) => {
    await deleteRefs(rows.filter((row) => row.data().postId === postId).map((row) => row.ref));
  });
  await deleteDoc(postRef);
}
