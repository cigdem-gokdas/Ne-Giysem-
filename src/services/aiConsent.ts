import { Alert } from 'react-native';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { firebaseAuth, firestore } from '../config/firebase';

export async function getAiConsent(userId: string): Promise<boolean> {
  if (firebaseAuth.currentUser?.uid !== userId) throw new Error('Oturum değişti.');
  return (await getDoc(doc(firestore, 'account_settings', userId))).data()?.aiConsent === true;
}
export async function setAiConsent(userId: string, value: boolean): Promise<void> {
  if (firebaseAuth.currentUser?.uid !== userId) throw new Error('Oturum değişti.');
  const ref = doc(firestore, 'account_settings', userId);
  const previous = await getDoc(ref);
  await setDoc(ref, { aiConsent: value, termsVersion: '2026-10-03', termsAcceptedAt: previous.data()?.termsAcceptedAt ?? serverTimestamp() });
}
export async function requireAiConsent(userId: string): Promise<void> {
  if (await getAiConsent(userId)) return;
  const allowed = await new Promise<boolean>((resolve) => Alert.alert('OpenAI ile veri paylaşımı', 'Kıyafet analizi için seçtiğin fotoğraf; kombin önerisi için yazdığın istek ve gardırop etiketlerin OpenAI’ye gönderilecek. İzin vermeden elle etiketleyebilir, iznini Ayarlar’dan geri alabilirsin.', [{ text: 'Şimdi değil', style: 'cancel', onPress: () => resolve(false) }, { text: 'İzin ver', onPress: () => resolve(true) }], { cancelable: false }));
  if (!allowed) throw new Error('OpenAI ile veri paylaşımına izin verilmedi. Elle etiketleme kullanabilirsin.');
  await setAiConsent(userId, true);
}
