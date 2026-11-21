import { Feather } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import type { QueryDocumentSnapshot } from 'firebase/firestore';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUserId } from '../auth/AuthContext';
import { getNotificationsPage, markNotificationsRead, type AppNotification } from '../data/interactions';
import { colors, fonts } from '../theme';

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('tr-TR', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

export function NotificationBell() {
  const userId = useUserId();
  const focused = useIsFocused();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [cursor, setCursor] = useState<QueryDocumentSnapshot | undefined>();
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState('');
  const mounted = useRef(true);
  const loadGeneration = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; loadGeneration.current += 1; };
  }, []);

  /** Loads the first page and returns the notifications now on screen (null when the load failed or was superseded). */
  const load = useCallback(async (): Promise<AppNotification[] | null> => {
    const generation = ++loadGeneration.current;
    if (mounted.current) { setLoading(true); setLoadError(''); }
    try {
      const page = await getNotificationsPage(userId);
      if (!mounted.current || generation !== loadGeneration.current) return null;
      setItems(page.items); setCursor(page.cursor);
      return page.items;
    } catch (cause) {
      if (mounted.current && generation === loadGeneration.current) setLoadError(cause instanceof Error ? cause.message : 'Bildirimler yüklenemedi.');
      return null;
    } finally { if (mounted.current && generation === loadGeneration.current) setLoading(false); }
  }, [userId]);

  useEffect(() => {
    if (focused) void load();
  }, [focused, load]);

  async function loadMore() {
    if (!cursor || loadingMore || loading) return;
    const generation = loadGeneration.current;
    setLoadingMore(true);
    try {
      const page = await getNotificationsPage(userId, cursor);
      if (!mounted.current || generation !== loadGeneration.current) return;
      setItems((current) => [...current, ...page.items.filter((entry) => !current.some((known) => known.id === entry.id))]);
      setCursor(page.cursor);
    } catch (cause) {
      if (mounted.current) setLoadError(cause instanceof Error ? cause.message : 'Daha fazla bildirim yüklenemedi.');
    } finally { if (mounted.current) setLoadingMore(false); }
  }

  async function open() {
    setVisible(true);
    const shown = await load();
    if (!shown) return;
    // Only the notifications currently displayed are marked; newer ones that arrive later stay unread.
    const ids = shown.filter((item) => !item.isRead).map((item) => item.id);
    if (ids.length === 0) return;
    try {
      await markNotificationsRead(userId, ids);
      if (mounted.current) setItems((current) => current.map((item) => ids.includes(item.id) ? { ...item, isRead: true } : item));
    } catch (cause) {
      if (mounted.current) setLoadError(cause instanceof Error ? cause.message : 'Bildirimler okundu olarak işaretlenemedi.');
    }
  }

  const unread = items.filter((item) => !item.isRead).length;
  return (
    <>
      <Pressable style={styles.button} onPress={() => { void open(); }} accessibilityRole="button" accessibilityLabel={`Bildirimler, ${unread} okunmamış`}>
        <Feather name="bell" size={19} color={colors.lavender} />
        {unread > 0 && <View style={styles.badge}><Text style={styles.badgeText}>{Math.min(unread, 9)}{unread > 9 ? '+' : ''}</Text></View>}
      </Pressable>
      <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setVisible(false)}>
        <View style={[styles.overlay, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
          <Pressable style={styles.backdrop} onPress={() => setVisible(false)} accessibilityLabel="Bildirimleri kapat" accessibilityRole="button" />
          <View style={styles.card}>
            <View style={styles.header}>
              <View><Text style={styles.eyebrow}>STİL DEFTERİN</Text><Text style={styles.title}>Bildirimler</Text></View>
              <Pressable style={styles.close} onPress={() => setVisible(false)} accessibilityRole="button" accessibilityLabel="Bildirimleri kapat"><Feather name="x" size={19} color={colors.sage} /></Pressable>
            </View>
            {!!loadError && <Text style={styles.error} accessibilityRole="alert">{loadError}</Text>}
            {loading && items.length === 0 ? <ActivityIndicator style={styles.loader} color={colors.sage} /> : (
              <FlatList
                data={items}
                keyExtractor={(item) => item.id}
                contentContainerStyle={items.length === 0 ? styles.emptyList : styles.list}
                onEndReached={() => { void loadMore(); }}
                onEndReachedThreshold={0.4}
                renderItem={({ item }) => <View style={[styles.notification, !item.isRead && styles.unread]}>
                  <View style={styles.dot} />
                  <View style={styles.notificationText}><Text style={styles.message}>{item.message}</Text><Text style={styles.date}>{formatDate(item.createdAt)}</Text></View>
                </View>}
                ListFooterComponent={cursor ? <Pressable style={styles.more} onPress={() => { void loadMore(); }} disabled={loadingMore} accessibilityRole="button" accessibilityLabel="Daha fazla bildirim yükle">
                  {loadingMore ? <ActivityIndicator size="small" color={colors.sage} /> : <Text style={styles.moreText}>Daha fazla</Text>}
                </Pressable> : null}
                ListEmptyComponent={<View style={styles.empty}><Feather name="bell" size={27} color={colors.lavender} /><Text style={styles.emptyTitle}>Henüz bildirim yok</Text><Text style={styles.emptyText}>Stil topluluğundaki etkileşimler burada görünecek.</Text></View>}
              />
            )}
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  button: { width: 43, height: 43, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.backgroundRaised, borderWidth: 1, borderColor: colors.border },
  badge: { position: 'absolute', top: -4, right: -4, minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 9, backgroundColor: colors.pinkDeep, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.background },
  badgeText: { color: colors.text, fontFamily: fonts.sans, fontWeight: '800', fontSize: 9 },
  overlay: { flex: 1, justifyContent: 'flex-start', paddingHorizontal: 18, backgroundColor: 'rgba(20, 12, 11, 0.82)' },
  backdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  card: { flex: 1, maxHeight: 570, padding: 19, borderRadius: 21, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 15, borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  eyebrow: { color: colors.gold, fontFamily: fonts.sans, fontSize: 9, fontWeight: '700', letterSpacing: 1.6 },
  title: { color: colors.text, fontFamily: fonts.serif, fontSize: 27, marginTop: 4 },
  close: { width: 38, height: 38, borderRadius: 11, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.backgroundRaised },
  loader: { marginTop: 40 },
  error: { color: colors.pink, fontFamily: fonts.sans, fontSize: 12, paddingVertical: 10 },
  list: { paddingTop: 10, paddingBottom: 8 },
  emptyList: { flexGrow: 1, justifyContent: 'center' },
  notification: { flexDirection: 'row', gap: 11, paddingVertical: 13, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: colors.borderSoft, borderRadius: 10 },
  unread: { backgroundColor: colors.backgroundRaised },
  dot: { width: 7, height: 7, borderRadius: 4, marginTop: 6, backgroundColor: colors.sage },
  notificationText: { flex: 1 },
  message: { color: colors.text, fontFamily: fonts.sans, fontSize: 12, lineHeight: 18 },
  date: { color: colors.gold, fontFamily: fonts.sans, fontSize: 9, marginTop: 5 },
  more: { alignItems: 'center', justifyContent: 'center', minHeight: 44, marginTop: 8 },
  moreText: { color: colors.sage, fontFamily: fonts.sans, fontSize: 12, fontWeight: '700' },
  empty: { alignItems: 'center', padding: 24, gap: 9 },
  emptyTitle: { color: colors.pink, fontFamily: fonts.serif, fontSize: 22 },
  emptyText: { color: colors.textMuted, fontFamily: fonts.sans, fontSize: 12, lineHeight: 18, textAlign: 'center' },
});
