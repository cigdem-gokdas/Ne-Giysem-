import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { useIsFocused, useNavigation, type CompositeNavigationProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { PrimaryButton } from '../components/PrimaryButton';
import { useUserId } from '../auth/AuthContext';
import { ScreenFrame } from '../components/ScreenFrame';
import { ScreenHeading } from '../components/ScreenHeading';
import { CLOTHING_TYPES, deleteClothingItem, getClothingItems, updateClothingTags, type ClothingItem, type ClothingTags } from '../data/wardrobe';
import type { MainTabParamList, RootStackParamList } from '../navigation/AppNavigator';
import { colors, fonts } from '../theme';

type Navigation = CompositeNavigationProp<BottomTabNavigationProp<MainTabParamList, 'Wardrobe'>, NativeStackNavigationProp<RootStackParamList>>;

export function WardrobeScreen() {
  const userId = useUserId();
  const navigation = useNavigation<Navigation>();
  const isFocused = useIsFocused();
  const { width } = useWindowDimensions();
  const [items, setItems] = useState<ClothingItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [selectedItem, setSelectedItem] = useState<ClothingItem | null>(null);
  const [modalMode, setModalMode] = useState<'actions' | 'edit'>('actions');
  const [draftTags, setDraftTags] = useState<ClothingTags>({ tur: 'üst', renk: '', desen: '' });
  const [isSaving, setIsSaving] = useState(false);
  const columns = width >= 600 ? 3 : 2;
  const itemWidth = (width - 48 - (columns - 1) * 12) / columns;

  useEffect(() => {
    if (!isFocused) return;
    let active = true;
    setIsLoading(true);
    setLoadError(false);
    getClothingItems(userId)
      .then((saved) => { if (active) setItems(saved); })
      .catch(() => { if (active) setLoadError(true); })
      .finally(() => { if (active) setIsLoading(false); });
    return () => { active = false; };
  }, [isFocused, retryCount, userId]);

  function openActions(item: ClothingItem) {
    setSelectedItem(item);
    setDraftTags(item.tags);
    setModalMode('actions');
  }

  function closeModal() {
    if (isSaving) return;
    Keyboard.dismiss();
    setSelectedItem(null);
  }

  function confirmDelete() {
    if (!selectedItem) return;
    const id = selectedItem.id;
    setSelectedItem(null);
    Alert.alert('Kıyafeti sil', 'Bu parçayı gardırobundan silmek istediğine emin misin?', [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Sil', style: 'destructive', onPress: async () => {
          try {
            await deleteClothingItem(userId, id);
            setItems((current) => current.filter((item) => item.id !== id));
          } catch {
            Alert.alert('Silinemedi', 'Kıyafet silinemedi, lütfen tekrar dene.');
          }
        },
      },
    ]);
  }

  async function saveTags() {
    if (!selectedItem || isSaving) return;
    if (!draftTags.renk.trim() || !draftTags.desen.trim()) {
      Alert.alert('Eksik etiket', 'Renk ve desen alanlarını doldur.');
      return;
    }
    setIsSaving(true);
    try {
      const updated = await updateClothingTags(userId, selectedItem.id, draftTags);
      setItems((current) => current.map((item) => item.id === updated.id ? updated : item));
      Keyboard.dismiss();
      setSelectedItem(null);
    } catch {
      Alert.alert('Kaydedilemedi', 'Etiketler güncellenemedi, lütfen tekrar dene.');
    } finally {
      setIsSaving(false);
    }
  }

  function renderItem({ item }: { item: ClothingItem }) {
    return (
      <Pressable style={[styles.clothingCard, { width: itemWidth }]} onLongPress={() => openActions(item)} accessibilityLabel={`${item.tags.renk} ${item.tags.tur}, düzenlemek için basılı tut`}>
        <Image source={{ uri: item.imageUri }} style={styles.clothingImage} resizeMode="cover" accessibilityLabel="Kaydedilmiş kıyafet fotoğrafı" />
        <Pressable style={styles.cardAction} onPress={() => openActions(item)} accessibilityRole="button" accessibilityLabel="Kıyafet seçenekleri"><Feather name="more-horizontal" size={18} color={colors.text} /></Pressable>
        <View style={styles.clothingDetails}>
          <Text style={styles.itemCaption}>GARDIROP PARÇASI</Text>
          <View style={styles.tagChips}>
            <Text style={[styles.tagChip, styles.turChip]}>{item.tags.tur}</Text>
            <Text style={[styles.tagChip, styles.renkChip]}>{item.tags.renk}</Text>
            <Text style={[styles.tagChip, styles.desenChip]}>{item.tags.desen}</Text>
          </View>
        </View>
      </Pressable>
    );
  }

  return (
    <ScreenFrame>
      <ScreenHeading eyebrow="NE GİYSEM?  /  01" title="Gardırobun" subtitle="Sevdiğin parçaların küçük bir arşivi." onSettingsPress={() => navigation.navigate('Settings')} />
      {isLoading ? (
        <View style={styles.centerState}><ActivityIndicator size="large" color={colors.sage} /><Text style={styles.stateText}>Gardırobun açılıyor...</Text></View>
      ) : loadError ? (
        <View style={styles.centerState}>
          <Text style={styles.errorTitle}>Gardırobun okunamadı.</Text>
          <Text style={styles.stateText}>Kaydedilen parçalara şu an ulaşılamıyor.</Text>
          <View style={styles.retryButton}><PrimaryButton label="Tekrar dene" icon="refresh-cw" onPress={() => setRetryCount((count) => count + 1)} /></View>
        </View>
      ) : items.length === 0 ? (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.card}>
            <View style={styles.cornerTopLeft} />
            <View style={styles.cornerBottomRight} />
            <View style={styles.iconCircle}><MaterialCommunityIcons name="hanger" size={48} color={colors.sage} /></View>
            <Text style={styles.overline}>HENÜZ ÇOK SAKİN</Text>
            <Text style={styles.message}>Henüz kıyafet eklemedin. Gardırobunu doldurmaya başla!</Text>
            <Text style={styles.detail}>İlk parçanla bu hikâye başlasın.</Text>
            <View style={styles.buttonWrap}><PrimaryButton label="Yeni kıyafet ekle" icon="plus" onPress={() => navigation.navigate('AddClothing')} /></View>
          </View>
          <Text style={styles.footer}>KENDİ TARZIN, KENDİ KOLEKSİYONUN</Text>
        </ScrollView>
      ) : (
        <FlatList
          key={columns}
          data={items}
          keyExtractor={(item) => item.id}
          numColumns={columns}
          renderItem={renderItem}
          columnWrapperStyle={styles.gridRow}
          contentContainerStyle={styles.gridContent}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <View style={styles.gridHeader}>
              <Text style={styles.collectionCount}>KOLEKSİYON  /  {items.length} PARÇA</Text>
              <PrimaryButton label="Yeni kıyafet ekle" icon="plus" onPress={() => navigation.navigate('AddClothing')} />
            </View>
          }
        />
      )}
      <Modal visible={selectedItem !== null} transparent animationType="fade" onRequestClose={closeModal}>
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalBackdrop} onPress={closeModal} />
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalKeyboard}>
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalOverline}>GARDIROP DETAYI</Text>
                <Pressable onPress={closeModal} disabled={isSaving} accessibilityRole="button" accessibilityLabel="Kapat"><Feather name="x" size={20} color={colors.textMuted} /></Pressable>
              </View>
              {selectedItem && (
                <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                  <View style={styles.modalPreview}>
                    <Image source={{ uri: selectedItem.imageUri }} style={styles.modalImage} resizeMode="cover" />
                    <View style={styles.previewTextWrap}>
                      <Text style={styles.modalTitle}>{modalMode === 'edit' ? 'Etiketleri düzenle' : 'Bu parçayla ne yapalım?'}</Text>
                      <Text style={styles.modalSubtitle}>{selectedItem.tags.renk} · {selectedItem.tags.tur}</Text>
                    </View>
                  </View>
                  {modalMode === 'actions' ? (
                    <View style={styles.actionList}>
                      <Pressable style={styles.actionButton} onPress={() => setModalMode('edit')}><Feather name="edit-3" size={18} color={colors.sage} /><Text style={styles.actionText}>Etiketleri Düzenle</Text></Pressable>
                      <Pressable style={[styles.actionButton, styles.deleteAction]} onPress={confirmDelete}><Feather name="trash-2" size={18} color={colors.pink} /><Text style={[styles.actionText, styles.deleteText]}>Sil</Text></Pressable>
                    </View>
                  ) : (
                    <View>
                      <Text style={styles.fieldLabel}>TÜR</Text>
                      <View style={styles.typeOptions}>
                        {CLOTHING_TYPES.map((type) => (
                          <Pressable key={type} onPress={() => setDraftTags((current) => ({ ...current, tur: type }))} style={[styles.typeChip, draftTags.tur === type && styles.typeChipSelected]}>
                            <Text style={[styles.typeChipText, draftTags.tur === type && styles.typeChipTextSelected]}>{type}</Text>
                          </Pressable>
                        ))}
                      </View>
                      <Text style={styles.fieldLabel}>RENK</Text>
                      <TextInput style={styles.formInput} value={draftTags.renk} onChangeText={(renk) => setDraftTags((current) => ({ ...current, renk }))} placeholder="Örn. bordo" placeholderTextColor={colors.textFaint} maxLength={40} />
                      <Text style={styles.fieldLabel}>DESEN</Text>
                      <TextInput style={styles.formInput} value={draftTags.desen} onChangeText={(desen) => setDraftTags((current) => ({ ...current, desen }))} placeholder="Örn. düz" placeholderTextColor={colors.textFaint} maxLength={40} />
                      <View style={styles.editActions}>
                        <Pressable style={styles.cancelButton} onPress={() => setModalMode('actions')} disabled={isSaving}><Text style={styles.cancelText}>Geri</Text></Pressable>
                        <Pressable style={[styles.saveButton, isSaving && styles.disabledButton]} onPress={saveTags} disabled={isSaving}><Text style={styles.saveText}>{isSaving ? 'Kaydediliyor...' : 'Kaydet'}</Text></Pressable>
                      </View>
                    </View>
                  )}
                </ScrollView>
              )}
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingBottom: 25 },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 24, minHeight: 390, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, paddingVertical: 38, overflow: 'hidden' },
  cornerTopLeft: { position: 'absolute', top: 14, left: 14, width: 36, height: 36, borderTopWidth: 1, borderLeftWidth: 1, borderColor: colors.gold, opacity: 0.55 },
  cornerBottomRight: { position: 'absolute', bottom: 14, right: 14, width: 36, height: 36, borderBottomWidth: 1, borderRightWidth: 1, borderColor: colors.gold, opacity: 0.55 },
  iconCircle: { width: 104, height: 104, borderRadius: 52, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.backgroundRaised, alignItems: 'center', justifyContent: 'center', marginBottom: 27 },
  overline: { color: colors.gold, fontFamily: fonts.sans, fontSize: 10, fontWeight: '700', letterSpacing: 2.8, marginBottom: 14 },
  message: { color: colors.pink, fontFamily: fonts.serif, fontSize: 23, lineHeight: 31, textAlign: 'center' },
  detail: { color: colors.textMuted, fontFamily: fonts.sans, fontSize: 12, marginTop: 13, textAlign: 'center' },
  buttonWrap: { alignSelf: 'stretch', marginTop: 30 },
  footer: { textAlign: 'center', color: colors.textFaint, fontFamily: fonts.sans, fontSize: 9, letterSpacing: 2.2, marginTop: 21 },
  centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  stateText: { color: colors.textMuted, fontFamily: fonts.sans, fontSize: 13, textAlign: 'center', marginTop: 12 },
  errorTitle: { color: colors.pink, fontFamily: fonts.serif, fontSize: 24, textAlign: 'center' },
  retryButton: { alignSelf: 'stretch', marginTop: 25 },
  gridContent: { paddingHorizontal: 24, paddingBottom: 28 },
  gridHeader: { paddingBottom: 20 },
  collectionCount: { color: colors.gold, fontFamily: fonts.sans, fontSize: 10, fontWeight: '700', letterSpacing: 2, marginBottom: 13 },
  gridRow: { gap: 12, marginBottom: 12 },
  clothingCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 16, overflow: 'hidden' },
  cardAction: { position: 'absolute', top: 8, right: 8, zIndex: 1, width: 33, height: 33, borderRadius: 17, backgroundColor: colors.backgroundRaised, borderWidth: 1, borderColor: colors.pinkDeep, alignItems: 'center', justifyContent: 'center' },
  clothingImage: { width: '100%', aspectRatio: 0.88, backgroundColor: colors.backgroundRaised },
  clothingDetails: { paddingHorizontal: 10, paddingTop: 11, paddingBottom: 13 },
  itemCaption: { color: colors.textFaint, fontFamily: fonts.sans, fontSize: 8, fontWeight: '700', letterSpacing: 1.1, marginBottom: 9 },
  tagChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  tagChip: { overflow: 'hidden', borderRadius: 7, color: colors.ink, fontFamily: fonts.sans, fontSize: 9, fontWeight: '700', paddingHorizontal: 7, paddingVertical: 5 },
  turChip: { backgroundColor: colors.sage },
  renkChip: { backgroundColor: colors.pink },
  desenChip: { backgroundColor: colors.lavender },
  modalOverlay: { flex: 1, justifyContent: 'center', paddingHorizontal: 22, backgroundColor: 'rgba(20, 12, 11, 0.75)' },
  modalBackdrop: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 },
  modalKeyboard: { width: '100%' },
  modalCard: { maxHeight: '88%', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 22, padding: 20 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  modalOverline: { color: colors.gold, fontFamily: fonts.sans, fontSize: 10, fontWeight: '700', letterSpacing: 1.8 },
  modalPreview: { flexDirection: 'row', alignItems: 'center', gap: 13, marginBottom: 20 },
  modalImage: { width: 66, height: 66, borderRadius: 11, borderWidth: 1, borderColor: colors.pinkDeep },
  previewTextWrap: { flex: 1 },
  modalTitle: { color: colors.text, fontFamily: fonts.serif, fontSize: 21, lineHeight: 26 },
  modalSubtitle: { color: colors.textMuted, fontFamily: fonts.sans, fontSize: 12, marginTop: 5 },
  actionList: { gap: 9 },
  actionButton: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 15, borderRadius: 12, backgroundColor: colors.backgroundRaised, borderWidth: 1, borderColor: colors.border },
  actionText: { color: colors.text, fontFamily: fonts.sans, fontSize: 14, fontWeight: '600' },
  deleteAction: { borderColor: colors.pinkDeep },
  deleteText: { color: colors.pink },
  fieldLabel: { color: colors.gold, fontFamily: fonts.sans, fontSize: 10, fontWeight: '700', letterSpacing: 1.5, marginBottom: 8, marginTop: 14 },
  typeOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  typeChip: { paddingHorizontal: 11, paddingVertical: 8, borderRadius: 9, backgroundColor: colors.backgroundRaised, borderWidth: 1, borderColor: colors.border },
  typeChipSelected: { backgroundColor: colors.sage, borderColor: colors.sage },
  typeChipText: { color: colors.textMuted, fontFamily: fonts.sans, fontSize: 11 },
  typeChipTextSelected: { color: colors.ink, fontWeight: '700' },
  formInput: { backgroundColor: colors.backgroundRaised, borderWidth: 1, borderColor: colors.border, borderRadius: 11, paddingHorizontal: 13, paddingVertical: 11, color: colors.text, fontFamily: fonts.sans, fontSize: 14 },
  editActions: { flexDirection: 'row', gap: 10, marginTop: 23 },
  cancelButton: { flex: 1, alignItems: 'center', paddingVertical: 13, borderRadius: 11, borderWidth: 1, borderColor: colors.border },
  cancelText: { color: colors.textMuted, fontFamily: fonts.sans, fontSize: 13, fontWeight: '700' },
  saveButton: { flex: 1, alignItems: 'center', paddingVertical: 13, borderRadius: 11, backgroundColor: colors.sage },
  saveText: { color: colors.ink, fontFamily: fonts.sans, fontSize: 13, fontWeight: '700' },
  disabledButton: { opacity: 0.5 },
});
