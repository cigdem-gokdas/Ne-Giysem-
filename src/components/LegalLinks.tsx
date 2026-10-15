import { useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SUPPORT_EMAIL } from '../config/env';
import { colors } from '../theme';

export const PRIVACY_TEXT = `Hesabın için Firebase Authentication kullanılır. E-posta adresin kimlik doğrulama için işlenir; şifren uygulamanın veritabanında saklanmaz. Profil, gardırop etiketleri, sohbet ve paylaşım kayıtları Google Firebase üzerinde; seçtiğin fotoğraflar Cloudflare üzerinde saklanır.

OpenAI ile analiz isteğe bağlıdır. Açık onay verdiğinde seçtiğin kıyafet fotoğrafı veya kombin isteğin ve gardırop etiketleri OpenAI'ye gönderilir. E-posta ve giriş bilgilerin AI isteğine eklenmez. AI yanıtları hatalı olabilir. Onayını Ayarlar'dan geri alabilirsin; önceki işlemleri geri almaz. Sağlayıcıların kendi güvenlik ve veri saklama politikaları geçerlidir.

Galeri ve panolar yeni hesaplarda özel başlar. Paylaşımı açarsan ilgili içerikleri diğer giriş yapmış kullanıcılar görebilir. Paylaşılmış bir görseli başka kullanıcılar kopyalamış olabilir; bu kopyalar uygulama tarafından geri alınamaz. Medya bağlantısını bilen kişiler görseli açabilir; bağlantıları gizli tut.

Hesabını Ayarlar > Hesabımı sil yolundan silebilirsin. Hesap içeriği ve fotoğrafların sunucudan temizlenir. Eski oturumların tekrar erişimini engellemek için kullanıcı kimliği ve silme zamanı içeren asgari bir silme kaydı tutulur. Sağlayıcıların yedekleme ve güvenlik kayıtları kendi saklama sürelerine tabidir.

Pro aboneliğinde hesap kimliğin ve mağaza satın alma bilgilerin abonelik doğrulaması için RevenueCat ve ilgili mağaza tarafından işlenir. Kart bilgilerin uygulamamıza ulaşmaz. Hesap başına ücretsiz sohbet sayısı sunucuda saklanır; yeniden yüklemek bu sayacı sıfırlamaz.

Uygulama reklam takibi amacıyla veri toplamaz. Fotoğraf seçim izni cihaz ayarlarından yönetilebilir. Yalnızca paylaşma hakkına sahip olduğun içerikleri yükle.`;
const TERMS = `Ne giysem? gardırop düzenleme ve stil önerisi uygulamasıdır. AI önerileri bilgi amaçlıdır ve hatalı olabilir. Hizmet kullanım sınırlarına ulaşıldığında bazı özellikler geçici olarak kullanılamaz.

Başkasına ait hesapları kullanma; izinsiz kişisel veri, nefret, taciz, şiddet, cinsel istismar veya hak ihlali içeren içerik paylaşma. Uygunsuz içerikleri kullanıcı menüsünden bildir; istemediğin etkileşimleri engelle. Bildirilen içerikler incelenerek kaldırılabilir.

Ücretsiz hesap 50 kıyafet ve hesap başına toplam 3 başarılı AI sohbet isteği içerir; kombin değiştirme istekleri de bu hakka dahildir. Fotoğraf analizi Pro gerektirir. Pro’da kıyafet sayısı sınırı yoktur; günlük AI, yükleme ve ortak hizmet kapasitesi sınırları geçerlidir. Kesintiye uğrayıp sonucu belirsiz kalan bir AI isteği hak tüketebilir. Abonelik iptal edilmedikçe otomatik yenilenir ve mağaza ayarlarından yönetilir. Hesabı silmek mağaza aboneliğini iptal etmez.

Hesap güvenliğinden sorumlusun. Güçlü ve başka yerde kullanmadığın bir şifre seç. Hesabını ve verilerini uygulama içinden silebilirsin.`;
export function LegalLinks() {
  const [page, setPage] = useState<'privacy' | 'terms' | null>(null);
  const publicPolicy = page === 'privacy' ? process.env.EXPO_PUBLIC_PRIVACY_URL?.trim() : process.env.EXPO_PUBLIC_TERMS_URL?.trim();
  const support = SUPPORT_EMAIL;
  return <>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16, marginVertical: 12 }}>
      <Pressable accessibilityRole="button" onPress={() => setPage('privacy')}><Text style={{ color: colors.sage }}>Gizlilik</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={() => setPage('terms')}><Text style={{ color: colors.sage }}>Kullanım koşulları</Text></Pressable>
      {!!support && <Pressable accessibilityRole="link" onPress={() => { void Linking.openURL(`mailto:${support}`).catch(() => undefined); }}><Text style={{ color: colors.sage }}>Destek</Text></Pressable>}
    </View>
    <Modal visible={page !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setPage(null)}>
      <View style={{ flex: 1, backgroundColor: colors.background, padding: 24, paddingTop: 50 }}>
        <Pressable onPress={() => setPage(null)} accessibilityRole="button"><Text style={{ color: colors.sage, paddingVertical: 12 }}>Kapat</Text></Pressable>
        <ScrollView>{publicPolicy?.startsWith('https://') && <Pressable accessibilityRole="link" onPress={() => { void Linking.openURL(publicPolicy).catch(() => undefined); }}><Text style={{ color: colors.sage, paddingVertical: 12 }}>Yayımlanmış metni aç</Text></Pressable>}<Text style={{ color: colors.text, fontSize: 24, marginBottom: 20 }}>{page === 'privacy' ? 'Gizlilik' : 'Kullanım koşulları'}</Text><Text style={{ color: colors.text, lineHeight: 24 }}>{page === 'privacy' ? PRIVACY_TEXT : TERMS}</Text>{!!support && <Text style={{ color: colors.text, marginTop: 20 }}>İletişim: {support}</Text>}</ScrollView>
      </View>
    </Modal>
  </>;
}
