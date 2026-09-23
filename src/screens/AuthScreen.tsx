import { Feather } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { ScreenFrame } from '../components/ScreenFrame';
import { colors, fonts } from '../theme';

export function AuthScreen() {
  const { login, register } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState<'login' | 'register' | null>(null);
  const [error, setError] = useState('');

  async function submit(action: 'login' | 'register') {
    if (pending) return;
    setPending(action);
    setError('');
    try {
      if (action === 'login') await login(username, password);
      else await register(username, password);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'İşlem tamamlanamadı. Lütfen tekrar dene.');
    } finally {
      setPending(null);
    }
  }

  return (
    <ScreenFrame includeBottom>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.ornament}><Feather name="moon" size={32} color={colors.sage} /></View>
          <Text style={styles.eyebrow}>KİŞİSEL STİL DEFTERİN</Text>
          <Text style={styles.title}>Ne giysem?</Text>
          <Text style={styles.subtitle}>Gardırobunun kapısını aç; kendi stil hikâyene kaldığın yerden devam et.</Text>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Hoş geldin</Text>
            <Text style={styles.label}>KULLANICI ADI</Text>
            <TextInput style={styles.input} value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} maxLength={32} placeholder="Kullanıcı adın" placeholderTextColor={colors.textFaint} accessibilityLabel="Kullanıcı Adı" />
            <Text style={styles.label}>ŞİFRE</Text>
            <TextInput style={styles.input} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" maxLength={128} placeholder="Şifren" placeholderTextColor={colors.textFaint} accessibilityLabel="Şifre" />
            {!!error && <Text style={styles.error} accessibilityRole="alert">{error}</Text>}
            <Pressable style={[styles.primaryButton, pending && styles.disabled]} onPress={() => { void submit('login'); }} disabled={pending !== null} accessibilityRole="button" accessibilityLabel="Giriş Yap">
              {pending === 'login' ? <ActivityIndicator color={colors.ink} /> : <Text style={styles.primaryText}>Giriş Yap</Text>}
            </Pressable>
            <Pressable style={[styles.secondaryButton, pending && styles.disabled]} onPress={() => { void submit('register'); }} disabled={pending !== null} accessibilityRole="button" accessibilityLabel="Kayıt Ol">
              {pending === 'register' ? <ActivityIndicator color={colors.lavender} /> : <Text style={styles.secondaryText}>Kayıt Ol</Text>}
            </Pressable>
          </View>
          <Text style={styles.footer}>BU CİHAZDA SANA ÖZEL BİR KÖŞE</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 26, paddingVertical: 32 },
  ornament: { alignSelf: 'center', width: 72, height: 72, borderRadius: 36, borderColor: colors.border, borderWidth: 1, backgroundColor: colors.backgroundRaised, alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  eyebrow: { color: colors.gold, fontFamily: fonts.sans, fontSize: 10, letterSpacing: 2.3, textAlign: 'center', fontWeight: '700' },
  title: { color: colors.text, fontFamily: fonts.serif, fontSize: 42, textAlign: 'center', marginTop: 8 },
  subtitle: { color: colors.textMuted, fontFamily: fonts.sans, fontSize: 13, lineHeight: 21, textAlign: 'center', marginTop: 8, marginBottom: 27 },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 21, padding: 22 },
  cardTitle: { color: colors.pink, fontFamily: fonts.serif, fontSize: 26, marginBottom: 11 },
  label: { color: colors.gold, fontFamily: fonts.sans, fontWeight: '700', fontSize: 9, letterSpacing: 1.6, marginTop: 15, marginBottom: 8 },
  input: { color: colors.text, backgroundColor: colors.backgroundRaised, borderColor: colors.border, borderWidth: 1, borderRadius: 11, paddingHorizontal: 14, minHeight: 49, fontFamily: fonts.sans, fontSize: 14 },
  error: { color: colors.pink, fontFamily: fonts.sans, fontSize: 12, lineHeight: 18, marginTop: 14 },
  primaryButton: { minHeight: 49, borderRadius: 11, backgroundColor: colors.sage, alignItems: 'center', justifyContent: 'center', marginTop: 22 },
  primaryText: { color: colors.ink, fontFamily: fonts.sans, fontSize: 14, fontWeight: '700' },
  secondaryButton: { minHeight: 47, borderRadius: 11, borderColor: colors.lavender, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  secondaryText: { color: colors.lavender, fontFamily: fonts.sans, fontSize: 14, fontWeight: '700' },
  disabled: { opacity: 0.55 },
  footer: { color: colors.textFaint, fontFamily: fonts.sans, fontSize: 9, letterSpacing: 1.7, textAlign: 'center', marginTop: 24 },
});
