import { Feather } from '@expo/vector-icons';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useUserId } from '../auth/AuthContext';
import { ScreenFrame } from '../components/ScreenFrame';
import { ScreenHeading } from '../components/ScreenHeading';
import { SocialAvatar } from '../components/SocialAvatar';
import { SocialPostCard } from '../components/SocialPostCard';
import { getDiscoverableUsers, getFeedPosts, type PublicUser, type SocialPost } from '../data/social';
import type { MainTabParamList, RootStackParamList } from '../navigation/AppNavigator';
import { colors, fonts } from '../theme';

export function DiscoverScreen() {
  const userId = useUserId();
  const navigation = useNavigation<BottomTabNavigationProp<MainTabParamList>>();
  const focused = useIsFocused();
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [people, setPeople] = useState<PublicUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [reload, setReload] = useState(0);
  const [failed, setFailed] = useState(false);

  const openProfile = useCallback((id: string) => {
    navigation.getParent<NativeStackNavigationProp<RootStackParamList>>()?.navigate('UserProfile', { userId: id });
  }, [navigation]);

  useEffect(() => {
    if (!focused) return;
    let alive = true;
    setFailed(false);
    Promise.all([getFeedPosts(userId), getDiscoverableUsers(userId)]).then(([nextPosts, nextPeople]) => {
      if (alive) { setPosts(nextPosts); setPeople(nextPeople); }
    }).catch(() => {
      if (alive) setFailed(true);
    }).finally(() => {
      if (alive) { setLoading(false); setRefreshing(false); }
    });
    return () => { alive = false; };
  }, [focused, reload, userId]);

  const header = (
    <>
      <ScreenHeading eyebrow="STİL DEFTERİ" title="Keşfet" subtitle="Her gün başka bir ilham, aynı sıcak gardırop." />
      {people.length > 0 && <View style={styles.peopleSection}>
        <View style={styles.sectionHeading}><Feather name="users" size={15} color={colors.sage} /><Text style={styles.sectionLabel}>DİĞER STİL DEFTERLERİ</Text></View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.peopleRow}>
          {people.map((person) => <Pressable key={person.id} style={styles.person} onPress={() => openProfile(person.id)} accessibilityRole="button" accessibilityLabel={`${person.username} profilini aç`}>
            <SocialAvatar username={person.username} uri={person.avatarUri} size={50} />
            <Text style={styles.personName} numberOfLines={1}>{person.username}</Text>
          </Pressable>)}
        </ScrollView>
      </View>}
      <View style={styles.feedHeading}><Text style={styles.sectionLabel}>GÜNCEL PAYLAŞIMLAR</Text><Feather name="compass" size={17} color={colors.gold} /></View>
    </>
  );

  return <ScreenFrame>
    {loading ? <View style={styles.center}><ActivityIndicator color={colors.sage} /><Text style={styles.state}>Keşfet hazırlanıyor...</Text></View> : failed ? <View style={styles.center}><Text style={styles.state}>Keşfet açılamadı.</Text><Pressable style={styles.retry} onPress={() => { setLoading(true); setReload((n) => n + 1); }}><Text style={styles.retryText}>Tekrar dene</Text></Pressable></View> : (
      <FlatList
        data={posts}
        keyExtractor={(item) => `${item.kind}-${item.id}`}
        ListHeaderComponent={header}
        renderItem={({ item }) => <View style={styles.postWrap}><SocialPostCard post={item} onUserPress={() => openProfile(item.user.id)} /></View>}
        ListEmptyComponent={<View style={styles.empty}><Feather name="compass" size={33} color={colors.lavender} /><Text style={styles.emptyTitle}>İlham burada başlayacak</Text><Text style={styles.state}>Açık bir kombin fotoğrafı veya ilham panosu paylaşıldığında burada görünecek.</Text></View>}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshing={refreshing}
        onRefresh={() => { setRefreshing(true); setReload((n) => n + 1); }}
      />
    )}
  </ScreenFrame>;
}

const styles = StyleSheet.create({
  list: { paddingBottom: 26 },
  postWrap: { paddingHorizontal: 20 },
  peopleSection: { marginBottom: 21 },
  sectionHeading: { paddingHorizontal: 24, flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionLabel: { color: colors.gold, fontFamily: fonts.sans, fontSize: 10, fontWeight: '700', letterSpacing: 1.4 },
  peopleRow: { paddingHorizontal: 24, gap: 15, paddingTop: 13 },
  person: { width: 72, alignItems: 'center', gap: 7 },
  personName: { color: colors.text, fontFamily: fonts.sans, fontSize: 11, textAlign: 'center' },
  feedHeading: { paddingHorizontal: 24, marginBottom: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 15 },
  state: { color: colors.textMuted, fontFamily: fonts.sans, fontSize: 13, lineHeight: 20, textAlign: 'center' },
  retry: { backgroundColor: colors.sage, paddingHorizontal: 20, paddingVertical: 11, borderRadius: 10 },
  retryText: { color: colors.ink, fontFamily: fonts.sans, fontWeight: '700' },
  empty: { marginHorizontal: 24, padding: 27, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', gap: 11 },
  emptyTitle: { color: colors.pink, fontFamily: fonts.serif, fontSize: 23, textAlign: 'center' },
});
