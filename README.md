# Ne giysem?

Dark Academia görsel diline sahip Expo/React Native stil uygulaması. Kimlik doğrulama Firebase Auth, veriler Cloud Firestore, fotoğraflar Cloudflare R2 üzerinde tutulur. Mobil uygulamada R2 veya OpenAI secret bulunmaz; güvenli işlemler `api-worker` üzerinden yürür.

## Mobil uygulama

```bash
npm install
cp .env.example .env.local
npm start
```

`.env.local` yalnızca Firebase web yapılandırmasını, Google OAuth istemci kimliklerini ve yayımlanmış Worker adresini içerir:

```env
EXPO_PUBLIC_WORKER_URL=https://ne-giysem-api.<hesap>.workers.dev
```

`OPENAI_API_KEY` kesinlikle `EXPO_PUBLIC_` değişkeni olarak eklenmemelidir. R2 erişimi Worker bucket binding üzerinden yapılır; mobil uygulamada veya Worker secret'larında R2 anahtarı gerekmez.

## Cloudflare Worker

[api-worker/wrangler.toml](./api-worker/wrangler.toml) içindeki `FIREBASE_PROJECT_ID`, `IMAGES` bucket binding'i ve `ALLOWED_ORIGINS` değerlerini doldur. Ardından OpenAI secret değerini Cloudflare'a ekle:

```bash
cd api-worker
npm install
npx wrangler login
npx wrangler secret put OPENAI_API_KEY
npm run deploy
```

Worker şu Firebase ID token korumalı uçları sunar:

- `POST /upload-image`: Kimliği doğrulanmış fotoğrafı özel R2 bucket'a yükler.
- `GET /media/:key?token=...`: Yalnızca rastgele dosya belirtecine sahip kalıcı medya adresini sunar.
- `POST /delete-object`: Yalnızca oturum sahibinin R2 nesnesini siler.
- `POST /analyze-clothing`: Görseli OpenAI ile etiketler.
- `POST /generate-outfit`: Yalnızca gardırop etiket özetinden kombin üretir.

AI uçlarında kullanıcı bazlı Durable Object, başarılı çağrılar için günlük 25 istek ve 8 saniye bekleme süresi uygular. Süre hesabı isteğin başlangıcında başlar; aynı anda çalışan ikinci istek engellenir.

## Firebase

Firebase Console içinde Email/Password ve Google sağlayıcılarını aç. Firestore veritabanını oluştur ve [firestore.rules](./firestore.rules) dosyasını yayımla.

## Kontroller

```bash
npm test
npm audit
npm --prefix api-worker audit
npm --prefix api-worker run typecheck
npx expo-doctor
npx expo export --platform ios
npx expo export --platform android
```
