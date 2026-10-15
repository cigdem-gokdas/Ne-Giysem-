export function authErrorMessage(error: unknown): string {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
  if (['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found', 'auth/user-disabled'].includes(code)) return 'E-posta veya şifre doğrulanamadı.';
  if (code === 'auth/email-already-in-use') return 'Bu bilgilerle kayıt tamamlanamadı. Giriş yapmayı veya şifre sıfırlamayı dene.';
  if (code === 'auth/too-many-requests') return 'Çok fazla deneme yapıldı. Bir süre bekleyip yeniden dene.';
  if (code === 'auth/requires-recent-login') return 'Bu işlem için hesabına yeniden giriş yapmalısın.';
  if (code === 'auth/network-request-failed') return 'İnternet bağlantını kontrol edip tekrar dene.';
  if (code.startsWith('auth/')) return 'Oturum işlemi tamamlanamadı. Lütfen tekrar dene.';
  return error instanceof Error ? error.message : 'İşlem tamamlanamadı.';
}
