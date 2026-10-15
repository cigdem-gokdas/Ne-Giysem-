import Constants from 'expo-constants';
import { Platform } from 'react-native';
import type { PurchasesPackage } from 'react-native-purchases';
import { firebaseAuth } from '../config/firebase';
import { REVENUECAT_ANDROID_KEY, REVENUECAT_IOS_KEY, REVENUECAT_MONTHLY_PRODUCT_ID, REVENUECAT_YEARLY_PRODUCT_ID } from '../config/env';

let queue: Promise<unknown> = Promise.resolve();
export function withPurchases<T>(uid: string, operation: (sdk: typeof import('react-native-purchases').default) => Promise<T>): Promise<T> {
  const task = queue.catch(() => undefined).then(async () => {
    const apiKey = Platform.OS === 'ios' ? REVENUECAT_IOS_KEY : REVENUECAT_ANDROID_KEY;
    if (Constants.appOwnership === 'expo' || !['ios', 'android'].includes(Platform.OS)) throw new Error('Satın alma için uygulamanın mağaza veya geliştirme sürümünü kullanmalısın.');
    if (!apiKey || !(Platform.OS === 'ios' ? /^appl_/ : /^goog_/).test(apiKey)) throw new Error('Abonelikler henüz satışa açılmadı.');
    if (firebaseAuth.currentUser?.uid !== uid) throw new Error('Önce hesabına giriş yap.');
    const sdk = (await import('react-native-purchases')).default;
    if (!(await sdk.isConfigured())) sdk.configure({ apiKey, appUserID: uid });
    else if (await sdk.getAppUserID() !== uid) await sdk.logIn(uid);
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
