import type { PropsWithChildren } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme';

export function ScreenFrame({ children, includeBottom = false }: PropsWithChildren<{ includeBottom?: boolean }>) {
  return (
    <SafeAreaView style={styles.safeArea} edges={includeBottom ? ['top', 'bottom', 'left', 'right'] : ['top', 'left', 'right']}>
      <View style={styles.frame}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  frame: { flex: 1, backgroundColor: colors.background },
});
