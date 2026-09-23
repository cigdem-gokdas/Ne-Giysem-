import { Feather } from '@expo/vector-icons';
import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { SocialPost } from '../data/social';
import { colors, fonts } from '../theme';
import { MoodBoardCollage } from './MoodBoardCollage';
import { SocialAvatar } from './SocialAvatar';

export function SocialPostCard({ post, onUserPress }: { post: SocialPost; onUserPress: () => void }) {
  const [liked, setLiked] = useState(false);
  return (
    <View style={styles.card}>
      <Pressable style={styles.author} onPress={onUserPress} accessibilityRole="button" accessibilityLabel={`${post.user.username} profilini aç`}>
        <SocialAvatar username={post.user.username} uri={post.user.avatarUri} />
        <View style={styles.authorText}>
          <Text style={styles.username}>{post.user.username}</Text>
          <Text style={styles.postType}>{post.kind === 'board' ? 'İLHAM PANOSU' : 'STİL GÜNLÜĞÜ'}</Text>
        </View>
        <Feather name="chevron-right" size={17} color={colors.gold} />
      </Pressable>
      {post.kind === 'gallery' && post.imageUri ? (
        <View style={styles.photoFrame}><Image source={{ uri: post.imageUri }} style={styles.photo} resizeMode="cover" /></View>
      ) : post.items.length > 0 ? (
        <View style={styles.collageFrame}><MoodBoardCollage items={post.items} /></View>
      ) : <View style={styles.missing}><Feather name="layers" size={27} color={colors.lavender} /><Text style={styles.missingText}>Bu panonun parçaları artık bulunmuyor.</Text></View>}
      <View style={styles.footer}>
        <Pressable onPress={() => setLiked((value) => !value)} style={styles.likeButton} accessibilityRole="button" accessibilityLabel={liked ? 'Beğeniyi kaldır' : 'Beğen'}>
          <Feather name="heart" size={20} color={liked ? colors.pink : colors.textMuted} />
        </Pressable>
        <Text style={styles.date}>{new Date(post.createdAt).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })}</Text>
      </View>
      <Text style={styles.caption}>{post.title || (post.kind === 'gallery' ? 'Bugünden bir kare' : 'Bir ilham panosu')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 18, padding: 14, marginBottom: 17 },
  author: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingBottom: 13 },
  authorText: { flex: 1 },
  username: { color: colors.text, fontFamily: fonts.serif, fontSize: 17 },
  postType: { color: colors.gold, fontFamily: fonts.sans, fontSize: 9, letterSpacing: 1.1, fontWeight: '700', marginTop: 2 },
  photoFrame: { width: '100%', aspectRatio: 0.88, borderRadius: 11, overflow: 'hidden', borderColor: colors.pinkDeep, borderWidth: 2, backgroundColor: colors.backgroundRaised },
  photo: { width: '100%', height: '100%' },
  collageFrame: { paddingVertical: 9, alignItems: 'center', backgroundColor: colors.backgroundRaised, borderRadius: 11 },
  missing: { minHeight: 170, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.backgroundRaised, borderRadius: 11, gap: 10 },
  missingText: { color: colors.textMuted, fontFamily: fonts.sans, fontSize: 12, textAlign: 'center' },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 },
  likeButton: { padding: 4 },
  date: { color: colors.textMuted, fontFamily: fonts.sans, fontSize: 11 },
  caption: { color: colors.pink, fontFamily: fonts.serif, fontSize: 18, marginTop: 6 },
});
