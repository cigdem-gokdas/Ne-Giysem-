# Dolap açılışı ve Ne Giysem Pro — 10 Ekim 2026

Bu sürüm önceki güvenlik düzenlemelerini de içerir. Masaüstündeki eski kaynak kopyası bu sürüme yükseltilmiştir. Canlı Firebase / Cloudflare / RevenueCat ayarları değiştirilmemiş, App Store'a gönderim yapılmamıştır.

## Kullanıcı deneyimi

- Uygulama ilk açıldığında kahverengi ahşap, iki kapaklı, pirinç kulplu dolap ortadan açılarak uygulamayı gösterir. Bir kez oynar; arka plandan dönüşte tekrarlanmaz. Hareketi azalt ayarı desteklenir, kullanıcı geçebilir. Oturum açılmamışsa giriş ekranı görünür.
- Ücretsiz: en fazla 50 kıyafet; etiketler elle yazılır; hesap başına toplam 3 başarılı kombin sohbeti isteği. Kombinde parça değiştirme de bir istektir. Ay değişimi, yeniden giriş ve uygulamayı yeniden yükleme hakları yenilemez.
- Pro: kıyafet sayısı sınırı yok; fotoğraf seçildiğinde onayla AI analizi; kombin sohbetine erişim. AI paylaşım izni yine gereklidir. AI başarısızsa elle etiketleme kullanılabilir.
- Üyelik sona erdiğinde mevcut kıyafetler silinmez. Sayı 50 veya üzerindeyse yeni ekleme durur. Silme ve elle düzenleme kullanılabilir.
- Gardırop 100'er parçalık sayfalarla yüklenir. AI'ya gönderilen özet maliyet ve bağlam sınırı için son 100 parçadan hazırlanır.
- Pro ekranında mağazanın yerel fiyatı, aylık / yıllık dönem, geri yükleme, durum yenileme, iptal yönetimi, gizlilik ve koşullar bulunur. Anahtarlar veya ürünler yoksa sahte satın alma / Pro açılması yapılmaz.

## Sunucu güvenliği

RevenueCat REST API üzerinden Firebase UID ile abonelik doğrulanır; uygulamanın gönderdiği Pro değeri kullanılmaz. Mağaza, bitiş / ek süre, sandbox ve iade durumu kontrol edilir. Promosyon / tek seferlik ürünler bu sürümde desteklenmez. En fazla 60 saniyelik önbellek vardır; satın alma sonrası yenileme 5 saniyelik koruma aralığına sahiptir. İade / iptal / hesap transferi değişikliği en geç yeni doğrulamada uygulanır. Doğrulama servisi çökerse süresi geçen bilgiyle Pro verilmez.

Kıyafet oluşturma yalnızca Worker üzerinden yapılır. Kullanıcıya ait Durable Object, aynı anda gelen eklemeleri sıraya alır; Firestore'daki mevcut en fazla 50 kaydı okuyarak ücretsiz sınırı kontrol eder. Eski hesaplar için sayaç taşınmasına gerek yoktur. Fotoğrafın kullanıcıya ait R2 nesnesi olduğu ve etiket türleri doğrulanır. Fotoğraf UUID'si aynı isteğin yinelenmesinde ikinci kayıt oluşmasını önler. Firestore kuralları doğrudan kıyafet oluşturmayı reddeder; kişinin kendi etiketlerini düzenlemesine / silmesine izin verir.

Ücretsiz sohbet hakkı sunucuda işlem öncesi ayrılır. Bilinen başarısızlıkta geri verilir; ücret doğurmuş olabilecek OpenAI isteği genel maliyet sayacından düşülmez. Sonucu belirsiz, kesilmiş bir istek hakkı tüketebilir. Günlük AI ve toplam bütçe korumaları Pro için de geçerlidir. Hesap silme kilidi bu uç noktaları da kapatır.

## Bütçe ve ücretsiz altyapının sınırları

- Önceden onaylanan toplam AI bütçesi **aylık 5 USD** olarak korundu. Mevcut ihtiyatlı istek başına 5 cent rezervi bütün kullanıcılar için ayda en fazla 100 AI denemesine izin verir. Bu, ölçülen fatura değil, uygulamanın koruma tavanıdır. Pro satışı büyümeden bu kapasite değerlendirilmelidir.
- Kişi başına AI: günde 25 deneme, 8 saniye bekleme. Fotoğraf: günde 10 yükleme, yüklemeler arasında 3 saniye, görsel başına en fazla 5 MiB. Pro için ayrı kıyafet adedi tavanı yoktur; önceki 250 MiB kişi başı birikimli yükleme tavanı kaldırıldı, genel depolama koruması korundu.
- Ortak R2 yükleme: günde 100, ayda 1000, birikimli 5 GiB koruması. Silinmiş / başarısız yüklemeler için otomatik iade yoktur; temkinli olarak zamanla yeni yüklemeleri durdurabilir. Medya günlük 5000 / aylık 100000 istekle sınırlıdır.
- Firestore **Spark** planında kalmalıdır. Blaze fatura uyarısı harcamayı durdurmaz. Kurallar sorguları ve yazmaları sınırlar; uygulama tek başına Firestore faturasına mutlak parasal tavan koyamaz. Sağlayıcı planı ayrıca doğrulanmalıdır.
- Cloudflare Worker / SQLite Durable Objects ücretsiz planı ve hesabın R2 kullanımı kontrol edilmelidir. R2 ücretsiz kota hesap genelindedir; başka uygulamaların veya manuel yüklemelerin kullanımı bu kodun sayaçlarında yoktur. R2 için faturalandırma açmak gerekiyorsa bunu otomatik yapmadık.
- Sınırsız kullanıcı / depolama ile sürekli sıfır altyapı ücreti birlikte garanti edilemez. Bu ayarlar kapasite dolduğunda ek kullanımın durması yönünde hazırlanmıştır. Hiçbir ücretli plan veya otomatik bakiye yüklemesi açılmadı.

## Yayından önce gerçek hesaplarda tamamlanacaklar

1. App Store Connect: aynı abonelik grubunda aylık ve istenirse yıllık otomatik yenilenen Ne Giysem Pro ürünü oluştur; fiyatları ve yerelleştirmeyi seç. Ürünleri ilk uygulama sürümüyle incelemeye gönder.
2. RevenueCat: Apple uygulamasını bağla, ürünleri `pro` entitlement'ına ve varsayılan offering'e ekle. Restore davranışını **Keep with original App User ID** olarak ayarla; anonim satın alma kullanılmaz. Böylece başka Firebase hesabı satın almayı kendine taşıyamaz. Android satışı için Play ürünlerini / anahtarını ayrıca bağla.
3. Mobil ortam: `EXPO_PUBLIC_REVENUECAT_IOS_KEY=appl_...`, Android için `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY=goog_...`. Bunlar yalnızca SDK public anahtarlarıdır.
4. Worker secret: `REVENUECAT_SECRET_KEY` (v1 API erişimli secret anahtar). Mevcut `FIREBASE_SERVICE_ACCOUNT`, `OPENAI_API_KEY` ve Apple giriş / hesap silme secretları da gerekli. Secretları mobil `.env` içine koyma. Firestore oluşturma artık admin yetkisine sahip sunucu servisini kullanır.
5. Üretimde `REVENUECAT_ALLOW_SANDBOX=false`; yalnızca ayrı önizleme Worker'ında `true` kullanılabilir. App Review ve seçili TestFlight hesaplarının **doğrulanmış Firebase UID** değerlerini üretim Worker'ın `REVENUECAT_SANDBOX_USER_IDS` listesine ekle. İnceleme için bu hesaba ait giriş bilgilerini App Store Connect'e ver. Böylece aynı yayın sürümünde Apple'ın doğrulanmış sandbox işlemi yalnızca belirlenmiş inceleme hesaplarına Pro verir; diğer hesaplarda ücretsiz limitler korunur. Bu hesaplar da 5 USD ortak AI bütçesine ve günlük sınırlara tabidir. RevenueCat Test Store sahte işlemleri hiçbir hesapta Pro sağlamaz.
6. Worker'ı, Firestore kurallarını ve `wardrobe(userId ASC, createdAt DESC)` dahil indeksleri birlikte yayınla. Önceki mobil sürümün doğrudan kıyafet oluşturması yeni kurallarla reddedilir; zorunlu sürüm geçişini planla. Canlı veri silme yapılmaz.
7. Firebase Spark, Cloudflare planı, R2 toplam doluluk ve OpenAI projesinin 5 USD limitini konsollarda doğrula. Başka API anahtarlarının harcamasını bu uygulama sınırlandıramaz.
8. Gizlilik / koşul URL'lerini, gerçek işletmeci adını ve App Store gizlilik beyanını tamamla. RevenueCat satın alma verisini ekle. Destek: cigdemgokdas01@gmail.com. Hesap silmek mağaza aboneliğini iptal etmez; arayüzde bu açıklandı.
9. TestFlight'ta satın alma, iptal, yenileme, iade, geri yükleme, farklı Firebase hesabı, hesap silme ve soğuk açılış animasyonunu gerçek cihazda dene. UGC moderasyonu ve önceki yayın raporundaki açık maddeler hâlâ geçerlidir.

## Ödeme seçimi

Öneri: **Apple In-App Purchase + RevenueCat**. RevenueCat ödeme yönteminin yerine geçmez; StoreKit / Play Billing aboneliklerini yönetir. Doğrudan StoreKit ek servis ücretini azaltabilir fakat makbuz, yenileme, iade, entitlement ve platform eşleştirmelerini kendimiz yönetmemizi gerektirir.

10 Ekim 2026'da resmi fiyat sayfasına göre RevenueCat aylık takip edilen gelir 2.500 USD'ye kadar ücretsiz; eşik geçilince Pro planı takip edilen aylık gelirin %1'ini ücretlendirir. Apple komisyonu / geliştirici üyeliği ayrıdır. Bu maliyetler OpenAI bütçesine dahil değildir.

Kaynaklar: [RevenueCat fiyatları](https://www.revenuecat.com/pricing), [Expo kurulumu](https://www.revenuecat.com/docs/getting-started/installation/expo), [Sunucu abonelik modeli](https://www.revenuecat.com/docs/api-v1/customer-info-model), [Apple uygulama içi satın alma](https://developer.apple.com/in-app-purchase/), [Firebase planları](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans), [Firestore fiyat ve ücretsiz kota](https://firebase.google.com/docs/firestore/pricing).

## Doğrulama

Test sonuçları çalışma tamamlandığında aşağıya kaydedilir. Gerçek mağaza işlemi veya ücretli AI testi yapılmadı.

- `npm test`: geçti (mobil / Worker TypeScript ve mevcut servis testleri dahil).
- Projede ESLint yapılandırması veya `lint` komutu bulunmadığı için lint sonucu yoktur; TypeScript, sözleşme testleri, Expo Doctor ve paketleme kontrolleri çalıştırıldı.
- Pro erişimi, kalıcı deneme hakkı, sandbox inceleme hesabı, hesap silme temizliği ve eşzamanlı 50 parça sınırı: **20 test geçti**.
- Worker kimlik doğrulama / güvenlik / bütçe: **29 test geçti**.
- Gerçek Firestore emülatörü: **45 güvenlik testi geçti**.
- SecureStore ve hesap silme senaryoları: geçti.
- iOS + Android JavaScript / Hermes paket dışa aktarımı: geçti. Bu bir imzalı native / TestFlight derlemesi değildir.
- Worker paketlemesi `wrangler deploy --dry-run`: geçti; canlı deploy yapılmadı.
- `npm audit`: Expo geliştirme araçlarının iki kök bağımlılığından (`braces`, `node-forge`) yayılan **16 high** bulgusu var. Paket denetimi bu iki kök sorun için uyumlu bir düzeltme sunmuyor; önerilen Expo 44'e düşürme uygulanmadı. RevenueCat paketinde ayrı bir kök güvenlik bildirimi görülmedi. Güncel native yayın öncesi yeniden kontrol edilmeli.
- Üretim yapılandırması kontrolü gerçek RevenueCat SDK anahtarı, gizlilik / koşul URL'leri olmadan yayını reddeder. Worker secretları, konsol planları, gerçek mağaza işlemleri ve cihazdaki görsel kalite henüz doğrulanmış sayılmaz.

- Son bağımlılık düzeltmesi: Expo 57.0.27, auth-session 57.0.14, constants 57.0.21 ve image-manipulator 57.0.21 ile SDK yama sürümleri eşitlendi. Worker araç zincirindeki sharp açığının uyumlu düzeltmesi uygulandı; Worker `npm audit` sonucu **0 açık**.

- Son kopya doğrulaması: masaüstündeki projede `npm test` tekrar geçti; `git diff --check` temiz. Kaynak dosyaları test edilen sürümle aynı. Güncellemeler sonrası Expo Doctor **21/21**, iOS / Android dışa aktarımı ve Worker dry-run tekrar geçti. Çalışan iOS simülatörü olmadığından animasyonun cihazdaki görünümü ve gerçek mağaza akışları hâlâ cihaz testi gerektirir.
