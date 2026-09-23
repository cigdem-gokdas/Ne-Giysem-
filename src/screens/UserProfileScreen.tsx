import { Feather } from '@expo/vector-icons';
import { useIsFocused, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useUserId } from '../auth/AuthContext';
import { MoodBoardCollage } from '../components/MoodBoardCollage';
import { ScreenFrame } from '../components/ScreenFrame';
import { SocialAvatar } from '../components/SocialAvatar';
import { getPublicPostsForUser, getPublicUser, isFollowing, setFollowing, type PublicUser, type SocialPost } from '../data/social';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { colors, fonts } from '../theme';

type ProfileRoute = RouteProp<RootStackParamList, 'UserProfile'>;
type Navigation = NativeStackNavigationProp<RootStackParamList, 'UserProfile'>;

function ProfileTile({ post, width }: { post: SocialPost; width: number }) {
  return <View style={[styles.tile, { width }]}>
    {post.kind === 'gallery' && post.imageUri ? <Image source={{ uri: post.imageUri }} style={styles.tileImage} resizeMode="cover" /> : post.items.length ? <View style={styles.tileBoard}><MoodBoardCollage items={post.items} /></View> : <View style={styles.tileEmpty}><Feather name="layers" size={26} color={colors.lavender} /></View>}
    <View style={styles.tileCaption}><Feather name={post.kind === 'gallery' ? 'camera' : 'layers'} size={11} color={colors.gold} /><Text style={styles.tileTitle} numberOfLines={1}>{post.title || 'Bir stil anı'}</Text></View>
  </View>;
}

export function UserProfileScreen() {
  const viewerId = useUserId();
  const { width } = useWindowDimensions();
  const { params } = useRoute<ProfileRoute>();
  const navigation = useNavigation<Navigation>();
  const focused = useIsFocused();
  const [profile, setProfile] = useState<PublicUser | null>(null);
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [following, setIsFollowing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const isSelf = viewerId === params.userId;

  useEffect(() => {
    if (!focused) return;
    let alive = true;
    setLoading(true);
    setFailed(false);
    Promise.all([getPublicUser(params.userId), getPublicPostsForUser(params.userId, viewerId), isSelf ? Promise.resolve(false) : isFollowing(viewerId, params.userId)])
      .then(([person, nextPosts, follows]) => { if (alive) { setProfile(person); setPosts(nextPosts); setIsFollowing(follows); } })
      .catch(() => { if (alive) setFailed(true); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [focused, isSelf, params.userId, reload, viewerId]);

  async function toggleFollow() {
    if (busy || isSelf) return;
    setBusy(true);
    try {
      await setFollowing(viewerId, params.userId, !following);
      setIsFollowing(!following);
    } catch {
      Alert.alert('Takip değiştirilemedi', 'Lütfen tekrar dene.');
    } finally { setBusy(false); }
  }

  const header = profile && <>
    <View style={styles.profileHeader}>
      <SocialAvatar username={profile.username} uri={profile.avatarUri} size={76} />
      <Text style={styles.username}>{profile.username}</Text>
      <Text style={styles.bio}>{profile.bio || 'Stil defterinden küçük notlar.'}</Text>
      {!isSelf && <Pressable style={[styles.followButton, following && styles.followingButton]} onPress={() => { void toggleFollow(); }} disabled={busy} accessibilityRole="button" accessibilityLabel={following ? 'Takibi bırak' : 'Takip et'}>
        {busy ? <ActivityIndicator size="small" color={colors.ink} /> : <Feather name={following ? 'check' : 'plus'} size={15} color={following ? colors.sage : colors.ink} />}
        <Text style={[styles.followText, following && styles.followingText]}>{following ? 'Takip ediliyor' : 'Takip et'}</Text>
      </Pressable>}
    </View>
    <View style={styles.sectionHeading}><Text style={styles.sectionLabel}>HERKESE AÇIK PAYLAŞIMLAR</Text><Text style={styles.count}>{posts.length} GÖNDERİ</Text></View>
  </>;

  return <ScreenFrame>
    <Pressable style={styles.back} onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel="Keşfet'e dön"><Feather name="arrow-left" size={18} color={colors.sage} /><Text style={styles.backText}>Keşfet'e dön</Text></Pressable>
    {loading ? <View style={styles.center}><ActivityIndicator color={colors.sage} /></View> : failed ? <View style={styles.center}><Text style={styles.error}>Profil açılamadı.</Text><Pressable onPress={() => setReload((n) => n + 1)}><Text style={styles.retry}>Tekrar dene</Text></Pressable></View> : !profile ? <View style={styles.center}><Text style={styles.error}>Profil bulunamadı.</Text></View> : (
      <FlatList
        data={posts}
        keyExtractor={(post) => `${post.kind}-${post.id}`}
        numColumns={2}
        columnWrapperStyle={styles.gridRow}
        contentContainerStyle={styles.list}
        ListHeaderComponent={header}
        renderItem={({ item }) => <ProfileTile post={item} width={(width - 52) / 2} />}
        ListEmptyComponent={<View style={styles.empty}><Feather name="image" size={30} color={colors.lavender} /><Text style={styles.error}>Henüz herkese açık bir paylaşım yok.</Text></View>}
        showsVerticalScrollIndicator={false}
      />
    )}
  </ScreenFrame>;
}

const styles = StyleSheet.create({
  back: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 24, marginTop: 16, paddingVertical: 7 },
  backText: { color: colors.sage, fontFamily: fonts.sans, fontSize: 12, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  error: { color: colors.textMuted, fontFamily: fonts.sans, fontSize: 13, textAlign: 'center' },
  retry: { color: colors.sage, fontFamily: fonts.sans, fontSize: 13, fontWeight: '700' },
  list: { paddingHorizontal: 20, paddingBottom: 35 },
  profileHeader: { alignItems: 'center', marginTop: 22, padding: 22, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 19 },
  username: { color: colors.text, fontFamily: fonts.serif, fontSize: 27, marginTop: 10 },
  bio: { color: colors.textMuted, fontFamily: fonts.sans, fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 7 },
  followButton: { marginTop: 18, minWidth: 150, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 10, borderRadius: 10, backgroundColor: colors.sage },
  followingButton: { backgroundColor: colors.backgroundRaised, borderWidth: 1, borderColor: colors.sage },
  followText: { color: colors.ink, fontFamily: fonts.sans, fontSize: 12, fontWeight: '700' },
  followingText: { color: colors.sage },
  sectionHeading: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 26, marginBottom: 13 },
  sectionLabel: { color: colors.gold, fontFamily: fonts.sans, fontSize: 10, fontWeight: '700', letterSpacing: 1.1 },
  count: { color: colors.textFaint, fontFamily: fonts.sans, fontSize: 10, fontWeight: '700' },
  gridRow: { gap: 12, marginBottom: 12 },
  tile: { minWidth: 0, padding: 7, borderRadius: 13, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  tileImage: { width: '100%', aspectRatio: 0.8, borderRadius: 8, backgroundColor: colors.backgroundRaised },
  tileBoard: { width: '100%', aspectRatio: 0.8, overflow: 'hidden', borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.backgroundRaised },
  tileEmpty: { width: '100%', aspectRatio: 0.8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.backgroundRaised },
  tileCaption: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8, marginBottom: 4 },
  tileTitle: { flex: 1, color: colors.text, fontFamily: fonts.sans, fontSize: 11 },
  empty: { alignItems: 'center', gap: 12, padding: 30, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
});
