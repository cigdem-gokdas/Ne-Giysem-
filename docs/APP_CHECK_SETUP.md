# Firebase App Check entegrasyon notu

Bu proje Firebase JS SDK ile çalışan bir Expo / React Native uygulamasıdır. Native App Check paketi şu anda kurulu değildir. Yalnız App Check eklemek için Firebase erişim katmanını React Native Firebase'e taşımak, mevcut Auth kalıcılığı ve güvenlik kurallarını gereksiz yere riske atar. Bu nedenle yayın sürümünde Firebase Auth token doğrulaması, doğrulanmış e-posta, Firestore Rules ve Worker'daki `accounts:lookup` kontrolü aktif kalır; App Check aşağıdaki kontrollü native build işi olarak bırakılmıştır.

TestFlight'tan önce uygulanacak TODO:

1. Firebase Console > App Check > Apps altında iOS uygulaması `com.cigdemgokdas.negiysem` için App Attest sağlayıcısını aç. Geliştirme cihazlarında Debug provider kullan; debug token'ı repoya yazma.
2. Expo SDK sürümüyle uyumlu native App Check çözümünü ayrı bir dalda kur. RevenueCat gibi bu özellik Expo Go'da doğrulanamaz; EAS development build gerekir.
3. Token'ı yalnız Firebase SDK isteklerine değil, Worker çağrılarına da `X-Firebase-AppCheck` başlığıyla gönder. Worker'da Firebase'in resmi JWK / token doğrulama akışı ile audience, app ID, expiry ve imzayı doğrula. Sadece başlığın varlığını kontrol etmek güvenlik sağlamaz.
4. Önce metrics / monitor modunda geçersiz istekleri ölç; TestFlight, Apple Review ve eski uygulama sürümlerinin çalıştığını doğrula.
5. Ardından Firestore için App Check enforcement'ı ve Worker için zorunlu doğrulamayı birlikte etkinleştir. Enforcement açılmadan önce App Check'in koruma sağladığını söyleme.

Firebase Storage kullanılmıyor. Kullanıcı görselleri Cloudflare R2'de özel tutuluyor ve yalnız Firebase kimliği doğrulanmış Worker yükleme/silme uçlarından değiştiriliyor. Bu nedenle `storage.rules` dosyası yoktur. Firebase Storage ileride açılırsa varsayılan kapalı kural kullanılmalı ve ayrı güvenlik testleri eklenmelidir.

