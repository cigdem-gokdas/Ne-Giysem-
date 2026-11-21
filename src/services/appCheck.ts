/**
 * Firebase App Check client hook.
 *
 * The Firebase JS SDK has no native attestation provider on React Native (App Check there only supports
 * reCAPTCHA / custom providers for web), so a real token cannot be produced without a native module such
 * as @react-native-firebase/app-check, which this project deliberately does not add yet.
 *
 * `initAppCheck()` is therefore a documented no-op. When the native integration lands (see
 * docs/APP_CHECK_SETUP.md) it should obtain App Check tokens from the native SDK and register them with
 *   import { setAppCheckTokenProvider } from './workerApi';
 *   setAppCheckTokenProvider(async () => (await nativeAppCheck.getToken()).token);
 * so workerApi can attach them as the `X-Firebase-AppCheck` header. Until then no header is sent and the
 * Worker must keep App Check enforcement off.
 */
export function initAppCheck(): void {
  // Intentionally empty: see the comment above.
}
