# Ne giysem?

Türkçe, Dark Academia esintili bir Expo ve React Native uygulaması.

## Çalıştırma

```bash
npm install
npm start
```

Expo Go ile QR kodunu okutabilir veya geliştirme ortamında `npm run ios` / `npm run android` kullanabilirsin.

Bu adımda eklenen paketlerin Expo uyumlu kurulum komutu:

```bash
npx expo install expo-image-picker expo-file-system @react-native-async-storage/async-storage
npx expo install expo-sqlite expo-crypto
npx expo install expo-auth-session expo-web-browser
npx expo install expo-secure-store
npx expo install expo-sharing expo-document-picker
npm install jszip
```

Projeyi `npm install` ile kurduğunda bu paketler de otomatik yüklenir.

## Görsel analizi için anahtar

`.env.example` dosyasını `.env.local` olarak kopyala ve kendi anahtarını ekle:

```bash
cp .env.example .env.local
```

```dotenv
EXPO_PUBLIC_OPENAI_API_KEY=sk-...
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=...apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=...apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID=...apps.googleusercontent.com
```

Ardından Expo geliştirme sunucusunu yeniden başlat. Bu prototip isteği doğrudan mobil uygulamadan OpenAI Chat Completions API'sine gönderir ve görsel etiketleme ile kombin önerilerinde `gpt-5.6-luna` kullanır. **`EXPO_PUBLIC_` değeri uygulama paketinde görünür; bu yöntem gerçek kullanıcıların eriştiği bir sürüm için güvenli değildir.** Canlı kullanımda anahtarı sunucuda tutup isteği kendi API'n üzerinden geçirmek gerekir. `.env.local` Git tarafından yok sayılır.

## Kontrol

```bash
npm run typecheck
npm run test:analysis
npm run test:recommend
npm run test:database
npm run test:rate-limit
npx expo export --platform ios --output-dir /tmp/ne-giysem-ios
npx expo export --platform android --output-dir /tmp/ne-giysem-android
```

## Yapı

- `src/navigation`: AuthStack, MainStack ve alt sekmeler
- `src/auth/AuthContext.tsx`: İmzalı yerel oturumu ve aktif kullanıcıyı ekranlara taşır
- `src/auth/sessionStore.ts`: Süreli, imzalı oturum belirtecini `expo-secure-store` içinde saklar ve açılışta doğrular
- `src/screens`: Giriş, Keşfet, Gardırop, Kıyafet Ekle, Kombin Sohbet ve Profilim ekranları
- `src/components`: Ortak arayüz bileşenleri
- `src/data/database.ts`: SQLite tablolarını uygulama açılışında oluşturur
- `src/data/auth.ts`: Yerel kullanıcı kaydı ve girişini yönetir
- `src/data/account.ts`: Şifre doğrulamalı hesap silme işlemini, kullanıcı kapsamlı SQLite temizliğini ve yönetilen fotoğraf dosyalarının kaldırılmasını yönetir
- `src/screens/VerifyEmailScreen.tsx`: Yeni kayıt için simüle edilmiş `1234` e-posta doğrulaması
- `src/screens/ForgotPasswordScreen.tsx`: Simüle kodla yerel şifre sıfırlama akışı
- `src/data/legacyMigration.ts`: Eski AsyncStorage kayıtlarını ilk giriş yapan hesaba tek sefer taşır
- `src/data/wardrobe.ts`: Fotoğrafları belge klasörüne, etiketleri kullanıcıya bağlı SQLite satırlarına kaydeder
- `src/data/outfitHistory.ts`: Kombin geçmişini ve son kullanım değerlerini SQLite'da tutar
- `src/data/chatSessions.ts`: Kullanıcıya bağlı sohbet oturumlarını SQLite'da saklar
- `src/data/outfitGallery.ts`: Fotoğraf dosyalarını belge klasörüne, tarih ve notları SQLite galeri tablosuna kaydeder
- `src/data/moodBoards.ts`: Kullanıcıya ait ilham panolarını ve seçilen kıyafet ID'lerini SQLite'da saklar
- `src/data/social.ts`: Keşfet, açık profiller, engel filtreleri, takip ilişkileri ve paylaşım tercihlerini yönetir
- `src/data/interactions.ts`: Kalıcı beğeni, yorum, bildirim, şikayet, engelleme ve admin raporlarını yönetir
- `src/utils/sanitize.ts`: Biyografi, yorum ve diğer kullanıcı metinlerinden tehlikeli işaretlemeyi temizler
- `src/services/rateLimiter.ts`: Görsel analiz ve sohbet için ortak, kullanıcıya bağlı 20 saniye / günlük 25 istek sınırı
- `src/services/backup.ts`: SQLite veritabanını ve yönetilen fotoğraf klasörlerini tek `.negiysem` dosyasında dışa aktarır; içe aktarmadan önce ZIP ve SQLite bütünlüğünü doğrular
- `src/components/MoodBoardCollage.tsx`: Sohbet ve Galeri için ortak vintage kolaj görünümü
- `src/components/SocialPostCard.tsx`: Keşfet gönderilerinin ortak görünümü
- `src/services/recommendOutfit.ts`: Yalnızca güncel mesajı ve ID/tür/renk/son kullanım özetini gönderir; yanıtı ve soğuma kuralını doğrular
- `src/theme`: Renk ve tipografi kimliği
- `scripts/generate_icons.py`: Uygulama simgesinin kaynak kodu (Pillow gerekir)

## Elle deneme

1. **Kayıt Ol** ile yerel bir hesap aç; uygulamayı yeniden açıp aynı kullanıcı adı ve şifreyle **Giriş Yap**.
2. Eski uygulama verileri varsa ilk giriş yaptığın hesapta göründüğünü doğrula. İkinci bir hesap açıp bu verilerin orada görünmediğini kontrol et.
3. Boş Gardırop ekranından **Yeni kıyafet ekle**'ye dokun.
4. **Fotoğraf Seç** ile galeriden bir görsel seç; önizleme ve analiz yükleniyor göstergesini gör.
5. Gerçek etiketler görününce **Kaydet**'e dokun; fotoğrafın ve etiketlerin Gardırop ızgarasında göründüğünü doğrula.
6. Uygulamayı kapatıp aç; girişten sonra kıyafet kaydının yerinde olduğunu doğrula.
7. İnternet bağlantısını kapatıp yeni bir görsel seç; hata uyarısı ve **Tekrar analiz et** düğmesini doğrula.
8. En az iki kıyafet kaydet ve **Kombin Sohbet** sekmesini aç. Bir plan yaz; stil yorumu ve seçilen kıyafet fotoğraflarının görünmesini doğrula.
9. **Daha spor olsun** diye yaz; yeni önerinin eski mesajları API'ye göndermeden üretildiğini doğrula. İki parçadan az varsa pastel uyarı görünür.
10. Sohbet başlığındaki menüye dokun; **Yeni Sohbet** oluştur, eski sohbeti seç ve uygulamayı yeniden açınca iki oturumun ayrı kaldığını doğrula.
11. **Profilim** sekmesinden kare avatarını seç, biyografini kaydet ve uygulamayı yeniden açınca ikisinin de korunduğunu doğrula.
12. Profilim içindeki **Stil Günlüğüm** bölümünde fotoğraf ekle, karta basılı tut veya çöp kutusuna dokun; onaydan sonra fotoğrafın silindiğini doğrula.
13. Profilim içindeki **İlham Panosu** bölümünde **Yeni Pano** ile birkaç kıyafet seçip kaydet. Kartın çöp ikonuna dokunarak veya karta basılı tutarak kalıcı olarak silebilirsin.
14. Ayarlar'daki **Çıkış Yap** ile giriş ekranına dön; başka bir hesapta ilk hesabın fotoğraflarının ve panolarının görünmediğini doğrula.
15. **Keşfet** sekmesinde açık fotoğraf ve panoları gör; kişi adına dokunup profilindeki açık gönderileri incele.
16. İkinci bir yerel hesapla ilkini takip et. Keşfet'te takip ettiğin hesabın gönderilerinin göründüğünü doğrula.
17. **Ayarlar** içindeki iki paylaşım anahtarını kapat. Mevcut gönderilerin diğer hesaptaki Keşfet ve profil görünümünden kaybolduğunu; yeni eklenenlerin de gizli kaldığını doğrula.
18. Görsel analizinden veya sohbet önerisinden hemen sonra ikinci AI isteği dene; 20 saniye uyarısını gör. Günlük 25 başarılı HTTP isteğinden sonra ertesi güne kadar yeni istek gönderilmediğini doğrula.
19. **Kayıt Ol** bölümünde e-posta, kullanıcı adı ve şifre gir; `1234` koduyla doğruladıktan sonra hesabın oluştuğunu kontrol et. Yanlış kodla hesap oluşturulmamalı.
20. **Şifremi Unuttum** akışında kullanıcı adı veya e-posta yaz; simülasyon kodu `1234` ile yeni şifre belirleyip giriş yap.
21. Ayarlar'da **Şifremi Değiştir** ile mevcut şifreni doğrula. Google hesabında bu seçenek Google tarafından yönetildiği için kapalı görünür.
22. Google Cloud Console'da web, iOS ve Android OAuth istemcilerini tanımlayıp `.env.local` değerlerini doldur; **Google ile Giriş Yap** ile profilin SQLite'a yazıldığını kontrol et.
23. Kayıt sırasında Kullanıcı Sözleşmesi/KVKK kutusunu işaretlemeden ilerlenemediğini doğrula.
24. Keşfet'te bir gönderiyi beğen ve yorum yap; diğer hesapta çan ikonundan kalıcı bildirimleri gör. Kendi yorumunu silebildiğini, diğer hesabın yorumunu silemediğini kontrol et.
25. Gönderinin üç nokta menüsünden kullanıcıyı şikayet et ve engelle. Engellenen hesabın gönderilerinin akıştan kalktığını doğrula.
26. SQLite'ta rolü `admin` olan test hesabıyla Ayarlar'ı aç; yalnızca bu hesapta görünen **Moderatör Paneli** içinde şikayeti incele.
27. Ayarlar'ın altındaki **Hesabımı Sil** alanını aç. Yerel hesapta yanlış şifrenin reddedildiğini; doğru şifre ve `SİL` onayından sonra hesabın, fotoğrafların ve tüm kullanıcı verilerinin kaldırılıp giriş ekranına dönüldüğünü doğrula.
28. Ayarlar'da **Tüm Verilerimi Yedekle** ile `.negiysem` dosyasını Dosyalar'a kaydet. Ardından yeni bir kıyafet veya günlük fotoğrafı ekle; **Yedeklemeden Geri Yükle** ile önceki dosyayı seçip yeniden giriş yaptığında yalnızca yedekteki verilerin ve fotoğrafların geldiğini doğrula.
29. Geri yükleme dosya seçicisini iptal et ve geçersiz bir dosya seç; uygulamanın kapanmadığını, mevcut verilerin değişmediğini ve anlaşılır hata mesajı gösterildiğini doğrula.

Galeri için sistemin fotoğraf seçicisi kullanılır; kamera ile çekim için cihaz izni istenir. **Keşfet ve tüm etkileşimler yalnızca aynı cihazdaki yerel kullanıcı hesapları arasında çalışır; gerçek bir çevrimiçi sosyal ağ veya cihazlar arası eşitleme yoktur.** `.negiysem` yedeği de hiçbir sunucuya gönderilmez; kullanıcı dosyayı paylaşım ekranından kendisi saklar. Yedek bütün yerel kullanıcıları, parola özetlerini ve fotoğrafları içerdiği için kişisel bir dosya olarak korunmalıdır. E-posta doğrulama ve şifre sıfırlama mesajları bu aşamada yalnızca `1234` koduyla simüle edilir. Google OAuth dönüşü özel uygulama şeması kullandığı için yerel mobil testte Expo Go yerine development build gerekir. Yeni fotoğraf ve panolar paylaşım anahtarlarını izler. Beğeni, yorum ve bildirimler SQLite'ta kalıcıdır; engellenen iki kullanıcı birbirinin açık gönderilerini göremez. AI kotası cihazın yerel tarihine göre kullanıcı başına hesaplanır; HTTP başarılı olunca sayılır, HTTP hatası veya iptalinde sayılmaz. Bu istemci tarafı sınır cihaz saati değiştirilerek veya yeni yerel hesap açılarak aşılabilir; kesin maliyet kontrolü için sunucu tarafı kota gerekir. Parolalar rastgele tuzla özetlenir; süreli oturum belirteci imzalanıp işletim sisteminin güvenli deposunda saklanır, ancak SQLite veritabanı dosyası ve yedek arşivi şifrelenmez. Kombin isteğinde fotoğraf, dosya URI'si veya eski mesajlar gönderilmez; yalnızca güncel mesaj ve parça ID/tür/renk/son kullanım özeti gönderilir. Kamera, paylaşım sayfası ve belge seçiciyi gerçek cihazda dene.
