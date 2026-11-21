import { Feather } from '@expo/vector-icons';
import { useMemo, useState, type PropsWithChildren } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
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
  /** Slimmer starting state: no eyebrow, one-line subtitle (used by the chat screen). */
  compact?: boolean;
  /** Scroll offset of the screen's list. When given, the heading shrinks while scrolling down and grows back at the top. */
  scrollY?: Animated.Value;
};

/** Distance (px) of scrolling over which the heading goes from full size to the slim bar. */
const COLLAPSE_RANGE = 80;
const COLLAPSED_TITLE = 18;

/** Shrinks to zero height (and fades) with the scroll progress; measures its own natural height once. */
function Collapsible({ progress, fadeEnd = 0.6, children }: PropsWithChildren<{ progress: Animated.AnimatedInterpolation<number> | null; fadeEnd?: number }>) {
  const [height, setHeight] = useState<number | null>(null);
  if (!progress) return <>{children}</>;
  return (
    <Animated.View
      style={{
        overflow: 'hidden',
        height: height === null ? undefined : progress.interpolate({ inputRange: [0, 1], outputRange: [height, 0] }),
        opacity: progress.interpolate({ inputRange: [0, fadeEnd], outputRange: [1, 0], extrapolate: 'clamp' }),
      }}
    >
      <View
        style={styles.measure}
        onLayout={(event) => { const next = event.nativeEvent.layout.height; if (next > 0) setHeight((current) => (current === null || Math.abs(current - next) > 0.5 ? next : current)); }}
      >
        {children}
      </View>
    </Animated.View>
  );
}

export function ScreenHeading({
  title, subtitle, eyebrow, onSettingsPress, onMenuPress, onClearPress, centerTitle = false, showNotifications = false, compact = false, scrollY,
}: Props) {
  const rightActions = (onSettingsPress ? 1 : 0) + (showNotifications ? 1 : 0) + (onClearPress ? 1 : 0);
  const progress = useMemo(() => (scrollY ? scrollY.interpolate({ inputRange: [0, COLLAPSE_RANGE], outputRange: [0, 1], extrapolate: 'clamp' }) : null), [scrollY]);

  const fullTitle = compact ? 22 : centerTitle ? 28 : 36;
  const titleStyle = progress
    ? { fontSize: progress.interpolate({ inputRange: [0, 1], outputRange: [fullTitle, COLLAPSED_TITLE] }), lineHeight: progress.interpolate({ inputRange: [0, 1], outputRange: [Math.round(fullTitle * 1.2), 24] }) }
    : { fontSize: fullTitle, lineHeight: Math.round(fullTitle * 1.2) };
  const containerStyle = progress
    ? {
        paddingTop: progress.interpolate({ inputRange: [0, 1], outputRange: [compact ? 8 : 22, 6] }),
        paddingBottom: progress.interpolate({ inputRange: [0, 1], outputRange: [compact ? 8 : 24, 6] }),
        borderBottomColor: progress.interpolate({ inputRange: [0.6, 1], outputRange: ['rgba(0,0,0,0)', colors.border], extrapolate: 'clamp' }),
      }
    : { paddingTop: compact ? 8 : 22, paddingBottom: compact ? 8 : 24, borderBottomColor: 'rgba(0,0,0,0)' };

  return (
    <Animated.View style={[styles.container, compact && styles.compactContainer, containerStyle]}>
      {!compact && (
        <Collapsible progress={progress} fadeEnd={0.4}>
          <View style={[styles.eyebrowRow, centerTitle && styles.centeredEyebrowRow]}>
            <View style={styles.eyebrowLine} />
            <Text style={styles.eyebrow}>{eyebrow}</Text>
          </View>
        </Collapsible>
      )}
      <View style={[styles.titleRow, centerTitle && styles.centeredTitleRow]}>
        {centerTitle && (
          onMenuPress ? <View style={{ width: Math.max(43, rightActions * 48) }}><Pressable style={styles.iconButton} onPress={onMenuPress} accessibilityRole="button" accessibilityLabel="Sohbet menüsünü aç"><Feather name="menu" size={22} color={colors.sage} /></Pressable></View>
            : <View style={[styles.actionSpacer, { width: Math.max(43, rightActions * 48) }]} />
        )}
        <Animated.Text numberOfLines={1} accessibilityRole="header" style={[styles.title, centerTitle && styles.centeredTitle, titleStyle]}>{title}</Animated.Text>
        <View style={styles.actions}>
          {onClearPress && <Pressable style={styles.iconButton} onPress={onClearPress} accessibilityRole="button" accessibilityLabel="Sohbet geçmişini temizle"><Feather name="trash-2" size={19} color={colors.pink} /></Pressable>}
          {showNotifications && <NotificationBell />}
          {onSettingsPress && <Pressable style={styles.iconButton} onPress={onSettingsPress} accessibilityRole="button" accessibilityLabel="Ayarlar"><Feather name="settings" size={20} color={colors.sage} /></Pressable>}
          {centerTitle && rightActions === 0 && <View style={styles.actionSpacer} />}
        </View>
      </View>
      <Collapsible progress={progress} fadeEnd={0.5}>
        <Text numberOfLines={compact ? 1 : undefined} style={[styles.subtitle, centerTitle && styles.centeredSubtitle, compact && styles.compactSubtitle]}>{subtitle}</Text>
      </Collapsible>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 28, borderBottomWidth: StyleSheet.hairlineWidth, backgroundColor: colors.background },
  compactContainer: { paddingHorizontal: 16 },
  measure: { flexShrink: 0 },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  centeredEyebrowRow: { justifyContent: 'center' },
  eyebrowLine: { width: 18, height: 1, backgroundColor: colors.gold, marginRight: 9 },
  eyebrow: { color: colors.gold, fontFamily: fonts.sans, fontSize: 10, letterSpacing: 2.4, fontWeight: '700' },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  centeredTitleRow: { justifyContent: 'center' },
  title: { flex: 1, color: colors.text, fontFamily: fonts.serif },
  centeredTitle: { textAlign: 'center' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  iconButton: { width: 43, height: 43, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.backgroundRaised, borderWidth: 1, borderColor: colors.border },
  actionSpacer: { width: 43, height: 43 },
  subtitle: { color: colors.textMuted, fontFamily: fonts.sans, fontSize: 13, lineHeight: 20, marginTop: 5 },
  centeredSubtitle: { textAlign: 'center' },
  compactSubtitle: { fontSize: 12, lineHeight: 16, marginTop: 1 },
});
