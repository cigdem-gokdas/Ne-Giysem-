import { Feather } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { ScreenFrame } from '../components/ScreenFrame';
import type { AuthStackParamList } from '../navigation/AppNavigator';
import { colors, fonts } from '../theme';

type Props = NativeStackScreenProps<AuthStackParamList, 'VerifyEmail'>;

export function VerifyEmailScreen({ navigation, route }: Props) {
  const { verificationEmail, confirmEmailVerification, resendVerification, logout } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function verify() {
    if (busy) return;
    setBusy(true); setError('');
    try { await confirmEmailVerification(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'E-posta doğrulanamadı.'); }
    finally { setBusy(false); }
  }

  return <ScreenFrame includeBottom>
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.content}>
        <Pressable style={styles.back} onPress={() => { void logout().catch(() => setError('Çıkış yapılamadı.')); }} accessibilityRole="button" accessibilityLabel="Geri dön ve çıkış yap"><Feather name="arrow-left" size={18} color={colors.sage} /><Text style={styles.backText}>Geri dön</Text></Pressable>
        <View style={styles.icon}><Feather name="mail" size={30} color={colors.lavender} /></View>
        <Text style={styles.eyebrow}>E-POSTA DOĞRULAMA</Text>
        <Text style={styles.title}>Son bir küçük adım.</Text>
        <Text style={styles.subtitle}><Text style={styles.email}>{verificationEmail}</Text> adresine gönderilen doğrulama bağlantısını aç.</Text>
        <View style={styles.card}>
          <Text style={styles.label}>E-POSTANI KONTROL ET</Text>
          <Text style={styles.simulation}>E-posta uygulamanda bağlantıyı açtıktan sonra aşağıdaki düğmeye dokun.</Text>
          {!!error && <Text style={styles.error} accessibilityRole="alert">{error}</Text>}
          <Pressable style={[styles.button, busy && styles.disabled]} onPress={() => { void verify(); }} disabled={busy} accessibilityRole="button" accessibilityLabel="E-postamı doğruladım">
            {busy ? <ActivityIndicator color={colors.ink} /> : <Text style={styles.buttonText}>E-postamı Doğruladım</Text>}
          </Pressable>
          <Pressable style={styles.button} disabled={busy} accessibilityRole="button" accessibilityLabel="Doğrulama bağlantısını yeniden gönder" onPress={() => { setBusy(true); void resendVerification().then(() => Alert.alert('Bağlantı gönderildi', 'Gelen kutunu ve spam klasörünü kontrol et.')).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Bağlantı gönderilemedi.')).finally(() => setBusy(false)); }}><Text style={styles.buttonText}>Bağlantıyı yeniden gönder</Text></Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  </ScreenFrame>;
}

const styles = StyleSheet.create({
  fill: { flex: 1 }, content: { flex: 1, justifyContent: 'center', padding: 26 },
  back: { position: 'absolute', top: 18, left: 24, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  backText: { color: colors.sage, fontFamily: fonts.sans, fontSize: 12, fontWeight: '700' },
  icon: { alignSelf: 'center', width: 67, height: 67, borderRadius: 34, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.backgroundRaised },
  eyebrow: { color: colors.gold, fontFamily: fonts.sans, fontSize: 10, fontWeight: '700', letterSpacing: 2, textAlign: 'center', marginTop: 19 },
  title: { color: colors.text, fontFamily: fonts.serif, fontSize: 31, textAlign: 'center', marginTop: 8 },
  subtitle: { color: colors.textMuted, fontFamily: fonts.sans, fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 9, marginBottom: 24 },
  email: { color: colors.pink, fontWeight: '700' },
  card: { padding: 21, borderRadius: 19, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  label: { color: colors.gold, fontFamily: fonts.sans, fontSize: 9, fontWeight: '700', letterSpacing: 1.6 },
  simulation: { color: colors.textFaint, fontFamily: fonts.sans, fontSize: 11, textAlign: 'center', marginTop: 10 },
  error: { color: colors.pink, fontFamily: fonts.sans, fontSize: 12, textAlign: 'center', marginTop: 12 },
  button: { minHeight: 49, marginTop: 19, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.sage },
  buttonText: { color: colors.ink, fontFamily: fonts.sans, fontSize: 13, fontWeight: '700' },
  disabled: { opacity: 0.5 },
});
