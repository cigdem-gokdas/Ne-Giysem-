import { Feather } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '../theme';

type Props = { title: string; subtitle: string; eyebrow: string; onSettingsPress?: () => void; onMenuPress?: () => void; centerTitle?: boolean };

export function ScreenHeading({ title, subtitle, eyebrow, onSettingsPress, onMenuPress, centerTitle = false }: Props) {
  return (
    <View style={styles.container}>
      <View style={[styles.eyebrowRow, centerTitle && styles.centeredEyebrowRow]}>
        <View style={styles.eyebrowLine} />
        <Text style={styles.eyebrow}>{eyebrow}</Text>
      </View>
      <View style={[styles.titleRow, centerTitle && styles.centeredTitleRow]}>
        {onMenuPress && (
          <Pressable style={styles.menuButton} onPress={onMenuPress} accessibilityRole="button" accessibilityLabel="Sohbet menüsünü aç">
            <Feather name="menu" size={22} color={colors.sage} />
          </Pressable>
        )}
        <Text style={[styles.title, centerTitle && styles.centeredTitle]}>{title}</Text>
        {onSettingsPress && (
          <Pressable
            style={styles.settingsButton}
            onPress={onSettingsPress}
            accessibilityRole="button"
            accessibilityLabel="Ayarlar"
          >
            <Feather name="settings" size={20} color={colors.sage} />
          </Pressable>
        )}
        {centerTitle && onMenuPress && <View style={styles.menuSpacer} />}
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
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  centeredTitleRow: { justifyContent: 'center' },
  title: { flexShrink: 1, color: colors.text, fontFamily: fonts.serif, fontSize: 36, lineHeight: 43 },
  centeredTitle: { flex: 1, textAlign: 'center', fontSize: 28 },
  settingsButton: { width: 43, height: 43, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.backgroundRaised, borderWidth: 1, borderColor: colors.border },
  menuButton: { width: 43, height: 43, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.backgroundRaised, borderWidth: 1, borderColor: colors.border },
  menuSpacer: { width: 43, height: 43 },
  subtitle: { color: colors.textMuted, fontFamily: fonts.sans, fontSize: 13, lineHeight: 20, marginTop: 5 },
  centeredSubtitle: { textAlign: 'center' },
});
