import { Feather } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ScreenFrame } from '../components/ScreenFrame';
import { ensurePasswordResettable } from '../data/auth';
import type { AuthStackParamList } from '../navigation/AppNavigator';
import { colors, fonts } from '../theme';

type Props = NativeStackScreenProps<AuthStackParamList, 'ForgotPassword'>;

export function ForgotPasswordScreen({ navigation }: Props) {
  const [identifier, setIdentifier] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function sendCode() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      await ensurePasswordResettable(identifier);
      Alert.alert('Bağlantı gönderildi', 'Firebase şifre sıfırlama bağlantısı e-posta adresine gönderildi.', [{ text: 'Girişe dön', onPress: () => navigation.popToTop() }]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Kod oluşturulamadı.'); }
    finally { setBusy(false); }
  }

  return <ScreenFrame includeBottom>
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Pressable style={styles.back} onPress={() => navigation.goBack()} accessibilityRole="button"><Feather name="arrow-left" size={18} color={colors.sage} /><Text style={styles.backText}>Girişe dön</Text></Pressable>
        <View style={styles.icon}><Feather name="key" size={29} color={colors.pink} /></View>
        <Text style={styles.eyebrow}>HESAP KURTARMA</Text>
        <Text style={styles.title}>Anahtarını yenileyelim.</Text>
        <Text style={styles.subtitle}>E-posta adresini yaz; Firebase sana güvenli bir sıfırlama bağlantısı göndersin.</Text>
        <View style={styles.card}>
          <Text style={styles.label}>E-POSTA</Text>
          <TextInput style={styles.input} value={identifier} onChangeText={setIdentifier} keyboardType="email-address" autoComplete="email" autoCapitalize="none" autoCorrect={false} placeholder="ornek@eposta.com" placeholderTextColor={colors.textFaint} />
          {!!error && <Text style={styles.error} accessibilityRole="alert">{error}</Text>}
          <Pressable style={[styles.button, busy && styles.disabled]} onPress={() => { void sendCode(); }} disabled={busy} accessibilityRole="button">
            {busy ? <ActivityIndicator color={colors.ink} /> : <Text style={styles.buttonText}>Sıfırlama Bağlantısı Gönder</Text>}
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
