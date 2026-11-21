import * as Google from 'expo-auth-session/providers/google';
import { useCallback, useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { GOOGLE_ANDROID_CLIENT_ID, GOOGLE_IOS_CLIENT_ID, GOOGLE_WEB_CLIENT_ID } from '../config/env';

/** True when a Google OAuth client ID exists for the platform the app is running on. */
export function googleConfiguredForPlatform(): boolean {
  return !!Platform.select({ ios: GOOGLE_IOS_CLIENT_ID, android: GOOGLE_ANDROID_CLIENT_ID, default: GOOGLE_WEB_CLIENT_ID });
}

export const googleAuthConfig = {
  webClientId: GOOGLE_WEB_CLIENT_ID || undefined,
  iosClientId: GOOGLE_IOS_CLIENT_ID || undefined,
  androidClientId: GOOGLE_ANDROID_CLIENT_ID || undefined,
  scopes: ['openid', 'profile', 'email'],
  selectAccount: true,
};

type Pending = { resolve: (idToken: string) => void; reject: (error: Error) => void };

/** Returns a function that prompts for Google and resolves with a fresh id token (used to reauthenticate before account deletion). */
export function useGoogleReauth(): () => Promise<string> {
  const [request, response, promptAsync] = Google.useAuthRequest(googleAuthConfig);
  const pending = useRef<Pending | null>(null);

  useEffect(() => {
    const current = pending.current;
    if (!response || !current) return;
    if (response.type === 'cancel' || response.type === 'dismiss') { pending.current = null; current.reject(new Error('Google doğrulaması iptal edildi. Hesabını silmek için Google ile yeniden doğrulama yapmalısın.')); return; }
    if (response.type === 'error') { pending.current = null; current.reject(new Error('Google oturumu tamamlanamadı. Lütfen tekrar dene.')); return; }
    if (response.type !== 'success') return;
    pending.current = null;
    const idToken = response.authentication?.idToken ?? response.params.id_token;
    if (idToken) current.resolve(idToken); else current.reject(new Error('Google doğrulama bilgisi alınamadı. Lütfen tekrar dene.'));
  }, [response]);

  return useCallback(() => new Promise<string>((resolve, reject) => {
    if (!request) { reject(new Error('Google girişi henüz hazır değil. Lütfen birkaç saniye sonra tekrar dene.')); return; }
    pending.current = { resolve, reject };
    promptAsync().catch(() => { pending.current = null; reject(new Error('Google oturumu açılamadı.')); });
  }), [request, promptAsync]);
}
