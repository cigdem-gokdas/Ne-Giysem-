# Ne giysem?

Expo / React Native stil uygulaması. Firebase Authentication + Firestore, özel Cloudflare R2 bucket ve kimlik doğrulayan Cloudflare Worker kullanır.

## Kurulum

```sh
npm ci
npm --prefix api-worker ci
cp .env.example .env.local
npm start
```

`.env.local` dosyasındaki Firebase, OAuth ve Worker değerlerini kendi projenle doldur. E-posta/şifre, Google ve Apple sağlayıcılarını Firebase Console'da etkinleştir. Apple Developer hesabında Sign in with Apple capability ve Firebase sağlayıcı ayarlarını tamamla. Google istemci kimlikleri doğru iOS bundle ID / Android paketine bağlı olmalı. Apple ve SecureStore için yeni native development/TestFlight build gerekir; yalnızca JS güncellemesi yeterli değildir.

Destek adresi: **cigdemgokdas01@gmail.com**. `EXPO_PUBLIC_PRIVACY_URL` ve `EXPO_PUBLIC_TERMS_URL` yayımlanmış gerçek HTTPS metinlerine yönelmeli. Uygulama içindeki açıklamalar veri akışını anlatır; işletmeci bilgisi ve geçerli hukuki metinler yayından önce tamamlanmalı.

## Güvenli yayın sırası

1. [Güvenlik ve yayın raporunu](docs/SECURITY_RELEASE_REVIEW.md) oku. Mevcut veri şemalarını ve eski istemcileri staging ortamında kontrol et.
2. `api-worker/wrangler.toml`: Firebase web API key, proje kimliği, R2 bucket, origin izinlerini doldur. Native istemciler Origin göndermeyebilir; asıl koruma kimlik doğrulamadır.
3. Worker secretlarını Cloudflare'a ekle. Mobil pakete secret koyma:

```sh
cd api-worker
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put FIREBASE_SERVICE_ACCOUNT
npx wrangler secret put APPLE_TEAM_ID
npx wrangler secret put APPLE_KEY_ID
npx wrangler secret put APPLE_CLIENT_ID
npx wrangler secret put APPLE_PRIVATE_KEY
npm run deploy
```

`FIREBASE_SERVICE_ACCOUNT`, aynı projeye ait JSON servis hesabıdır; hesap silme için yalnızca gereken Firestore IAM yetkilerini ver (ör. `roles/datastore.user`), Owner/Editor verme. Firebase Auth silme kullanıcının güncel ID tokenıyla yapılır. Apple client ID native bundle ID ile eşleşir; private key Apple'ın Sign in with Apple anahtarıdır. Bu secretlar bu çalışma sırasında oluşturulmadı/yayımlanmadı.

4. Kuralları ve indeksleri birlikte yayımla:

```sh
firebase deploy --only firestore:rules,firestore:indexes --project GERCEK_PROJE_ID
```

5. Console'da faturalandırma korumalarını doğrula, iki ayrı hesapla TestFlight testlerini tamamla. `npm run check:release` eksik yapılandırmayı reddeder; production EAS build aynı kontrolü çalıştırır.

## Maliyet sınırları

OpenAI için istenen başlangıç bütçesi **tüm uygulama için 5 USD/UTC ay**: `AI_MONTHLY_BUDGET_CENTS="500"`. Bütçe kullanıcı başına değildir. Kota ve anahtar eksikse çağrılar kapalı kalır. Acil durdurma: `AI_ENABLED="false"`.

Her AI denemesi sunucu tarafında **5 cent ihtiyat payı** tüketir; başarı, hata, iptal veya zaman aşımı geri ödeme yapmaz. Bu gerçek çağrı fiyatı değildir. Bu temkinli politika, 5 USD bütçede **en fazla 100 AI denemesi/ay** verir ve gerçek fatura genellikle daha düşüktür. Kullanıcı başına 25/gün ve 8 saniye ara; global ayrıca 100/gün, 1000/ay tavanı vardır. Model/sağlayıcı fiyatı değişirse ihtiyat payını yeniden incele. OpenAI Console'da da ayrı proje için hard spend limit ayarla; başka anahtarlarla yapılan istekler bu Worker sayacından geçmez.

Bütçeyi artırmak için Worker değişkenini ve OpenAI proje hard limitini güncelle. **App Store'a yeni sürüm göndermek gerekmez.** 50 USD üzerinde kullanım hedeflenirse aylık istek tavanı da değerlendirilir. Sayaçları veya `global-budget-v1` nesne adını değiştirme; limit artırıldığında o ayın tüketimi korunur.

Firestore standart kullanıcı yazmaları atomik kural kontrolüyle 150/gün; liste sorguları sınırlı; sohbet 50 mesaj; AI gardırop özeti 100 parça. Gizlilikten vazgeçme/silme günlük yazma kotasından muaftır. Normal liste ekranları sınırlı son kayıtları gösterir, silme ve gizleme işlemleri bütün sayfaları gezer.

Yükleme 5 MiB/dosya; kullanıcı 10/gün, 3 saniye ara ve 250 MiB kümülatif yükleme; global 100/gün, 1000/ay ve 5 GiB kümülatif yükleme sınırı. Silinen yüklemeler bu ihtiyat sayaçlarından düşmez. Medya okuma global 5000/gün, 100000/ay.

**Ek fatura istemiyorsan Firestore için Spark, Worker/SQLite Durable Objects için Free planı doğrula.** Blaze bütçe uyarısı Firestore harcamasını kesmez. R2'nin ücretsiz kotası hesap genelinde paylaşılır; diğer bucket ve doğrudan erişimler de hesaba katılmalı. Kod bu planların mevcut durumunu değiştirmez veya doğrulamaz.

## Testler

```sh
npm test
# Java 21+ ve Firebase CLI gerekir; yalnızca demo proje ve yerel emülatör kullanılır.
npm run test:rules
npx expo-doctor
npx expo export --platform ios --platform android
npm run check:release
npm audit
npm --prefix api-worker audit
```

Testler ücretli OpenAI çağrısı yapmaz. Export başarılı olması imzalı iOS build, Apple sağlayıcı kurulumu veya TestFlight testi yerine geçmez. Bilinen bağımlılık uyarıları ve kalan yayın adımları [raporda](docs/SECURITY_RELEASE_REVIEW.md).

## Ne Giysem Pro ve dolap açılışı

10 Ekim 2026 sürümü iki kapaklı dolap açılışı, 50 parçalık ücretsiz gardırop, hesap başına toplam 3 ücretsiz sohbet ve sunucuda doğrulanan RevenueCat Pro erişimi içerir. Kurulum, kapasite sınırları, mağaza inceleme hesapları ve test sonuçları için [Pro yayın notlarına](docs/PRO_RELEASE_NOTES.md) bakın. Ürün / anahtar yapılandırması olmadan gerçek satın alma açılmaz.
