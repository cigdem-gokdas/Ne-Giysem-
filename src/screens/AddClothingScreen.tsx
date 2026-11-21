import { useSubscription } from '../billing/SubscriptionContext';
import { PlanBanner } from '../components/PlanBanner';
import { prepareImage } from '../services/prepareImage';
import { Feather } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { PrimaryButton } from '../components/PrimaryButton';
import { useUserId } from '../auth/AuthContext';
import { ScreenFrame } from '../components/ScreenFrame';
import { addClothingItem, CLOTHING_TYPES, FIT_TYPES, getWardrobeCapacity, SUBTYPES, type ClothingTags } from '../data/wardrobe';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { analyzeClothing } from '../services/analyzeClothing';
import type { ImageUploadMetadata } from '../services/r2Storage';
import { RateLimitError, ProRequiredError } from '../services/workerApi';
import { colors, fonts } from '../theme';
import { describeError, friendlyError, reportError, track } from '../services/telemetry';
import { FREE_WARDROBE_LIMIT } from '../config/plans';
import { sanitizeUserText } from '../utils/sanitize';
import * as FileSystem from 'expo-file-system/legacy';

type Props = NativeStackScreenProps<RootStackParamList, 'AddClothing'>;

export function AddClothingScreen({ navigation }: Props) {
  const userId = useUserId();
  const { status: plan, refresh: refreshPlan } = useSubscription();
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [uploadMetadata, setUploadMetadata] = useState<ImageUploadMetadata>({});
  const [tags, setTags] = useState<ClothingTags | null>(null);
  const [isPicking, setIsPicking] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisFailed, setAnalysisFailed] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const mountedRef = useRef(true);
  const pickingRef = useRef(false);
  const savingRef = useRef(false);
  const analyzingRef = useRef(false);
  const base64Ref = useRef<string | null>(null);
  const analysisController = useRef<AbortController | null>(null);
  const analysisRequestId = useRef(0);

  useEffect(() => { mountedRef.current = true; return () => {
    mountedRef.current = false;
    analysisRequestId.current += 1;
    analysisController.current?.abort();
  }; }, []);

  async function runAnalysis(base64Jpeg: string, pro: boolean | undefined = plan?.pro) {
    if (!mountedRef.current || analyzingRef.current) return;
    if (pro === undefined) {
      // Membership could not be verified (offline / transient error): never bounce a possible Pro user to the paywall.
      Alert.alert('Üyelik doğrulanamadı', 'Üyelik durumun şu an kontrol edilemedi. Etiketleri elle doldurabilir veya biraz sonra tekrar deneyebilirsin.');
      return;
    }
    if (!pro) { navigation.navigate('Pro'); return; }
    analyzingRef.current = true;
    const requestId = ++analysisRequestId.current;
    analysisController.current?.abort();
    const controller = new AbortController();
    analysisController.current = controller;
    const timeout = setTimeout(() => controller.abort(), 30000);

    setAnalysisFailed(false);
    setIsAnalyzing(true);
    track('ai_auto_tag_started');

    try {
      const result = await analyzeClothing(userId, base64Jpeg, controller.signal);
      if (analysisRequestId.current === requestId) { setTags(result); track('ai_auto_tag_success'); }
    } catch (error) {
      if (analysisRequestId.current === requestId) {
        track('ai_auto_tag_failed');
        reportError('ai_auto_tag', error);
        setAnalysisFailed(true);
        if (error instanceof RateLimitError) {
          Alert.alert(error.reason === 'daily' ? 'Günlük ilham sınırı' : 'Biraz yavaşlayalım', error.message);
        } else if (error instanceof Error && error.name === 'AbortError') {
          Alert.alert('Analiz zaman aşımına uğradı', 'Bağlantı yavaş görünüyor. Lütfen tekrar dene.');
        } else {
          Alert.alert('Analiz başarısız', friendlyError(error, 'Görsel analiz edilemedi. Etiketleri elle doldurabilir veya tekrar deneyebilirsin.'));
        }
      }
    } finally {
      clearTimeout(timeout);
      if (analysisRequestId.current === requestId) {
        analysisController.current = null;
        setIsAnalyzing(false);
      }
      analyzingRef.current = false;
    }
  }

  async function pickImage() {
    if (pickingRef.current || savingRef.current) return;
    pickingRef.current = true;
    setIsPicking(true);
    try {
      let capacity: Awaited<ReturnType<typeof getWardrobeCapacity>>;
      try { capacity = await getWardrobeCapacity(userId); }
      catch (error) {
        // Capacity problems are not a permissions issue: do not offer the device settings here.
        reportError('wardrobe_capacity', error);
        Alert.alert('Gardırop kapasitesi doğrulanamadı', describeError(error, 'Gardırop kapasiten şu an kontrol edilemedi. Bağlantını kontrol edip tekrar dene.'));
        return;
      }
      if (!capacity.canAdd) {
        track('wardrobe_limit_reached', { limit: capacity.limit ?? FREE_WARDROBE_LIMIT });
        navigation.navigate('Pro');
        return;
      }
      // The system photo picker does not need broad library permission for images.
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: false,
        base64: false,
        quality: 0.8,
      });
      if (mountedRef.current && !result.canceled && result.assets[0]?.uri) {
        analysisRequestId.current++;
        analysisController.current?.abort();
        const asset = result.assets[0];
        // The small analysis copy is only needed for its base64; the upload re-encodes the original once.
        const image = await prepareImage(asset.uri, 1024, true);
        await FileSystem.deleteAsync(image.uri, { idempotent: true }).catch(() => undefined);
        if (!mountedRef.current) return;
        setImageUri(asset.uri);
        setUploadMetadata({ mimeType: asset.mimeType ?? 'image/jpeg', fileName: asset.fileName, fileSize: asset.fileSize });
        base64Ref.current = image.base64 ?? null;
        setTags({ tur: 'üst', renk: 'bilinmiyor', desen: 'düz', kesim: 'bilinmiyor', altTur: 'diğer', kemerUygun: false });
        setAnalysisFailed(false);
        setIsAnalyzing(false);
        const confirmedPlan = plan ?? await refreshPlan();
        if (mountedRef.current && confirmedPlan?.pro && image.base64) await runAnalysis(image.base64, true);
        else if (mountedRef.current && !confirmedPlan) Alert.alert('Üyelik doğrulanamadı', 'Otomatik analiz şu an kullanılamıyor. Etiketleri elle doldurabilirsin.');
      }
    } catch (error) {
      if (!mountedRef.current) return;
      reportError('image_picker', error);
      Alert.alert(
        'Fotoğraf seçimi başlatılamadı',
        friendlyError(error, 'Fotoğraf erişimi doğrulanamadı. İzinlerini kontrol edip tekrar deneyebilirsin.'),
        [
          { text: 'Tamam', style: 'cancel' },
          { text: 'Ayarları Aç', onPress: () => { void Linking.openSettings().catch(() => Alert.alert('Ayarlar açılamadı', 'Cihaz ayarlarını elle açabilirsin.')); } },
        ],
      );
    } finally {
      pickingRef.current = false;
      if (mountedRef.current) setIsPicking(false);
    }
  }

  async function saveClothing() {
    if (!imageUri || !tags || analyzingRef.current || savingRef.current) return;
    // Renk/desen are never shown or edited in the UI; the backend still requires them, so fall back to neutral defaults.
    const cleanTags = { ...tags, renk: sanitizeUserText(tags.renk, 80) || 'bilinmiyor', desen: sanitizeUserText(tags.desen, 80) || 'düz' };
    savingRef.current = true;
    setIsSaving(true);
    try {
      await addClothingItem(userId, imageUri, cleanTags, uploadMetadata);
      track('wardrobe_item_added');
      navigation.goBack();
    } catch (error) {
      reportError('wardrobe_item_add', error);
      if (error instanceof ProRequiredError) { track('wardrobe_limit_reached', { limit: FREE_WARDROBE_LIMIT }); navigation.navigate('Pro'); return; }
      Alert.alert('Kaydedilemedi', describeError(error, 'Kıyafet kaydedilemedi. Fotoğraf ve etiketlerin ekranda duruyor; tekrar deneyebilirsin.'));
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setIsSaving(false);
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
        <Text style={styles.subtitle}>{plan?.pro ? 'Fotoğrafını seç; izninle AI etiketlerini hazırlasın. Dilersen etiketleri değiştirebilirsin.' : 'Fotoğrafını seçip etiketlerini kendin doldur. Otomatik analiz Pro’da.'}</Text>
        <PlanBanner />

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
          <Text style={styles.tagsHint}>{isAnalyzing ? 'Analiz sürüyor' : tags ? 'Etiketleri düzenleyebilirsin' : 'Fotoğraf seçerek başla'}</Text>
        </View>
        {isAnalyzing && (
          <View style={styles.analysisBanner} accessibilityRole="progressbar" accessibilityLabel="Görsel analiz ediliyor">
            <ActivityIndicator size="small" color={colors.sage} />
            <Text style={styles.analysisText}>Yükleniyor... Kıyafetin inceleniyor.</Text>
          </View>
        )}
        <View style={styles.tagsCard}>
          {imageUri && tags && <>
            <Text style={styles.tagLabel}>Tür</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingVertical: 10 }}>{CLOTHING_TYPES.map((tur) => <Pressable key={tur} accessibilityRole="radio" accessibilityState={{ selected: tags.tur === tur }} accessibilityLabel={`Tür: ${tur}`} onPress={() => setTags({ ...tags, tur })}><Text style={{ color: tags.tur === tur ? colors.sage : colors.textMuted }}>{tur}</Text></Pressable>)}</View>
            <Text style={styles.tagLabel}>Kesim</Text><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingVertical: 10 }}>{FIT_TYPES.map((kesim) => <Pressable key={kesim} accessibilityRole="radio" accessibilityState={{ selected: tags.kesim === kesim }} accessibilityLabel={`Kesim: ${kesim}`} onPress={() => setTags({ ...tags, kesim })}><Text style={{ color: tags.kesim === kesim ? colors.sage : colors.textMuted }}>{kesim}</Text></Pressable>)}</View>
            <Text style={styles.tagLabel}>Parça</Text><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingVertical: 10 }}>{SUBTYPES.map((altTur) => <Pressable key={altTur} accessibilityRole="radio" accessibilityState={{ selected: tags.altTur === altTur }} accessibilityLabel={`Parça türü: ${altTur}`} onPress={() => setTags({ ...tags, altTur })}><Text style={{ color: tags.altTur === altTur ? colors.sage : colors.textMuted }}>{altTur}</Text></Pressable>)}</View>
            {tags.tur === 'alt' && <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: !!tags.kemerUygun }} accessibilityLabel="Kemer kullanmaya uygun" onPress={() => setTags({ ...tags, kemerUygun: !tags.kemerUygun })}><Text style={styles.tagValue}>Kemer: {tags.kemerUygun ? 'Uygun' : 'Uygun değil'}</Text></Pressable>}
          </>}
          {imageUri && plan?.pro && !isAnalyzing && <Pressable style={{ paddingVertical: 14 }} accessibilityRole="button" accessibilityLabel="İzin vererek AI ile analiz et" onPress={() => { if (base64Ref.current) void runAnalysis(base64Ref.current); }}><Text style={{ color: colors.sage }}>İzin vererek AI ile analiz et</Text></Pressable>}
        </View>
        {plan?.pro && analysisFailed && base64Ref.current && (
          <Pressable accessibilityRole="button" accessibilityLabel="Görseli tekrar analiz et" onPress={() => { if (!isAnalyzing && base64Ref.current) void runAnalysis(base64Ref.current); }} style={({ pressed }) => [styles.retryAnalysis, pressed && styles.pressed]}>
            <Feather name="refresh-cw" size={15} color={colors.sage} />
            <Text style={styles.retryText}>Tekrar analiz et</Text>
          </Pressable>
        )}

        <View style={styles.saveArea}>
          <PrimaryButton label={isSaving ? 'Kaydediliyor...' : 'Kaydet'} icon="check" disabled={!imageUri || !tags || isPicking || isAnalyzing || isSaving} onPress={saveClothing} />
          <Text style={styles.disclaimer}>Etiketleri kontrol ederek kaydet.</Text>
          {plan?.pro && <Text style={styles.disclaimer}>Malzeme, mevsim ve tarz gibi AI etiketleri fotoğraftan yapılan tahminlerdir; kesin bilgi sayılmaz.</Text>}
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
  tagLabel: { color: colors.textMuted, fontFamily: fonts.sans, fontSize: 13 },
  tagValue: { color: colors.lavender, fontFamily: fonts.serif, fontSize: 20 },
  retryAnalysis: { alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 7, padding: 12, marginTop: 8 },
  retryText: { color: colors.sage, fontFamily: fonts.sans, fontSize: 12, fontWeight: '700' },
  saveArea: { marginTop: 28 },
  disclaimer: { color: colors.textFaint, fontFamily: fonts.sans, fontSize: 10, textAlign: 'center', marginTop: 11 },
});
