// Expo yalnızca herkese açık yapılandırma değerlerini istemci paketine ekler.
export const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim() ?? '';
export const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim() ?? '';
export const GOOGLE_ANDROID_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID?.trim() ?? '';
export const WORKER_URL = process.env.EXPO_PUBLIC_WORKER_URL?.trim().replace(/\/$/, '') ?? '';
export const REVENUECAT_IOS_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY?.trim() ?? '';
export const REVENUECAT_ANDROID_KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY?.trim() ?? '';
export const REVENUECAT_MONTHLY_PRODUCT_ID = process.env.EXPO_PUBLIC_REVENUECAT_MONTHLY_PRODUCT_ID?.trim() || 'ne_giysem_pro_monthly';
export const REVENUECAT_YEARLY_PRODUCT_ID = process.env.EXPO_PUBLIC_REVENUECAT_YEARLY_PRODUCT_ID?.trim() || 'ne_giysem_pro_yearly';

export const SUPPORT_EMAIL = process.env.EXPO_PUBLIC_SUPPORT_EMAIL?.trim() || 'cigdemgokdas01@gmail.com';
