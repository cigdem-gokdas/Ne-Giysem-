# Firebase App Check entegrasyon notu

Bu proje Firebase JS SDK ile çalışan bir Expo / React Native uygulamasıdır. Native App Check paketi şu anda istemcide kurulu değildir. Worker tarafı ise App Check token doğrulamasını **soft mod**da destekler.

## Worker tarafı (hazır)

- İstemci Worker çağrılarında isteğe bağlı `X-Firebase-AppCheck` başlığı gönderebilir. Worker bu token'ı Firebase'in resmi JWKS anahtarlarıyla doğrular (imza, süre, issuer ve audience: `projects/<FIREBASE_PROJECT_NUMBER>`).
- `FIREBASE_PROJECT_NUMBER` Worker değişkenidir (Firebase Console > Project settings > General > Project number). Proje **kimliği** (`FIREBASE_PROJECT_ID`) ile karıştırma.
- `APP_CHECK_ENFORCE` varsayılanı `"false"` (soft mod): token yoksa veya geçersizse istek **reddedilmez**, yalnızca sonuç ölçülür/loglanır. Böylece eski sürümler, TestFlight ve Apple Review kırılmaz.
- `APP_CHECK_ENFORCE="true"` yapıldığında geçersiz/eksik token 401/403 ile reddedilir. Bunu yalnızca istemci App Check token'ı gönderdiği doğrulandıktan sonra aç.

## Kalan native istemci adımı

Mevcut Auth kalıcılığı ve güvenlik kurallarını riske atmamak için App Check istemcisi ayrı bir dalda eklenmelidir:

1. Firebase Console > App Check > Apps altında iOS uygulaması için App Attest sağlayıcısını aç (bundle ID: uygulamanın gerçek bundle ID'si). Geliştirme cihazlarında Debug provider kullan; debug token'ı repoya yazma.
2. Expo SDK sürümüyle uyumlu native App Check çözümünü kur. Bu özellik Expo Go'da doğrulanamaz; EAS development build gerekir.
3. Alınan token'ı Worker çağrılarına `X-Firebase-AppCheck` başlığıyla ekle (`src/services/workerApi.ts`).
4. Önce Worker soft modunda (`APP_CHECK_ENFORCE=false`) geçersiz/eksik istek oranını ölç; TestFlight, Apple Review ve eski sürümlerin çalıştığını doğrula.
5. Ardından Firestore için Console'da App Check enforcement'ı ve Worker için `APP_CHECK_ENFORCE="true"` ayarını birlikte aç. Enforcement açılmadan App Check'in koruma sağladığını söyleme.

Firebase Storage kullanılmıyor. Kullanıcı görselleri Cloudflare R2'de özel tutuluyor ve yalnız Firebase kimliği doğrulanmış Worker yükleme/silme uçlarından değiştiriliyor. Bu nedenle `storage.rules` dosyası yoktur. Firebase Storage ileride açılırsa varsayılan kapalı kural kullanılmalı ve ayrı güvenlik testleri eklenmelidir.
