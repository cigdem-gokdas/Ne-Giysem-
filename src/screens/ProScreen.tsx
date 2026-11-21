import { Feather } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { PurchasesPackage } from 'react-native-purchases';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useUserId } from '../auth/AuthContext';
import { useSubscription } from '../billing/SubscriptionContext';
import { getPackages, purchasesConfigured, withPurchases } from '../billing/purchases';
import { LegalLinks } from '../components/LegalLinks';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenFrame } from '../components/ScreenFrame';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { DAILY_AI_LIMIT, DAILY_UPLOAD_LIMIT, FREE_CHAT_LIMIT, FREE_WARDROBE_LIMIT } from '../config/plans';
import { colors, fonts } from '../theme';
import { friendlyError, reportError, track } from '../services/telemetry';

type FeatherName = React.ComponentProps<typeof Feather>['name'];

/** A clearly tappable row: icon, label, hint and a chevron, with a pressed state. */
function ActionRow({ icon, label, hint, onPress, disabled, role = 'button' }: { icon: FeatherName; label: string; hint: string; onPress: () => void; disabled?: boolean; role?: 'button' | 'link' }) {
  return (
    <Pressable accessibilityRole={role} accessibilityLabel={label} accessibilityHint={hint} accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [extra.row, pressed && extra.rowPressed, disabled && extra.rowDisabled]}>
      <View style={extra.iconWrap}><Feather name={icon} size={18} color={colors.gold} /></View>
      <View style={extra.rowText}><Text style={extra.rowLabel}>{label}</Text><Text style={extra.rowHint}>{hint}</Text></View>
      <Feather name="chevron-right" size={20} color={colors.gold} />
    </Pressable>
  );
}

export function ProScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'Pro'>) {
  const uid = useUserId();
  const { status, refresh } = useSubscription();
  const [packages, setPackages] = useState<PurchasesPackage[]>([]);
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { let active = true; track('paywall_viewed'); setLoading(true); setError(''); void (async () => { try {
    const plan = await refresh(true);
    if (!purchasesConfigured()) throw new Error('Abonelikler henüz satışa açılmadı. Ücretsiz gardırobunu kullanmaya devam edebilirsin.');
    if (!plan?.billingReady) throw new Error('Abonelikler henüz satışa açılmadı. Ücretsiz gardırobunu kullanmaya devam edebilirsin.');
    const result = await getPackages(uid); if (active) { setPackages(result); if (!result.length) setError('Abonelik seçenekleri şu an yüklenemedi.'); }
  } catch (err) { reportError('paywall_load', err); if (active) setError(friendlyError(err, 'Abonelik seçenekleri şu anda yüklenemedi.')); }
  finally { if (active) setLoading(false); } })(); return () => { active = false; }; }, [uid, refresh, reload]);
  async function purchase(pkg?: PurchasesPackage) {
    if (busy) return; setBusy(true); setError('');
    try {
      if (!purchasesConfigured()) throw new Error('Abonelikler henüz satışa açılmadı. Ücretsiz gardırobunu kullanmaya devam edebilirsin.');
      track(pkg ? 'purchase_started' : 'restore_purchase');
      await withPurchases<unknown>(uid, sdk => pkg ? sdk.purchasePackage(pkg) : sdk.restorePurchases());
      const plan = await refresh(true);
      if (plan?.pro) { if (pkg) track('purchase_success'); Alert.alert('Ne Giysem Pro hazır', 'Pro özelliklerin hesabında etkinleştirildi.'); }
      else {
        if (pkg) track('purchase_failed');
        setError('Mağaza işlemi tamamlandı; Pro henüz sunucuda doğrulanmadı. Birkaç saniye sonra “Durumu yenile”ye dokun. Yeniden satın almana gerek yok.');
      }
    } catch (err) { if (!(err as { userCancelled?: boolean })?.userCancelled) { if (pkg) track('purchase_failed'); reportError(pkg ? 'purchase' : 'restore_purchase', err); setError(friendlyError(err, 'Mağaza işlemi tamamlanamadı. Biraz sonra tekrar dene.')); } }
    finally { setBusy(false); }
  }
  return <ScreenFrame includeBottom><ScrollView contentContainerStyle={styles.content}>
    <Pressable accessibilityRole="button" accessibilityLabel="Geri dön" onPress={() => navigation.goBack()} style={styles.back}><Text style={styles.copy}>‹ Geri</Text></Pressable>
    <Text style={styles.eyebrow}>DOLABININ YENİ BÖLÜMÜ</Text><Text style={styles.title}>Ne Giysem <Text style={{ color: colors.gold }}>Pro</Text></Text>
    <Text style={styles.copy}>Tarzına daha fazla yer aç.</Text>
    <View style={styles.card}><Text style={styles.feature}>✦  Kıyafet sayısı sınırı olmadan gardırop</Text><Text style={styles.feature}>✦  Fotoğraf eklerken otomatik AI etiketleri</Text><Text style={styles.feature}>✦  Kişisel kombin sohbetine erişim</Text><Text style={styles.feature}>✦  Otomatik kırpma: Kıyafet fotoğrafların yapay zekâ ile otomatik kadrajlanır</Text><Text style={styles.small}>AI için veri paylaşım iznin gerekir. Günlük AI ve fotoğraf yükleme sınırları ile hizmet kapasitesi geçerlidir.</Text></View>
    <Text style={styles.copy}>{`Ücretsiz: ${FREE_WARDROBE_LIMIT} parça, elle etiketleme ve hesap başına toplam ${FREE_CHAT_LIMIT} sohbet hakkı.`}</Text>
    {status?.pro && <Text style={styles.active}>Pro üyeliğin etkin ✓</Text>}
    {loading && <ActivityIndicator color={colors.gold} />}
    {!status?.pro && packages.map(pkg => <View key={pkg.identifier} style={styles.option}><PrimaryButton disabled={busy || loading} label={`${pkg.packageType === 'ANNUAL' ? 'Yıllık' : 'Aylık'} Pro · ${pkg.product.priceString} / ${pkg.packageType === 'ANNUAL' ? 'yıl' : 'ay'}`} onPress={() => void purchase(pkg)} /></View>)}
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    <View style={extra.actionCard}>
      <ActionRow icon="rotate-ccw" label="Satın almaları geri yükle" hint="Daha önce Pro aldıysan yeniden etkinleştir" disabled={busy} onPress={() => void purchase()} />
      <View style={extra.divider} />
      <ActionRow icon="refresh-cw" label="Durumu yenile" hint="Üyelik durumunu sunucudan tekrar kontrol et" disabled={busy || loading} onPress={() => setReload(value => value + 1)} />
      <View style={extra.divider} />
      <ActionRow icon="external-link" label="Aboneliği yönet / iptal et" hint={Platform.OS === 'ios' ? 'App Store abonelik ayarlarını açar' : 'Google Play abonelik ayarlarını açar'} role="link" onPress={() => { void Linking.openURL(Platform.OS === 'ios' ? 'https://apps.apple.com/account/subscriptions' : 'https://play.google.com/store/account/subscriptions').catch(() => setError('Mağaza ayarları açılamadı.')); }} />
    </View>
    <Text style={styles.small}>Ödeme mağaza hesabından alınır. Abonelik iptal edilmedikçe seçilen dönem ve mağazada gösterilen ücretle otomatik yenilenir. Hesabı silmek aboneliği iptal etmez. Pro sona erince mevcut kıyafetlerin korunur; {FREE_WARDROBE_LIMIT} veya daha fazla parçan varsa yeni parça eklemek için sayı {FREE_WARDROBE_LIMIT}’nin altına inmelidir.</Text>
    <Text style={styles.small}>AI şu anda günde en fazla {DAILY_AI_LIMIT} istek, fotoğraf yükleme günde en fazla {DAILY_UPLOAD_LIMIT} adettir. Ortak hizmet kotası dolarsa AI veya yeni yüklemeler geçici olarak durabilir.</Text>
    <LegalLinks />
  </ScrollView></ScreenFrame>;
}
const styles = StyleSheet.create({ content: { padding: 26, gap: 18, paddingBottom: 50 }, back: { paddingVertical: 8 }, eyebrow: { color: colors.gold, fontSize: 10, letterSpacing: 2 }, title: { fontFamily: fonts.serif, color: colors.text, fontSize: 38 }, copy: { color: colors.textMuted, fontSize: 14, lineHeight: 22 }, card: { padding: 22, backgroundColor: colors.surface, borderColor: colors.gold, borderWidth: 1, borderRadius: 20, gap: 17 }, feature: { color: colors.text, fontSize: 15, lineHeight: 22 }, small: { color: colors.textFaint, fontSize: 12, lineHeight: 19 }, active: { color: colors.sage, fontSize: 18 }, option: { marginTop: 4 }, error: { color: colors.pink, lineHeight: 21 }, link: { paddingVertical: 8 } });
const extra = StyleSheet.create({
  actionCard: { borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 15, paddingHorizontal: 16, minHeight: 64 },
  rowPressed: { backgroundColor: colors.backgroundRaised },
  rowDisabled: { opacity: 0.5 },
  iconWrap: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.backgroundRaised, borderWidth: 1, borderColor: colors.border },
  rowText: { flex: 1 },
  rowLabel: { color: colors.text, fontSize: 15, fontWeight: '600' },
  rowHint: { color: colors.textMuted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 68 },
});
