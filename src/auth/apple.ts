import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { OAuthProvider } from 'firebase/auth';

export async function appleCredential() {
  const rawNonce = Crypto.randomUUID() + Crypto.randomUUID();
  const nonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
  const result = await AppleAuthentication.signInAsync({ requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL], nonce });
  if (!result.identityToken) throw new Error('Apple oturumu doğrulanamadı.');
  return { credential: new OAuthProvider('apple.com').credential({ idToken: result.identityToken, rawNonce }), authorizationCode: result.authorizationCode, name: [result.fullName?.givenName, result.fullName?.familyName].filter(Boolean).join(' ') };
}
