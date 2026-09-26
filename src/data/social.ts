import { collection, deleteDoc, doc, getCountFromServer, getDoc, getDocs, query, setDoc, updateDoc, where, writeBatch, type DocumentData, type QueryDocumentSnapshot } from 'firebase/firestore';
import { firestore } from '../config/firebase';
import { deleteR2Object, uploadImageToR2, type ImageUploadMetadata } from '../services/r2Storage';
import { sanitizeUserText } from '../utils/sanitize';
import type { ClothingItem } from './wardrobe';

export type PublicUser = { id: string; username: string; avatarUri: string | null; bio: string };
export type ShareSettings = { gallery: boolean; boards: boolean };
export type SocialPost = { id: string; kind: 'gallery' | 'board'; user: PublicUser; title: string; imageUri: string | null; items: ClothingItem[]; createdAt: string; likeCount: number; commentCount: number; likedByViewer: boolean };

export async function getPublicUser(userId: string): Promise<PublicUser | null> {
  const snapshot = await getDoc(doc(firestore, 'users', userId));
  if (!snapshot.exists()) return null;
  return { id: snapshot.id, username: snapshot.data().username, avatarUri: snapshot.data().avatarUri ?? null, bio: sanitizeUserText(snapshot.data().bio ?? '', 160) };
}

async function blocked(viewerId: string): Promise<Set<string>> {
  const [outgoing, incoming] = await Promise.all([
    getDocs(query(collection(firestore, 'blocked_users'), where('blockerId', '==', viewerId))),
    getDocs(query(collection(firestore, 'blocked_users'), where('blockedId', '==', viewerId))),
  ]);
  return new Set([...outgoing.docs.map((row) => row.data().blockedId), ...incoming.docs.map((row) => row.data().blockerId)]);
}

export async function getDiscoverableUsers(viewerId: string): Promise<PublicUser[]> {
  const [rows, excluded] = await Promise.all([getDocs(collection(firestore, 'users')), blocked(viewerId)]);
  return rows.docs.filter((row) => row.id !== viewerId && !excluded.has(row.id)).map((row) => ({ id: row.id, username: row.data().username, avatarUri: row.data().avatarUri ?? null, bio: sanitizeUserText(row.data().bio ?? '', 160) })).sort((a, b) => a.username.localeCompare(b.username, 'tr'));
}

export async function updateBio(userId: string, bio: string): Promise<void> {
  await updateDoc(doc(firestore, 'users', userId), { bio: sanitizeUserText(bio, 160) });
}

export async function updateAvatar(userId: string, sourceUri: string, metadata: ImageUploadMetadata = {}): Promise<string> {
  const ref = doc(firestore, 'users', userId);
  const before = await getDoc(ref);
  if (!before.exists()) throw new Error('Profil bulunamadı.');
  const upload = await uploadImageToR2(userId, 'avatars', sourceUri, metadata);
  try {
    await updateDoc(ref, { avatarUri: upload.url, avatarKey: upload.key });
  } catch (error) {
    await deleteR2Object(upload.key).catch(() => undefined);
    throw error;
  }
  await deleteR2Object(before.data().avatarKey).catch(() => undefined);
  return upload.url;
}

export async function getShareSettings(userId: string): Promise<ShareSettings> {
  const snapshot = await getDoc(doc(firestore, 'users', userId));
  if (!snapshot.exists()) throw new Error('Profil bulunamadı.');
  return { gallery: snapshot.data().shareGallery !== false, boards: snapshot.data().shareBoards !== false };
}

export async function setShareSetting(userId: string, kind: 'gallery' | 'boards', isPublic: boolean): Promise<void> {
  await updateDoc(doc(firestore, 'users', userId), { [kind === 'gallery' ? 'shareGallery' : 'shareBoards']: isPublic });
  const targetKind = kind === 'gallery' ? 'gallery' : 'board';
  const posts = await getDocs(query(collection(firestore, 'posts'), where('userId', '==', userId)));
  for (let offset = 0; offset < posts.docs.length; offset += 450) {
    const batch = writeBatch(firestore);
    posts.docs.slice(offset, offset + 450).filter((row) => row.data().kind === targetKind).forEach((row) => batch.update(row.ref, { isPublic }));
    await batch.commit();
  }
  if (kind === 'boards') {
    const boards = await getDocs(query(collection(firestore, 'mood_boards'), where('userId', '==', userId)));
    for (let offset = 0; offset < boards.docs.length; offset += 450) {
      const batch = writeBatch(firestore);
      boards.docs.slice(offset, offset + 450).forEach((row) => batch.update(row.ref, { isPublic }));
      await batch.commit();
    }
  }
}

export async function isFollowing(followerId: string, followedId: string): Promise<boolean> {
  return (await getDoc(doc(firestore, 'follows', `${followerId}_${followedId}`))).exists();
}

export async function setFollowing(followerId: string, followedId: string, follow: boolean): Promise<void> {
  if (followerId === followedId) throw new Error('Kendini takip edemezsin.');
  const ref = doc(firestore, 'follows', `${followerId}_${followedId}`);
  if (!follow) { await deleteDoc(ref); return; }
  const [user, outgoing, incoming] = await Promise.all([
    getDoc(doc(firestore, 'users', followedId)),
    getDoc(doc(firestore, 'blocked_users', `${followerId}_${followedId}`)),
    getDoc(doc(firestore, 'blocked_users', `${followedId}_${followerId}`)),
  ]);
  if (!user.exists()) throw new Error('Kullanıcı bulunamadı.');
  if (outgoing.exists() || incoming.exists()) throw new Error('Bu kullanıcıyı takip edemezsin.');
  await setDoc(ref, { followerId, followedId, createdAt: new Date().toISOString() });
}

async function hydrate(posts: QueryDocumentSnapshot<DocumentData>[], viewerId: string): Promise<SocialPost[]> {
  const result = await Promise.all(posts.map(async (post): Promise<SocialPost | null> => {
    const data = post.data();
    const [user, liked, likes, comments] = await Promise.all([
      getPublicUser(data.userId),
      getDoc(doc(firestore, 'likes', `${viewerId}_${post.id}`)),
      getCountFromServer(query(collection(firestore, 'likes'), where('postId', '==', post.id))),
      getCountFromServer(query(collection(firestore, 'comments'), where('postId', '==', post.id))),
    ]);
    if (!user) return null;
    return { id: post.id, kind: data.kind, user, title: sanitizeUserText(data.title ?? '', 160), imageUri: data.imageUri ?? null, items: Array.isArray(data.items) ? data.items : [], createdAt: data.createdAt, likeCount: likes.data().count, commentCount: comments.data().count, likedByViewer: liked.exists() };
  }));
  return result.filter((post): post is SocialPost => post !== null).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getFeedPosts(viewerId: string): Promise<SocialPost[]> {
  const excluded = await blocked(viewerId);
  const rows = await getDocs(query(collection(firestore, 'posts'), where('isPublic', '==', true)));
  return hydrate(rows.docs.filter((row) => !excluded.has(row.data().userId)), viewerId);
}

export async function getPublicPostsForUser(userId: string, viewerId: string): Promise<SocialPost[]> {
  const excluded = await blocked(viewerId);
  if (excluded.has(userId)) return [];
  const rows = await getDocs(query(collection(firestore, 'posts'), where('userId', '==', userId)));
  return hydrate(rows.docs.filter((row) => row.data().isPublic === true), viewerId);
}
