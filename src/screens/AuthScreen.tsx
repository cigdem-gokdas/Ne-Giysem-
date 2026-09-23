import { Feather } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { ScreenFrame } from '../components/ScreenFrame';
import { GOOGLE_ANDROID_CLIENT_ID, GOOGLE_IOS_CLIENT_ID, GOOGLE_WEB_CLIENT_ID } from '../config/env';
import { ensureRegistrationAvailable, type GoogleProfile } from '../data/auth';
import type { AuthStackParamList } from '../navigation/AppNavigator';
import { colors, fonts } from '../theme';

WebBrowser.maybeCompleteAuthSession();

type Props = NativeStackScreenProps<AuthStackParamList, 'Auth'>;
type GoogleUserInfo = { sub?: unknown; email?: unknown; name?: unknown; picture?: unknown };

function GoogleOAuthButton({ onError }: { onError: (message: string) => void }) {
  const { loginWithGoogle } = useAuth();
  const [busy, setBusy] = useState(false);
  const handled = useRef<string | null>(null);
  const [request, response, promptAsync] = Google.useAuthRequest({
    webClientId: GOOGLE_WEB_CLIENT_ID || undefined,
    iosClientId: GOOGLE_IOS_CLIENT_ID || undefined,
    androidClientId: GOOGLE_ANDROID_CLIENT_ID || undefined,
    scopes: ['openid', 'profile', 'email'],
    selectAccount: true,
  });

  useEffect(() => {
    if (!response || response.type === 'cancel' || response.type === 'dismiss') { setBusy(false); return; }
    if (response.type === 'error') { setBusy(false); onError('Google oturumu tamamlanamadı. Lütfen tekrar dene.'); return; }
    if (response.type !== 'success' || handled.current === response.url) return;
    handled.current = response.url;
    const token = response.authentication?.accessToken ?? response.params.access_token;
    if (!token) { setBusy(false); onError('Google erişim bilgisi alınamadı.'); return; }
    setBusy(true);
    fetch(Google.discovery.userInfoEndpoint ?? 'https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${token}` },
    }).then(async (result) => {
      if (!result.ok) throw new Error('Google profile failed');
      const info = await result.json() as GoogleUserInfo;
      if (typeof info.sub !== 'string' || typeof info.email !== 'string' || typeof info.name !== 'string') {
        throw new Error('Invalid Google profile');
      }
      const profile: GoogleProfile = {
        sub: info.sub, email: info.email, name: info.name,
        picture: typeof info.picture === 'string' ? info.picture : null,
      };
      await loginWithGoogle(profile);
    }).catch(() => onError('Google profilin alınamadı. Lütfen tekrar dene.')).finally(() => setBusy(false));
  }, [loginWithGoogle, onError, response]);

  return <Pressable style={[styles.googleButton, (!request || busy) && styles.disabled]} onPress={() => { setBusy(true); onError(''); void promptAsync().catch(() => { setBusy(false); onError('Google oturumu açılamadı.'); }); }} disabled={!request || busy} accessibilityRole="button" accessibilityLabel="Google ile Giriş Yap">
    {busy ? <ActivityIndicator color={colors.ink} /> : <><Text style={styles.googleMark}>G</Text><Text style={styles.googleText}>Google ile Giriş Yap</Text></>}
  </Pressable>;
}

function GoogleSignInButton({ onError }: { onError: (message: string) => void }) {
  const configured = Platform.select({ ios: !!GOOGLE_IOS_CLIENT_ID, android: !!GOOGLE_ANDROID_CLIENT_ID, default: !!GOOGLE_WEB_CLIENT_ID });
  if (configured) return <GoogleOAuthButton onError={onError} />;
  return <Pressable style={styles.googleButton} onPress={() => onError('Google girişi için bu platformun istemci kimliği henüz yapılandırılmadı.')} accessibilityRole="button" accessibilityLabel="Google ile Giriş Yap">
    <Text style={styles.googleMark}>G</Text><Text style={styles.googleText}>Google ile Giriş Yap</Text>
  </Pressable>;
}

export function AuthScreen({ navigation }: Props) {
  const { login } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    if (pending) return;
    setPending(true);
    setError('');
    try {
      if (mode === 'login') {
        await login(username, password);
      } else {
        if (!acceptedTerms) throw new Error('Kullanıcı Sözleşmesi ve KVKK metnini onaylamalısın.');
        const clean = await ensureRegistrationAvailable(username, email, password);
        navigation.navigate('VerifyEmail', { username: clean.username, email: clean.email, password, acceptedTerms: true });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'İşlem tamamlanamadı. Lütfen tekrar dene.');
    } finally { setPending(false); }
  }

  function changeMode(next: 'login' | 'register') {
    setMode(next); setError(''); setPassword('');
  }

  return <ScreenFrame includeBottom>
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.ornament}><Feather name="moon" size={32} color={colors.sage} /></View>
        <Text style={styles.eyebrow}>KİŞİSEL STİL DEFTERİN</Text>
        <Text style={styles.title}>Ne giysem?</Text>
        <Text style={styles.subtitle}>Gardırobunun kapısını aç; kendi stil hikâyene kaldığın yerden devam et.</Text>
        <View style={styles.card}>
          <View style={styles.modeRow}>
            <Pressable style={[styles.modeButton, mode === 'login' && styles.modeActive]} onPress={() => changeMode('login')}><Text style={[styles.modeText, mode === 'login' && styles.modeTextActive]}>Giriş Yap</Text></Pressable>
            <Pressable style={[styles.modeButton, mode === 'register' && styles.modeActiveLavender]} onPress={() => changeMode('register')}><Text style={[styles.modeText, mode === 'register' && styles.modeTextActive]}>Kayıt Ol</Text></Pressable>
          </View>
          <Text style={styles.cardTitle}>{mode === 'login' ? 'Hoş geldin' : 'Stil defterini aç'}</Text>
          <Text style={styles.label}>{mode === 'login' ? 'KULLANICI ADI VEYA E-POSTA' : 'KULLANICI ADI'}</Text>
          <TextInput style={styles.input} value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} maxLength={254} placeholder={mode === 'login' ? 'Kullanıcı adın veya e-postan' : 'Kullanıcı adın'} placeholderTextColor={colors.textFaint} accessibilityLabel={mode === 'login' ? 'Kullanıcı adı veya e-posta' : 'Kullanıcı adı'} />
          {mode === 'register' && <><Text style={styles.label}>E-POSTA</Text><TextInput style={styles.input} value={email} onChangeText={setEmail} keyboardType="email-address" autoComplete="email" autoCapitalize="none" autoCorrect={false} maxLength={254} placeholder="ornek@eposta.com" placeholderTextColor={colors.textFaint} accessibilityLabel="E-posta" /></>}
          <Text style={styles.label}>ŞİFRE</Text>
          <TextInput style={styles.input} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" maxLength={128} placeholder="En az 6 karakter" placeholderTextColor={colors.textFaint} accessibilityLabel="Şifre" />
          {mode === 'register' && <Pressable style={styles.consentRow} onPress={() => setAcceptedTerms((value) => !value)} accessibilityRole="checkbox" accessibilityState={{ checked: acceptedTerms }}>
            <View style={[styles.checkbox, acceptedTerms && styles.checkboxChecked]}>{acceptedTerms && <Feather name="check" size={14} color={colors.ink} />}</View>
            <Text style={styles.consentText}>Kullanıcı Sözleşmesi ve KVKK Metnini okudum, onaylıyorum.</Text>
          </Pressable>}
          {mode === 'login' && <Pressable style={styles.forgotLink} onPress={() => navigation.navigate('ForgotPassword')} accessibilityRole="button"><Text style={styles.forgotText}>Şifremi Unuttum</Text></Pressable>}
          {!!error && <Text style={styles.error} accessibilityRole="alert">{error}</Text>}
          <Pressable style={[styles.primaryButton, pending && styles.disabled]} onPress={() => { void submit(); }} disabled={pending} accessibilityRole="button" accessibilityLabel={mode === 'login' ? 'Giriş Yap' : 'Doğrulama kodu gönder'}>
            {pending ? <ActivityIndicator color={colors.ink} /> : <Text style={styles.primaryText}>{mode === 'login' ? 'Giriş Yap' : 'Kayıt Ol ve E-postayı Doğrula'}</Text>}
          </Pressable>
          <View style={styles.divider}><View style={styles.dividerLine} /><Text style={styles.dividerText}>VEYA</Text><View style={styles.dividerLine} /></View>
          <GoogleSignInButton onError={setError} />
        </View>
        <Text style={styles.footer}>BU CİHAZDA SANA ÖZEL BİR KÖŞE</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  </ScreenFrame>;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 26, paddingVertical: 32 },
  ornament: { alignSelf: 'center', width: 68, height: 68, borderRadius: 34, borderColor: colors.border, borderWidth: 1, backgroundColor: colors.backgroundRaised, alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  eyebrow: { color: colors.gold, fontFamily: fonts.sans, fontSize: 10, letterSpacing: 2.3, textAlign: 'center', fontWeight: '700' },
  title: { color: colors.text, fontFamily: fonts.serif, fontSize: 40, textAlign: 'center', marginTop: 7 },
  subtitle: { color: colors.textMuted, fontFamily: fonts.sans, fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 7, marginBottom: 22 },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 21, padding: 21 },
  modeRow: { flexDirection: 'row', padding: 4, backgroundColor: colors.backgroundRaised, borderRadius: 12, marginBottom: 18 },
  modeButton: { flex: 1, minHeight: 37, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  modeActive: { backgroundColor: colors.sage },
  modeActiveLavender: { backgroundColor: colors.lavender },
  modeText: { color: colors.textMuted, fontFamily: fonts.sans, fontSize: 12, fontWeight: '700' },
  modeTextActive: { color: colors.ink },
  cardTitle: { color: colors.pink, fontFamily: fonts.serif, fontSize: 25, marginBottom: 8 },
  label: { color: colors.gold, fontFamily: fonts.sans, fontWeight: '700', fontSize: 9, letterSpacing: 1.5, marginTop: 13, marginBottom: 7 },
  input: { color: colors.text, backgroundColor: colors.backgroundRaised, borderColor: colors.border, borderWidth: 1, borderRadius: 11, paddingHorizontal: 14, minHeight: 48, fontFamily: fonts.sans, fontSize: 14 },
  forgotLink: { alignSelf: 'flex-end', paddingVertical: 10 },
  consentRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 14 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1, borderColor: colors.lavender, backgroundColor: colors.backgroundRaised, alignItems: 'center', justifyContent: 'center' },
  checkboxChecked: { backgroundColor: colors.lavender },
  consentText: { flex: 1, color: colors.textMuted, fontFamily: fonts.sans, fontSize: 11, lineHeight: 17 },
  forgotText: { color: colors.lavender, fontFamily: fonts.sans, fontSize: 12, fontWeight: '700' },
  error: { color: colors.pink, fontFamily: fonts.sans, fontSize: 12, lineHeight: 18, marginTop: 12 },
  primaryButton: { minHeight: 49, borderRadius: 11, backgroundColor: colors.sage, alignItems: 'center', justifyContent: 'center', marginTop: 18 },
  primaryText: { color: colors.ink, fontFamily: fonts.sans, fontSize: 13, fontWeight: '700' },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 14 },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { color: colors.textFaint, fontFamily: fonts.sans, fontSize: 9, letterSpacing: 1.2 },
  googleButton: { minHeight: 48, borderRadius: 11, backgroundColor: '#F3E8DB', borderWidth: 1, borderColor: '#D9C7B4', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 11 },
  googleMark: { color: '#765449', fontFamily: fonts.sans, fontSize: 18, fontWeight: '800' },
  googleText: { color: colors.ink, fontFamily: fonts.sans, fontSize: 13, fontWeight: '700' },
  disabled: { opacity: 0.5 },
  footer: { color: colors.textFaint, fontFamily: fonts.sans, fontSize: 9, letterSpacing: 1.7, textAlign: 'center', marginTop: 22 },
});
