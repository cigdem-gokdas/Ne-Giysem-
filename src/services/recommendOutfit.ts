import { buildWardrobeSummary, hasAvailableMainPiece, isMainClothingType, type OutfitHistoryEntry, type WardrobeSummaryItem } from '../data/outfitHistory';
import type { ClothingItem } from '../data/wardrobe';
import { workerPost } from './workerApi';

const REPLACEMENT_RULE = 'Kullanıcı önerdiğin son kombindeki bir parçayı değiştirmek istiyor. Gardıroptan sadece o parçanın yerine geçecek YENİ bir eşya seç. Kombinin geri kalan parçalarını (ID\'lerini) AYNEN KORU ve sadece yeni eklediğin parçayla birlikte tam listeyi tekrar dön.';
const SHOE_TYPE = 'ayakkabı';

export type OutfitRecommendation = { mesaj: string; secilen_idler: string[] };
export type ReplacementRequest = { previousIds: string[]; replaceId: string };

export function isReplacementRequest(prompt: string): boolean {
  return /(kirli|kirlen|lekeli|yıkanmamış|yikanmamis|giyem|müsait değil|musait degil|değiştir|degistir|alternatif|yerine|olmasın|olmasin)/i.test(prompt);
}

function normalizedType(type: string): string {
  return type.trim().toLocaleLowerCase('tr-TR');
}

export function buildRotationPool(summary: WardrobeSummaryItem[]): WardrobeSummaryItem[] {
  return summary
    .filter((item) => {
      if (isMainClothingType(item.tur)) return item.son_kullanim === 'hic' || item.son_kullanim >= 5;
      if (normalizedType(item.tur) === SHOE_TYPE) return item.son_kullanim !== 0;
      return true;
    })
    .sort((left, right) => {
      if (left.kullanim_sayisi !== right.kullanim_sayisi) return left.kullanim_sayisi - right.kullanim_sayisi;
      const leftRecency = left.son_kullanim === 'hic' ? Number.MAX_SAFE_INTEGER : left.son_kullanim;
      const rightRecency = right.son_kullanim === 'hic' ? Number.MAX_SAFE_INTEGER : right.son_kullanim;
      return rightRecency - leftRecency;
    });
}

export function getReplacementCandidates(
  wardrobe: ClothingItem[],
  history: OutfitHistoryEntry[],
  request: ReplacementRequest,
): ClothingItem[] {
  const target = wardrobe.find((item) => item.id === request.replaceId);
  if (
    !target
    || !request.previousIds.includes(request.replaceId)
    || new Set(request.previousIds).size !== request.previousIds.length
    || !request.previousIds.every((id) => wardrobe.some((item) => item.id === id))
  ) return [];
  const lastIds = new Set(request.previousIds);
  const targetType = target.tags.tur.trim().toLocaleLowerCase('tr-TR');
  const summaryById = new Map(buildWardrobeSummary(wardrobe, history).map((item) => [item.id, item]));
  return wardrobe.filter((item) => {
    if (lastIds.has(item.id) || item.tags.tur.trim().toLocaleLowerCase('tr-TR') !== targetType) return false;
    const lastUse = summaryById.get(item.id)?.son_kullanim;
    return !isMainClothingType(targetType) || lastUse === 'hic' || (typeof lastUse === 'number' && lastUse >= 5);
  });
}

function parseRecommendation(
  value: unknown,
  wardrobe: ClothingItem[],
  summary: WardrobeSummaryItem[],
  replacement?: ReplacementRequest,
  replacementCandidates: ClothingItem[] = [],
): OutfitRecommendation {
  if (!value || typeof value !== 'object') throw new Error('Stil servisi geçersiz bir kombin yanıtı döndürdü.');
  const result = value as Partial<OutfitRecommendation>;
  const knownIds = new Set(wardrobe.map((item) => item.id));
  if (
    typeof result.mesaj !== 'string' || !result.mesaj.trim()
    || !Array.isArray(result.secilen_idler)
    || result.secilen_idler.length < 1
    || !result.secilen_idler.every((id) => typeof id === 'string' && knownIds.has(id))
    || new Set(result.secilen_idler).size !== result.secilen_idler.length
  ) {
    throw new Error('Stil servisi gardıropta bulunmayan veya eksik parçalar döndürdü.');
  }
  if (replacement) {
    const previous = new Set(replacement.previousIds);
    const keptIds = replacement.previousIds.filter((id) => id !== replacement.replaceId);
    const newIds = result.secilen_idler.filter((id) => !previous.has(id));
    const candidateIds = new Set(replacementCandidates.map((item) => item.id));
    if (
      result.secilen_idler.length !== replacement.previousIds.length
      || result.secilen_idler.includes(replacement.replaceId)
      || !keptIds.every((id) => result.secilen_idler?.includes(id))
      || newIds.length !== 1
      || !candidateIds.has(newIds[0])
    ) {
      throw new Error('Stil servisi yalnızca değiştirilecek parçayı yenileme kuralına uymadı.');
    }
    return {
      mesaj: result.mesaj.trim(),
      secilen_idler: replacement.previousIds.map((id) => id === replacement.replaceId ? newIds[0] : id),
    };
  }
  const selectedSummary = summary.filter((item) => result.secilen_idler?.includes(item.id));
  if (
    !selectedSummary.some((item) => isMainClothingType(item.tur))
    || selectedSummary.some((item) => isMainClothingType(item.tur) && typeof item.son_kullanim === 'number' && item.son_kullanim < 5)
  ) {
    throw new Error('Stil servisi yakın zamanda kullanılan bir ana parçayı tekrar seçti.');
  }
  return { mesaj: result.mesaj.trim(), secilen_idler: result.secilen_idler };
}

export async function recommendOutfit(
  userId: string,
  prompt: string,
  wardrobe: ClothingItem[],
  history: OutfitHistoryEntry[],
  signal?: AbortSignal,
  replacement?: ReplacementRequest,
): Promise<OutfitRecommendation> {
  if (wardrobe.length < 2) throw new Error('Kombin oluşturmak için gardırobunda en az iki parça olmalı.');
  if (!prompt.trim()) throw new Error('Nereye gideceğini veya nasıl bir kombin istediğini yaz.');

  const wardrobeSummary = buildWardrobeSummary(wardrobe, history);
  let replacementCandidates: ClothingItem[] = [];
  if (replacement) {
    if (
      replacement.previousIds.length < 1
      || new Set(replacement.previousIds).size !== replacement.previousIds.length
      || !replacement.previousIds.every((id) => wardrobe.some((item) => item.id === id))
    ) throw new Error('Değiştirilecek önceki kombin bulunamadı.');
    replacementCandidates = getReplacementCandidates(wardrobe, history, replacement);
    if (replacementCandidates.length === 0) throw new Error('Bu parçanın yerine geçebilecek, rotasyon kuralına uygun başka bir parça yok.');
  } else if (!hasAvailableMainPiece(wardrobeSummary)) {
    throw new Error('Ana parçaların son beş kombinde kullanılmış. Yeni bir ana parça ekleyebilir veya geçmiş rotasyonunun dolmasını bekleyebilirsin.');
  }
  const candidateIds = new Set(replacementCandidates.map((item) => item.id));
  const sentSummary = replacement
    ? wardrobeSummary.filter((item) => replacement.previousIds.includes(item.id) || candidateIds.has(item.id))
    : buildRotationPool(wardrobeSummary);
  if (!replacement && sentSummary.length < 2) throw new Error('Aynı parçaları tekrarlamadan kombin kurmak için yeterli uygun parça yok.');
  const userMessage = replacement
    ? `${prompt.trim()}\nSon kombin ID'leri: ${JSON.stringify(replacement.previousIds)}. Değişecek ID: ${replacement.replaceId}. Aynen korunacak ID'ler: ${JSON.stringify(replacement.previousIds.filter((id) => id !== replacement.replaceId))}.\n${REPLACEMENT_RULE}`
    : prompt.trim();

  const result = await workerPost<{ recommendation: unknown }>(userId, '/generate-outfit', { wardrobe: sentSummary, message: userMessage }, signal);
  return parseRecommendation(result.recommendation, wardrobe, wardrobeSummary, replacement, replacementCandidates);
}
