import { Feather } from '@expo/vector-icons';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useUserId } from '../auth/AuthContext';
import { ScreenFrame } from '../components/ScreenFrame';
import { ScreenHeading } from '../components/ScreenHeading';
import { SocialAvatar } from '../components/SocialAvatar';
import { SocialPostCard } from '../components/SocialPostCard';
import { addComment, blockUser, deleteComment, getComments, reportUser, toggleLike, type PostComment } from '../data/interactions';
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
  const [busyPostId, setBusyPostId] = useState<string | null>(null);
  const [commentPost, setCommentPost] = useState<SocialPost | null>(null);
  const [comments, setComments] = useState<PostComment[]>([]);
  const [commentText, setCommentText] = useState('');
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentSaving, setCommentSaving] = useState(false);
  const [moderationPost, setModerationPost] = useState<SocialPost | null>(null);
  const [reportReason, setReportReason] = useState('');

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

  function updatePost(postId: string, kind: SocialPost['kind'], values: Partial<SocialPost>) {
    setPosts((current) => current.map((post) => post.id === postId && post.kind === kind ? { ...post, ...values } : post));
    setCommentPost((current) => current?.id === postId && current.kind === kind ? { ...current, ...values } : current);
  }

  async function like(post: SocialPost) {
    if (busyPostId) return;
    setBusyPostId(post.id);
    try {
      const result = await toggleLike(userId, post.kind, post.id);
      updatePost(post.id, post.kind, { likedByViewer: result.liked, likeCount: result.likeCount });
    } catch (cause) {
      Alert.alert('Beğeni kaydedilemedi', cause instanceof Error ? cause.message : 'Lütfen tekrar dene.');
    } finally { setBusyPostId(null); }
  }

  async function openComments(post: SocialPost) {
    setCommentPost(post);
    setCommentText('');
    setComments([]);
    setCommentsLoading(true);
    try { setComments(await getComments(userId, post.kind, post.id)); }
    catch (cause) {
      Alert.alert('Yorumlar açılamadı', cause instanceof Error ? cause.message : 'Lütfen tekrar dene.');
      setCommentPost(null);
    } finally { setCommentsLoading(false); }
  }

  async function submitComment() {
    if (!commentPost || commentSaving) return;
    setCommentSaving(true);
    try {
      const saved = await addComment(userId, commentPost.kind, commentPost.id, commentText);
      setComments((current) => [...current, saved]);
      setCommentText('');
      updatePost(commentPost.id, commentPost.kind, { commentCount: commentPost.commentCount + 1 });
    } catch (cause) {
      Alert.alert('Yorum kaydedilemedi', cause instanceof Error ? cause.message : 'Lütfen tekrar dene.');
    } finally { setCommentSaving(false); }
  }

  async function removeComment(comment: PostComment) {
    if (!commentPost) return;
    try {
      await deleteComment(userId, comment.id);
      setComments((current) => current.filter((item) => item.id !== comment.id));
      updatePost(commentPost.id, commentPost.kind, { commentCount: Math.max(0, commentPost.commentCount - 1) });
    } catch (cause) {
      Alert.alert('Yorum silinemedi', cause instanceof Error ? cause.message : 'Lütfen tekrar dene.');
    }
  }

  async function submitReport() {
    if (!moderationPost) return;
    try {
      await reportUser(userId, moderationPost.user.id, reportReason);
      setModerationPost(null);
      setReportReason('');
      Alert.alert('Şikayetin alındı', 'Moderatör incelemesi için yerel kayıt oluşturuldu.');
    } catch (cause) {
      Alert.alert('Şikayet kaydedilemedi', cause instanceof Error ? cause.message : 'Lütfen tekrar dene.');
    }
  }

  function confirmBlock() {
    if (!moderationPost) return;
    const target = moderationPost.user;
    Alert.alert(
      `${target.username} engellensin mi?`,
      'Birbirinizin paylaşımlarını göremez ve etkileşim kuramazsınız.',
      [
        { text: 'Vazgeç', style: 'cancel' },
        { text: 'Engelle', style: 'destructive', onPress: () => {
          void blockUser(userId, target.id).then(() => {
            setPosts((current) => current.filter((post) => post.user.id !== target.id));
            setPeople((current) => current.filter((person) => person.id !== target.id));
            setModerationPost(null);
          }).catch((cause: unknown) => Alert.alert('Engellenemedi', cause instanceof Error ? cause.message : 'Lütfen tekrar dene.'));
        } },
      ],
    );
  }

  const header = (
    <>
      <ScreenHeading eyebrow="STİL DEFTERİ" title="Keşfet" subtitle="Her gün başka bir ilham, aynı sıcak gardırop." showNotifications />
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
        renderItem={({ item }) => <View style={styles.postWrap}><SocialPostCard
          post={item}
          onUserPress={() => openProfile(item.user.id)}
          onLike={() => { void like(item); }}
          onComments={() => { void openComments(item); }}
          onMore={() => {
            if (item.user.id === userId) Alert.alert('Senin paylaşımın', 'Bu paylaşımı Profilim sekmesinden yönetebilirsin.');
            else { setReportReason(''); setModerationPost(item); }
          }}
          busy={busyPostId === item.id}
        /></View>}
        ListEmptyComponent={<View style={styles.empty}><Feather name="compass" size={33} color={colors.lavender} /><Text style={styles.emptyTitle}>İlham burada başlayacak</Text><Text style={styles.state}>Açık bir kombin fotoğrafı veya ilham panosu paylaşıldığında burada görünecek.</Text></View>}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshing={refreshing}
        onRefresh={() => { setRefreshing(true); setReload((n) => n + 1); }}
      />
    )}

    <Modal visible={commentPost !== null} transparent animationType="slide" onRequestClose={() => setCommentPost(null)}>
      <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={styles.modalBackdrop} onPress={() => setCommentPost(null)} />
        <View style={styles.commentSheet}>
          <View style={styles.modalHeader}><View><Text style={styles.modalEyebrow}>STİL SOHBETİ</Text><Text style={styles.modalTitle}>Yorumlar</Text></View><Pressable style={styles.close} onPress={() => setCommentPost(null)}><Feather name="x" size={19} color={colors.sage} /></Pressable></View>
          {commentsLoading ? <ActivityIndicator style={styles.commentLoader} color={colors.sage} /> : <FlatList
            data={comments}
            keyExtractor={(item) => item.id}
            style={styles.commentsList}
            contentContainerStyle={comments.length === 0 ? styles.commentsEmptyList : styles.commentsContent}
            renderItem={({ item }) => <View style={styles.commentRow}>
              <SocialAvatar username={item.username} uri={item.avatarUri} size={33} />
              <View style={styles.commentBubble}><Text style={styles.commentAuthor}>{item.username}</Text><Text style={styles.commentBody}>{item.text}</Text></View>
              {item.isOwner && <Pressable style={styles.commentDelete} onPress={() => { void removeComment(item); }} accessibilityLabel="Yorumu sil"><Feather name="trash-2" size={14} color={colors.pink} /></Pressable>}
            </View>}
            ListEmptyComponent={<View style={styles.commentEmpty}><Text style={styles.emptyTitle}>İlk yorumu sen bırak</Text><Text style={styles.state}>Bu stil hikâyesine sıcak bir not ekle.</Text></View>}
          />}
          <View style={styles.composer}>
            <TextInput style={styles.commentInput} value={commentText} onChangeText={setCommentText} placeholder="Yorumunu yaz..." placeholderTextColor={colors.textFaint} maxLength={300} multiline />
            <Pressable style={[styles.send, (!commentText.trim() || commentSaving) && styles.disabled]} onPress={() => { void submitComment(); }} disabled={!commentText.trim() || commentSaving} accessibilityLabel="Yorumu gönder">
              {commentSaving ? <ActivityIndicator size="small" color={colors.ink} /> : <Feather name="send" size={17} color={colors.ink} />}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>

    <Modal visible={moderationPost !== null} transparent animationType="fade" onRequestClose={() => setModerationPost(null)}>
      <View style={styles.moderationOverlay}>
        <Pressable style={styles.modalBackdrop} onPress={() => setModerationPost(null)} />
        <View style={styles.moderationCard}>
          <Text style={styles.modalEyebrow}>TOPLULUK ARAÇLARI</Text>
          <Text style={styles.modalTitle}>{moderationPost?.user.username}</Text>
          <Text style={styles.moderationHint}>Şikayet nedenini kısaca yazabilir veya bu stil defterini engelleyebilirsin.</Text>
          <TextInput style={styles.reasonInput} value={reportReason} onChangeText={setReportReason} placeholder="Örn: uygunsuz içerik" placeholderTextColor={colors.textFaint} maxLength={240} multiline />
          <Pressable style={styles.reportButton} onPress={() => { void submitReport(); }}><Feather name="flag" size={16} color={colors.pink} /><Text style={styles.reportText}>Kullanıcıyı Şikayet Et</Text></Pressable>
          <Pressable style={styles.blockButton} onPress={confirmBlock}><Feather name="slash" size={16} color={colors.lavender} /><Text style={styles.blockText}>Kullanıcıyı Engelle</Text></Pressable>
          <Pressable style={styles.cancel} onPress={() => setModerationPost(null)}><Text style={styles.cancelText}>Vazgeç</Text></Pressable>
        </View>
      </View>
    </Modal>
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
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(20, 12, 11, 0.76)' },
  modalBackdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  commentSheet: { height: '72%', padding: 19, paddingBottom: Platform.OS === 'ios' ? 28 : 18, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 13, borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  modalEyebrow: { color: colors.gold, fontFamily: fonts.sans, fontSize: 9, letterSpacing: 1.5, fontWeight: '700' },
  modalTitle: { color: colors.text, fontFamily: fonts.serif, fontSize: 25, marginTop: 4 },
  close: { width: 38, height: 38, borderRadius: 11, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  commentLoader: { marginTop: 38 },
  commentsList: { flex: 1 },
  commentsContent: { paddingVertical: 12 },
  commentsEmptyList: { flexGrow: 1, justifyContent: 'center' },
  commentRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, paddingVertical: 9 },
  commentBubble: { flex: 1, padding: 11, borderRadius: 12, backgroundColor: colors.backgroundRaised, borderWidth: 1, borderColor: colors.borderSoft },
  commentAuthor: { color: colors.sage, fontFamily: fonts.sans, fontSize: 11, fontWeight: '700' },
  commentBody: { color: colors.text, fontFamily: fonts.sans, fontSize: 12, lineHeight: 18, marginTop: 3 },
  commentDelete: { padding: 8 },
  commentEmpty: { alignItems: 'center', padding: 25, gap: 8 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 9, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border },
  commentInput: { flex: 1, maxHeight: 94, minHeight: 45, color: colors.text, fontFamily: fonts.sans, fontSize: 13, paddingHorizontal: 13, paddingVertical: 11, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.backgroundRaised },
  send: { width: 45, height: 45, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.sage },
  disabled: { opacity: 0.5 },
  moderationOverlay: { flex: 1, justifyContent: 'center', padding: 23, backgroundColor: 'rgba(20, 12, 11, 0.82)' },
  moderationCard: { padding: 21, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  moderationHint: { color: colors.textMuted, fontFamily: fonts.sans, fontSize: 12, lineHeight: 18, marginTop: 8 },
  reasonInput: { minHeight: 70, color: colors.text, fontFamily: fonts.sans, fontSize: 12, padding: 12, marginTop: 15, borderRadius: 11, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.backgroundRaised, textAlignVertical: 'top' },
  reportButton: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, marginTop: 14, borderRadius: 11, borderWidth: 1, borderColor: colors.pinkDeep, backgroundColor: colors.backgroundRaised },
  reportText: { color: colors.pink, fontFamily: fonts.sans, fontSize: 12, fontWeight: '700' },
  blockButton: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, marginTop: 10, borderRadius: 11, borderWidth: 1, borderColor: colors.lavender },
  blockText: { color: colors.lavender, fontFamily: fonts.sans, fontSize: 12, fontWeight: '700' },
  cancel: { alignItems: 'center', paddingTop: 15 },
  cancelText: { color: colors.textMuted, fontFamily: fonts.sans, fontSize: 12, fontWeight: '700' },
});
