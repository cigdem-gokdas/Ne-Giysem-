import { SENTRY_DSN } from '../config/env';

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
let sentryStarted = false;

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const JWT = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const SECRET_PARAM = /([?&](?:token|access_token|id_token|key|api_key|apikey|code|password)=)[^&\s]+/gi;
const LONG_TOKEN = /\b[A-Za-z0-9_-]{32,}\b/g;

/** Removes e-mail addresses and credential-looking strings from any text before it leaves the device. */
export function scrubText(value: string): string {
  return value.replace(EMAIL, '[email]').replace(JWT, '[token]').replace(BEARER, 'Bearer [token]')
    .replace(SECRET_PARAM, '$1[redacted]').replace(LONG_TOKEN, '[redacted]');
}

function scrubDeep<T>(value: T, depth = 0): T {
  if (typeof value === 'string') return scrubText(value) as T;
  if (!value || typeof value !== 'object' || depth > 8) return value;
  if (Array.isArray(value)) return value.map((entry) => scrubDeep(entry, depth + 1)) as T;
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    result[key] = /^(authorization|cookie|set-cookie|password|token|idToken|accessToken|email)$/i.test(key) ? '[redacted]' : scrubDeep(entry, depth + 1);
  }
  return result as T;
}

function startSentry(dsn: string): void {
  if (sentryStarted || !dsn) return;
  try {
    // Loaded lazily so a missing native module can never break app start.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sentry = require('@sentry/react-native') as typeof import('@sentry/react-native');
    Sentry.init({
      dsn,
      sendDefaultPii: false,
      enableAutoSessionTracking: true,
      tracesSampleRate: 0,
      attachScreenshot: false,
      attachViewHierarchy: false,
      beforeSend: (event) => {
        const scrubbed = scrubDeep(event) as typeof event;
        delete scrubbed.user;
        if (scrubbed.request) { delete scrubbed.request.cookies; delete scrubbed.request.headers; delete scrubbed.request.data; }
        return scrubbed;
      },
      beforeBreadcrumb: (breadcrumb) => scrubDeep(breadcrumb),
    });
    sentryStarted = true;
    const sentryErrors: ErrorSink = (context, error) => {
      Sentry.withScope((scope) => {
        scope.setTag('context', context);
        Sentry.captureException(error instanceof Error ? error : new Error(typeof error === 'string' ? error : context));
      });
    };
    errorSink = errorSink ?? sentryErrors;
    analyticsSink = analyticsSink ?? ((event) => { Sentry.addBreadcrumb({ category: 'analytics', message: event, level: 'info' }); });
  } catch { /* telemetry must never crash the app */ }
}

/** Registers telemetry sinks. Crash reporting (Sentry) starts only when EXPO_PUBLIC_SENTRY_DSN is set. */
export function registerTelemetry(sinks: { analytics?: AnalyticsSink; errors?: ErrorSink } = {}): void {
  if (sinks.analytics) analyticsSink = sinks.analytics;
  if (sinks.errors) errorSink = sinks.errors;
  startSentry(SENTRY_DSN);
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

/** Turkish user-facing message for an error: keeps our own Turkish messages, maps common technical failures. */
export function describeError(error: unknown, fallback: string): string {
  if (error instanceof Error && (error.name === 'RateLimitError' || error.name === 'ProRequiredError') && error.message) return error.message;
  const mapped = friendlyError(error, '');
  if (mapped) return mapped;
  const message = error instanceof Error ? error.message : '';
  return /[çğıöşüÇĞİÖŞÜ]/.test(message) && message.length < 240 ? message : fallback;
}
