import { Feather } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '../theme';
import { NotificationBell } from './NotificationBell';

type Props = {
  title: string;
  subtitle: string;
  eyebrow: string;
  onSettingsPress?: () => void;
  onMenuPress?: () => void;
  onClearPress?: () => void;
  centerTitle?: boolean;
  showNotifications?: boolean;
};

export function ScreenHeading({
  title, subtitle, eyebrow, onSettingsPress, onMenuPress, onClearPress, centerTitle = false, showNotifications = false,
}: Props) {
  const rightActions = (onSettingsPress ? 1 : 0) + (showNotifications ? 1 : 0) + (onClearPress ? 1 : 0);
  return (
    <View style={styles.container}>
      <View style={[styles.eyebrowRow, centerTitle && styles.centeredEyebrowRow]}>
        <View style={styles.eyebrowLine} />
        <Text style={styles.eyebrow}>{eyebrow}</Text>
      </View>
      <View style={[styles.titleRow, centerTitle && styles.centeredTitleRow]}>
        {centerTitle && (
          onMenuPress ? <View style={{ width: Math.max(43, rightActions * 48) }}><Pressable style={styles.iconButton} onPress={onMenuPress} accessibilityRole="button" accessibilityLabel="Sohbet menüsünü aç"><Feather name="menu" size={22} color={colors.sage} /></Pressable></View>
            : <View style={[styles.actionSpacer, { width: Math.max(43, rightActions * 48) }]} />
        )}
        <Text style={[styles.title, centerTitle && styles.centeredTitle]}>{title}</Text>
        <View style={styles.actions}>
          {onClearPress && <Pressable style={styles.iconButton} onPress={onClearPress} accessibilityRole="button" accessibilityLabel="Sohbet geçmişini temizle"><Feather name="trash-2" size={19} color={colors.pink} /></Pressable>}
          {showNotifications && <NotificationBell />}
          {onSettingsPress && <Pressable style={styles.iconButton} onPress={onSettingsPress} accessibilityRole="button" accessibilityLabel="Ayarlar"><Feather name="settings" size={20} color={colors.sage} /></Pressable>}
          {centerTitle && rightActions === 0 && <View style={styles.actionSpacer} />}
        </View>
      </View>
      <Text style={[styles.subtitle, centerTitle && styles.centeredSubtitle]}>{subtitle}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 28, paddingTop: 22, paddingBottom: 24 },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  centeredEyebrowRow: { justifyContent: 'center' },
  eyebrowLine: { width: 18, height: 1, backgroundColor: colors.gold, marginRight: 9 },
  eyebrow: { color: colors.gold, fontFamily: fonts.sans, fontSize: 10, letterSpacing: 2.4, fontWeight: '700' },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  centeredTitleRow: { justifyContent: 'center' },
  title: { flex: 1, color: colors.text, fontFamily: fonts.serif, fontSize: 36, lineHeight: 43 },
  centeredTitle: { textAlign: 'center', fontSize: 28 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  iconButton: { width: 43, height: 43, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.backgroundRaised, borderWidth: 1, borderColor: colors.border },
  actionSpacer: { width: 43, height: 43 },
  subtitle: { color: colors.textMuted, fontFamily: fonts.sans, fontSize: 13, lineHeight: 20, marginTop: 5 },
  centeredSubtitle: { textAlign: 'center' },
});
