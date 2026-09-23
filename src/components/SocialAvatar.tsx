import { Feather } from '@expo/vector-icons';
import { Image, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '../theme';

type Props = { username: string; uri: string | null; size?: number };

export function SocialAvatar({ username, uri, size = 42 }: Props) {
  return (
    <View style={[styles.frame, { width: size, height: size, borderRadius: size / 2 }]}>
      {uri ? <Image source={{ uri }} style={styles.image} resizeMode="cover" /> : (
        username ? <Text style={[styles.initial, { fontSize: size * 0.42 }]}>{username[0].toLocaleUpperCase('tr-TR')}</Text> : <Feather name="user" size={size * 0.45} color={colors.sage} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { overflow: 'hidden', borderWidth: 1, borderColor: colors.gold, backgroundColor: colors.backgroundRaised, alignItems: 'center', justifyContent: 'center' },
  image: { width: '100%', height: '100%' },
  initial: { color: colors.sage, fontFamily: fonts.serif, fontWeight: '700' },
});
