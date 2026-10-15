import { EmailAuthProvider, reauthenticateWithCredential, signOut } from 'firebase/auth';
import { firebaseAuth } from '../config/firebase';
import { workerPost } from '../services/workerApi';
import { appleCredential } from '../auth/apple';
import { authErrorMessage } from '../auth/authErrors';

export async function deleteUserAccount(userId: string, currentPassword?: string): Promise<void> {
  const current = firebaseAuth.currentUser;
  if (!current || current.uid !== userId) throw new Error('Hesap bulunamadı.');
  let appleAuthorizationCode: string | undefined;
  try {
    // Reauthenticate BEFORE touching any stored data.
    if (current.providerData.some((p) => p.providerId === 'password')) {
      if (!current.email || !currentPassword) throw new Error('Mevcut şifreni yazmalısın.');
      await reauthenticateWithCredential(current, EmailAuthProvider.credential(current.email, currentPassword));
    } else if (current.providerData.some((p) => p.providerId === 'apple.com')) {
      const apple = await appleCredential();
      await reauthenticateWithCredential(current, apple.credential);
      appleAuthorizationCode = apple.authorizationCode ?? undefined;
    }
    const token = await current.getIdTokenResult(true);
    if (Date.now() - Date.parse(token.authTime) > 240_000) throw new Error('Hesabını silmeden önce çıkış yapıp yeniden giriş yapmalısın. Verilerin değiştirilmedi.');
    // Each server chunk is retryable and removes a bounded amount of data.
    for (let chunk = 0; chunk < 1000; chunk++) {
      const result = await workerPost<{ done: boolean }>(userId, '/delete-account', { appleAuthorizationCode });
      if (result.done) { await signOut(firebaseAuth); return; }
    }
    throw new Error('Temizlik devam ediyor. Tamamlamak için hesap silmeyi tekrar başlat.');
  } catch (error) { throw new Error(authErrorMessage(error)); }
}
