import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '../theme';
import { subscribeUploadState, type UploadState } from '../services/uploadStatus';

export function CloudUploadModal() {
  const [state, setState] = useState<UploadState>({ visible: false, label: '' });
  useEffect(() => subscribeUploadState(setState), []);
  return <Modal visible={state.visible} transparent animationType="fade" statusBarTranslucent>
    <View style={styles.overlay}><View style={styles.card}>
      <ActivityIndicator size="large" color={colors.lavender} />
      <Text style={styles.title}>{state.label}</Text>
      <Text style={styles.hint}>Gardırobunun bulut rafı hazırlanıyor…</Text>
    </View></View>
  </Modal>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, backgroundColor: 'rgba(20,12,11,0.86)' },
  card: { width: '100%', maxWidth: 340, alignItems: 'center', padding: 28, borderRadius: 22, borderWidth: 1, borderColor: colors.sage, backgroundColor: colors.surface },
  title: { color: colors.text, fontFamily: fonts.serif, fontSize: 22, textAlign: 'center', marginTop: 18 },
  hint: { color: colors.textMuted, fontFamily: fonts.sans, fontSize: 11, marginTop: 9 },
});
