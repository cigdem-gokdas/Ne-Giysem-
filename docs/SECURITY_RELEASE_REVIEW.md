# Güvenlik, maliyet ve App Store hazırlığı — 3 Ekim 2026

Bu çalışma kaynak kodu ve yerel testleri kapsar. Canlı Firebase / Cloudflare / OpenAI konsollarının planları ve secretları doğrulanmadı; sunucuya veya App Store'a yayın yapılmadı. Tam güvenlik veya sıfır ek fatura garantisi verilmez. Başlangıç OpenAI bütçesi kullanıcı tercihiyle 5 USD/ay, destek e-postası cigdemgokdas01@gmail.com olarak hazırlandı.

## Düzeltilen bulgular

- **Doğrulanmamış hesap erişimi:** Worker ve Firestore artık doğrulanmış e-posta ister. JWT imza, issuer, audience, expiry ve gerekli claim'ler kontrol edilir. Worker ayrıca Firebase'den hesabın mevcut/etkin olduğunu ve oturumun iptal edilmediğini doğrular.
- **Rol/yetki kontrolü:** moderatör yetkisi kullanıcı belgesindeki role yerine sunucuda verilmiş `admin` custom claim üzerinden kontrol edilir. Kullanıcılar kendi rolünü değiştiremez.
- **Oturum yaşam döngüsü:** e-posta doğrulamasından sonra token zorla yenilenir; eksik profil tamamlanabilir. Kayıt şifresi navigation parametrelerine yazılmaz. Geç gelen yanıtın başka hesaba uygulanması engellenir. Hatalı giriş mesajları hesap varlığını açık etmez; yeni şifreler 12–128 karakterdir.
- **Cihazda oturum saklama:** native Firebase persistence SecureStore/Keychain'e taşındı. Parçalı kayıtlar atomik manifest kullanır; eski AsyncStorage oturumu taşınınca düz kayıt silinir. Kurulum kimliği Keychain'in yeniden kurulumda eski hesabı otomatik açmasını önler. Yarım yazma, Unicode, çıkış ve kurulum değişimi test edildi.
- **Kota atlama:** ücretli AI girişimleri gönderimden önce düşer. Başarısız yanıt, timeout veya yarım kalmış rezervasyon kotayı geri açmaz. 60 saniyelik eşzamanlı çalışma kilidi ve 25 saniyelik sağlayıcı timeout'u var.
- **Toplam AI bütçesi:** tek global Durable Object tüm hesapları kapsar; eşzamanlı yeni hesaplar bütçeyi aşamaz. Varsayım/konfigürasyon eksikse ücretli çağrı yapılmaz. Her deneme için 5 cent ihtiyat payı, 5 USD ayda en fazla 100 deneme anlamına gelir. Bu hesaplama gerçek OpenAI fiyatı değildir; fiyat artışları ve Worker dışı kullanım ayrıca kontrol edilmelidir.
- **İstek boyutları:** Content-Length bulunmasa da streaming byte limiti uygulanır. JSON türleri, MIME/dosya imzası, sahiplik anahtarları, gardırop alanları ve AI çıktı boyutu kontrol edilir. Kullanıcının gönderdiği fazladan alanlar AI prompt'una taşınmaz; gardırop verisi system prompt'a yerleştirilmez.
- **Depolama:** küçültülmüş JPEG yüklenir; native yüklemeler zaman aşımıyla iptal edilir. Global/kullanıcı yükleme ve medya okuma tavanları var. Temizlikte R2 hataları sessiz başarıya dönüştürülmez.
- **Firestore maliyeti:** sınırsız koleksiyon sorguları kaldırıldı. Alan whitelist/uzunluk/type kuralları, uygun composite indexler ve günlük 150 yazma bütçesi eklendi. Sayaç ve ilgili belge aynı transaction içinde değişir. Tek kota ile farklı belgeleri yazma ve sayaç sıfırlama reddedilir. Bildirimler ikişerli transaction ile işlenir. Sohbet her mesajda tüm oturumları tekrar okumaz.
- **Sosyal yetkiler:** engellenen kişi engeli silemez. Şikâyet edilen kişi şikâyeti okuyamaz/silemez. Aynı kişiye tekrarlı rapor ve aynı etkileşime tekrarlı bildirim yazımı önlenir. Bildirim gerçek beğeni/yoruma bağlıdır. Olmayan like/block belgelerinin güvenli okunması düzeltildi. Profil sorgusu `isPublic=true` koşulunu içerir. Engel sayısı 50'yi aşsa da görüntülenen adayların engel kontrolü yapılır.
- **Gizlilik:** yeni hesaplarda paylaşım kapalıdır. OpenAI veri paylaşımı ayrı, açık ve geri alınabilir izne bağlıdır. AI istemeyen kullanıcı fotoğrafını elle etiketler. Paylaşımı kapatma ve silme bütçe dolduğunda çalışır. Eski şemalı kayıtlarda da gizleme engellenmez.
- **Hesap silme:** önce yeniden doğrulama, sonra yetkili sunucuda küçük ve tekrar denenebilir parçalarla silme. Paylaşım alt kayıtları, iki yöndeki sosyal bağlar, raporlar, profil, ayarlar, sayaç ve yetim R2 fotoğrafları temizlenir; Auth hesabı en son kapatılır. Silme işareti eski tokenların veri erişimini keser. Bağlantı kesilirse uygulama tekrar açıldığında devam ekranı vardır. Asgari UID/zaman silme işareti tutulur; kişisel içerik değildir fakat hesabı ilişkilendiren bir güvenlik kaydıdır.
- **Apple ile giriş:** nonce, Firebase Apple credential, native capability ve Apple erişimini iptal ederek hesap silme akışı eklendi. Canlı sağlayıcı kurulumu ve gerçek cihaz doğrulaması halen gereklidir.
- **Yayın kontrolü:** EAS yapılandırması, gizlilik/destek ekranları ve eksik üretim değerlerini reddeden `check:release` kontrolü eklendi.

## Yerel doğrulama sonuçları

- `npm test`: mobil/Worker TypeScript, servis testleri, **29 Worker güvenlik/maliyet** ve **20 Pro/kota** senaryosu, SecureStore ve sunucu hesap silme testleri geçti.
- Firestore gerçek emülatörü: **45 izin/ret senaryosu geçti**. Test projesi `demo-ne-giysem`; üretim verisi kullanılmadı.
- Expo Doctor: **21/21 geçti**.
- iOS ve Android Metro/Hermes export: başarılı. Bunlar imzalı native build veya TestFlight testi değildir.
- Worker `wrangler deploy --dry-run`: başarılı; gerçek yayın yapılmadı. Kaynak dosyalardaki secret örüntüsü taramasında eşleşme bulunmadı.
- Worker npm audit: güncellemelerden sonra **0 bulgu**.
- Mobil npm audit: başlangıçta 20 high, son durumda **16 high**; iki kök advisory aşağıdadır. gRPC sertifika doğrulama açığı 1.14.5 override ile giderildi. Uyumlu Expo/React Navigation/Firebase araç güncellemeleri uygulandı.
- Ücretli OpenAI isteği veya canlı kullanıcı verisiyle test yapılmadı.
- `npm run check:release` masaüstündeki gerçek Firebase/Worker değerlerini kabul etti; yayımlanmış politika/koşul URL'leri ve RevenueCat iOS production public anahtarı eksik olduğu için **beklendiği gibi başarısız**. Bu yayın engellerini gizleyen bir test başarısı değildir.

## Kalan bağımlılık uyarıları

`braces@3.0.3` ve `node-forge@1.4.0` için kontrol edilen npm latest sürümlerinde yamalar yayımlanmamıştı. Audit'in Expo/RN'yi eski büyük sürümlere düşüren `--force` önerisi uygulanmadı. Bu iki geliştirme/paketleme bağımlılığı Expo/Metro zincirinde 16 transitive high uyarı oluşturuyor. Bunlar görmezden gelinmedi; açık durumdalar.

- [braces: derin desenlerde stack exhaustion](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
- [node-forge: RSA imza doğrulama](https://github.com/advisories/GHSA-86w9-cpqp-85rv)

Güvenilmeyen projeleri/desenleri veya sertifikaları bu build araçlarıyla işlemeyin. Yama yayımlandığında güncelleyin ve audit + export'u yeniden çalıştırın. Yayın öncesi kalan riskin kapsamı ayrıca değerlendirilmelidir.

## Canlıya geçmeden tamamlanacak işler

1. Gerçek `.env.local`/EAS ortam değerleri, Worker public Firebase key ve secretları; R2 bucket binding; Apple/Google provider ve redirect/client kimlikleri. Dedicated servis hesabı aynı projede ve en az yetkiyle çalışmalı.
2. Firestore kuralları ve indekslerini Worker + mobil sürümle uyumlu sırada staging ve production'a yayımla. Yeni kurallar eski istemcilerin kotasız yazmalarını reddeder. Mevcut kullanıcıları korumak için kontrollü sürüm geçişi yap; eski geniş sorgular kırılabilir. Eski Google avatarlarını gerekirse yeni R2 avatarıyla değiştir. Var olan paylaşım tercihlerinin kullanıcının isteğiyle uyumunu incele.
3. Firebase Console: **Spark** planını doğrula; Blaze kullanılıyorsa bu rapordaki sorgu/yazma limitleri toplam faturayı garanti etmez. Email enumeration protection ve 12 karakter parola politikasını konsolda da etkinleştir; istemci kontrolleri doğrudan Auth API çağrılarını sınırlamaz. Auth uçlarının kendi rate limitleri ve App Check/cihaz doğrulama seçenekleri ayrıca değerlendirilmeli. Native App Check bu çalışmada entegre edilmedi.
4. Cloudflare: **Workers Free + SQLite Durable Objects**, özel R2 bucket, kapalı r2.dev/public domain ve gereksiz erişim anahtarı olmamasını doğrula. WAF/bot kontrollerini sağlayıcı seviyesinde yapılandır. R2 ücretsiz kullanım hesap genelindedir; başka bucket/worker/lifecycle işlemleri bu sayaçların dışındadır. Sayaçlar eski mevcut depolamayı otomatik ölçmez; başlangıç doluluğunu kontrol et. 5 GiB genel kümülatif koruma silmeyle azalmaz; körlemesine sıfırlamayın. Pro kullanıcı başına ayrı depolama tavanı uygulanmıyor.
5. OpenAI: yalnızca bu uygulamaya ait proje/anahtar, gerekli model/endpoint izinleri, **5 USD proje hard spend limit** ve bütçe uyarıları. Uyarı tek başına kesici değildir; hard limit de gecikmeli uygulanabilir. Tüm hesabın diğer projelerini bu Worker sınırlamaz. Model/fiyat değişiminde 5 cent ihtiyat politikasını yeniden doğrula. Bütçe artırımı Worker ve OpenAI konsolundan yapılır; App Store sürümü gerektirmez.
6. Gizlilik/koşul metinlerini gerçek işletmeci bilgisiyle tamamlayıp HTTPS'te yayımla ve App Store Connect'e ekle. Destek: **cigdemgokdas01@gmail.com**. App Privacy beyanlarını Firebase/Auth, fotoğraf, kullanıcı içeriği ve isteğe bağlı OpenAI veri akışıyla eşleştir. Uygulama içindeki metin hukuki uygunluk onayı değildir.
7. Kullanıcı üretimi içerik için yayın öncesi filtreleme/inceleme ve zamanında rapor müdahalesi sürecini kur. Bildirme/engelleme ve admin claim altyapısı vardır; otomatik içerik moderasyonu veya insan moderasyon hizmeti bu kodla sağlanmış değildir. Apple 1.2 açısından bu süreç tamamlanmadan sosyal özelliklerle yayın hazır kabul edilmemeli.
8. Gerçek iPhone/TestFlight: e-posta doğrulama/yeniden açılış, Apple gizli e-posta ve tekrar giriş, Google OAuth, şifre sıfırlama, yeniden kurulum, iki hesap arası geçiş, AI izin reddi/geri alma, 429 sınırları, ağ kesintisi, fotoğraf izin reddi, hesap silme/Apple revoke ve kesintiden devam. İmzalı build, cihaz UI testleri, App Store metadata ve submission bu oturumda yapılmadı.

## Önemli sınırlar

Medya URL'si bir erişim yeteneğidir: bağlantıyı bilen görseli okuyabilir. Paylaşımı kapatmak önceden kopyalanan URL veya görselleri geri almaz; HTTP cache kapatıldı, nesne silinince Worker erişimi biter. UID/zaman silme kaydı ve Durable Object kota/tombstone kayıtları güvenlik amacıyla kalır; saklama politikası işletmeci tarafından belirlenmelidir. Doğrudan Firestore okumalarını ve yeni hesap oluşturmayı uygulama sayaçları tek başına küresel olarak durduramaz. Bu yüzden fatura korumasında sağlayıcı planı zorunlu bir parçadır. Bu koşullar doğrulanmadan 'tüm güvenlik sorunları bitti / ek fatura imkânsız' denemez.

## Resmî kaynaklar

OpenAI hard spend limit davranışı ve gecikmeli kesme açıklaması: [OpenAI spend limits](https://developers.openai.com/api/docs/guides/spend-limits). Güncel model ve fiyat incelemesi: [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna).

Firestore bütçe uyarılarının hizmeti durdurmadığı açıklaması: [Firebase bütçeler](https://firebase.google.com/docs/projects/billing/budget-alerts). Sorgu limitlerinin kurallarla zorlanması: [güvenli sorgular](https://firebase.google.com/docs/firestore/security/rules-query).

Free planda aşımda işlemlerin hata vermesi: [Durable Objects fiyatlandırması](https://developers.cloudflare.com/durable-objects/platform/pricing/). Hesap genelindeki depolama/işlem kotaları: [R2 fiyatlandırması](https://developers.cloudflare.com/r2/pricing/).

Apple hesap silme, üçüncü taraf AI paylaşımı ve sosyal giriş/UGC gereksinimleri: [hesap silme](https://developer.apple.com/support/offering-account-deletion-in-your-app), [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/).
