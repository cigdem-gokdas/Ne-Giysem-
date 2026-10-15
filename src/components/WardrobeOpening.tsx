import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useAuth } from '../auth/AuthContext';

/** A cold-launch curtain; the actual navigation tree stays mounted behind the doors. */
export function WardrobeOpening() {
  const { initializing } = useAuth();
  const { width, height } = useWindowDimensions();
  const progress = useRef(new Animated.Value(0)).current;
  const [visible, setVisible] = useState(true);
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (active) setReduceMotion(value); }).catch(() => { if (active) setReduceMotion(true); });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    // A broken startup must never trap the user behind the animation.
    const fallback = setTimeout(() => setVisible(false), 6000);
    return () => { active = false; subscription.remove(); clearTimeout(fallback); };
  }, []);
  useEffect(() => {
    if (initializing || reduceMotion === null || !visible) return;
    const animation = Animated.sequence([
      Animated.delay(reduceMotion ? 0 : 250),
      Animated.timing(progress, { toValue: 1, duration: reduceMotion ? 180 : 1250, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
    ]);
    animation.start(({ finished }) => { if (finished) setVisible(false); });
    return () => animation.stop();
  }, [initializing, reduceMotion, progress, visible]);
  if (!visible) return null;
  const doorWidth = width / 2;
  return <Animated.View accessibilityViewIsModal style={[StyleSheet.absoluteFill, styles.overlay, { opacity: progress.interpolate({ inputRange: [0, reduceMotion ? 0 : .82, 1], outputRange: [1, 1, 0] }) }]}>
    {(['left','right'] as const).map(side => {
      const sign = side === 'left' ? -1 : 1;
      return <Animated.View key={side} accessible={false} style={[styles.door, { width: doorWidth + 1, height, left: side === 'left' ? 0 : doorWidth, transformOrigin: side === 'left' ? 'left center' : 'right center', transform: reduceMotion ? [] : [{ perspective: 1200 }, { rotateY: progress.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${sign * 105}deg`] }) }, { translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [0, sign * 20] }) }] }]}>
        {Array.from({ length: 14 }, (_, i) => <View key={i} style={[styles.grain, { left: `${5 + i * 7}%`, width: i % 3 === 0 ? 3 : 1, opacity: .12 + (i % 4) * .035, transform: [{ rotate: `${i % 2 ? .4 : -.4}deg` }] }]} />)}
        <View style={[styles.raisedPanel, { top: '10%', height: '35%' }]}><View style={styles.innerPanel} /></View>
        <View style={[styles.raisedPanel, { top: '52%', height: '35%' }]}><View style={styles.innerPanel} /></View>
        <View style={[styles.handlePlate, side === 'left' ? { right: 17 } : { left: 17 }]}><View style={styles.handle} /><View style={styles.keyhole} /></View>
        {[.2,.78].map(top => <View key={top} style={[styles.hinge, { top: height * top }, side === 'left' ? { left: 3 } : { right: 3 }]} />)}
      </Animated.View>;
    })}
    <Animated.View pointerEvents="none" style={[styles.label, { opacity: progress.interpolate({ inputRange: [0, .25, 1], outputRange: [1, 0, 0] }) }]}>
      <Text style={styles.title}>Ne Giysem?</Text><Text style={styles.subtitle}>HER DOLABIN BİR HİKÂYESİ VAR</Text>
    </Animated.View>
    <Pressable accessibilityRole="button" accessibilityLabel="Açılış animasyonunu geç" onPress={() => setVisible(false)} style={styles.skip}><Text style={styles.skipText}>Dolabını aç  ›</Text></Pressable>
  </Animated.View>;
}
const styles = StyleSheet.create({
  overlay: { zIndex: 999, overflow: 'hidden' },
  door: { position: 'absolute', backgroundColor: '#613b26', borderColor: '#2c190f', borderWidth: 6, borderTopWidth: 20, borderBottomWidth: 24, backfaceVisibility: 'hidden' },
  grain: { position: 'absolute', top: 0, bottom: 0, backgroundColor: '#c09560' },
  raisedPanel: { position: 'absolute', left: 18, right: 18, borderWidth: 7, borderTopColor: '#926442', borderLeftColor: '#825334', borderRightColor: '#342014', borderBottomColor: '#301c11', backgroundColor: '#4c2e1e', borderRadius: 45 },
  innerPanel: { flex: 1, margin: 6, borderWidth: 1, borderColor: '#a77748', borderRadius: 36, opacity: .55 },
  handlePlate: { top: '47%', width: 19, height: 62, backgroundColor: '#8a6837', borderRadius: 12, borderWidth: 2, borderColor: '#ba9350', alignItems: 'center', paddingTop: 6 },
  handle: { width: 10, height: 24, borderRadius: 6, borderWidth: 3, borderColor: '#d5ad65', backgroundColor: '#4b321b' },
  keyhole: { marginTop: 7, height: 10, width: 4, borderRadius: 3, backgroundColor: '#29190f' },
  hinge: { width: 10, height: 37, borderRadius: 2, backgroundColor: '#8a6837', borderWidth: 1, borderColor: '#b99657' },
  label: { position: 'absolute', top: '3%', width: '100%', alignItems: 'center', paddingTop: 28 },
  title: { color: '#f0d5a7', fontFamily: 'Georgia', fontSize: 29, textShadowColor: '#211208', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 4 },
  subtitle: { color: '#d2af80', fontSize: 8, letterSpacing: 2, marginTop: 7 },
  skip: { position: 'absolute', bottom: 46, alignSelf: 'center', padding: 15 },
  skipText: { color: '#eed3a5', fontSize: 12, letterSpacing: 2 },
});
