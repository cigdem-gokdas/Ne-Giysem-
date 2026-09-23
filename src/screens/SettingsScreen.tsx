import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { ScreenFrame } from '../components/ScreenFrame';
import { ScreenHeading } from '../components/ScreenHeading';
import { SocialAvatar } from '../components/SocialAvatar';
import { useAuth, useUserId } from '../auth/AuthContext';
import { getPublicUser, getShareSettings, setShareSetting, updateAvatar, updateBio, type ShareSettings } from '../data/social';
import { resetLocalData } from '../data/wardrobe';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { colors, fonts } from '../theme';

type Navigation = NativeStackNavigationProp<RootStackParamList, 'Settings'>;

export function SettingsScreen() {
  const userId = useUserId();
  const { user, logout } = useAuth();
  const navigation = useNavigation<Navigation>();
  const [isResetting, setIsResetting] = useState(false);
  const [share, setShare] = useState<ShareSettings | null>(null);
  const [busyShare, setBusyShare] = useState<'gallery' | 'boards' | null>(null);
  const [bio, setBio] = useState('');
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([getShareSettings(userId), getPublicUser(userId)]).then(([settings, profile]) => {
      if (active) { setShare(settings); setBio(profile?.bio ?? ''); setAvatarUri(profile?.avatarUri ?? null); }
    }).catch(() => { if (active) Alert.alert('Ayarlar açılamadı', 'Paylaşım tercihleri yüklenemedi.'); });
    return () => { active = false; };
  }, [userId]);

  async function toggleShare(kind: 'gallery' | 'boards', value: boolean) {
    if (!share || busyShare) return;
    setBusyShare(kind);
    try {
      await setShareSetting(userId, kind, value);
      setShare((current) => current ? { ...current, [kind]: value } : current);
    } catch {
      Alert.alert('Paylaşım güncellenemedi', 'Lütfen tekrar dene.');
    } finally { setBusyShare(null); }
  }

  async function saveBio() {
    if (savingProfile) return;
    setSavingProfile(true);
    try { await updateBio(userId, bio); Alert.alert('Kaydedildi', 'Biyografin güncellendi.'); }
    catch { Alert.alert('Kaydedilemedi', 'Biyografin güncellenemedi.'); }
    finally { setSavingProfile(false); }
  }

  async function chooseAvatar() {
    if (savingProfile) return;
    setSavingProfile(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.8 });
      if (!result.canceled && result.assets[0]?.uri) setAvatarUri(await updateAvatar(userId, result.assets[0].uri));
    } catch { Alert.alert('Fotoğraf seçilemedi', 'Profil fotoğrafı güncellenemedi.'); }
    finally { setSavingProfile(false); }
  }

  async function performReset() {
    setIsResetting(true);
    try {
      await resetLocalData(userId);
      Alert.alert('Tamamlandı', 'Gardırobun, sohbetlerin ve galerindeki fotoğraflar temizlendi.', [
        { text: 'Tamam', onPress: () => navigation.goBack() },
      ]);
    } catch {
      Alert.alert('Sıfırlanamadı', 'Yerel veriler temizlenemedi. Lütfen tekrar dene.');
    } finally {
      setIsResetting(false);
    }
  }

  function confirmReset() {
    if (isResetting) return;
    Alert.alert(
      'Tüm verileri sıfırla',
      'Gardırobun, sohbetlerin, kombin geçmişin ve galerindeki fotoğraflar silinecek. Bu işlem geri alınamaz. Devam etmek istiyor musun?',
      [
        { text: 'Vazgeç', style: 'cancel' },
        { text: 'Sıfırla', style: 'destructive', onPress: () => { void performReset(); } },
      ],
    );
  }

  return (
    <ScreenFrame>
      <Pressable style={styles.backButton} onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel="Gardıroba dön">
        <Feather name="arrow-left" size={17} color={colors.sage} />
        <Text style={styles.backText}>Gardıroba dön</Text>
      </Pressable>
      <ScreenHeading eyebrow="KİŞİSEL ALAN" title="Ayarlar" subtitle="Gardırobunun küçük düzenlemeleri." />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.sectionCard}>
          <Text style={styles.overline}>PROFİLİN</Text>
          <Pressable style={styles.avatarRow} onPress={() => { void chooseAvatar(); }} accessibilityRole="button" accessibilityLabel="Profil fotoğrafı seç">
            <SocialAvatar username={user?.username ?? ''} uri={avatarUri} size={57} />
            <View style={styles.cardText}><Text style={styles.cardTitle}>Fotoğrafını seç</Text><Text style={styles.description}>Keşfet'te adının yanında görünür.</Text></View>
            <Feather name="edit-2" size={16} color={colors.sage} />
          </Pressable>
          <TextInput style={styles.bioInput} value={bio} onChangeText={setBio} placeholder="Kısa bir biyografi yaz..." placeholderTextColor={colors.textFaint} maxLength={160} multiline accessibilityLabel="Biyografi" />
          <Pressable style={styles.bioSave} onPress={() => { void saveBio(); }} disabled={savingProfile} accessibilityRole="button" accessibilityLabel="Biyografiyi kaydet"><Text style={styles.bioSaveText}>Biyografiyi kaydet</Text></Pressable>
        </View>
        <View style={styles.sectionCard}>
          <Text style={styles.overline}>KEŞFET GİZLİLİĞİ</Text>
          <Text style={styles.sectionTitle}>Paylaşım tercihleri</Text>
          <Text style={styles.description}>Kapattığında eski paylaşımların da Keşfet ve diğer profillerde gizlenir. Yeni kayıtlar bu tercihi izler.</Text>
          <View style={styles.toggleRow}><View style={styles.cardText}><Text style={styles.toggleTitle}>Stil Günlüğümü Keşfette Paylaş</Text><Text style={styles.toggleHint}>Kombin fotoğrafları</Text></View><Switch value={share?.gallery ?? false} onValueChange={(value) => { void toggleShare('gallery', value); }} disabled={!share || busyShare !== null} trackColor={{ false: colors.border, true: colors.sage }} thumbColor={colors.text} accessibilityLabel="Stil Günlüğümü Keşfette Paylaş" /></View>
          <View style={styles.toggleRow}><View style={styles.cardText}><Text style={styles.toggleTitle}>İlham Panolarımı Keşfette Paylaş</Text><Text style={styles.toggleHint}>Mood board kolajları</Text></View><Switch value={share?.boards ?? false} onValueChange={(value) => { void toggleShare('boards', value); }} disabled={!share || busyShare !== null} trackColor={{ false: colors.border, true: colors.lavender }} thumbColor={colors.text} accessibilityLabel="İlham Panolarımı Keşfette Paylaş" /></View>
        </View>
        <View style={styles.themeCard}>
          <View style={styles.cardIcon}><Feather name="user" size={20} color={colors.sage} /></View>
          <View style={styles.cardText}>
            <Text style={styles.overline}>AKTİF OTURUM</Text>
            <Text style={styles.cardTitle}>{user?.username}</Text>
            <Pressable style={styles.logoutButton} onPress={logout} accessibilityRole="button" accessibilityLabel="Çıkış Yap"><Feather name="log-out" size={15} color={colors.lavender} /><Text style={styles.logoutText}>Çıkış Yap</Text></Pressable>
          </View>
        </View>
        <View style={styles.themeCard}>
          <View style={styles.cardIcon}><Feather name="moon" size={20} color={colors.lavender} /></View>
          <View style={styles.cardText}>
            <Text style={styles.overline}>GÖRÜNÜM</Text>
            <Text style={styles.cardTitle}>Dark Academia</Text>
            <Text style={styles.description}>Sıcak kahveler ve yumuşak pastel dokunuşlar.</Text>
          </View>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.overline}>YEREL VERİLER</Text>
          <Text style={styles.sectionTitle}>Küçük bir başlangıç</Text>
          <Text style={styles.description}>Kıyafetlerin, sohbetlerin ve fotoğraf günlüğün bu cihazda saklanır. İstersen hepsini temizleyip yeniden başlayabilirsin.</Text>
          <Pressable style={[styles.resetButton, isResetting && styles.disabled]} onPress={confirmReset} disabled={isResetting} accessibilityRole="button" accessibilityLabel="Tüm yerel verileri sıfırla">
            {isResetting ? <ActivityIndicator size="small" color={colors.pink} /> : <Feather name="trash-2" size={17} color={colors.pink} />}
            <Text style={styles.resetText}>{isResetting ? 'Temizleniyor...' : 'Tüm verileri sıfırla'}</Text>
          </Pressable>
        </View>

        <View style={styles.modelCard}>
          <View style={styles.modelIcon}><Feather name="star" size={19} color={colors.sage} /></View>
          <View style={styles.cardText}>
            <Text style={styles.overline}>KULLANILAN MODEL</Text>
            <Text style={styles.modelName}>gpt-5.6-luna</Text>
            <Text style={styles.description}>Görsel etiketleme ve kombin önerileri</Text>
          </View>
        </View>
      </ScrollView>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  backButton: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', marginHorizontal: 28, marginTop: 14, paddingVertical: 8 },
  backText: { color: colors.sage, fontFamily: fonts.sans, fontSize: 12, fontWeight: '700' },
  content: { paddingHorizontal: 24, paddingBottom: 35, gap: 14 },
  avatarRow: { flexDirection: 'row', alignItems: 'center', gap: 13, marginTop: 15 },
  bioInput: { color: colors.text, fontFamily: fonts.sans, fontSize: 13, lineHeight: 20, minHeight: 66, textAlignVertical: 'top', marginTop: 16, padding: 12, borderRadius: 11, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.backgroundRaised },
  bioSave: { alignSelf: 'flex-end', backgroundColor: colors.sage, paddingHorizontal: 15, paddingVertical: 10, borderRadius: 10, marginTop: 11 },
  bioSaveText: { color: colors.ink, fontFamily: fonts.sans, fontSize: 12, fontWeight: '700' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingTop: 17, paddingBottom: 3, borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  toggleTitle: { color: colors.text, fontFamily: fonts.sans, fontSize: 12, fontWeight: '700' },
  toggleHint: { color: colors.textMuted, fontFamily: fonts.sans, fontSize: 11, marginTop: 4 },
  themeCard: { flexDirection: 'row', gap: 14, padding: 19, borderRadius: 17, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  cardIcon: { width: 43, height: 43, borderRadius: 13, backgroundColor: colors.backgroundRaised, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  cardText: { flex: 1 },
  logoutButton: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 7, borderWidth: 1, borderColor: colors.lavender, borderRadius: 10, paddingHorizontal: 13, paddingVertical: 9, marginTop: 14 },
  logoutText: { color: colors.lavender, fontFamily: fonts.sans, fontSize: 12, fontWeight: '700' },
  overline: { color: colors.gold, fontFamily: fonts.sans, fontSize: 9, letterSpacing: 1.6, fontWeight: '700' },
  cardTitle: { color: colors.lavender, fontFamily: fonts.serif, fontSize: 23, marginTop: 5 },
  description: { color: colors.textMuted, fontFamily: fonts.sans, fontSize: 12, lineHeight: 19, marginTop: 7 },
  sectionCard: { padding: 21, borderRadius: 17, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  sectionTitle: { color: colors.text, fontFamily: fonts.serif, fontSize: 24, marginTop: 7 },
  resetButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 22, paddingHorizontal: 12, paddingVertical: 14, borderRadius: 11, borderWidth: 1, borderColor: colors.pinkDeep, backgroundColor: colors.backgroundRaised },
  resetText: { color: colors.pink, fontFamily: fonts.sans, fontSize: 13, fontWeight: '700' },
  disabled: { opacity: 0.5 },
  modelCard: { flexDirection: 'row', gap: 14, padding: 19, borderRadius: 17, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceLight },
  modelIcon: { width: 43, height: 43, borderRadius: 13, backgroundColor: colors.backgroundRaised, borderWidth: 1, borderColor: colors.sage, alignItems: 'center', justifyContent: 'center' },
  modelName: { color: colors.sage, fontFamily: fonts.serif, fontSize: 23, marginTop: 5 },
});
