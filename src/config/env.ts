// Expo yalnızca herkese açık yapılandırma değerlerini istemci paketine ekler.
export const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim() ?? '';
export const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim() ?? '';
export const GOOGLE_ANDROID_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID?.trim() ?? '';
export const WORKER_URL = process.env.EXPO_PUBLIC_WORKER_URL?.trim().replace(/\/$/, '') ?? '';
