import { Feather } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { ScreenFrame } from '../components/ScreenFrame';
import { ScreenHeading } from '../components/ScreenHeading';
import { MoodBoardCollage } from '../components/MoodBoardCollage';
import { useUserId } from '../auth/AuthContext';
import { createMoodBoard, deleteMoodBoard, getMoodBoards, type MoodBoard } from '../data/moodBoards';
import { addGalleryEntry, deleteGalleryEntry, getGalleryEntries, type GalleryEntry } from '../data/outfitGallery';
import { getClothingItems, type ClothingItem } from '../data/wardrobe';
import { colors, fonts } from '../theme';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
}

function GalleryCard({ entry, width, onDelete }: { entry: GalleryEntry; width: number; onDelete: () => void }) {
  return (
    <Pressable style={[styles.card, { width }]} onLongPress={onDelete} accessibilityLabel={`${entry.note || 'Kombin fotoğrafı'}, silmek için basılı tut`}>
      <View style={styles.photoFrame}><Image source={{ uri: entry.imageUri }} style={styles.photo} resizeMode="cover" accessibilityLabel={entry.note || 'Kombin fotoğrafı'} /></View>
      <Pressable style={styles.deleteIcon} onPress={onDelete} accessibilityRole="button" accessibilityLabel="Kombin fotoğrafını sil"><Feather name="trash-2" size={15} color={colors.pink} /></Pressable>
      <Text style={styles.cardNote} numberOfLines={2}>{entry.note || 'O günün kombini'}</Text>
      <View style={styles.visibilityRow}><Feather name={entry.isPublic ? 'globe' : 'lock'} size={11} color={entry.isPublic ? colors.sage : colors.lavender} /><Text style={styles.visibilityText}>{entry.isPublic ? 'Keşfette' : 'Yalnızca sen'}</Text></View>
      <View style={styles.dateRow}><Feather name="calendar" size={11} color={colors.gold} /><Text style={styles.cardDate}>{formatDate(entry.createdAt)}</Text></View>
    </Pressable>
  );
}

function MoodBoardCard({ board, wardrobeById, onDelete }: { board: MoodBoard; wardrobeById: Map<string, ClothingItem>; onDelete: () => void }) {
  const pieces = board.itemIds.flatMap((id) => {
    const item = wardrobeById.get(id);
    return item ? [item] : [];
  });
  return (
    <Pressable style={styles.moodCard} onLongPress={onDelete} accessibilityLabel={`${board.title}, silmek için basılı tut`}>
      <Pressable style={styles.boardDeleteIcon} onPress={onDelete} accessibilityRole="button" accessibilityLabel={`${board.title} ilham panosunu sil`}>
        <Feather name="trash-2" size={15} color={colors.pink} />
      </Pressable>
      <Text style={styles.moodOverline}>İLHAM PANOSU  /  {board.itemIds.length} PARÇA</Text>
      <Text style={styles.moodTitle}>{board.title}</Text>
      <Text style={styles.moodDate}>{formatDate(board.createdAt)}</Text>
      <View style={styles.boardVisibility}><Feather name={board.isPublic ? 'globe' : 'lock'} size={11} color={board.isPublic ? colors.sage : colors.lavender} /><Text style={styles.visibilityText}>{board.isPublic ? 'Keşfette' : 'Yalnızca sen'}</Text></View>
      {pieces.length > 0
        ? <MoodBoardCollage items={pieces} />
        : <Text style={styles.missingPieces}>Bu panodaki parçalar artık gardıropta bulunmuyor.</Text>}
      {pieces.length < board.itemIds.length && pieces.length > 0 && (
        <Text style={styles.missingPieces}>Gardıroptan silinen parçalar panoda gösterilemiyor.</Text>
      )}
    </Pressable>
  );
}

export function OutfitHistoryScreen() {
  const userId = useUserId();
  const isFocused = useIsFocused();
  const { width } = useWindowDimensions();
  const [entries, setEntries] = useState<GalleryEntry[]>([]);
  const [boards, setBoards] = useState<MoodBoard[]>([]);
  const [wardrobe, setWardrobe] = useState<ClothingItem[]>([]);
  const [activeSection, setActiveSection] = useState<'journal' | 'boards'>('journal');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [choiceVisible, setChoiceVisible] = useState(false);
  const [selectedUri, setSelectedUri] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [isPicking, setIsPicking] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<GalleryEntry | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [boardModalVisible, setBoardModalVisible] = useState(false);
  const [boardTitle, setBoardTitle] = useState('');
  const [selectedBoardIds, setSelectedBoardIds] = useState<string[]>([]);
  const [isSavingBoard, setIsSavingBoard] = useState(false);
  const [pendingBoardDelete, setPendingBoardDelete] = useState<MoodBoard | null>(null);
  const [isDeletingBoard, setIsDeletingBoard] = useState(false);
  const columns = width >= 600 ? 3 : 2;
  const cardWidth = (width - 48 - 12 * (columns - 1)) / columns;
  const wardrobeById = new Map(wardrobe.map((item) => [item.id, item]));

  useEffect(() => {
    if (!isFocused) return;
    let active = true;
    setLoading(true);
    setLoadError(false);
    Promise.all([getGalleryEntries(userId), getMoodBoards(userId), getClothingItems(userId)])
      .then(([savedPhotos, savedBoards, savedWardrobe]) => {
        if (active) {
          setEntries(savedPhotos);
          setBoards(savedBoards);
          setWardrobe(savedWardrobe);
        }
      })
      .catch(() => { if (active) setLoadError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [isFocused, reloadKey, userId]);

  function openBoardModal() {
    setBoardTitle('');
    setSelectedBoardIds([]);
    setBoardModalVisible(true);
  }

  function toggleBoardItem(id: string) {
    setSelectedBoardIds((current) => current.includes(id)
      ? current.filter((selected) => selected !== id)
      : [...current, id]);
  }

  async function saveBoard() {
    if (isSavingBoard || selectedBoardIds.length === 0) return;
    setIsSavingBoard(true);
    try {
      const saved = await createMoodBoard(userId, boardTitle, selectedBoardIds);
      setBoards((current) => [saved, ...current]);
      setBoardModalVisible(false);
      setBoardTitle('');
      setSelectedBoardIds([]);
    } catch (error) {
      Alert.alert('Pano kaydedilemedi', error instanceof Error ? error.message : 'Lütfen tekrar dene.');
    } finally {
      setIsSavingBoard(false);
    }
  }

  async function deleteSelected() {
    if (!pendingDelete || isDeleting) return;
    setIsDeleting(true);
    try {
      await deleteGalleryEntry(userId, pendingDelete.id);
      setEntries((current) => current.filter((item) => item.id !== pendingDelete.id));
      setPendingDelete(null);
    } catch {
      Alert.alert('Silinemedi', 'Kombin fotoğrafı silinemedi. Lütfen tekrar dene.');
    } finally {
      setIsDeleting(false);
    }
  }

  async function deleteSelectedBoard() {
    if (!pendingBoardDelete || isDeletingBoard) return;
    setIsDeletingBoard(true);
    try {
      await deleteMoodBoard(userId, pendingBoardDelete.id);
      setBoards((current) => current.filter((board) => board.id !== pendingBoardDelete.id));
      setPendingBoardDelete(null);
    } catch {
      Alert.alert('Silinemedi', 'İlham panosu silinemedi. Lütfen tekrar dene.');
    } finally {
      setIsDeletingBoard(false);
    }
  }

  async function pickPhoto(source: 'library' | 'camera') {
    if (isPicking || isSaving) return;
    setIsPicking(true);
    try {
      if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          Alert.alert('Kamera izni gerekli', 'Kombin fotoğrafı çekebilmek için kamera izni vermelisin.', [
            { text: 'Vazgeç', style: 'cancel' },
            { text: 'Ayarları aç', onPress: () => { void Linking.openSettings(); } },
          ]);
          return;
        }
      }
      const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.85, allowsEditing: false };
      const result = source === 'camera'
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);
      if (!result.canceled && result.assets[0]?.uri) {
        setSelectedUri(result.assets[0].uri);
        setNote('');
      }
    } catch {
      Alert.alert('Fotoğraf açılamadı', 'Fotoğraf seçimi başarısız oldu. Lütfen tekrar dene.');
    } finally {
      setIsPicking(false);
    }
  }

  async function savePhoto() {
    if (!selectedUri || isSaving) return;
    setIsSaving(true);
    try {
      const saved = await addGalleryEntry(userId, selectedUri, note);
      setEntries((current) => [saved, ...current]);
      setSelectedUri(null);
      setNote('');
    } catch {
      Alert.alert('Kaydedilemedi', 'Kombin fotoğrafı cihazına kaydedilemedi. Lütfen tekrar dene.');
    } finally {
      setIsSaving(false);
    }
  }

  function chooseSource(source: 'library' | 'camera') {
    setChoiceVisible(false);
    setTimeout(() => { void pickPhoto(source); }, 280);
  }

  return (
    <ScreenFrame>
      <ScreenHeading eyebrow="KİŞİSEL STİL GÜNLÜĞÜ" title="Galeri" subtitle={activeSection === 'journal' ? 'Giydiğin kombinlerden kendine küçük bir arşiv.' : 'Gardırobundan kendi stil hikâyeni kur.'} />
      <View style={styles.segmentedControl}>
        <Pressable style={[styles.segment, activeSection === 'journal' && styles.activeSegment]} onPress={() => setActiveSection('journal')} accessibilityRole="tab" accessibilityState={{ selected: activeSection === 'journal' }}>
          <Feather name="camera" size={15} color={activeSection === 'journal' ? colors.ink : colors.textMuted} />
          <Text style={[styles.segmentText, activeSection === 'journal' && styles.activeSegmentText]}>Stil Günlüğüm</Text>
        </Pressable>
        <Pressable style={[styles.segment, activeSection === 'boards' && styles.activeSegmentLavender]} onPress={() => setActiveSection('boards')} accessibilityRole="tab" accessibilityState={{ selected: activeSection === 'boards' }}>
          <Feather name="layers" size={15} color={activeSection === 'boards' ? colors.ink : colors.textMuted} />
          <Text style={[styles.segmentText, activeSection === 'boards' && styles.activeSegmentText]}>İlham Panosu</Text>
        </Pressable>
      </View>
      <Pressable
        style={[styles.addButton, activeSection === 'boards' && styles.addBoardButton]}
        onPress={activeSection === 'journal' ? () => setChoiceVisible(true) : openBoardModal}
        disabled={isPicking || isSaving || loading || loadError}
        accessibilityRole="button"
        accessibilityLabel={activeSection === 'journal' ? 'Bugün ne giydim fotoğrafı ekle' : 'Yeni ilham panosu oluştur'}
      >
        {isPicking ? <ActivityIndicator size="small" color={colors.ink} /> : <Feather name="plus" size={20} color={colors.ink} />}
        <Text style={styles.addButtonText}>{activeSection === 'journal' ? 'Bugün Ne Giydim?' : 'Yeni Pano'}</Text>
      </Pressable>
      {loading ? (
        <View style={styles.centerState}><ActivityIndicator color={colors.sage} /><Text style={styles.stateText}>Galeri açılıyor...</Text></View>
      ) : loadError ? (
        <View style={styles.centerState}><Text style={styles.emptyTitle}>Galeri açılamadı</Text><Pressable style={styles.retryButton} onPress={() => setReloadKey((value) => value + 1)}><Text style={styles.retryText}>Tekrar dene</Text></Pressable></View>
      ) : activeSection === 'boards' && boards.length === 0 ? (
        <View style={styles.centerState}><View style={styles.emptyCard}><Feather name="layers" size={32} color={colors.lavender} /><Text style={styles.emptyTitle}>İlk panonu oluştur</Text><Text style={styles.stateText}>Gardırobundan birkaç parça seçip kendi kolajını biriktir.</Text></View></View>
      ) : activeSection === 'boards' ? (
        <FlatList data={boards} keyExtractor={(board) => board.id} contentContainerStyle={styles.boardListContent} renderItem={({ item }) => <MoodBoardCard board={item} wardrobeById={wardrobeById} onDelete={() => setPendingBoardDelete(item)} />} showsVerticalScrollIndicator={false} ListHeaderComponent={<Text style={styles.collectionCount}>{boards.length} PANO  /  SENİN İLHAMIN</Text>} />
      ) : entries.length === 0 ? (
        <View style={styles.centerState}><View style={styles.emptyCard}><Feather name="camera" size={32} color={colors.sage} /><Text style={styles.emptyTitle}>İlk kareyi ekle</Text><Text style={styles.stateText}>Bugünkü görünümün bu defterin ilk sayfası olsun.</Text></View></View>
      ) : (
        <FlatList key={columns} data={entries} keyExtractor={(entry) => entry.id} numColumns={columns} columnWrapperStyle={styles.gridRow} contentContainerStyle={styles.gridContent} renderItem={({ item }) => <GalleryCard entry={item} width={cardWidth} onDelete={() => setPendingDelete(item)} />} showsVerticalScrollIndicator={false} ListHeaderComponent={<Text style={styles.collectionCount}>{entries.length} KARE  /  SENİN STİL HİKÂYEN</Text>} />
      )}
      <Modal visible={boardModalVisible} transparent animationType="fade" onRequestClose={() => { if (!isSavingBoard) setBoardModalVisible(false); }}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable style={styles.modalBackdrop} onPress={() => { if (!isSavingBoard) setBoardModalVisible(false); }} />
          <View style={styles.boardModalCard}>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <Text style={styles.modalEyebrow}>KENDİ KOLAJIN</Text>
              <Text style={styles.modalTitle}>Yeni ilham panosu</Text>
              <Text style={styles.boardModalHint}>Gardırobundan parçaları seç. Fotoğraflar panoda vintage bir kolaja dönüşecek.</Text>
              <Text style={styles.inputLabel}>PANO BAŞLIĞI  /  İSTEĞE BAĞLI</Text>
              <TextInput style={styles.noteInput} placeholder="Örn: Pazar Kahvesi" placeholderTextColor={colors.textFaint} value={boardTitle} onChangeText={setBoardTitle} maxLength={80} accessibilityLabel="Pano başlığı" />
              <Text style={styles.inputLabel}>GARDIROBUNDAN SEÇ</Text>
              {wardrobe.length === 0 ? (
                <Text style={styles.noWardrobeText}>Önce gardırobuna birkaç kıyafet eklemelisin.</Text>
              ) : (
                <View style={styles.chooserGrid}>
                  {wardrobe.map((item) => {
                    const selected = selectedBoardIds.includes(item.id);
                    return (
                      <Pressable key={item.id} style={[styles.chooserTile, selected && styles.chooserTileSelected]} onPress={() => toggleBoardItem(item.id)} accessibilityRole="checkbox" accessibilityState={{ checked: selected }} accessibilityLabel={`${item.tags.renk} ${item.tags.tur}`}>
                        <Image source={{ uri: item.imageUri }} style={styles.chooserPhoto} resizeMode="cover" />
                        {selected && <View style={styles.selectedMark}><Feather name="check" size={14} color={colors.ink} /></View>}
                        <Text style={styles.chooserCaption} numberOfLines={1}>{item.tags.renk} {item.tags.tur}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}
              <Text style={styles.selectionCount}>{selectedBoardIds.length} parça seçildi</Text>
              <Pressable style={[styles.saveButton, (selectedBoardIds.length === 0 || isSavingBoard) && styles.disabled]} onPress={() => { void saveBoard(); }} disabled={selectedBoardIds.length === 0 || isSavingBoard} accessibilityRole="button" accessibilityLabel="Panoyu Kaydet">
                {isSavingBoard ? <ActivityIndicator size="small" color={colors.ink} /> : <Text style={styles.saveText}>Panoyu Kaydet</Text>}
              </Pressable>
              <Pressable style={styles.cancelButton} onPress={() => setBoardModalVisible(false)} disabled={isSavingBoard}><Text style={styles.cancelText}>Vazgeç</Text></Pressable>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <Modal visible={pendingDelete !== null} transparent animationType="fade" onRequestClose={() => { if (!isDeleting) setPendingDelete(null); }}>
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalBackdrop} onPress={() => { if (!isDeleting) setPendingDelete(null); }} />
          <View style={styles.modalCard}>
            <Text style={styles.modalEyebrow}>STİL GÜNLÜĞÜN</Text>
            <Text style={styles.modalTitle}>Bu kareyi silelim mi?</Text>
            <Text style={styles.deleteQuestion}>Bu kombin fotoğrafını günlüğünden silmek istediğine emin misin?</Text>
            <Pressable style={[styles.deleteButton, isDeleting && styles.disabled]} onPress={() => { void deleteSelected(); }} disabled={isDeleting} accessibilityRole="button" accessibilityLabel="Kombin fotoğrafını silmeyi onayla">
              {isDeleting ? <ActivityIndicator size="small" color={colors.pink} /> : <><Feather name="trash-2" size={16} color={colors.pink} /><Text style={styles.deleteText}>Sil</Text></>}
            </Pressable>
            <Pressable style={styles.cancelButton} onPress={() => setPendingDelete(null)} disabled={isDeleting}><Text style={styles.cancelText}>Vazgeç</Text></Pressable>
          </View>
        </View>
      </Modal>
      <Modal visible={pendingBoardDelete !== null} transparent animationType="fade" onRequestClose={() => { if (!isDeletingBoard) setPendingBoardDelete(null); }}>
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalBackdrop} onPress={() => { if (!isDeletingBoard) setPendingBoardDelete(null); }} />
          <View style={styles.modalCard}>
            <Text style={styles.modalEyebrow}>İLHAM PANON</Text>
            <Text style={styles.modalTitle}>Bu panoyu silelim mi?</Text>
            <Text style={styles.deleteQuestion}>“{pendingBoardDelete?.title}” ilham panosunu kalıcı olarak silmek istediğine emin misin?</Text>
            <Pressable style={[styles.deleteButton, isDeletingBoard && styles.disabled]} onPress={() => { void deleteSelectedBoard(); }} disabled={isDeletingBoard} accessibilityRole="button" accessibilityLabel="İlham panosunu silmeyi onayla">
              {isDeletingBoard ? <ActivityIndicator size="small" color={colors.pink} /> : <><Feather name="trash-2" size={16} color={colors.pink} /><Text style={styles.deleteText}>Panoyu Sil</Text></>}
            </Pressable>
            <Pressable style={styles.cancelButton} onPress={() => setPendingBoardDelete(null)} disabled={isDeletingBoard}><Text style={styles.cancelText}>Vazgeç</Text></Pressable>
          </View>
        </View>
      </Modal>
      <Modal visible={choiceVisible} transparent animationType="fade" onRequestClose={() => setChoiceVisible(false)}>
        <View style={styles.modalOverlay}><Pressable style={styles.modalBackdrop} onPress={() => setChoiceVisible(false)} />
          <View style={styles.modalCard}>
            <Text style={styles.modalEyebrow}>YENİ BİR SAYFA</Text><Text style={styles.modalTitle}>Fotoğrafı nasıl ekleyelim?</Text>
            <Pressable style={styles.sourceButton} onPress={() => chooseSource('library')}><Feather name="image" size={20} color={colors.sage} /><Text style={styles.sourceText}>Galeriden seç</Text></Pressable>
            <Pressable style={styles.sourceButton} onPress={() => chooseSource('camera')}><Feather name="camera" size={20} color={colors.pink} /><Text style={styles.sourceText}>Fotoğraf çek</Text></Pressable>
            <Pressable style={styles.cancelButton} onPress={() => setChoiceVisible(false)}><Text style={styles.cancelText}>Vazgeç</Text></Pressable>
          </View>
        </View>
      </Modal>
      <Modal visible={selectedUri !== null} transparent animationType="fade" onRequestClose={() => { if (!isSaving) setSelectedUri(null); }}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalCard}>
            <Text style={styles.modalEyebrow}>BUGÜNÜN KOMBİNİ</Text><Text style={styles.modalTitle}>Bir not düşmek ister misin?</Text>
            {selectedUri && <Image source={{ uri: selectedUri }} style={styles.preview} resizeMode="cover" />}
            <Text style={styles.previewDate}>{formatDate(new Date().toISOString())}</Text>
            <TextInput style={styles.noteInput} placeholder="Örn: Vintage ceketle okul günü" placeholderTextColor={colors.textFaint} value={note} onChangeText={setNote} maxLength={100} accessibilityLabel="Kombin fotoğrafı notu" />
            <Pressable style={[styles.saveButton, isSaving && styles.disabled]} onPress={() => { void savePhoto(); }} disabled={isSaving} accessibilityRole="button" accessibilityLabel="Kombin fotoğrafını kaydet">
              {isSaving ? <ActivityIndicator size="small" color={colors.ink} /> : <Text style={styles.saveText}>Kaydet</Text>}
            </Pressable>
            <Pressable style={styles.cancelButton} onPress={() => setSelectedUri(null)} disabled={isSaving}><Text style={styles.cancelText}>Vazgeç</Text></Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  segmentedControl: { flexDirection: 'row', marginHorizontal: 24, marginBottom: 15, padding: 4, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.backgroundRaised },
  segment: { flex: 1, minHeight: 39, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  activeSegment: { backgroundColor: colors.sage },
  activeSegmentLavender: { backgroundColor: colors.lavender },
  segmentText: { color: colors.textMuted, fontFamily: fonts.sans, fontSize: 12, fontWeight: '700' },
  activeSegmentText: { color: colors.ink },
  addButton: { marginHorizontal: 24, marginBottom: 21, minHeight: 52, borderRadius: 13, backgroundColor: colors.sage, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  addBoardButton: { backgroundColor: colors.lavender },
  addButtonText: { color: colors.ink, fontFamily: fonts.sans, fontSize: 14, fontWeight: '700' },
  centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  stateText: { color: colors.textMuted, fontFamily: fonts.sans, fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 12 },
  emptyCard: { width: '100%', padding: 30, borderRadius: 19, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center' },
  emptyTitle: { color: colors.pink, fontFamily: fonts.serif, fontSize: 24, textAlign: 'center', marginTop: 16 },
  retryButton: { marginTop: 22, paddingHorizontal: 22, paddingVertical: 12, borderRadius: 12, backgroundColor: colors.sage },
  retryText: { color: colors.ink, fontFamily: fonts.sans, fontSize: 13, fontWeight: '700' },
  gridContent: { paddingHorizontal: 24, paddingBottom: 30 },
  gridRow: { gap: 12, marginBottom: 13 },
  collectionCount: { color: colors.gold, fontFamily: fonts.sans, fontSize: 10, letterSpacing: 1.6, fontWeight: '700', marginBottom: 15 },
  boardListContent: { paddingHorizontal: 24, paddingBottom: 30 },
  moodCard: { padding: 17, marginBottom: 17, borderRadius: 17, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center' },
  boardDeleteIcon: { position: 'absolute', top: 13, right: 13, zIndex: 20, width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: colors.pinkDeep, backgroundColor: colors.backgroundRaised, alignItems: 'center', justifyContent: 'center' },
  moodOverline: { color: colors.gold, fontFamily: fonts.sans, fontSize: 9, letterSpacing: 1.3, fontWeight: '700', alignSelf: 'stretch', paddingRight: 39 },
  moodTitle: { color: colors.text, fontFamily: fonts.serif, fontSize: 21, alignSelf: 'stretch', marginTop: 6 },
  moodDate: { color: colors.textMuted, fontFamily: fonts.sans, fontSize: 11, alignSelf: 'stretch', marginTop: 4, marginBottom: 14 },
  boardVisibility: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 13 },
  missingPieces: { color: colors.textMuted, fontFamily: fonts.sans, fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 10 },
  card: { padding: 9, paddingBottom: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 14 },
  photoFrame: { height: 215, borderRadius: 9, borderWidth: 1, borderColor: colors.pinkDeep, overflow: 'hidden', backgroundColor: colors.backgroundRaised },
  photo: { width: '100%', height: '100%' },
  deleteIcon: { position: 'absolute', top: 16, right: 16, width: 31, height: 31, borderRadius: 16, borderWidth: 1, borderColor: colors.pinkDeep, backgroundColor: colors.backgroundRaised, alignItems: 'center', justifyContent: 'center' },
  cardNote: { color: colors.text, fontFamily: fonts.serif, fontSize: 16, lineHeight: 21, marginTop: 11, minHeight: 42 },
  visibilityRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8 },
  visibilityText: { color: colors.textMuted, fontFamily: fonts.sans, fontSize: 10 },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 9 },
  cardDate: { color: colors.textMuted, fontFamily: fonts.sans, fontSize: 10, flexShrink: 1 },
  modalOverlay: { flex: 1, justifyContent: 'center', paddingHorizontal: 22, backgroundColor: 'rgba(20, 12, 11, 0.78)' },
  modalBackdrop: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 },
  modalCard: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 20, padding: 22 },
  boardModalCard: { width: '100%', maxHeight: '88%', backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 20, padding: 20 },
  modalEyebrow: { color: colors.gold, fontFamily: fonts.sans, fontSize: 9, fontWeight: '700', letterSpacing: 1.6 },
  modalTitle: { color: colors.text, fontFamily: fonts.serif, fontSize: 24, marginTop: 8, marginBottom: 15 },
  boardModalHint: { color: colors.textMuted, fontFamily: fonts.sans, fontSize: 12, lineHeight: 19, marginBottom: 12 },
  inputLabel: { color: colors.gold, fontFamily: fonts.sans, fontSize: 10, letterSpacing: 1.1, fontWeight: '700', marginTop: 15 },
  noWardrobeText: { color: colors.pink, fontFamily: fonts.sans, fontSize: 13, lineHeight: 20, marginTop: 14 },
  chooserGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginTop: 12 },
  chooserTile: { width: '31%', padding: 5, borderRadius: 10, borderWidth: 2, borderColor: colors.border, backgroundColor: colors.backgroundRaised },
  chooserTileSelected: { borderColor: colors.lavender, backgroundColor: colors.surfaceLight },
  chooserPhoto: { width: '100%', aspectRatio: 0.85, borderRadius: 6, backgroundColor: colors.surfaceLight },
  selectedMark: { position: 'absolute', top: 9, right: 9, width: 22, height: 22, borderRadius: 11, backgroundColor: colors.lavender, alignItems: 'center', justifyContent: 'center' },
  chooserCaption: { color: colors.text, fontFamily: fonts.sans, fontSize: 10, marginTop: 5, textAlign: 'center' },
  selectionCount: { color: colors.lavender, fontFamily: fonts.sans, fontSize: 12, fontWeight: '700', marginTop: 17, textAlign: 'center' },
  deleteQuestion: { color: colors.textMuted, fontFamily: fonts.sans, fontSize: 13, lineHeight: 21, marginBottom: 13 },
  deleteButton: { minHeight: 47, borderRadius: 11, borderColor: colors.pinkDeep, borderWidth: 1, backgroundColor: colors.backgroundRaised, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' },
  deleteText: { color: colors.pink, fontFamily: fonts.sans, fontSize: 14, fontWeight: '700' },
  sourceButton: { flexDirection: 'row', alignItems: 'center', gap: 13, padding: 16, backgroundColor: colors.backgroundRaised, borderWidth: 1, borderColor: colors.border, borderRadius: 12, marginTop: 8 },
  sourceText: { color: colors.text, fontFamily: fonts.sans, fontSize: 14, fontWeight: '600' },
  cancelButton: { alignItems: 'center', paddingTop: 17, paddingBottom: 3 },
  cancelText: { color: colors.pink, fontFamily: fonts.sans, fontSize: 13, fontWeight: '700' },
  preview: { width: '100%', height: 260, borderRadius: 10, borderWidth: 1, borderColor: colors.pinkDeep, backgroundColor: colors.backgroundRaised },
  previewDate: { color: colors.gold, fontFamily: fonts.sans, fontSize: 11, marginTop: 10 },
  noteInput: { color: colors.text, fontFamily: fonts.sans, fontSize: 13, backgroundColor: colors.backgroundRaised, borderWidth: 1, borderColor: colors.border, borderRadius: 11, paddingHorizontal: 14, paddingVertical: 13, marginTop: 15 },
  saveButton: { alignItems: 'center', justifyContent: 'center', minHeight: 47, borderRadius: 11, backgroundColor: colors.sage, marginTop: 13 },
  saveText: { color: colors.ink, fontFamily: fonts.sans, fontSize: 14, fontWeight: '700' },
  disabled: { opacity: 0.5 },
});
