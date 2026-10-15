import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSubscription } from '../billing/SubscriptionContext';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { colors } from '../theme';
export function PlanBanner({ chat = false }: { chat?: boolean }) {
  const { status, error, refresh } = useSubscription();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  return <View style={styles.wrap}><Pressable accessibilityRole="button" onPress={() => navigation.navigate('Pro')} style={styles.card}>
    <Text style={styles.title}>{status?.pro ? 'NE GİYSEM PRO  ✦' : 'NE GİYSEM PRO  →'}</Text>
    <Text style={styles.copy}>{status?.pro ? 'AI etiketleri ve kişisel kombin sohbeti' : !status ? (error ? 'Üyelik doğrulanamadı' : 'Üyelik kontrol ediliyor…') : chat ? `${status.freeChatsRemaining} / 3 ücretsiz sohbet hakkın kaldı` : 'Ücretsiz: 50 parça · Pro ile daha fazlası'}</Text>
  </Pressable>{error && <Pressable onPress={() => void refresh()} accessibilityRole="button" style={{ padding: 8 }}><Text style={styles.copy}>Yeniden kontrol et</Text></Pressable>}</View>;
}
const styles = StyleSheet.create({ wrap: { marginHorizontal: 24, marginVertical: 10 }, card: { padding: 15, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 14, gap: 5 }, title: { color: colors.gold, fontSize: 11, letterSpacing: 1.5, fontWeight: '700' }, copy: { color: colors.textMuted, fontSize: 12, lineHeight: 18 } });
