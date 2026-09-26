import { Feather } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { PrimaryButton } from '../components/PrimaryButton';
import { useUserId } from '../auth/AuthContext';
import { ScreenFrame } from '../components/ScreenFrame';
import { addClothingItem, type ClothingTags } from '../data/wardrobe';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { analyzeClothing } from '../services/analyzeClothing';
import type { ImageUploadMetadata } from '../services/r2Storage';
import { RateLimitError } from '../services/workerApi';
import { colors, fonts } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'AddClothing'>;

export function AddClothingScreen({ navigation }: Props) {
  const userId = useUserId();
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [uploadMetadata, setUploadMetadata] = useState<ImageUploadMetadata>({});
  const [tags, setTags] = useState<ClothingTags | null>(null);
  const [isPicking, setIsPicking] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisFailed, setAnalysisFailed] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const base64Ref = useRef<string | null>(null);
  const analysisController = useRef<AbortController | null>(null);
  const analysisRequestId = useRef(0);

  useEffect(() => () => {
    analysisRequestId.current += 1;
    analysisController.current?.abort();
  }, []);

  async function runAnalysis(base64Jpeg: string) {
    const requestId = ++analysisRequestId.current;
    analysisController.current?.abort();
    const controller = new AbortController();
    analysisController.current = controller;
    const timeout = setTimeout(() => controller.abort(), 30000);
    setTags(null);
    setAnalysisFailed(false);
    setIsAnalyzing(true);

    try {
      const result = await analyzeClothing(userId, base64Jpeg, controller.signal);
      if (analysisRequestId.current === requestId) setTags(result);
    } catch (error) {
      if (analysisRequestId.current === requestId) {
        setAnalysisFailed(true);
        if (error instanceof RateLimitError) {
          Alert.alert(error.reason === 'daily' ? 'Günlük ilham sınırı' : 'Biraz yavaşlayalım', error.message);
        } else if (error instanceof Error && error.name === 'AbortError') {
          Alert.alert('Analiz zaman aşımına uğradı', 'Bağlantı yavaş görünüyor. Lütfen tekrar dene.');
        } else {
          Alert.alert('Analiz başarısız', error instanceof Error ? error.message : 'Görsel analiz edilemedi, lütfen tekrar deneyin');
        }
      }
    } finally {
      clearTimeout(timeout);
      if (analysisRequestId.current === requestId) {
        analysisController.current = null;
        setIsAnalyzing(false);
      }
    }
  }

  async function pickImage() {
    if (isPicking || isSaving) return;
    setIsPicking(true);
    try {
      // The system photo picker does not need broad library permission for images.
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: false,
        base64: true,
        quality: 0.8,
      });
      if (!result.canceled && result.assets[0]?.uri) {
        const asset = result.assets[0];
        setImageUri(asset.uri);
        setUploadMetadata({ fileName: asset.fileName, mimeType: asset.mimeType, fileSize: asset.fileSize });
        base64Ref.current = asset.base64 ?? null;
        if (asset.base64) {
          void runAnalysis(asset.base64);
        } else {
          setAnalysisFailed(true);
          Alert.alert('Fotoğraf okunamadı', 'Seçilen fotoğrafın analiz verisi hazırlanamadı. Lütfen başka bir fotoğraf seç.');
        }
      }
    } catch {
      Alert.alert(
        'Galeri açılamadı',
        'Fotoğraf seçimi başarısız oldu. Uygulamanın fotoğraf erişimini ayarlardan kontrol edebilirsin.',
        [
          { text: 'Tamam', style: 'cancel' },
          { text: 'Ayarları Aç', onPress: () => { void Linking.openSettings().catch(() => Alert.alert('Ayarlar açılamadı', 'Cihaz ayarlarını elle açabilirsin.')); } },
        ],
      );
    } finally {
      setIsPicking(false);
    }
  }

  async function saveClothing() {
    if (!imageUri || !tags || isAnalyzing || isSaving) return;
    setIsSaving(true);
    try {
      await addClothingItem(userId, imageUri, tags, uploadMetadata);
      navigation.goBack();
    } catch (error) {
      Alert.alert('Kaydedilemedi', error instanceof Error ? error.message : 'Kıyafet kaydedilirken bir sorun oluştu. Lütfen tekrar dene.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <ScreenFrame includeBottom>
      <View style={styles.topBar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Gardıroba geri dön" onPress={() => navigation.goBack()} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
          <Feather name="arrow-left" size={20} color={colors.text} />
        </Pressable>
        <Text style={styles.topBarTitle}>YENİ PARÇA</Text>
        <View style={styles.topBarSpacer} />
      </View>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Text style={styles.eyebrow}>GARDIROBUNA EKLE  /  01</Text>
        <Text style={styles.title}>Bir parça, bin ihtimal.</Text>
        <Text style={styles.subtitle}>Seçtiğin fotoğraf OpenAI ile analiz edilir; ardından gardırobuna ekleyebilirsin.</Text>

        <Text style={styles.sectionLabel}>FOTOĞRAF</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={imageUri ? 'Fotoğrafı değiştir' : 'Fotoğraf Seç'}
          disabled={isPicking || isSaving}
          onPress={pickImage}
          style={({ pressed }) => [styles.photoArea, imageUri && styles.photoAreaSelected, pressed && styles.pressed]}
        >
          {imageUri ? (
            <>
              <Image source={{ uri: imageUri }} style={styles.selectedImage} resizeMode="cover" accessibilityLabel="Seçilen kıyafet fotoğrafı" />
              <View style={styles.changePill}><Feather name="refresh-cw" size={13} color={colors.ink} /><Text style={styles.photoPillText}>FOTOĞRAFI DEĞİŞTİR</Text></View>
            </>
          ) : (
            <>
              <View style={styles.photoIcon}><Feather name="image" size={31} color={colors.pink} /></View>
              <Text style={styles.photoTitle}>{isPicking ? 'Galeri açılıyor...' : 'Fotoğraf Seç'}</Text>
              <Text style={styles.photoHint}>Gardırobuna eklemek için bir kıyafet seç</Text>
              <View style={styles.photoPill}><Feather name="plus" size={14} color={colors.ink} /><Text style={styles.photoPillText}>FOTOĞRAF EKLE</Text></View>
            </>
          )}
        </Pressable>

        <View style={styles.tagsHeading}>
          <Text style={styles.sectionLabel}>ETİKETLER (ÖNİZLEME)</Text>
          <Text style={styles.tagsHint}>{isAnalyzing ? 'Analiz sürüyor' : tags ? 'Analiz tamamlandı' : analysisFailed ? 'Analiz başarısız' : 'Fotoğraf seçildiğinde dolacak'}</Text>
        </View>
        {isAnalyzing && (
          <View style={styles.analysisBanner} accessibilityRole="progressbar" accessibilityLabel="Görsel analiz ediliyor">
            <ActivityIndicator size="small" color={colors.sage} />
            <Text style={styles.analysisText}>Yükleniyor... Kıyafetin inceleniyor.</Text>
          </View>
        )}
        <View style={styles.tagsCard}>
          {[
            { label: 'Tür', value: tags?.tur ?? '—' },
            { label: 'Renk', value: tags?.renk ?? '—' },
            { label: 'Desen', value: tags?.desen ?? '—' },
            { label: 'Kesim', value: tags?.kesim ?? '—' },
            { label: 'Parça', value: tags?.altTur ?? '—' },
            { label: 'Kemer', value: tags?.tur === 'alt' ? (tags.kemerUygun ? 'Uygun' : 'Uygun değil') : '—' },
          ].map((tag, index) => (
            <View key={tag.label} style={[styles.tagRow, index < 5 && styles.tagRowBorder]}>
              <Text style={styles.tagLabel}>{tag.label}</Text>
              <Text style={styles.tagValue}>{tag.value}</Text>
            </View>
          ))}
        </View>
        {analysisFailed && base64Ref.current && (
          <Pressable accessibilityRole="button" accessibilityLabel="Görseli tekrar analiz et" onPress={() => { if (!isAnalyzing && base64Ref.current) void runAnalysis(base64Ref.current); }} style={({ pressed }) => [styles.retryAnalysis, pressed && styles.pressed]}>
            <Feather name="refresh-cw" size={15} color={colors.sage} />
            <Text style={styles.retryText}>Tekrar analiz et</Text>
          </Pressable>
        )}

        <View style={styles.saveArea}>
          <PrimaryButton label={isSaving ? 'Kaydediliyor...' : 'Kaydet'} icon="check" disabled={!imageUri || !tags || isAnalyzing || isSaving} onPress={saveClothing} />
          <Text style={styles.disclaimer}>Kaydetmek için görsel analizinin tamamlanmasını bekle.</Text>
        </View>
      </ScrollView>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  topBar: { height: 62, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  backButton: { width: 40, height: 40, borderRadius: 12, borderWidth: 1, borderColor: colors.border, justifyContent: 'center', alignItems: 'center' },
  pressed: { opacity: 0.72 },
  topBarTitle: { color: colors.gold, fontFamily: fonts.sans, fontSize: 10, letterSpacing: 2.6, fontWeight: '700' },
  topBarSpacer: { width: 40 },
  scrollContent: { paddingHorizontal: 24, paddingTop: 25, paddingBottom: 40 },
  eyebrow: { color: colors.gold, fontFamily: fonts.sans, fontSize: 10, letterSpacing: 2.1, fontWeight: '700' },
  title: { color: colors.text, fontFamily: fonts.serif, fontSize: 32, lineHeight: 40, marginTop: 12 },
  subtitle: { color: colors.textMuted, fontFamily: fonts.sans, fontSize: 13, lineHeight: 20, marginTop: 7, marginBottom: 27 },
  sectionLabel: { color: colors.text, fontFamily: fonts.sans, fontSize: 11, fontWeight: '700', letterSpacing: 1.8 },
  photoArea: { marginTop: 12, minHeight: 220, borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, alignItems: 'center', justifyContent: 'center', padding: 22 },
  photoAreaSelected: { borderStyle: 'solid', padding: 0, overflow: 'hidden' },
  selectedImage: { width: '100%', height: 232 },
  changePill: { position: 'absolute', right: 12, bottom: 12, backgroundColor: colors.sage, borderRadius: 20, paddingHorizontal: 13, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', gap: 6 },
  photoIcon: { width: 62, height: 62, borderRadius: 31, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.backgroundRaised, alignItems: 'center', justifyContent: 'center', marginBottom: 15 },
  photoTitle: { color: colors.pink, fontFamily: fonts.serif, fontSize: 22 },
  photoHint: { color: colors.textFaint, fontFamily: fonts.sans, fontSize: 11, textAlign: 'center', marginTop: 5 },
  photoPill: { backgroundColor: colors.sage, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', marginTop: 17, gap: 5 },
  photoPillText: { color: colors.ink, fontFamily: fonts.sans, fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  tagsHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 6, marginTop: 30, marginBottom: 12 },
  tagsHint: { color: colors.textFaint, fontFamily: fonts.sans, fontSize: 10 },
  analysisBanner: { minHeight: 52, borderRadius: 14, backgroundColor: colors.surfaceLight, borderWidth: 1, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, marginBottom: 12 },
  analysisText: { color: colors.sage, fontFamily: fonts.sans, fontSize: 12 },
  tagsCard: { borderRadius: 17, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderSoft, paddingHorizontal: 17 },
  tagRow: { minHeight: 49, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  tagRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  tagLabel: { color: colors.textMuted, fontFamily: fonts.sans, fontSize: 13 },
  tagValue: { color: colors.lavender, fontFamily: fonts.serif, fontSize: 20 },
  retryAnalysis: { alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 7, padding: 12, marginTop: 8 },
  retryText: { color: colors.sage, fontFamily: fonts.sans, fontSize: 12, fontWeight: '700' },
  saveArea: { marginTop: 28 },
  disclaimer: { color: colors.textFaint, fontFamily: fonts.sans, fontSize: 10, textAlign: 'center', marginTop: 11 },
});
