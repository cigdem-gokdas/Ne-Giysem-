import { Feather } from '@expo/vector-icons';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { SocialPost } from '../data/social';
import { colors, fonts } from '../theme';
import { MoodBoardCollage } from './MoodBoardCollage';
import { SocialAvatar } from './SocialAvatar';

type Props = {
  post: SocialPost;
  onUserPress: () => void;
  onLike: () => void;
  onComments: () => void;
  onMore: () => void;
  busy?: boolean;
};

export function SocialPostCard({ post, onUserPress, onLike, onComments, onMore, busy = false }: Props) {
  return (
    <View style={styles.card}>
      <View style={styles.authorRow}>
        <Pressable style={styles.author} onPress={onUserPress} accessibilityRole="button" accessibilityLabel={`${post.user.username} profilini aç`}>
          <SocialAvatar username={post.user.username} uri={post.user.avatarUri} />
          <View style={styles.authorText}>
            <Text style={styles.username}>{post.user.username}</Text>
            <Text style={styles.postType}>{post.kind === 'board' ? 'İLHAM PANOSU' : 'STİL GÜNLÜĞÜ'}</Text>
          </View>
        </Pressable>
        <Pressable style={styles.more} onPress={onMore} accessibilityRole="button" accessibilityLabel="Gönderi seçenekleri"><Feather name="more-horizontal" size={20} color={colors.gold} /></Pressable>
      </View>
      {post.kind === 'gallery' && post.imageUri ? (
        <View style={styles.photoFrame}><Image source={{ uri: post.imageUri }} style={styles.photo} resizeMode="cover" /></View>
      ) : post.items.length > 0 ? (
        <View style={styles.collageFrame}><MoodBoardCollage items={post.items} /></View>
      ) : <View style={styles.missing}><Feather name="layers" size={27} color={colors.lavender} /><Text style={styles.missingText}>Bu panonun parçaları artık bulunmuyor.</Text></View>}
      <View style={styles.footer}>
        <View style={styles.interactions}>
          <Pressable onPress={onLike} disabled={busy} style={[styles.action, post.likedByViewer && styles.likedAction]} accessibilityRole="button" accessibilityLabel={post.likedByViewer ? 'Beğeniyi kaldır' : 'Beğen'}>
            <Feather name="heart" size={19} color={post.likedByViewer ? colors.pink : colors.textMuted} />
            <Text style={[styles.actionCount, post.likedByViewer && styles.likedCount]}>{post.likeCount}</Text>
          </Pressable>
          <Pressable onPress={onComments} style={styles.action} accessibilityRole="button" accessibilityLabel="Yorumları aç">
            <Feather name="message-circle" size={19} color={colors.sage} />
            <Text style={styles.actionCount}>{post.commentCount}</Text>
          </Pressable>
        </View>
        <Text style={styles.date}>{new Date(post.createdAt).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })}</Text>
      </View>
      <Text style={styles.caption}>{post.title || (post.kind === 'gallery' ? 'Bugünden bir kare' : 'Bir ilham panosu')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 18, padding: 14, marginBottom: 17 },
  authorRow: { flexDirection: 'row', alignItems: 'center', paddingBottom: 13 },
  author: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  authorText: { flex: 1 },
  username: { color: colors.text, fontFamily: fonts.serif, fontSize: 17 },
  postType: { color: colors.gold, fontFamily: fonts.sans, fontSize: 9, letterSpacing: 1.1, fontWeight: '700', marginTop: 2 },
  more: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  photoFrame: { width: '100%', aspectRatio: 0.88, borderRadius: 11, overflow: 'hidden', borderColor: colors.pinkDeep, borderWidth: 2, backgroundColor: colors.backgroundRaised },
  photo: { width: '100%', height: '100%' },
  collageFrame: { paddingVertical: 9, alignItems: 'center', backgroundColor: colors.backgroundRaised, borderRadius: 11 },
  missing: { minHeight: 170, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.backgroundRaised, borderRadius: 11, gap: 10 },
  missingText: { color: colors.textMuted, fontFamily: fonts.sans, fontSize: 12, textAlign: 'center' },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 },
  interactions: { flexDirection: 'row', gap: 8 },
  action: { minHeight: 35, minWidth: 49, paddingHorizontal: 9, borderRadius: 10, borderWidth: 1, borderColor: colors.borderSoft, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, backgroundColor: colors.backgroundRaised },
  likedAction: { borderColor: colors.pinkDeep },
  actionCount: { color: colors.textMuted, fontFamily: fonts.sans, fontSize: 11, fontWeight: '700' },
  likedCount: { color: colors.pink },
  date: { color: colors.textMuted, fontFamily: fonts.sans, fontSize: 11 },
  caption: { color: colors.pink, fontFamily: fonts.serif, fontSize: 18, marginTop: 8 },
});
