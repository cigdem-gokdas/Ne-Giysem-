import { EmailAuthProvider, deleteUser, reauthenticateWithCredential } from 'firebase/auth';
import { collection, deleteDoc, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { firebaseAuth, firestore } from '../config/firebase';
import { deleteR2Object } from '../services/r2Storage';
import { deleteOwnedPost } from './postCleanup';

async function deleteOwnedRows(collectionName: string, field: string, userId: string): Promise<void> {
  const rows = await getDocs(query(collection(firestore, collectionName), where(field, '==', userId)));
  await Promise.all(rows.docs.map((row) => deleteDoc(row.ref)));
}

export async function deleteUserAccount(userId: string, currentPassword?: string): Promise<void> {
  const current = firebaseAuth.currentUser;
  if (!current || current.uid !== userId) throw new Error('Hesap bulunamadı.');
  if (current.email && current.providerData.some((provider) => provider.providerId === 'password')) {
    if (!currentPassword) throw new Error('Mevcut şifreni yazmalısın.');
    await reauthenticateWithCredential(current, EmailAuthProvider.credential(current.email, currentPassword));
  }

  const posts = await getDocs(query(collection(firestore, 'posts'), where('userId', '==', userId)));
  for (const post of posts.docs) {
    const kind = post.data().kind;
    if (kind === 'gallery' || kind === 'board') await deleteOwnedPost(userId, post.id, kind);
    await deleteR2Object(post.data().storageKey).catch(() => undefined);
  }

  const wardrobe = await getDocs(query(collection(firestore, 'wardrobe'), where('userId', '==', userId)));
  for (const item of wardrobe.docs) {
    await deleteR2Object(item.data().storageKey).catch(() => undefined);
    await deleteDoc(item.ref);
  }

  await deleteOwnedRows('mood_boards', 'userId', userId);
  await deleteOwnedRows('chat_sessions', 'userId', userId);
  await deleteOwnedRows('outfit_history', 'userId', userId);
  await deleteOwnedRows('likes', 'userId', userId);
  await deleteOwnedRows('comments', 'userId', userId);
  await deleteOwnedRows('notifications', 'userId', userId);
  await deleteOwnedRows('reports', 'reporterId', userId);
  await deleteOwnedRows('reports', 'reportedId', userId);
  await deleteOwnedRows('blocked_users', 'blockerId', userId);
  await deleteOwnedRows('blocked_users', 'blockedId', userId);
  await deleteOwnedRows('follows', 'followerId', userId);
  await deleteOwnedRows('follows', 'followedId', userId);
  const profileRef = doc(firestore, 'users', userId);
  const profile = await getDoc(profileRef);
  await deleteR2Object(profile.data()?.avatarKey).catch(() => undefined);
  await deleteDoc(profileRef);
  await deleteUser(current);
}
