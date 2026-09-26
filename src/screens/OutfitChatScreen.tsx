import { Feather } from '@expo/vector-icons';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Image, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MessageBubble } from '../components/MessageBubble';
import { useUserId } from '../auth/AuthContext';
import { ScreenFrame } from '../components/ScreenFrame';
import { ScreenHeading } from '../components/ScreenHeading';
import { appendChatMessage, clearChatSessions, deleteChatSession, getChatSessions, type ChatSession } from '../data/chatSessions';
import { createMoodBoard } from '../data/moodBoards';
import { buildWardrobeSummary, getOutfitHistory, hasAvailableMainPiece, saveOutfitHistoryEntry, type OutfitHistoryEntry } from '../data/outfitHistory';
import { getClothingItems, type ClothingItem } from '../data/wardrobe';
import type { MainTabParamList } from '../navigation/AppNavigator';
import { getReplacementCandidates, isReplacementRequest, recommendOutfit, type ReplacementRequest } from '../services/recommendOutfit';
import { RateLimitError } from '../services/workerApi';
import { colors, fonts } from '../theme';

type ChatMessage =
  | { id: string; role: 'user'; text: string }
  | { id: string; role: 'assistant'; text: string; items: ClothingItem[]; selectedIds: string[] };
type PendingReplacement = { prompt: string; appendUser: boolean; previousIds: string[] };
type FailedRequest = { prompt: string; replacement?: ReplacementRequest };

function inferReplacementId(prompt: string, selectedItems: ClothingItem[]): string | null {
  const text = prompt.toLocaleLowerCase('tr-TR');
  const typeHints: Array<[RegExp, string]> = [
    [/gömlek|bluz|kazak|tişört|tshirt|triko|hırka/, 'üst'],
    [/etek|pantolon|şort|jean/, 'alt'],
    [/ceket|mont|kaban|palto|trençkot/, 'dış giyim'],
    [/ayakkabı|bot|çizme|sneaker|mary jane|topuklu/, 'ayakkabı'],
    [/çanta|kemer|şal|atkı|takı|aksesuar/, 'aksesuar'],
  ];
  const hintedType = typeHints.find(([pattern]) => pattern.test(text))?.[1];
  if (!hintedType) return null;
  const matching = selectedItems.filter((item) => item.tags.tur.trim().toLocaleLowerCase('tr-TR') === hintedType);
  if (matching.length === 1) return matching[0].id;
  const colorMatches = matching.filter((item) => text.includes(item.tags.renk.trim().toLocaleLowerCase('tr-TR')));
  return colorMatches.length === 1 ? colorMatches[0].id : null;
}

function messagesFromSession(session: ChatSession | undefined, wardrobe: ClothingItem[]): ChatMessage[] {
  const byId = new Map(wardrobe.map((item) => [item.id, item]));
  return session?.messages.map((entry): ChatMessage => entry.role === 'user'
    ? { id: entry.id, role: 'user', text: entry.text }
    : { id: entry.id, role: 'assistant', text: entry.text, selectedIds: entry.selectedIds, items: entry.selectedIds.flatMap((id) => {
      const item = byId.get(id);
      return item ? [item] : [];
    }) }) ?? [];
}

export function OutfitChatScreen() {
  const userId = useUserId();
  const navigation = useNavigation<BottomTabNavigationProp<MainTabParamList>>();
  const isFocused = useIsFocused();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const drawerWidth = Math.min(320, width * 0.86);
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null | undefined>(undefined);
  const [drawerVisible, setDrawerVisible] = useState(false);
  const drawerX = useRef(new Animated.Value(-360)).current;
  const activeSessionIdRef = useRef<string | null | undefined>(undefined);
  const [wardrobe, setWardrobe] = useState<ClothingItem[]>([]);
  const [history, setHistory] = useState<OutfitHistoryEntry[]>([]);
  const [isLoadingWardrobe, setIsLoadingWardrobe] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [isSending, setIsSending] = useState(false);
  const [failedRequest, setFailedRequest] = useState<FailedRequest | null>(null);
  const [pendingReplacement, setPendingReplacement] = useState<PendingReplacement | null>(null);
  const [savingBoardId, setSavingBoardId] = useState<string | null>(null);
  const [savedBoardIds, setSavedBoardIds] = useState<Set<string>>(() => new Set());
  const [deletingChats, setDeletingChats] = useState(false);
  const historyRef = useRef<OutfitHistoryEntry[]>([]);
  const sendingRef = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const chatMutationRef = useRef(0);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
      drawerX.stopAnimation();
    };
  }, [drawerX]);

  useEffect(() => {
    if (drawerVisible) Animated.timing(drawerX, { toValue: 0, duration: 240, useNativeDriver: true }).start();
  }, [drawerVisible, drawerX]);

  function closeDrawer(afterClose?: () => void) {
    Animated.timing(drawerX, { toValue: -drawerWidth, duration: 220, useNativeDriver: true }).start(({ finished }) => {
      if (!finished || !mountedRef.current) return;
      setDrawerVisible(false);
      afterClose?.();
    });
  }

  function chooseSession(sessionId: string | null) {
    if (deletingChats || isSending) return;
    activeSessionIdRef.current = sessionId;
    setActiveSessionId(sessionId);
    setMessages(messagesFromSession(sessions.find((session) => session.id === sessionId), wardrobe));
    setDraft('');
    setFailedRequest(null);
    setPendingReplacement(null);
    closeDrawer();
  }

  function resetConversation(nextSessions: ChatSession[]) {
    const next = nextSessions[0];
    activeSessionIdRef.current = next?.id ?? null;
    setActiveSessionId(next?.id ?? null);
    setSessions(nextSessions);
    setMessages(messagesFromSession(next, wardrobe));
    setDraft('');
    setFailedRequest(null);
    setPendingReplacement(null);
  }

  function confirmClearChats() {
    if (isSending || deletingChats || sessions.length === 0) return;
    Alert.alert('Sohbet geçmişi silinsin mi?', 'Tüm eski sohbetlerin silinecek. Bu işlem geri alınamaz.', [
      { text: 'Vazgeç', style: 'cancel' },
      { text: 'Temizle', style: 'destructive', onPress: () => { void clearChats(); } },
    ]);
  }

  async function clearChats() {
    if (isSending || deletingChats) return;
    setDeletingChats(true);
    chatMutationRef.current += 1;
    resetConversation([]);
    try {
      await clearChatSessions(userId);
    } catch (error) {
      Alert.alert('Sohbetler silinemedi', error instanceof Error ? error.message : 'Lütfen tekrar dene.');
      setReloadKey((value) => value + 1);
    } finally { if (mountedRef.current) setDeletingChats(false); }
  }

  function confirmDeleteSession(session: ChatSession) {
    if (isSending || deletingChats) return;
    Alert.alert('Sohbet silinsin mi?', `“${session.title}” sohbeti kalıcı olarak silinecek.`, [
      { text: 'Vazgeç', style: 'cancel' },
      { text: 'Sil', style: 'destructive', onPress: () => { void removeSession(session.id); } },
    ]);
  }

  async function removeSession(sessionId: string) {
    if (isSending || deletingChats) return;
    setDeletingChats(true);
    chatMutationRef.current += 1;
    const remaining = sessions.filter((session) => session.id !== sessionId);
    if (activeSessionIdRef.current === sessionId) resetConversation(remaining);
    else setSessions(remaining);
    try {
      await deleteChatSession(userId, sessionId);
    } catch (error) {
      Alert.alert('Sohbet silinemedi', error instanceof Error ? error.message : 'Lütfen tekrar dene.');
      setReloadKey((value) => value + 1);
    } finally { if (mountedRef.current) setDeletingChats(false); }
  }

  useEffect(() => {
    if (!isFocused) return;
    let active = true;
    const mutation = chatMutationRef.current;
    setIsLoadingWardrobe(true);
    setLoadError(false);
    Promise.all([getClothingItems(userId), getOutfitHistory(userId), getChatSessions(userId)])
      .then(([items, savedHistory, savedSessions]) => {
        if (active && mutation === chatMutationRef.current) {
          setWardrobe(items);
          setHistory(savedHistory);
          historyRef.current = savedHistory;
          setSessions(savedSessions);
          const previousId = activeSessionIdRef.current;
          const selectedId = previousId === undefined || (previousId !== null && !savedSessions.some((session) => session.id === previousId))
            ? savedSessions[0]?.id ?? null
            : previousId;
          activeSessionIdRef.current = selectedId;
          setActiveSessionId(selectedId);
          setMessages(messagesFromSession(savedSessions.find((session) => session.id === selectedId), items));
          setFailedRequest(null);
          setPendingReplacement(null);
        }
      })
      .catch(() => {
        if (active) setLoadError(true);
      })
      .finally(() => {
        if (active) setIsLoadingWardrobe(false);
      });
    return () => { active = false; };
  }, [isFocused, reloadKey, userId]);

  const hasAvailableMain = hasAvailableMainPiece(buildWardrobeSummary(wardrobe, history));
  const activeSession = sessions.find((session) => session.id === activeSessionId);
  const lastOutfit = activeSession?.messages.filter((message) => message.role === 'assistant').at(-1);
  const canChangeLast = !!lastOutfit && lastOutfit.selectedIds.some((id) =>
    getReplacementCandidates(wardrobe, history, { previousIds: lastOutfit.selectedIds, replaceId: id }).length > 0);
  const canCompose = wardrobe.length >= 2 && (hasAvailableMain || canChangeLast);
  const canSend = !isLoadingWardrobe && !loadError && canCompose && !isSending && !deletingChats && draft.trim().length > 0;

  async function saveAssistantBoard(message: Extract<ChatMessage, { role: 'assistant' }>) {
    if (savingBoardId || savedBoardIds.has(message.id)) return;
    setSavingBoardId(message.id);
    try {
      const excerpt = message.text.trim().split(/\s+/).slice(0, 5).join(' ');
      await createMoodBoard(userId, excerpt ? `AI Önerisi · ${excerpt}` : 'AI Önerisi', message.selectedIds);
      setSavedBoardIds((current) => new Set(current).add(message.id));
    } catch (error) {
      Alert.alert('Pano kaydedilemedi', error instanceof Error ? error.message : 'Lütfen tekrar dene.');
    } finally {
      setSavingBoardId(null);
    }
  }

  async function sendMessage(text: string, appendUser = true, replacement?: ReplacementRequest) {
    const prompt = text.trim();
    if (!prompt || sendingRef.current || deletingChats || isLoadingWardrobe || loadError || wardrobe.length < 2) return;

    let exchange = replacement;
    if (!exchange && isReplacementRequest(prompt) && lastOutfit) {
      const selectedItems = lastOutfit.selectedIds.flatMap((id) => {
        const item = wardrobe.find((piece) => piece.id === id);
        return item ? [item] : [];
      });
      const inferredId = inferReplacementId(prompt, selectedItems);
      if (inferredId) {
        exchange = { previousIds: lastOutfit.selectedIds, replaceId: inferredId };
      } else {
        const anyAlternative = lastOutfit.selectedIds.some((id) =>
          getReplacementCandidates(wardrobe, historyRef.current, { previousIds: lastOutfit.selectedIds, replaceId: id }).length > 0);
        if (!anyAlternative) {
          Alert.alert('Alternatif bulunamadı', 'Son kombindeki parçalar için uygun bir alternatif henüz yok.');
          return;
        }
        Keyboard.dismiss();
        setPendingReplacement({ prompt, appendUser, previousIds: lastOutfit.selectedIds });
        return;
      }
    }
    if (exchange) {
      if (getReplacementCandidates(wardrobe, historyRef.current, exchange).length === 0) {
        Alert.alert('Alternatif bulunamadı', 'Bu parça için uygun bir alternatif henüz yok.');
        return;
      }
    } else if (!hasAvailableMain) {
      Alert.alert('Parçalar dinleniyor', 'Yeni kombin için gardırobuna kullanılmamış bir ana parça ekle. Son kombininden parça değişimi de isteyebilirsin.');
      return;
    }

    sendingRef.current = true;
    setIsSending(true);
    setFailedRequest(null);
    Keyboard.dismiss();
    if (appendUser) {
      setDraft('');
    }

    const currentWardrobe = wardrobe;
    const controller = new AbortController();
    controllerRef.current = controller;
    const timeout = setTimeout(() => controller.abort(), 30000);
    let userMessageSaved = !appendUser;

    try {
      let sessionId = activeSessionIdRef.current ?? null;
      if (appendUser) {
        const saved = await appendChatMessage(userId, sessionId, { role: 'user', text: prompt });
        sessionId = saved.session.id;
        activeSessionIdRef.current = sessionId;
        setActiveSessionId(sessionId);
        setSessions(saved.sessions);
        setMessages(messagesFromSession(saved.session, currentWardrobe));
        userMessageSaved = true;
      }
      if (!sessionId) throw new Error('Sohbet bulunamadı.');
      const recommendation = await recommendOutfit(userId, prompt, currentWardrobe, historyRef.current, controller.signal, exchange);
      if (!mountedRef.current) return;
      const byId = new Map(currentWardrobe.map((item) => [item.id, item]));
      const items = recommendation.secilen_idler.flatMap((id) => {
        const item = byId.get(id);
        return item ? [item] : [];
      });
      try {
        const saved = await appendChatMessage(userId, sessionId, { role: 'assistant', text: recommendation.mesaj, selectedIds: recommendation.secilen_idler });
        if (!mountedRef.current) return;
        setSessions(saved.sessions);
        setMessages(messagesFromSession(saved.session, currentWardrobe));
      } catch {
        if (mountedRef.current) {
          setMessages((current) => [...current, { id: `${Date.now()}-assistant`, role: 'assistant', text: recommendation.mesaj, items, selectedIds: recommendation.secilen_idler }]);
          Alert.alert('Sohbet kaydedilemedi', 'Kombin oluşturuldu ancak sohbet oturumuna kaydedilemedi.');
        }
      }
      try {
        const savedEntry = await saveOutfitHistoryEntry(userId, {
          userMessage: prompt,
          assistantMessage: recommendation.mesaj,
          selectedIds: recommendation.secilen_idler,
        });
        if (!mountedRef.current) return;
        historyRef.current = [...historyRef.current, savedEntry];
        setHistory(historyRef.current);
      } catch {
        if (mountedRef.current) Alert.alert('Kombin geçmişi kaydedilemedi', 'Öneri sohbetinde duruyor ancak son kullanım hesabı için kaydedilemedi.');
      }
    } catch (error) {
      if (mountedRef.current) {
        if (!userMessageSaved) {
          setDraft(prompt);
          Alert.alert('Sohbet kaydedilemedi', 'Mesaj cihazına kaydedilemedi. Lütfen tekrar dene.');
        } else {
          setFailedRequest({ prompt, replacement: exchange });
          if (error instanceof RateLimitError) {
            Alert.alert(error.reason === 'daily' ? 'Günlük ilham sınırı' : 'Biraz yavaşlayalım', error.message);
          } else {
            Alert.alert('Kombin oluşturulamadı', error instanceof Error ? error.message : 'Kombin önerisi alınamadı, lütfen tekrar dene.');
          }
        }
      }
    } finally {
      clearTimeout(timeout);
      if (controllerRef.current === controller) controllerRef.current = null;
      sendingRef.current = false;
      if (mountedRef.current) setIsSending(false);
    }
  }

  return (
    <ScreenFrame>
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={0}>
        <ScreenHeading eyebrow="KİŞİSEL STİL DANIŞMANIN" title="Kombin sohbet" subtitle={activeSession?.title ?? 'Bir plan anlat, gardırobundan bir hikâye çıkaralım.'} onMenuPress={() => { Keyboard.dismiss(); drawerX.setValue(-drawerWidth); setDrawerVisible(true); }} onClearPress={sessions.length > 0 && !deletingChats && !isSending ? confirmClearChats : undefined} centerTitle showNotifications />
        {isLoadingWardrobe ? (
          <View style={styles.centerState}><ActivityIndicator color={colors.sage} /><Text style={styles.stateText}>Gardırobun açılıyor...</Text></View>
        ) : loadError ? (
          <View style={styles.centerState}>
            <Text style={styles.stateTitle}>Gardırop okunamadı</Text>
            <Text style={styles.stateText}>Kayıtlı parçalarını yeniden yükleyebilirsin.</Text>
            <Pressable style={styles.stateButton} onPress={() => setReloadKey((value) => value + 1)}><Text style={styles.stateButtonText}>Tekrar dene</Text></Pressable>
          </View>
        ) : (
          <ScrollView
            ref={scrollRef}
            style={styles.chatScroll}
            contentContainerStyle={styles.chatContent}
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
          >
            {wardrobe.length < 2 && (
              <View style={styles.noticeCard}>
                <Feather name="heart" size={25} color={colors.pink} />
                <Text style={styles.noticeText}>Kombin yapabilmem için önce gardırobuna birkaç parça eklemelisin.</Text>
                <Pressable style={styles.stateButton} onPress={() => navigation.navigate('Wardrobe')}><Text style={styles.stateButtonText}>Gardıroba git</Text></Pressable>
              </View>
            )}
            {wardrobe.length >= 2 && !hasAvailableMain && (
              <View style={styles.noticeCard}>
                <Feather name="clock" size={25} color={colors.sage} />
                <Text style={styles.noticeText}>Ana parçaların son 5 kombinde kullanıldı. Yeni kombin için başka bir ana parça ekle.{canChangeLast ? ' Son kombininden parça değişimi de isteyebilirsin.' : ''}</Text>
                <Pressable style={styles.stateButton} onPress={() => navigation.navigate('Wardrobe')}><Text style={styles.stateButtonText}>Gardıroba git</Text></Pressable>
              </View>
            )}
            {messages.length === 0 && wardrobe.length >= 2 && hasAvailableMain && (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyOrnament}>✦</Text>
                <Text style={styles.emptyTitle}>Bugün nereye gidiyoruz?</Text>
                <Text style={styles.emptyText}>Yaz, gardırobundaki parçalarla sana bir kombin önereyim...</Text>
              </View>
            )}
            {messages.map((message) => (
              <MessageBubble
                key={message.id}
                sender={message.role}
                text={message.text}
                items={message.role === 'assistant' ? message.items : undefined}
                onSaveBoard={message.role === 'assistant' ? () => { void saveAssistantBoard(message); } : undefined}
                isSavingBoard={message.role === 'assistant' && savingBoardId === message.id}
                isSavedBoard={message.role === 'assistant' && savedBoardIds.has(message.id)}
              />
            ))}
            {isSending && (
              <View style={styles.thinkingBubble}><ActivityIndicator size="small" color={colors.sage} /><Text style={styles.thinkingText}>Düşünüyor...</Text></View>
            )}
            {failedRequest && !isSending && (
              <Pressable style={styles.retryButton} onPress={() => sendMessage(failedRequest.prompt, false, failedRequest.replacement)}>
                <Feather name="refresh-cw" size={14} color={colors.pink} />
                <Text style={styles.retryText}>Öneriyi tekrar dene</Text>
              </Pressable>
            )}
          </ScrollView>
        )}
        <View style={styles.composerArea}>
          <Text style={styles.composerLabel}>GARDIROBUNDAN SANA ÖZEL</Text>
          <View style={styles.composer}>
            <TextInput
              style={styles.input}
              placeholder="Nereye gidiyorsun?"
              placeholderTextColor={colors.textFaint}
              value={draft}
              onChangeText={setDraft}
              maxLength={280}
              returnKeyType="send"
              onSubmitEditing={() => sendMessage(draft)}
              editable={!isLoadingWardrobe && !loadError && canCompose && !isSending && !deletingChats}
              accessibilityLabel="Kombin isteğini yaz"
            />
            <Pressable style={[styles.sendButton, !canSend && styles.sendDisabled]} onPress={() => sendMessage(draft)} disabled={!canSend} accessibilityRole="button" accessibilityLabel="Mesajı gönder">
              <Feather name="arrow-up" size={20} color={colors.ink} />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
      <Modal visible={pendingReplacement !== null} transparent animationType="fade" onRequestClose={() => setPendingReplacement(null)}>
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalBackdrop} onPress={() => setPendingReplacement(null)} />
          <View style={styles.modalCard}>
            <Text style={styles.modalOverline}>KOMBİNDE KÜÇÜK BİR DEĞİŞİM</Text>
            <Text style={styles.modalTitle}>Hangi parçayı değiştirelim?</Text>
            <Text style={styles.modalSubtitle}>Seçtiğin parçanın yerine aynı türden uygun bir alternatif bulacağım.</Text>
            <ScrollView style={styles.modalList}>
              {pendingReplacement?.previousIds.map((id) => {
                const item = wardrobe.find((piece) => piece.id === id);
                if (!item) return null;
                const request = { previousIds: pendingReplacement.previousIds, replaceId: id };
                const alternativeCount = getReplacementCandidates(wardrobe, historyRef.current, request).length;
                return (
                  <Pressable
                    key={id}
                    style={[styles.modalOption, alternativeCount === 0 && styles.modalOptionDisabled]}
                    disabled={alternativeCount === 0}
                    onPress={() => {
                      const pending = pendingReplacement;
                      setPendingReplacement(null);
                      sendMessage(pending.prompt, pending.appendUser, request);
                    }}
                  >
                    <Image source={{ uri: item.imageUri }} style={styles.modalPhoto} resizeMode="cover" />
                    <View style={styles.modalOptionText}>
                      <Text style={styles.modalItemName}>{item.tags.renk} {item.tags.tur}</Text>
                      <Text style={styles.modalItemHint}>{alternativeCount > 0 ? `${alternativeCount} alternatif` : 'Uygun alternatif yok'}</Text>
                    </View>
                    <Feather name="chevron-right" size={17} color={colors.sage} />
                  </Pressable>
                );
              })}
            </ScrollView>
            <Pressable style={styles.modalCancel} onPress={() => setPendingReplacement(null)}><Text style={styles.modalCancelText}>Vazgeç</Text></Pressable>
          </View>
        </View>
      </Modal>
      <Modal visible={drawerVisible} transparent animationType="none" onRequestClose={() => closeDrawer()}>
        <View style={styles.drawerLayer}>
          <Pressable style={styles.drawerBackdrop} onPress={() => closeDrawer()} accessibilityLabel="Sohbet menüsünü kapat" />
          <Animated.View style={[styles.drawer, { width: drawerWidth, paddingTop: insets.top + 22, paddingBottom: insets.bottom + 18, transform: [{ translateX: drawerX }] }]}>
            <Text style={styles.drawerEyebrow}>NE GİYSEM?  /  SOHBETLER</Text>
            <Text style={styles.drawerTitle}>Stil defterin</Text>
            <Pressable style={styles.newChatButton} onPress={() => chooseSession(null)} disabled={isSending || deletingChats} accessibilityRole="button" accessibilityLabel="Yeni sohbet başlat">
              <Feather name="plus" size={19} color={colors.ink} /><Text style={styles.newChatText}>Yeni Sohbet</Text>
            </Pressable>
            <Text style={styles.drawerSection}>ÖNCEKİ SOHBETLER</Text>
            <ScrollView style={styles.sessionScroll} showsVerticalScrollIndicator={false}>
              {sessions.length === 0 && <Text style={styles.noSessions}>İlk sohbetin burada görünecek.</Text>}
              {sessions.map((session) => (
                <Pressable key={session.id} style={[styles.sessionRow, session.id === activeSessionId && styles.activeSession]} onPress={() => chooseSession(session.id)} disabled={isSending || deletingChats} accessibilityRole="button" accessibilityLabel={`${session.title} sohbetini aç`}>
                  <Feather name="message-circle" size={17} color={session.id === activeSessionId ? colors.pink : colors.sage} />
                  <View style={styles.sessionText}><Text style={[styles.sessionTitle, session.id === activeSessionId && styles.activeSessionTitle]} numberOfLines={1}>{session.title}</Text><Text style={styles.sessionDate}>{new Date(session.createdAt).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })}</Text></View>
                  <Pressable style={styles.sessionDelete} onPress={(event) => { event.stopPropagation(); confirmDeleteSession(session); }} disabled={isSending || deletingChats} accessibilityRole="button" accessibilityLabel={`${session.title} sohbetini sil`}><Feather name="trash-2" size={16} color={colors.pink} /></Pressable>
                </Pressable>
              ))}
            </ScrollView>
            <Text style={styles.drawerFooter}>Sohbetlerin hesabına bağlı bulut alanında saklanır.</Text>
          </Animated.View>
        </View>
      </Modal>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centerState: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 28, paddingBottom: 24 },
  stateTitle: { fontFamily: fonts.serif, fontSize: 23, color: colors.text, textAlign: 'center' },
  stateText: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 21, color: colors.textMuted, textAlign: 'center', marginTop: 12 },
  noticeCard: { width: '100%', padding: 28, backgroundColor: colors.surface, borderRadius: 20, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  noticeText: { fontFamily: fonts.serif, fontSize: 21, lineHeight: 30, color: colors.pink, textAlign: 'center', marginTop: 18 },
  stateButton: { marginTop: 22, paddingHorizontal: 22, paddingVertical: 12, borderRadius: 12, backgroundColor: colors.sage },
  stateButtonText: { fontFamily: fonts.sans, fontSize: 13, fontWeight: '700', color: colors.ink },
  chatScroll: { flex: 1 },
  chatContent: { paddingHorizontal: 22, paddingTop: 10, paddingBottom: 22, flexGrow: 1 },
  emptyCard: { marginTop: 'auto', marginBottom: 'auto', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 35 },
  emptyOrnament: { fontSize: 31, color: colors.gold, marginBottom: 14 },
  emptyTitle: { fontFamily: fonts.serif, fontSize: 25, color: colors.text, textAlign: 'center' },
  emptyText: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 21, color: colors.textMuted, textAlign: 'center', marginTop: 9 },
  thinkingBubble: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surfaceLight, borderColor: colors.border, borderWidth: 1, borderRadius: 16, paddingHorizontal: 15, paddingVertical: 12 },
  thinkingText: { fontFamily: fonts.sans, fontSize: 13, color: colors.sage },
  retryButton: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 5, padding: 10 },
  retryText: { fontFamily: fonts.sans, fontSize: 12, color: colors.pink },
  composerArea: { paddingHorizontal: 22, paddingTop: 12, paddingBottom: 13, borderTopWidth: 1, borderTopColor: colors.borderSoft, backgroundColor: colors.backgroundRaised },
  composerLabel: { color: colors.gold, fontFamily: fonts.sans, fontSize: 9, fontWeight: '700', letterSpacing: 1.6, marginBottom: 9 },
  composer: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: 15, borderWidth: 1, borderColor: colors.border, paddingLeft: 15, paddingRight: 5, minHeight: 52 },
  input: { flex: 1, color: colors.text, fontFamily: fonts.sans, fontSize: 14, paddingVertical: 10 },
  sendButton: { width: 41, height: 41, borderRadius: 12, backgroundColor: colors.pink, alignItems: 'center', justifyContent: 'center' },
  sendDisabled: { opacity: 0.4 },
  modalOverlay: { flex: 1, justifyContent: 'center', paddingHorizontal: 22, backgroundColor: 'rgba(20, 12, 11, 0.75)' },
  modalBackdrop: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 },
  modalCard: { maxHeight: '78%', padding: 22, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 20 },
  modalOverline: { color: colors.gold, fontFamily: fonts.sans, fontSize: 9, fontWeight: '700', letterSpacing: 1.5 },
  modalTitle: { color: colors.text, fontFamily: fonts.serif, fontSize: 24, marginTop: 9 },
  modalSubtitle: { color: colors.textMuted, fontFamily: fonts.sans, fontSize: 12, lineHeight: 19, marginTop: 6, marginBottom: 16 },
  modalList: { flexGrow: 0 },
  modalOption: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 8, marginBottom: 8, borderRadius: 12, backgroundColor: colors.backgroundRaised, borderWidth: 1, borderColor: colors.border },
  modalOptionDisabled: { opacity: 0.45 },
  modalPhoto: { width: 48, height: 48, borderRadius: 8, borderWidth: 1, borderColor: colors.pinkDeep },
  modalOptionText: { flex: 1 },
  modalItemName: { color: colors.text, fontFamily: fonts.sans, fontSize: 13 },
  modalItemHint: { color: colors.sage, fontFamily: fonts.sans, fontSize: 11, marginTop: 3 },
  modalCancel: { alignItems: 'center', paddingVertical: 12, marginTop: 6 },
  modalCancelText: { color: colors.pink, fontFamily: fonts.sans, fontSize: 13, fontWeight: '700' },
  drawerLayer: { flex: 1, flexDirection: 'row' },
  drawerBackdrop: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(13, 8, 7, 0.72)' },
  drawer: { height: '100%', backgroundColor: colors.backgroundRaised, borderRightWidth: 1, borderRightColor: colors.border, paddingHorizontal: 18, shadowColor: '#000', shadowOffset: { width: 6, height: 0 }, shadowOpacity: 0.35, shadowRadius: 16, elevation: 12 },
  drawerEyebrow: { color: colors.gold, fontFamily: fonts.sans, fontSize: 9, letterSpacing: 1.8, fontWeight: '700' },
  drawerTitle: { color: colors.text, fontFamily: fonts.serif, fontSize: 29, marginTop: 8, marginBottom: 23 },
  newChatButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, paddingVertical: 14, borderRadius: 13, backgroundColor: colors.sage },
  newChatText: { color: colors.ink, fontFamily: fonts.sans, fontSize: 14, fontWeight: '700' },
  drawerSection: { color: colors.gold, fontFamily: fonts.sans, fontSize: 9, letterSpacing: 1.7, marginTop: 29, marginBottom: 12, fontWeight: '700' },
  sessionScroll: { flex: 1 },
  noSessions: { color: colors.textMuted, fontFamily: fonts.sans, fontSize: 12, lineHeight: 20, marginTop: 12 },
  sessionRow: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 13, borderRadius: 12, borderWidth: 1, borderColor: 'transparent', marginBottom: 7 },
  activeSession: { backgroundColor: colors.surfaceLight, borderColor: colors.pinkDeep },
  sessionText: { flex: 1 },
  sessionDelete: { width: 34, height: 34, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  sessionTitle: { color: colors.textMuted, fontFamily: fonts.sans, fontSize: 13, fontWeight: '600' },
  activeSessionTitle: { color: colors.pink },
  sessionDate: { color: colors.textFaint, fontFamily: fonts.sans, fontSize: 10, marginTop: 4 },
  drawerFooter: { color: colors.textFaint, fontFamily: fonts.sans, fontSize: 10, paddingTop: 13, borderTopWidth: 1, borderTopColor: colors.borderSoft },
});
