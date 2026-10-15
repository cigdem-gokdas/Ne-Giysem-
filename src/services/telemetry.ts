export type AnalyticsEvent =
  | 'wardrobe_item_added' | 'wardrobe_limit_reached'
  | 'ai_auto_tag_started' | 'ai_auto_tag_success' | 'ai_auto_tag_failed'
  | 'stylist_message_sent' | 'free_ai_limit_reached'
  | 'paywall_viewed' | 'purchase_started' | 'purchase_success' | 'purchase_failed'
  | 'restore_purchase' | 'account_deleted';

type SafeValue = string | number | boolean;
type AnalyticsSink = (event: AnalyticsEvent, parameters?: Record<string, SafeValue>) => void | Promise<void>;
type ErrorSink = (context: string, error: unknown) => void | Promise<void>;

let analyticsSink: AnalyticsSink | undefined;
let errorSink: ErrorSink | undefined;

/** Firebase Analytics / Crashlytics can register native sinks here later. */
export function registerTelemetry(sinks: { analytics?: AnalyticsSink; errors?: ErrorSink }): void {
  analyticsSink = sinks.analytics;
  errorSink = sinks.errors;
}

export function track(event: AnalyticsEvent, parameters?: Record<string, SafeValue>): void {
  // Parameters are deliberately restricted: never pass prompts, email, clothing text, image paths or UID.
  void Promise.resolve(analyticsSink?.(event, parameters)).catch(() => undefined);
}

export function reportError(context: string, error: unknown): void {
  void Promise.resolve(errorSink?.(context, error)).catch(() => undefined);
  if (__DEV__) console.warn(`[${context}]`, error);
}

export function friendlyError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.name === 'AbortError') return 'İşlem zaman aşımına uğradı. İnternet bağlantını kontrol edip tekrar dene.';
  const message = error instanceof Error ? error.message : '';
  if (/network|offline|failed to fetch|internet bağlant/i.test(message)) return 'İnternet bağlantısı kurulamadı. Bağlantını kontrol edip tekrar dene.';
  if (/permission|permission-denied|yetki|izin veril/i.test(message)) return 'Bu işlem için hesabının yetkisi doğrulanamadı. Yeniden giriş yapıp tekrar dene.';
  if (/timeout|zaman aş/i.test(message)) return 'İşlem zaman aşımına uğradı. Biraz sonra tekrar dene.';
  return fallback;
}
