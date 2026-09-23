import { Feather } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text } from 'react-native';
import { colors, fonts } from '../theme';

type Props = { label: string; onPress: () => void; icon?: keyof typeof Feather.glyphMap; disabled?: boolean };

export function PrimaryButton({ label, onPress, icon, disabled }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && styles.pressed, disabled && styles.disabled]}
    >
      {icon ? <Feather name={icon} size={18} color={colors.ink} style={styles.icon} /> : null}
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: 54, borderRadius: 15, backgroundColor: colors.pink, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  pressed: { opacity: 0.82 },
  disabled: { opacity: 0.45 },
  icon: { marginRight: 9 },
  label: { color: colors.ink, fontFamily: fonts.sans, fontSize: 15, fontWeight: '700', letterSpacing: 0.2 },
});
