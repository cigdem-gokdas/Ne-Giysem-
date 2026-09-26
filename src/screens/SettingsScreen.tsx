import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { ScreenFrame } from '../components/ScreenFrame';
import { ScreenHeading } from '../components/ScreenHeading';
import { useAuth, useUserId } from '../auth/AuthContext';
import { getShareSettings, setShareSetting, type ShareSettings } from '../data/social';
import { getModerationReports, type ModerationReport } from '../data/interactions';
import { resetLocalData } from '../data/wardrobe';
import { changePassword } from '../data/auth';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { colors, fonts } from '../theme';

type Navigation = NativeStackNavigationProp<RootStackParamList, 'Settings'>;

export function SettingsScreen() {
  const userId = useUserId();
  const { user, logout, deleteAccount } = useAuth();
  const navigation = useNavigation<Navigation>();
  const [isResetting, setIsResetting] = useState(false);
  const [share, setShare] = useState<ShareSettings | null>(null);
  const [busyShare, setBusyShare] = useState<'gallery' | 'boards' | null>(null);
  const [reports, setReports] = useState<ModerationReport[]>([]);
  const [reportsVisible, setReportsVisible] = useState(false);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [passwordModal, setPasswordModal] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [repeatPassword, setRepeatPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [deleteModal, setDeleteModal] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deletingAccount, setDeletingAccount] = useState(false);

  useEffect(() => {
    let active = true;
    getShareSettings(userId).then((settings) => {
      if (active) setShare(settings);
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

  async function openReports() {
    setReportsVisible(true);
    setReportsLoading(true);
    try { setReports(await getModerationReports(userId)); }
    catch (cause) {
      setReportsVisible(false);
      Alert.alert('Panel açılamadı', cause instanceof Error ? cause.message : 'Lütfen tekrar dene.');
    } finally { setReportsLoading(false); }
  }

  function openPasswordModal() {
    setCurrentPassword(''); setNewPassword(''); setRepeatPassword(''); setPasswordError(''); setPasswordModal(true);
  }

  async function submitPasswordChange() {
    if (changingPassword) return;
    if (newPassword !== repeatPassword) { setPasswordError('Yeni şifreler birbiriyle eşleşmiyor.'); return; }
    setChangingPassword(true); setPasswordError('');
    try {
      await changePassword(userId, currentPassword, newPassword);
      setPasswordModal(false);
      Alert.alert('Şifren değişti', 'Yeni şifren bir sonraki girişinde hazır.');
    } catch (cause) { setPasswordError(cause instanceof Error ? cause.message : 'Şifre değiştirilemedi.'); }
    finally { setChangingPassword(false); }
  }

  async function performReset() {
    setIsResetting(true);
    try {
      await resetLocalData(userId);
      Alert.alert('Tamamlandı', 'Gardırobun, sohbetlerin ve galerindeki fotoğraflar temizlendi.', [
        { text: 'Tamam', onPress: () => navigation.goBack() },
      ]);
    } catch {
      Alert.alert('Sıfırlanamadı', 'Bulut verileri temizlenemedi. Lütfen tekrar dene.');
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

  function openDeleteModal() {
    setDeletePassword('');
    setDeleteConfirmation('');
    setDeleteError('');
    setDeleteModal(true);
  }

  async function performAccountDeletion() {
    if (deletingAccount) return;
    setDeletingAccount(true);
    setDeleteError('');
    try {
      await deleteAccount(user?.authProvider === 'local' ? deletePassword : undefined);
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : 'Hesap silinemedi. Lütfen tekrar dene.');
      setDeletingAccount(false);
    }
  }

  async function handleLogout() {
    try { await logout(); }
    catch (cause) { Alert.alert('Çıkış yapılamadı', cause instanceof Error ? cause.message : 'Lütfen tekrar dene.'); }
  }

  function confirmAccountDeletion() {
    if (deleteConfirmation.trim().toLocaleUpperCase('tr-TR') !== 'SİL') {
      setDeleteError('Devam etmek için onay alanına SİL yazmalısın.');
      return;
    }
    if (user?.authProvider === 'local' && !deletePassword) {
      setDeleteError('Mevcut şifreni yazmalısın.');
      return;
    }
    Alert.alert(
      'Hesabın kalıcı olarak silinsin mi?',
      'Profilin, gardırobun, sohbetlerin, fotoğrafların ve sosyal etkileşimlerin bu cihazdan kalıcı olarak kaldırılacak.',
      [
        { text: 'Vazgeç', style: 'cancel' },
        { text: 'Hesabı Sil', style: 'destructive', onPress: () => { void performAccountDeletion(); } },
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
            {user?.email && <Text style={styles.accountEmail}>{user.email}</Text>}
            <Pressable style={[styles.passwordButton, user?.authProvider === 'google' && styles.disabled]} onPress={openPasswordModal} disabled={user?.authProvider === 'google'} accessibilityRole="button" accessibilityLabel="Şifremi Değiştir"><Feather name="key" size={15} color={colors.sage} /><Text style={styles.passwordButtonText}>{user?.authProvider === 'google' ? 'Şifre Google tarafından yönetiliyor' : 'Şifremi Değiştir'}</Text></Pressable>
            <Pressable style={styles.logoutButton} onPress={() => { void handleLogout(); }} accessibilityRole="button" accessibilityLabel="Çıkış Yap"><Feather name="log-out" size={15} color={colors.lavender} /><Text style={styles.logoutText}>Çıkış Yap</Text></Pressable>
          </View>
        </View>
        {user?.role === 'admin' && <View style={styles.sectionCard}>
          <Text style={styles.overline}>MODERASYON</Text>
          <Text style={styles.sectionTitle}>Moderatör Paneli</Text>
          <Text style={styles.description}>Topluluk tarafından gönderilen kullanıcı şikayetlerini incele.</Text>
          <Pressable style={styles.moderatorButton} onPress={() => { void openReports(); }} accessibilityRole="button" accessibilityLabel="Moderatör Panelini aç"><Feather name="shield" size={16} color={colors.ink} /><Text style={styles.moderatorButtonText}>Şikayetleri Gör</Text></Pressable>
        </View>}
        <View style={styles.themeCard}>
          <View style={styles.cardIcon}><Feather name="moon" size={20} color={colors.lavender} /></View>
          <View style={styles.cardText}>
            <Text style={styles.overline}>GÖRÜNÜM</Text>
            <Text style={styles.cardTitle}>Dark Academia</Text>
            <Text style={styles.description}>Sıcak kahveler ve yumuşak pastel dokunuşlar.</Text>
          </View>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.overline}>BULUT VERİLERİ</Text>
          <Text style={styles.sectionTitle}>Küçük bir başlangıç</Text>
          <Text style={styles.description}>Kıyafetlerin, sohbetlerin ve fotoğraf günlüğün hesabına bağlı bulut alanında saklanır. İstersen hepsini temizleyip yeniden başlayabilirsin.</Text>
          <Pressable style={[styles.resetButton, isResetting && styles.disabled]} onPress={confirmReset} disabled={isResetting} accessibilityRole="button" accessibilityLabel="Tüm verilerimi sıfırla">
            {isResetting ? <ActivityIndicator size="small" color={colors.pink} /> : <Feather name="trash-2" size={17} color={colors.pink} />}
            <Text style={styles.resetText}>{isResetting ? 'Temizleniyor...' : 'Tüm verileri sıfırla'}</Text>
          </Pressable>
        </View>

        <View style={styles.modelCard}>
          <View style={styles.modelIcon}><Feather name="star" size={19} color={colors.sage} /></View>
          <View style={styles.cardText}>
            <Text style={styles.overline}>KULLANILAN MODEL</Text>
            <Text style={styles.modelName}>gpt-6-luna</Text>
            <Text style={styles.description}>Görsel etiketleme ve kombin önerileri</Text>
          </View>
        </View>
        <View style={styles.dangerCard}>
          <View style={styles.dangerIcon}><Feather name="user-x" size={20} color={colors.pink} /></View>
          <View style={styles.cardText}>
            <Text style={styles.overline}>HESAP YÖNETİMİ</Text>
            <Text style={styles.dangerTitle}>Hesabımı sil</Text>
            <Text style={styles.description}>Hesabını ve bu hesaba ait tüm bulut verilerini kalıcı olarak kaldırır.</Text>
            <Pressable style={styles.deleteAccountButton} onPress={openDeleteModal} accessibilityRole="button" accessibilityLabel="Hesabımı kalıcı olarak sil"><Feather name="trash" size={15} color={colors.pink} /><Text style={styles.deleteAccountText}>Hesabımı Sil</Text></Pressable>
          </View>
        </View>
      </ScrollView>
      <Modal visible={passwordModal} transparent animationType="fade" onRequestClose={() => { if (!changingPassword) setPasswordModal(false); }}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable style={styles.modalBackdrop} onPress={() => { if (!changingPassword) setPasswordModal(false); }} />
          <View style={styles.modalCard}>
            <Text style={styles.overline}>HESAP GÜVENLİĞİ</Text>
            <Text style={styles.modalTitle}>Şifremi değiştir</Text>
            <Text style={styles.modalHint}>Mevcut şifreni doğrula ve en az 6 karakterli yeni şifreni seç.</Text>
            <Text style={styles.modalLabel}>MEVCUT ŞİFRE</Text>
            <TextInput style={styles.passwordInput} value={currentPassword} onChangeText={setCurrentPassword} secureTextEntry placeholder="Mevcut şifren" placeholderTextColor={colors.textFaint} />
            <Text style={styles.modalLabel}>YENİ ŞİFRE</Text>
            <TextInput style={styles.passwordInput} value={newPassword} onChangeText={setNewPassword} secureTextEntry placeholder="En az 6 karakter" placeholderTextColor={colors.textFaint} />
            <Text style={styles.modalLabel}>YENİ ŞİFRE TEKRARI</Text>
            <TextInput style={styles.passwordInput} value={repeatPassword} onChangeText={setRepeatPassword} secureTextEntry placeholder="Yeni şifreni tekrar yaz" placeholderTextColor={colors.textFaint} />
            {!!passwordError && <Text style={styles.passwordError} accessibilityRole="alert">{passwordError}</Text>}
            <Pressable style={[styles.modalSave, changingPassword && styles.disabled]} onPress={() => { void submitPasswordChange(); }} disabled={changingPassword} accessibilityRole="button">
              {changingPassword ? <ActivityIndicator color={colors.ink} /> : <Text style={styles.modalSaveText}>Şifreyi Güncelle</Text>}
            </Pressable>
            <Pressable style={styles.modalCancel} onPress={() => setPasswordModal(false)} disabled={changingPassword}><Text style={styles.modalCancelText}>Vazgeç</Text></Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <Modal visible={reportsVisible} transparent animationType="fade" onRequestClose={() => setReportsVisible(false)}>
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalBackdrop} onPress={() => setReportsVisible(false)} />
          <View style={styles.reportsCard}>
            <View style={styles.reportsHeader}><View><Text style={styles.overline}>YALNIZCA ADMİN</Text><Text style={styles.modalTitle}>Moderatör Paneli</Text></View><Pressable style={styles.reportClose} onPress={() => setReportsVisible(false)}><Feather name="x" size={18} color={colors.sage} /></Pressable></View>
            {reportsLoading ? <ActivityIndicator style={styles.reportsLoader} color={colors.sage} /> : <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={reports.length === 0 ? styles.emptyReports : undefined}>
              {reports.length === 0 ? <><Feather name="shield" size={29} color={colors.lavender} /><Text style={styles.emptyReportsTitle}>Bekleyen şikayet yok</Text></> : reports.map((report) => <View key={report.id} style={styles.reportRow}>
                <Text style={styles.reportUsers}>{report.reporterUsername} → {report.reportedUsername}</Text>
                <Text style={styles.reportReason}>{report.reason}</Text>
                <Text style={styles.reportDate}>{new Date(report.createdAt).toLocaleString('tr-TR')}</Text>
              </View>)}
            </ScrollView>}
          </View>
        </View>
      </Modal>
      <Modal visible={deleteModal} transparent animationType="fade" onRequestClose={() => { if (!deletingAccount) setDeleteModal(false); }}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable style={styles.modalBackdrop} onPress={() => { if (!deletingAccount) setDeleteModal(false); }} />
          <View style={[styles.modalCard, styles.deleteModalCard]}>
            <Text style={styles.overline}>GERİ ALINAMAZ İŞLEM</Text>
            <Text style={styles.modalTitle}>Hesabını sil</Text>
            <Text style={styles.modalHint}>Gardırobun, sohbetlerin, günlük fotoğrafların, ilham panoların ve etkileşimlerin kalıcı olarak silinir.</Text>
            {user?.authProvider === 'local' && <><Text style={styles.modalLabel}>MEVCUT ŞİFREN</Text><TextInput style={styles.passwordInput} value={deletePassword} onChangeText={setDeletePassword} secureTextEntry placeholder="Şifreni yaz" placeholderTextColor={colors.textFaint} autoCapitalize="none" /></>}
            <Text style={styles.modalLabel}>ONAYLAMAK İÇİN “SİL” YAZ</Text>
            <TextInput style={styles.passwordInput} value={deleteConfirmation} onChangeText={setDeleteConfirmation} placeholder="SİL" placeholderTextColor={colors.textFaint} autoCapitalize="characters" autoCorrect={false} />
            {!!deleteError && <Text style={styles.passwordError} accessibilityRole="alert">{deleteError}</Text>}
            <Pressable style={[styles.finalDeleteButton, deletingAccount && styles.disabled]} onPress={confirmAccountDeletion} disabled={deletingAccount} accessibilityRole="button" accessibilityLabel="Hesabı silme işlemini onayla">
              {deletingAccount ? <ActivityIndicator color={colors.pink} /> : <><Feather name="user-x" size={17} color={colors.pink} /><Text style={styles.finalDeleteText}>Hesabı Kalıcı Olarak Sil</Text></>}
            </Pressable>
            <Pressable style={styles.modalCancel} onPress={() => setDeleteModal(false)} disabled={deletingAccount}><Text style={styles.modalCancelText}>Vazgeç</Text></Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  backButton: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', marginHorizontal: 28, marginTop: 14, paddingVertical: 8 },
  backText: { color: colors.sage, fontFamily: fonts.sans, fontSize: 12, fontWeight: '700' },
  content: { paddingHorizontal: 24, paddingBottom: 35, gap: 14 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingTop: 17, paddingBottom: 3, borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  toggleTitle: { color: colors.text, fontFamily: fonts.sans, fontSize: 12, fontWeight: '700' },
  toggleHint: { color: colors.textMuted, fontFamily: fonts.sans, fontSize: 11, marginTop: 4 },
  themeCard: { flexDirection: 'row', gap: 14, padding: 19, borderRadius: 17, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  cardIcon: { width: 43, height: 43, borderRadius: 13, backgroundColor: colors.backgroundRaised, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  cardText: { flex: 1 },
  logoutButton: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 7, borderWidth: 1, borderColor: colors.lavender, borderRadius: 10, paddingHorizontal: 13, paddingVertical: 9, marginTop: 14 },
  logoutText: { color: colors.lavender, fontFamily: fonts.sans, fontSize: 12, fontWeight: '700' },
  accountEmail: { color: colors.textMuted, fontFamily: fonts.sans, fontSize: 11, marginTop: 3 },
  passwordButton: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 7, borderWidth: 1, borderColor: colors.sage, borderRadius: 10, paddingHorizontal: 13, paddingVertical: 9, marginTop: 14 },
  passwordButtonText: { color: colors.sage, fontFamily: fonts.sans, fontSize: 12, fontWeight: '700' },
  overline: { color: colors.gold, fontFamily: fonts.sans, fontSize: 9, letterSpacing: 1.6, fontWeight: '700' },
  cardTitle: { color: colors.lavender, fontFamily: fonts.serif, fontSize: 23, marginTop: 5 },
  description: { color: colors.textMuted, fontFamily: fonts.sans, fontSize: 12, lineHeight: 19, marginTop: 7 },
  sectionCard: { padding: 21, borderRadius: 17, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  sectionTitle: { color: colors.text, fontFamily: fonts.serif, fontSize: 24, marginTop: 7 },
  moderatorButton: { minHeight: 46, marginTop: 17, borderRadius: 11, backgroundColor: colors.lavender, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  moderatorButtonText: { color: colors.ink, fontFamily: fonts.sans, fontSize: 12, fontWeight: '800' },
  resetButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 22, paddingHorizontal: 12, paddingVertical: 14, borderRadius: 11, borderWidth: 1, borderColor: colors.pinkDeep, backgroundColor: colors.backgroundRaised },
  resetText: { color: colors.pink, fontFamily: fonts.sans, fontSize: 13, fontWeight: '700' },
  dangerCard: { flexDirection: 'row', gap: 14, padding: 19, borderRadius: 17, borderWidth: 1, borderColor: colors.pinkDeep, backgroundColor: colors.surface },
  dangerIcon: { width: 43, height: 43, borderRadius: 13, backgroundColor: colors.backgroundRaised, borderWidth: 1, borderColor: colors.pinkDeep, alignItems: 'center', justifyContent: 'center' },
  dangerTitle: { color: colors.pink, fontFamily: fonts.serif, fontSize: 23, marginTop: 5 },
  deleteAccountButton: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 14, paddingHorizontal: 13, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.pinkDeep, backgroundColor: colors.backgroundRaised },
  deleteAccountText: { color: colors.pink, fontFamily: fonts.sans, fontSize: 12, fontWeight: '800' },
  disabled: { opacity: 0.5 },
  modelCard: { flexDirection: 'row', gap: 14, padding: 19, borderRadius: 17, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceLight },
  modelIcon: { width: 43, height: 43, borderRadius: 13, backgroundColor: colors.backgroundRaised, borderWidth: 1, borderColor: colors.sage, alignItems: 'center', justifyContent: 'center' },
  modelName: { color: colors.sage, fontFamily: fonts.serif, fontSize: 23, marginTop: 5 },
  modalOverlay: { flex: 1, justifyContent: 'center', paddingHorizontal: 23, backgroundColor: 'rgba(20, 12, 11, 0.8)' },
  modalBackdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  modalCard: { padding: 22, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  modalTitle: { color: colors.text, fontFamily: fonts.serif, fontSize: 25, marginTop: 7 },
  modalHint: { color: colors.textMuted, fontFamily: fonts.sans, fontSize: 12, lineHeight: 19, marginTop: 7, marginBottom: 5 },
  modalLabel: { color: colors.gold, fontFamily: fonts.sans, fontWeight: '700', fontSize: 9, letterSpacing: 1.4, marginTop: 13, marginBottom: 7 },
  passwordInput: { minHeight: 47, paddingHorizontal: 13, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.backgroundRaised, color: colors.text, fontFamily: fonts.sans, fontSize: 13 },
  passwordError: { color: colors.pink, fontFamily: fonts.sans, fontSize: 12, lineHeight: 18, marginTop: 12 },
  modalSave: { minHeight: 48, borderRadius: 11, backgroundColor: colors.sage, alignItems: 'center', justifyContent: 'center', marginTop: 18 },
  modalSaveText: { color: colors.ink, fontFamily: fonts.sans, fontWeight: '700', fontSize: 13 },
  modalCancel: { alignItems: 'center', paddingTop: 15, paddingBottom: 2 },
  modalCancelText: { color: colors.pink, fontFamily: fonts.sans, fontWeight: '700', fontSize: 12 },
  deleteModalCard: { borderColor: colors.pinkDeep },
  finalDeleteButton: { minHeight: 49, marginTop: 18, borderRadius: 11, borderWidth: 1, borderColor: colors.pinkDeep, backgroundColor: colors.backgroundRaised, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  finalDeleteText: { color: colors.pink, fontFamily: fonts.sans, fontSize: 12, fontWeight: '800' },
  reportsCard: { maxHeight: '78%', minHeight: 290, padding: 20, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  reportsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 13, borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  reportClose: { width: 38, height: 38, borderRadius: 11, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  reportsLoader: { marginTop: 40 },
  emptyReports: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  emptyReportsTitle: { color: colors.textMuted, fontFamily: fonts.serif, fontSize: 21 },
  reportRow: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  reportUsers: { color: colors.lavender, fontFamily: fonts.sans, fontSize: 11, fontWeight: '800' },
  reportReason: { color: colors.text, fontFamily: fonts.sans, fontSize: 12, lineHeight: 18, marginTop: 5 },
  reportDate: { color: colors.gold, fontFamily: fonts.sans, fontSize: 9, marginTop: 5 },
});
