import { Image, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import type { ClothingItem } from '../data/wardrobe';
import { colors, fonts } from '../theme';

type PieceKind = 'top' | 'outer' | 'bottom' | 'shoes' | 'accessory' | 'unknown';
type Tilt = `${number}deg`;

function kindOf(item: ClothingItem): PieceKind {
  const type = item.tags.tur.trim().toLocaleLowerCase('tr-TR');
  if (type === 'üst') return 'top';
  if (type === 'dış giyim') return 'outer';
  if (type === 'alt') return 'bottom';
  if (type === 'ayakkabı') return 'shoes';
  if (type === 'aksesuar' || /çanta|kemer|şal|atkı|takı/.test(type)) return 'accessory';
  return 'unknown';
}

function tiltFor(id: string, slot: number): Tilt {
  const seed = Array.from(id).reduce((sum, char) => sum + char.charCodeAt(0), slot * 7);
  const angles = [-3, -2, 1, 2, 3] as const;
  return `${angles[seed % angles.length]}deg`;
}

function Polaroid({ item, slot, style }: { item: ClothingItem; slot: number; style?: StyleProp<ViewStyle> }) {
  return (
    <View
      style={[styles.polaroid, style, { transform: [{ rotate: tiltFor(item.id, slot) }] }]}
      accessible
      accessibilityLabel={`${item.tags.renk} ${item.tags.tur} fotoğrafı`}
    >
      <Image source={{ uri: item.imageUri }} style={styles.photo} resizeMode="contain" />
      <Text numberOfLines={1} style={styles.photoCaption}>{item.tags.tur} · {item.tags.renk}</Text>
    </View>
  );
}

export function MoodBoardCollage({ items }: { items: ClothingItem[] }) {
  const top = items.find((item) => kindOf(item) === 'top') ?? items.find((item) => kindOf(item) === 'outer');
  const outer = items.find((item) => kindOf(item) === 'outer' && item.id !== top?.id);
  const bottom = items.find((item) => kindOf(item) === 'bottom');
  const shoes = items.find((item) => kindOf(item) === 'shoes');
  const accessories = items.filter((item) => kindOf(item) === 'accessory').slice(0, 2);

  // Two photos or missing categories are more legible in a flexible arrangement.
  const hasUnknown = items.some((item) => kindOf(item) === 'unknown');
  const useCollage = items.length >= 3 && !!top && !!bottom && !hasUnknown;
  if (!useCollage) {
    return (
      <View style={styles.fallbackGrid}>
        {items.map((item, index) => <Polaroid key={item.id} item={item} slot={index} style={styles.fallbackCard} />)}
      </View>
    );
  }

  const placedIds = new Set([top.id, bottom.id, outer?.id, shoes?.id, ...accessories.map((item) => item.id)]);
  const remaining = items.filter((item) => !placedIds.has(item.id));
  return (
    <>
      <View style={styles.board} accessibilityLabel="Kombin stil panosu">
        <View style={styles.boardCornerTop} />
        <View style={styles.boardCornerBottom} />
        <Polaroid item={bottom} slot={1} style={[styles.boardCard, styles.bottomCard]} />
        {outer && <Polaroid item={outer} slot={2} style={[styles.boardCard, styles.outerCard]} />}
        <Polaroid item={top} slot={0} style={[styles.boardCard, styles.topCard]} />
        {shoes && <Polaroid item={shoes} slot={3} style={[styles.boardCard, styles.shoesCard]} />}
        {accessories[0] && <Polaroid item={accessories[0]} slot={4} style={[styles.boardCard, styles.accessoryLeft]} />}
        {accessories[1] && <Polaroid item={accessories[1]} slot={5} style={[styles.boardCard, styles.accessoryRight]} />}
      </View>
      {remaining.length > 0 && (
        <View style={styles.fallbackGrid}>
          {remaining.map((item, index) => <Polaroid key={item.id} item={item} slot={index + 6} style={styles.fallbackCard} />)}
        </View>
      )}
    </>
  );
}

const paper = '#F4E9DD';
const paperEdge = '#FFF5EA';

const styles = StyleSheet.create({
  board: { width: '100%', maxWidth: 340, aspectRatio: 0.78, alignSelf: 'center', position: 'relative', borderRadius: 17, backgroundColor: colors.backgroundRaised, borderWidth: 1, borderColor: colors.border, overflow: 'visible' },
  boardCornerTop: { position: 'absolute', top: 10, left: 10, width: 23, height: 23, borderTopWidth: 1, borderLeftWidth: 1, borderColor: colors.gold, opacity: 0.65 },
  boardCornerBottom: { position: 'absolute', bottom: 10, right: 10, width: 23, height: 23, borderBottomWidth: 1, borderRightWidth: 1, borderColor: colors.gold, opacity: 0.65 },
  polaroid: { padding: 5, paddingBottom: 8, backgroundColor: paper, borderColor: paperEdge, borderWidth: 4, borderRadius: 9, shadowColor: '#100908', shadowOffset: { width: 1, height: 6 }, shadowOpacity: 0.38, shadowRadius: 8, elevation: 8 },
  photo: { width: '100%', flex: 1, borderRadius: 3, backgroundColor: '#DED0C1' },
  photoCaption: { color: colors.ink, fontFamily: fonts.serif, fontSize: 9, lineHeight: 13, textAlign: 'center', marginTop: 4 },
  boardCard: { position: 'absolute' },
  topCard: { top: '6%', left: '25%', width: '50%', height: '49%', zIndex: 8 },
  outerCard: { top: '11%', left: '4%', width: '43%', height: '40%', zIndex: 7 },
  bottomCard: { top: '43%', left: '27%', width: '47%', height: '44%', zIndex: 3 },
  shoesCard: { top: '76%', left: '48%', width: '42%', height: '23%', zIndex: 5 },
  accessoryLeft: { top: '34%', left: '1%', width: '31%', height: '28%', zIndex: 6 },
  accessoryRight: { top: '45%', right: '1%', width: '30%', height: '27%', zIndex: 6 },
  fallbackGrid: { width: '100%', maxWidth: 340, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 11, alignSelf: 'center', paddingVertical: 8 },
  fallbackCard: { width: '45%', aspectRatio: 0.8 },
});
