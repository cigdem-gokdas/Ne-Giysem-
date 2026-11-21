import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { googleConfiguredForPlatform, useGoogleReauth } from '../auth/google';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenFrame } from '../components/ScreenFrame';
import { ScreenHeading } from '../components/ScreenHeading';
import { colors, fonts } from '../theme';

/** Only mounted for Google accounts: the Google auth hook must not run on platforms without a client ID. */
function GoogleDeleteButton({ onDelete, onError }: { onDelete: (googleIdToken: string) => void; onError: (message: string) => void }) {
  const getIdToken = useGoogleReauth();
  return <PrimaryButton label="Google ile doğrula ve silmeyi tamamla" icon="trash-2" onPress={() => { onError(''); getIdToken().then(onDelete, (cause: unknown) => onError(cause instanceof Error ? cause.message : 'Google doğrulaması tamamlanamadı.')); }} />;
}

export function DeletionRecoveryScreen() {
  const { user, deleteAccount, logout } = useAuth();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function run(googleIdToken?: string) {
    setBusy(true); setError('');
    void deleteAccount(password, googleIdToken).catch((cause: Error) => setError(cause.message)).finally(() => setBusy(false));
  }

  const google = user?.authProvider === 'google' && googleConfiguredForPlatform();
  return <ScreenFrame includeBottom>
    <ScreenHeading eyebrow="HESAP" title="Hesap silmeyi tamamla" subtitle="Önceki silme işlemi yarım kalmış." />
    <View style={styles.content}>
      <View style={styles.card}>
        <Text style={styles.body}>Önceki silme işlemi yarım kalmış. Verilerin yeniden erişime açılmadı. Temizliği kaldığı yerden tamamlayabilirsin.</Text>
        {user?.authProvider === 'local' && <TextInput accessibilityLabel="Mevcut şifre" secureTextEntry value={password} onChangeText={setPassword} placeholder="Mevcut şifren" placeholderTextColor={colors.textFaint} autoCapitalize="none" style={styles.input} />}
        {!!error && <Text style={styles.error} accessibilityRole="alert">{error}</Text>}
        {busy ? <ActivityIndicator color={colors.sage} /> : google ? <GoogleDeleteButton onDelete={run} onError={setError} /> : <PrimaryButton label="Silmeyi tamamla" icon="trash-2" onPress={() => run()} />}
        {!busy && <Pressable style={styles.logout} onPress={() => { void logout().catch((cause: Error) => setError(cause.message)); }} accessibilityRole="button" accessibilityLabel="Çıkış yap"><Text style={styles.logoutText}>Çıkış yap</Text></Pressable>}
      </View>
    </View>
  </ScreenFrame>;
}

const styles = StyleSheet.create({
  content: { flex: 1, justifyContent: 'center', paddingHorizontal: 26 },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 21, padding: 21, gap: 16 },
  body: { color: colors.textMuted, fontFamily: fonts.sans, fontSize: 13, lineHeight: 21 },
  input: { color: colors.text, backgroundColor: colors.backgroundRaised, borderColor: colors.border, borderWidth: 1, borderRadius: 11, paddingHorizontal: 14, minHeight: 48, fontFamily: fonts.sans, fontSize: 14 },
  error: { color: colors.pink, fontFamily: fonts.sans, fontSize: 12, lineHeight: 18 },
  logout: { alignSelf: 'center', paddingVertical: 8 },
  logoutText: { color: colors.sage, fontFamily: fonts.sans, fontSize: 13, fontWeight: '700' },
});
