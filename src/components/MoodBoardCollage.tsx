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
  const angles = [-2, -1, 1, 2] as const;
  return `${angles[seed % angles.length]}deg`;
}

function Polaroid({ item, slot, style, aspect }: { item: ClothingItem; slot: number; style?: StyleProp<ViewStyle>; aspect?: number }) {
  return (
    <View
      style={[styles.polaroid, aspect ? { aspectRatio: aspect } : null, style, { transform: [{ rotate: tiltFor(item.id, slot) }] }]}
      accessible
      accessibilityLabel={`${item.tags.tur} fotoğrafı`}
    >
      {/* contain keeps the whole garment visible; the photo background equals the card paper so no bars show. */}
      <Image source={{ uri: item.imageUri }} style={styles.photo} resizeMode="contain" />
      <Text numberOfLines={1} style={styles.photoCaption}>{item.tags.tur}</Text>
    </View>
  );
}

// Card shape (width / height) per piece, so every garment gets a frame that suits it.
const ASPECT: Record<PieceKind, number> = { top: 0.82, outer: 0.82, bottom: 0.78, shoes: 1.2, accessory: 1.05, unknown: 0.8 };

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
  // Two balanced columns, no overlap: captions and garment tops are never covered.
  const left = [top, bottom, accessories[0]].filter((item): item is ClothingItem => !!item);
  const right = [outer, shoes, accessories[1]].filter((item): item is ClothingItem => !!item);
  return (
    <>
      <View style={styles.board} accessibilityLabel="Kombin stil panosu">
        <View style={styles.boardCornerTop} />
        <View style={styles.boardCornerBottom} />
        <View style={styles.column}>
          {left.map((item, index) => <Polaroid key={item.id} item={item} slot={index} aspect={ASPECT[kindOf(item)]} />)}
        </View>
        <View style={[styles.column, styles.columnCentered]}>
          {right.map((item, index) => <Polaroid key={item.id} item={item} slot={index + 3} aspect={ASPECT[kindOf(item)]} />)}
        </View>
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
  board: { width: '100%', maxWidth: 340, flexDirection: 'row', alignItems: 'stretch', gap: 12, alignSelf: 'center', position: 'relative', padding: 14, borderRadius: 17, backgroundColor: colors.backgroundRaised, borderWidth: 1, borderColor: colors.border },
  boardCornerTop: { position: 'absolute', top: 6, left: 6, width: 18, height: 18, borderTopWidth: 1, borderLeftWidth: 1, borderColor: colors.gold, opacity: 0.65 },
  boardCornerBottom: { position: 'absolute', bottom: 6, right: 6, width: 18, height: 18, borderBottomWidth: 1, borderRightWidth: 1, borderColor: colors.gold, opacity: 0.65 },
  column: { flex: 1, gap: 12 },
  columnCentered: { justifyContent: 'center' },
  polaroid: { padding: 6, paddingBottom: 8, backgroundColor: paper, borderColor: paperEdge, borderWidth: 2, borderRadius: 8, shadowColor: '#100908', shadowOffset: { width: 1, height: 4 }, shadowOpacity: 0.3, shadowRadius: 6, elevation: 5 },
  photo: { width: '100%', flex: 1, borderRadius: 3, backgroundColor: paper },
  photoCaption: { color: colors.ink, fontFamily: fonts.serif, fontSize: 10, lineHeight: 14, textAlign: 'center', marginTop: 5 },
  fallbackGrid: { width: '100%', maxWidth: 340, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 12, alignSelf: 'center', paddingVertical: 8 },
  fallbackCard: { width: '45%', aspectRatio: 0.8 },
});
