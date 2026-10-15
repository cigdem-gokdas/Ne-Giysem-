import { Platform } from 'react-native';
import { securePersistence } from './securePersistence';
import { getApp, getApps, initializeApp } from 'firebase/app';
import * as FirebaseAuth from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY?.trim(),
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN?.trim(),
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID?.trim(),
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID?.trim(),
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID?.trim(),
};

if (!firebaseConfig.apiKey || !firebaseConfig.projectId || !firebaseConfig.appId) {
  console.warn('Firebase ortam değişkenleri eksik. .env.local dosyasını yapılandırın.');
}

export const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const firebaseAuth = (() => {
  try {
    const nativePersistence = (FirebaseAuth as typeof FirebaseAuth & { getReactNativePersistence: (storage: typeof securePersistence) => FirebaseAuth.Persistence }).getReactNativePersistence;
    return FirebaseAuth.initializeAuth(firebaseApp, { persistence: Platform.OS === 'web' ? FirebaseAuth.browserSessionPersistence : nativePersistence(securePersistence) });
  } catch (error) {
    if ((error as { code?: string }).code !== 'auth/already-initialized') throw error;
    return FirebaseAuth.getAuth(firebaseApp);
  }
})();

export const firestore = getFirestore(firebaseApp);
