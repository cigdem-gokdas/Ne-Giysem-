import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';

/**
 * Connects a scrollable list to a collapsing ScreenHeading.
 * Spread `onScroll` on the ScrollView/FlatList (with scrollEventThrottle={16}) and pass `scrollY` to the heading.
 * `listener` receives the raw scroll events too (e.g. for "stick to bottom" logic).
 */
export function useHeaderScroll(listener?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void) {
  const [scrollY] = useState(() => new Animated.Value(0));
  const listenerRef = useRef(listener);
  useEffect(() => { listenerRef.current = listener; });
  const onScroll = useMemo(
    () => Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
      useNativeDriver: false,
      listener: (event: NativeSyntheticEvent<NativeScrollEvent>) => listenerRef.current?.(event),
    }),
    [scrollY],
  );
  const resetHeader = useMemo(() => () => scrollY.setValue(0), [scrollY]);
  return { scrollY, onScroll, resetHeader };
}
