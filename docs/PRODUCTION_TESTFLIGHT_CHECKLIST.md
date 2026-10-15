# Production / TestFlight kontrol listesi

## A) Kod tarafında tamamlananlar

- Oturumda bir kez gösterilen, Reduce Motion uyumlu, React Native `Animated` tabanlı iki kapılı vintage gardırop açılışı.
- RevenueCat public SDK anahtarı ve `ne_giysem_pro_monthly` / `ne_giysem_pro_yearly` ürün kimlikleri config üzerinden okunuyor. `pro` entitlement, satın alma, restore, yenileme ve mağaza yönetim akışları hazır.
- Pro yetkisi Worker'ın RevenueCat REST doğrulamasından geliyor. Client `isPro` veya Firestore alanı değiştirilerek erişim kazanamıyor.
- Free kullanıcı için sunucuda hesap başına kalıcı üç başarılı sohbet hakkı ve yarış durumuna dayanıklı rezervasyon. Dördüncü istekte giriş alanı yerine Pro akışı açılıyor.
- Free dolap kapasitesi 50. Fotoğraf seçmeden önce sunucu ön kontrolü, kayıt anında seri ve yetkili kontrol, UUID ile tekrar denemede duplicate önleme bulunuyor.
- Pro dolabında uygulama seviyesi parça sınırı yok. Liste 100'er kayıt sayfalanıyor; aynı kayıt ikinci kez eklenmiyor. AI bağlamı maliyet için en fazla 100 metadata kaydıyla sınırlı.
- AI fotoğraf analizi yalnız Pro için çalışıyor. Strict structured response; kategori, alt kategori, ana/ikincil renk, desen, kesim, mevsim, stil, resmiyet ve malzeme tahmini içeriyor. Tahmini alanlar UI'da kesin bilgi olarak sunulmuyor.
- Stil danışmanı yalnız gönderilen gardırop ID'lerini kabul ediyor. Client ve Worker bilinmeyen/tekrarlı ID'leri reddediyor; görseller yerine metadata kullanılıyor.
- OpenAI anahtarı yalnız Worker secret'ı. Firebase kimlik doğrulaması, input boyutu, timeout, kullanıcı başına hız limiti, global çağrı ve aylık 5 USD bütçe koruması var.
- Firestore kuralları kullanıcı verisini UID ile ayırıyor; kritik subscription / quota kayıtları client yazımına açık değil. Kıyafet oluşturma yalnız Worker üzerinden gerçekleşiyor.
- Görseller yüklemeden önce yeniden boyutlandırılıp JPEG sıkıştırılıyor; R2 nesneleri özel ve sahip UID'sine bağlı.
- Hesap silme; yeniden kimlik doğrulama, silme kilidi, devam edilebilir sunucu temizliği, ilişkili Firestore kayıtları, R2 görselleri, RevenueCat müşteri kaydı için best-effort temizlik ve Auth hesabını kapsıyor. AI/plan/yükleme kullanım metadata'sı temizleniyor; yalnız UID'ye bağlı silme kilidi ve gerekli Apple iptal işareti kötüye kullanımı engellemek için tutuluyor.
- Settings ekranında Pro durumu, Pro'ya geçiş, restore, aboneliği yönetme, gizlilik, koşullar, AI izni, hesap silme ve çıkış bulunuyor.
- Analytics ve Crashlytics projede kurulu olmadığı için yeni izleme SDK'sı eklenmedi. İstenen olaylar için kişisel veri kabul etmeyen typed telemetry noktaları ve error sink hazırlandı. Gerçek sink bağlanana kadar olaylar dış servise gönderilmez.
- Ağ, timeout ve izin hataları kullanıcıya sade mesajlarla gösteriliyor; teknik hata yalnız development loguna veya daha sonra bağlanacak error sink'e gidiyor.
- App Check için mevcut Firebase JS mimarisini riske atmayan, enforcement öncesi ölçüm ve native build adımlarını içeren ayrı TODO hazırlandı: [APP_CHECK_SETUP.md](APP_CHECK_SETUP.md).
- Projede henüz ESLint yapılandırması yoktur. Bu sürüm TypeScript, servis/güvenlik testleri, Expo Doctor ve iOS/Android export ile doğrulandı; ekip çalışması başlamadan ayrı bir lint standardı eklenmelidir.

## B) Senin manuel yapman gerekenler

### Apple Developer

1. Üyeliğin aktif olsun. Certificates, Identifiers & Profiles > Identifiers altında `com.cigdemgokdas.negiysem` App ID'sinde Sign in with Apple ve In-App Purchase yeteneklerini doğrula.
2. Paid Applications Agreement, banka ve vergi bilgilerini tamamla. Bunlar olmadan ücretli abonelik satışı açılamaz.

### App Store Connect

1. Uygulamayı bundle ID ile oluştur; App Privacy, yaş derecesi, kategori, destek URL'si ve inceleme iletişim bilgilerini doldur.
2. Subscriptions altında tek bir abonelik grubu oluştur. Aylık ürün: `ne_giysem_pro_monthly`; yıllık ürün: `ne_giysem_pro_yearly`.
3. Her ürünün Türkçe görünen adını, açıklamasını, fiyatını, ülke kullanılabilirliğini ve inceleme ekran görüntüsünü ekle.
4. İlk abonelikleri uygulama sürümüyle aynı inceleme gönderimine ekle. Review Notes'a Pro ekranının yolu, test hesabı ve restore adımlarını yaz.

### RevenueCat

1. Projeyi ve iOS uygulamasını oluştur; App Store Connect In-App Purchase key / issuer bilgilerini bağla.
2. İki App Store ürününü içe aktar. Entitlement adı tam olarak `pro` olsun; iki ürünü bu entitlement'a bağla.
3. Varsayılan offering'e aylık ve yıllık paketleri ekle. App User ID olarak Firebase UID kullanılıyor; anonim satın alma açma.
4. Restore / transfer davranışını aynı uygulamadaki başka Firebase hesabının üyeliği ele geçiremeyeceği şekilde “Keep with original App User ID” olarak doğrula.
5. Public iOS SDK anahtarını EAS environment'ta `EXPO_PUBLIC_REVENUECAT_IOS_KEY` olarak ekle. RevenueCat v1 secret key'i Worker secret `REVENUECAT_SECRET_KEY` olarak ekle; mobil env'e koyma.
6. TestFlight / App Review sandbox Firebase UID'lerini sınırlı `REVENUECAT_SANDBOX_USER_IDS` Worker değişkenine ekle. Üretimde genel sandbox kabulü kapalı (`REVENUECAT_ALLOW_SANDBOX=false`) kalsın.

### Firebase

1. Authentication'da Email/Password, Google ve Apple sağlayıcı ayarlarını production redirect / bundle değerleriyle doğrula.
2. `firestore.rules` ve `firestore.indexes.json` dosyalarını Worker + yeni uygulama sürümüyle koordineli yayımla. Eski istemci yeni kıyafet oluşturamaz; zorunlu güncelleme planla.
3. Spark planında kaldığını doğrula. Kota dolunca hizmetin durmasını kabul ediyorsan Blaze açma. Budget alert parasal hard-cap değildir.
4. [App Check TODO'sunu](APP_CHECK_SETUP.md) development build ve monitor aşamasıyla tamamla; ardından enforcement'ı aç.

### Cloudflare / Worker / R2

1. `FIREBASE_SERVICE_ACCOUNT`, `FIREBASE_WEB_API_KEY`, `OPENAI_API_KEY`, `REVENUECAT_SECRET_KEY` ve Apple hesap silme secretlarını Worker'a ekle.
2. `wrangler.toml` içindeki production origin, Firebase proje kimliği, R2 binding ve Durable Object migration'larını doğrula; sonra Worker'ı yayımla.
3. R2 ve Workers planını kontrol et. Hesap genelindeki diğer kullanımlar uygulamanın dahili sayaçlarına dahil değildir.

### OpenAI

1. Bu uygulamaya özel Project ve API key kullan. Anahtarı yalnız Worker secret olarak sakla.
2. Project hard limitini 5 USD/ayarla eşleştir; uygulamadaki sayaç gecikmeli sağlayıcı faturalandırmasının yerine geçmez. Başka anahtarların harcaması bu uygulama tarafından sınırlanmaz.
3. Kullanıcı arttığında Pro satışı açmadan kapasite ve birim maliyeti yeniden hesapla.

### Gizlilik Politikası ve Kullanım Koşulları

1. Gerçek işletmeci/kişi adını, destek e-postasını (`cigdemgokdas01@gmail.com`), veri saklama sürelerini ve başvuru yöntemini ekle.
2. Firebase/Auth, Firestore, Cloudflare R2, RevenueCat, Apple satın alma ve isteğe bağlı OpenAI veri akışını açıkla.
3. HTTPS URL'lerini `EXPO_PUBLIC_PRIVACY_URL` ve `EXPO_PUBLIC_TERMS_URL` olarak EAS ortamına ekle; App Store Connect metadata'sında da kullan.

### TestFlight ve App Store gönderimi

1. EAS production build oluştur. RevenueCat native SDK nedeniyle Expo Go testi yeterli değildir.
2. Gerçek cihazda soğuk açılış animasyonu, Reduce Motion, login/register/Apple/Google, offline, iki kez dokunma ve büyük fotoğraf senaryolarını dene.
3. StoreKit sandbox'ta aylık/yıllık satın alma, yenileme, iptal, expiry, refund, restore, farklı cihaz ve farklı Firebase hesabını test et.
4. Free hesapla 49→50 ekleme ve 51. engelleme; 0→3 sohbet ve 4. engelleme; Pro ile 50+ ekleme ve AI analizi dene.
5. Hesap silme sırasında ağı kesip tekrar başlatarak devam davranışını, aboneliğin mağazadan ayrıca iptal edilmesi gerektiği metni ve tüm kullanıcı verisi temizliğini doğrula.
6. App Review'a build, abonelikler, demo hesabı ve net inceleme notlarını aynı gönderimde ekle.

## Production riskleri ve maliyet

- 5 USD ortak AI koruması mevcut ihtiyatlı rezervle ayda yaklaşık 100 AI denemesinden sonra AI'ı durdurur. Bu miktar Pro kullanıcı büyümesine uygun değildir.
- RevenueCat resmi fiyatı aylık takip edilen gelir 2.500 USD'ye kadar ücretsizdir; sonrasında mevcut plana göre ücret doğabilir. Apple komisyonu ve Developer Program üyeliği ayrıdır.
- Firestore Spark, Cloudflare Workers ve R2 ücretsiz kotaları aşıldığında hizmet durabilir veya plan değişikliği gerekebilir. Sınırsız kullanıcı ve depolamayı sürekli sıfır maliyetle garanti etmek mümkün değildir.
- App Check henüz enforced değildir. Diğer Auth/Rules/Worker kontrolleri aktiftir fakat bu madde TestFlight öncesi açık production riski olarak kalır.
- Expo geliştirme araç zincirindeki upstream güvenlik bildirimleri her release build'den önce yeniden denetlenmelidir.
