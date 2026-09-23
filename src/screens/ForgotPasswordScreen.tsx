import { Feather } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ScreenFrame } from '../components/ScreenFrame';
import { ensurePasswordResettable, resetPassword } from '../data/auth';
import type { AuthStackParamList } from '../navigation/AppNavigator';
import { colors, fonts } from '../theme';

type Props = NativeStackScreenProps<AuthStackParamList, 'ForgotPassword'>;

export function ForgotPasswordScreen({ navigation }: Props) {
  const [stage, setStage] = useState<'request' | 'reset'>('request');
  const [identifier, setIdentifier] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function sendCode() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      await ensurePasswordResettable(identifier);
      Alert.alert('Kod gönderildi', 'E-postanıza 4 haneli sıfırlama kodu gönderildi (Simülasyon: Kod 1234)');
      setStage('reset');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Kod oluşturulamadı.'); }
    finally { setBusy(false); }
  }

  async function savePassword() {
    if (busy) return;
    if (code.trim() !== '1234') { setError('Sıfırlama kodu doğru değil.'); return; }
    if (password !== repeat) { setError('Yeni şifreler birbiriyle eşleşmiyor.'); return; }
    setBusy(true); setError('');
    try {
      await resetPassword(identifier, password);
      Alert.alert('Şifren yenilendi', 'Yeni şifrenle giriş yapabilirsin.', [{ text: 'Girişe dön', onPress: () => navigation.popToTop() }]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Şifre değiştirilemedi.'); }
    finally { setBusy(false); }
  }

  return <ScreenFrame includeBottom>
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Pressable style={styles.back} onPress={() => navigation.goBack()} accessibilityRole="button"><Feather name="arrow-left" size={18} color={colors.sage} /><Text style={styles.backText}>Girişe dön</Text></Pressable>
        <View style={styles.icon}><Feather name="key" size={29} color={colors.pink} /></View>
        <Text style={styles.eyebrow}>HESAP KURTARMA</Text>
        <Text style={styles.title}>{stage === 'request' ? 'Anahtarını yenileyelim.' : 'Yeni şifreni seç.'}</Text>
        <Text style={styles.subtitle}>{stage === 'request' ? 'Hesabını bulmak için kullanıcı adını veya e-postanı yaz.' : 'Simülasyon kodunu ve yeni şifreni gir.'}</Text>
        <View style={styles.card}>
          <Text style={styles.label}>KULLANICI ADI VEYA E-POSTA</Text>
          <TextInput style={[styles.input, stage === 'reset' && styles.readOnly]} value={identifier} onChangeText={setIdentifier} editable={stage === 'request'} autoCapitalize="none" autoCorrect={false} placeholder="Kullanıcı adın veya e-postan" placeholderTextColor={colors.textFaint} />
          {stage === 'reset' && <>
            <Text style={styles.label}>4 HANELİ KOD</Text>
            <TextInput style={styles.input} value={code} onChangeText={(value) => setCode(value.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad" maxLength={4} placeholder="1234" placeholderTextColor={colors.textFaint} />
            <Text style={styles.label}>YENİ ŞİFRE</Text>
            <TextInput style={styles.input} value={password} onChangeText={setPassword} secureTextEntry placeholder="En az 6 karakter" placeholderTextColor={colors.textFaint} />
            <Text style={styles.label}>YENİ ŞİFRE TEKRARI</Text>
            <TextInput style={styles.input} value={repeat} onChangeText={setRepeat} secureTextEntry placeholder="Yeni şifreni tekrar yaz" placeholderTextColor={colors.textFaint} />
          </>}
          {!!error && <Text style={styles.error} accessibilityRole="alert">{error}</Text>}
          <Pressable style={[styles.button, busy && styles.disabled]} onPress={() => { void (stage === 'request' ? sendCode() : savePassword()); }} disabled={busy} accessibilityRole="button">
            {busy ? <ActivityIndicator color={colors.ink} /> : <Text style={styles.buttonText}>{stage === 'request' ? 'Sıfırlama Kodu Gönder' : 'Şifremi Yenile'}</Text>}
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  </ScreenFrame>;
}

const styles = StyleSheet.create({
  fill: { flex: 1 }, content: { flexGrow: 1, justifyContent: 'center', padding: 26, paddingVertical: 40 },
  back: { position: 'absolute', top: 9, left: 24, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  backText: { color: colors.sage, fontFamily: fonts.sans, fontSize: 12, fontWeight: '700' },
  icon: { alignSelf: 'center', width: 67, height: 67, borderRadius: 34, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.backgroundRaised },
  eyebrow: { color: colors.gold, fontFamily: fonts.sans, fontSize: 10, fontWeight: '700', letterSpacing: 2, textAlign: 'center', marginTop: 18 },
  title: { color: colors.text, fontFamily: fonts.serif, fontSize: 30, textAlign: 'center', marginTop: 8 },
  subtitle: { color: colors.textMuted, fontFamily: fonts.sans, fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 8, marginBottom: 22 },
  card: { padding: 21, borderRadius: 19, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  label: { color: colors.gold, fontFamily: fonts.sans, fontSize: 9, fontWeight: '700', letterSpacing: 1.5, marginTop: 13, marginBottom: 7 },
  input: { minHeight: 48, paddingHorizontal: 14, borderRadius: 11, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.backgroundRaised, color: colors.text, fontFamily: fonts.sans, fontSize: 13 },
  readOnly: { color: colors.textMuted, opacity: 0.8 },
  error: { color: colors.pink, fontFamily: fonts.sans, fontSize: 12, lineHeight: 18, marginTop: 13 },
  button: { minHeight: 49, marginTop: 19, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.sage },
  buttonText: { color: colors.ink, fontFamily: fonts.sans, fontSize: 13, fontWeight: '700' }, disabled: { opacity: 0.5 },
});
