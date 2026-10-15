import { HttpError } from './security';

export interface BillingEnv { REVENUECAT_SECRET_KEY?: string; REVENUECAT_ENTITLEMENT?: string; REVENUECAT_ALLOW_SANDBOX?: string; REVENUECAT_SANDBOX_USER_IDS?: string }
export type Plan = { pro: boolean; expiresAt: number; billingReady: boolean };

/** Only server-fetched App Store / Play Store subscriptions can authorize paid features. */
export function verifiedPlan(data: any, env: BillingEnv, now = Date.now(), uid?: string): Plan {
  const entitlement = data?.subscriber?.entitlements?.[env.REVENUECAT_ENTITLEMENT || 'pro'];
  const purchase = data?.subscriber?.subscriptions?.[entitlement?.product_identifier];
  const expiration = Math.max(Date.parse(entitlement?.expires_date) || 0, Date.parse(entitlement?.grace_period_expires_date) || 0);
  const pro = !!purchase && ['app_store', 'play_store'].includes(purchase.store)
    && (purchase.is_sandbox === false || (purchase.is_sandbox === true && (env.REVENUECAT_ALLOW_SANDBOX === 'true' || (!!uid && (env.REVENUECAT_SANDBOX_USER_IDS ?? '').split(',').map(value => value.trim()).includes(uid)))))
    && !purchase.refunded_at && expiration > now;
  return { pro, expiresAt: pro ? expiration : 0, billingReady: true };
}

export async function fetchPlan(uid: string, env: BillingEnv): Promise<Plan> {
  if (!env.REVENUECAT_SECRET_KEY) return { pro: false, expiresAt: 0, billingReady: false };
  const response = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(uid)}`, {
    headers: { Authorization: `Bearer ${env.REVENUECAT_SECRET_KEY}` }, signal: AbortSignal.timeout(8000),
  });
  if (response.status === 404) return { pro: false, expiresAt: 0, billingReady: true };
  if (!response.ok) throw new HttpError(503, 'Abonelik doğrulanamadı. Biraz sonra yeniden dene.');
  return verifiedPlan(await response.json(), env, Date.now(), uid);
}
