/** Apple's native SDK reports failures with codes such as ERR_REQUEST_CANCELED. */
function appleErrorMessage(code: string): string | null {
  switch (code) {
    case 'ERR_REQUEST_CANCELED': return 'Apple ile giriş iptal edildi.';
    case 'ERR_REQUEST_FAILED':
    case 'ERR_REQUEST_NOT_HANDLED':
    case 'ERR_REQUEST_UNKNOWN':
    case 'ERR_REQUEST_NOT_INTERACTIVE': return 'Apple ile giriş tamamlanamadı. Lütfen tekrar dene.';
    case 'ERR_INVALID_RESPONSE': return 'Apple oturumu doğrulanamadı. Lütfen tekrar dene.';
    case 'ERR_APPLE_AUTHENTICATION_UNAVAILABLE': return 'Apple ile giriş bu cihazda kullanılamıyor.';
    default: return null;
  }
}

export function authErrorMessage(error: unknown): string {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
  if (['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found', 'auth/user-disabled'].includes(code)) return 'E-posta veya şifre doğrulanamadı.';
  if (code === 'auth/email-already-in-use') return 'Bu bilgilerle kayıt tamamlanamadı. Giriş yapmayı veya şifre sıfırlamayı dene.';
  if (code === 'auth/too-many-requests') return 'Çok fazla deneme yapıldı. Bir süre bekleyip yeniden dene.';
  if (code === 'auth/requires-recent-login') return 'Bu işlem için hesabına yeniden giriş yapmalısın.';
  if (code === 'auth/network-request-failed') return 'İnternet bağlantını kontrol edip tekrar dene.';
  if (code.startsWith('auth/')) return 'Oturum işlemi tamamlanamadı. Lütfen tekrar dene.';
  const apple = appleErrorMessage(code);
  if (apple) return apple;
  // Raw English SDK text must not reach the UI; the app's own messages are Turkish.
  if (error instanceof Error && /[çğıöşüÇĞİÖŞÜ]/.test(error.message)) return error.message;
  return 'İşlem tamamlanamadı. Lütfen tekrar dene.';
}
