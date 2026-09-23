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
```

Projeyi `npm install` ile kurduğunda bu paketler de otomatik yüklenir.

## Görsel analizi için anahtar

`.env.example` dosyasını `.env.local` olarak kopyala ve kendi anahtarını ekle:

```bash
cp .env.example .env.local
```

```dotenv
EXPO_PUBLIC_OPENAI_API_KEY=sk-...
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
- `src/auth/AuthContext.tsx`: Aktif yerel kullanıcıyı ekranlara taşır
- `src/screens`: Giriş, Gardırop, Kıyafet Ekle, Kombin Sohbet ve Galeri ekranları
- `src/components`: Ortak arayüz bileşenleri
- `src/data/database.ts`: SQLite tablolarını uygulama açılışında oluşturur
- `src/data/auth.ts`: Yerel kullanıcı kaydı ve girişini yönetir
- `src/data/legacyMigration.ts`: Eski AsyncStorage kayıtlarını ilk giriş yapan hesaba tek sefer taşır
- `src/data/wardrobe.ts`: Fotoğrafları belge klasörüne, etiketleri kullanıcıya bağlı SQLite satırlarına kaydeder
- `src/data/outfitHistory.ts`: Kombin geçmişini ve son kullanım değerlerini SQLite'da tutar
- `src/data/chatSessions.ts`: Kullanıcıya bağlı sohbet oturumlarını SQLite'da saklar
- `src/data/outfitGallery.ts`: Fotoğraf dosyalarını belge klasörüne, tarih ve notları SQLite galeri tablosuna kaydeder
- `src/data/moodBoards.ts`: Kullanıcıya ait ilham panolarını ve seçilen kıyafet ID'lerini SQLite'da saklar
- `src/data/social.ts`: Keşfet, açık profiller, takip ilişkileri ve paylaşım tercihlerini yönetir
- `src/services/rateLimiter.ts`: Görsel analiz ve sohbet için ortak, kullanıcıya bağlı 20 saniye / günlük 25 istek sınırı
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
11. **Galeri** sekmesinde fotoğraf ekle, karta basılı tut veya çöp kutusuna dokun; onaydan sonra fotoğrafın silindiğini doğrula.
12. Galeri'de **İlham Panosu** sekmesine geç; **Yeni Pano** ile birkaç kıyafet seçip isteğe bağlı başlıkla kaydet. Kolajın uygulamayı yeniden açınca da göründüğünü doğrula. Kartın çöp ikonuna dokunarak veya karta basılı tutarak onay penceresinden kalıcı olarak silebilirsin.
13. Kombin sohbetinde bir AI önerisinin altındaki **İlham Panosuna Kaydet** düğmesine dokun; Galeri'deki İlham Panosu sekmesinde o kombini gör.
14. Ayarlar'daki **Çıkış Yap** ile giriş ekranına dön; başka bir hesapta ilk hesabın fotoğraflarının ve panolarının görünmediğini doğrula.
15. **Ana Ekran** sekmesinde açık fotoğraf ve panoları gör; kişi adına dokunup profilindeki açık gönderileri incele.
16. İkinci bir yerel hesapla ilkini takip et. Keşfet'te takip ettiğin hesabın gönderilerinin göründüğünü doğrula.
17. **Ayarlar** içindeki iki paylaşım anahtarını kapat. Mevcut gönderilerin diğer hesaptaki Keşfet ve profil görünümünden kaybolduğunu; yeni eklenenlerin de gizli kaldığını doğrula.
18. Görsel analizinden veya sohbet önerisinden hemen sonra ikinci AI isteği dene; 20 saniye uyarısını gör. Günlük 25 başarılı HTTP isteğinden sonra ertesi güne kadar yeni istek gönderilmediğini doğrula.

Galeri için sistemin fotoğraf seçicisi kullanılır; kamera ile çekim için cihaz izni istenir. **Keşfet yalnızca aynı cihazdaki yerel kullanıcı hesapları arasında çalışır; gerçek bir çevrimiçi sosyal ağ veya cihazlar arası eşitleme yoktur.** Yeni fotoğraf ve panolar, paylaşım anahtarlarının kayıt anındaki durumuna göre açılır veya gizlenir; anahtarlar eski kayıtları da günceller. Kalp simgesinin durumu yalnızca açık ekran oturumunda tutulur. AI kotası cihazın yerel tarihine göre kullanıcı başına hesaplanır; HTTP başarılı olunca sayılır, HTTP hatası veya iptalinde sayılmaz. Bu istemci tarafı sınır, cihaz saati değiştirilerek veya yeni yerel hesap açılarak aşılabilir; kesin maliyet kontrolü için sunucu tarafı kota gerekir. Parolalar rastgele tuzla özetlenerek saklanır, ancak veritabanı dosyası şifrelenmez. Kombin isteğinde fotoğraf, dosya URI'si veya eski mesajlar gönderilmez; yalnızca güncel mesaj ve parça ID/tür/renk/son kullanım özeti gönderilir. Kamera özelliğini gerçek cihazda dene.
