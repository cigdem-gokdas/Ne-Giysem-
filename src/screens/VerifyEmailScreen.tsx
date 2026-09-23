import { Feather } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { ScreenFrame } from '../components/ScreenFrame';
import type { AuthStackParamList } from '../navigation/AppNavigator';
import { colors, fonts } from '../theme';

type Props = NativeStackScreenProps<AuthStackParamList, 'VerifyEmail'>;

export function VerifyEmailScreen({ navigation, route }: Props) {
  const { register } = useAuth();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    Alert.alert('E-postanı doğrula', 'E-postanıza gelen doğrulama kodunu girin (Simülasyon: 1234)');
  }, []);

  async function verify() {
    if (busy) return;
    if (code.trim() !== '1234') { setError('Doğrulama kodu doğru değil.'); return; }
    setBusy(true); setError('');
    try { await register(route.params.username, route.params.email, route.params.password, route.params.acceptedTerms); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Hesap oluşturulamadı.'); }
    finally { setBusy(false); }
  }

  return <ScreenFrame includeBottom>
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.content}>
        <Pressable style={styles.back} onPress={() => navigation.goBack()} accessibilityRole="button"><Feather name="arrow-left" size={18} color={colors.sage} /><Text style={styles.backText}>Geri dön</Text></Pressable>
        <View style={styles.icon}><Feather name="mail" size={30} color={colors.lavender} /></View>
        <Text style={styles.eyebrow}>E-POSTA DOĞRULAMA</Text>
        <Text style={styles.title}>Son bir küçük adım.</Text>
        <Text style={styles.subtitle}><Text style={styles.email}>{route.params.email}</Text> adresine gönderilen dört haneli kodu yaz.</Text>
        <View style={styles.card}>
          <Text style={styles.label}>DOĞRULAMA KODU</Text>
          <TextInput style={styles.codeInput} value={code} onChangeText={(value) => setCode(value.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad" maxLength={4} placeholder="••••" placeholderTextColor={colors.textFaint} textAlign="center" accessibilityLabel="Dört haneli doğrulama kodu" />
          <Text style={styles.simulation}>Simülasyon kodu: 1234</Text>
          {!!error && <Text style={styles.error} accessibilityRole="alert">{error}</Text>}
          <Pressable style={[styles.button, (busy || code.length !== 4) && styles.disabled]} onPress={() => { void verify(); }} disabled={busy || code.length !== 4} accessibilityRole="button">
            {busy ? <ActivityIndicator color={colors.ink} /> : <Text style={styles.buttonText}>Doğrula ve Hesabı Aç</Text>}
          </Pressable>
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
  codeInput: { minHeight: 58, marginTop: 11, borderRadius: 11, borderWidth: 1, borderColor: colors.lavender, backgroundColor: colors.backgroundRaised, color: colors.text, fontFamily: fonts.serif, fontSize: 27, letterSpacing: 12, paddingLeft: 12 },
  simulation: { color: colors.textFaint, fontFamily: fonts.sans, fontSize: 11, textAlign: 'center', marginTop: 10 },
  error: { color: colors.pink, fontFamily: fonts.sans, fontSize: 12, textAlign: 'center', marginTop: 12 },
  button: { minHeight: 49, marginTop: 19, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.sage },
  buttonText: { color: colors.ink, fontFamily: fonts.sans, fontSize: 13, fontWeight: '700' },
  disabled: { opacity: 0.5 },
});
