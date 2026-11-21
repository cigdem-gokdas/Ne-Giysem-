import Constants from 'expo-constants';
import { Platform } from 'react-native';
import type { PurchasesPackage } from 'react-native-purchases';
import { firebaseAuth } from '../config/firebase';
import { reportError } from '../services/telemetry';
import { REVENUECAT_ANDROID_KEY, REVENUECAT_IOS_KEY, REVENUECAT_MONTHLY_PRODUCT_ID, REVENUECAT_YEARLY_PRODUCT_ID } from '../config/env';

/** True when a store key for this platform is configured. Lets screens skip purchase calls cleanly while billing is not set up. */
export function purchasesConfigured(): boolean {
  if (Constants.appOwnership === 'expo' || !['ios', 'android'].includes(Platform.OS)) return false;
  const apiKey = Platform.OS === 'ios' ? REVENUECAT_IOS_KEY : REVENUECAT_ANDROID_KEY;
  return !!apiKey && (Platform.OS === 'ios' ? /^appl_/ : /^goog_/).test(apiKey);
}

let queue: Promise<unknown> = Promise.resolve();
async function ensureUser(sdk: typeof import('react-native-purchases').default, apiKey: string, uid: string) {
  if (!(await sdk.isConfigured())) sdk.configure({ apiKey, appUserID: uid });
  else if (await sdk.getAppUserID() !== uid) await sdk.logIn(uid);
}
/** Keeps the RevenueCat app user in step with the signed-in Firebase uid. Idempotent and never throws. */
export function syncPurchasesUser(uid: string | null): Promise<void> {
  if (!purchasesConfigured()) return Promise.resolve();
  const task = queue.catch(() => undefined).then(async () => {
    try {
      const apiKey = Platform.OS === 'ios' ? REVENUECAT_IOS_KEY : REVENUECAT_ANDROID_KEY;
      const sdk = (await import('react-native-purchases')).default;
      if (uid) await ensureUser(sdk, apiKey, uid);
      else if (await sdk.isConfigured() && !(await sdk.isAnonymous())) await sdk.logOut();
    } catch (e) { reportError('purchases_login', e); }
  });
  queue = task;
  return task;
}
export function withPurchases<T>(uid: string, operation: (sdk: typeof import('react-native-purchases').default) => Promise<T>): Promise<T> {
  const task = queue.catch(() => undefined).then(async () => {
    const apiKey = Platform.OS === 'ios' ? REVENUECAT_IOS_KEY : REVENUECAT_ANDROID_KEY;
    if (Constants.appOwnership === 'expo' || !['ios', 'android'].includes(Platform.OS)) throw new Error('Satın alma için uygulamanın mağaza veya geliştirme sürümünü kullanmalısın.');
    if (!apiKey || !(Platform.OS === 'ios' ? /^appl_/ : /^goog_/).test(apiKey)) throw new Error('Abonelikler henüz satışa açılmadı.');
    if (firebaseAuth.currentUser?.uid !== uid) throw new Error('Önce hesabına giriş yap.');
    const sdk = (await import('react-native-purchases')).default;
    await ensureUser(sdk, apiKey, uid);
    if (firebaseAuth.currentUser?.uid !== uid) throw new Error('Oturum değişti.');
    const result = await operation(sdk);
    if (firebaseAuth.currentUser?.uid !== uid) throw new Error('Oturum değişti.');
    return result;
  });
  queue = task;
  return task;
}
export async function getPackages(uid: string): Promise<PurchasesPackage[]> {
  return withPurchases(uid, async sdk => {
    const offering = (await sdk.getOfferings()).current;
    // Only recurring monthly / annual subscriptions are supported by server verification.
    const productIds = new Set([REVENUECAT_MONTHLY_PRODUCT_ID, REVENUECAT_YEARLY_PRODUCT_ID]);
    return (offering?.availablePackages ?? []).filter(p => ['MONTHLY', 'ANNUAL'].includes(p.packageType) && productIds.has(p.product.identifier));
  });
}
