import { OPENAI_API_KEY } from '../config/env';
import { buildWardrobeSummary, hasAvailableMainPiece, isMainClothingType, type OutfitHistoryEntry, type WardrobeSummaryItem } from '../data/outfitHistory';
import type { ClothingItem } from '../data/wardrobe';
import { withApiRateLimit } from './rateLimiter';

const ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const MODEL = 'gpt-5.6-luna';
const SYSTEM_PROMPT = `Sen samimi, Türkçe konuşan bir stil danışmanısın. Kullanıcının planına göre yalnızca verilen gardırop ID'lerinden baştan aşağı uyumlu bir kombin seç. En az bir ana kıyafet ve varsa uyumlu bir ayakkabı veya aksesuar ekle.
1. Listedeki son_kullanim değerlerine dikkat et. Ana kıyafet (üst, alt, dış giyim) son 5 kombin içinde kullanılmışsa (son_kullanim < 5) onu yeni parça olarak SEÇME. Değişim isteğinde aynen korunacak son kombin ID'leri bu kuraldan muaftır. "hic" hiç kullanılmadı demektir; 0 en son kombindir.
2. Ayakkabı ve aksesuarlar (çanta, kemer, şal vb.) bu soğuma kuralından MUAFTIR; uyum için tekrar seçebilirsin.
3. Dark Academia, Koyu Kış (Deep Winter) paleti (lacivert, bordo, zümrüt yeşili) ve vintage dokulara odaklan. Mary Jane/kalın topuklu ayakkabılar ile geniş paça veya uzun elbiselerin estetik bütünlüğünü gözet.
Cevabını sadece şu JSON formatında ver:
{
  "mesaj": "[Kombinin neden uygun olduğunu anlatan samimi, 1-2 cümlelik Türkçe stil yorumu]",
  "secilen_idler": ["seçilen_id_1", "seçilen_id_2"]
}
Asla markdown veya fazladan metin yazma, sadece saf JSON dön.`;
const REPLACEMENT_RULE = 'Kullanıcı önerdiğin son kombindeki bir parçayı değiştirmek istiyor. Gardıroptan sadece o parçanın yerine geçecek YENİ bir eşya seç. Kombinin geri kalan parçalarını (ID\'lerini) AYNEN KORU ve sadece yeni eklediğin parçayla birlikte tam listeyi tekrar dön.';

export type OutfitRecommendation = { mesaj: string; secilen_idler: string[] };
export type ReplacementRequest = { previousIds: string[]; replaceId: string };

export function isReplacementRequest(prompt: string): boolean {
  return /(kirli|kirlen|lekeli|yıkanmamış|yikanmamis|giyem|müsait değil|musait degil|değiştir|degistir|alternatif|yerine|olmasın|olmasin)/i.test(prompt);
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

type CompletionResponse = {
  choices?: Array<{
    finish_reason?: string;
    message?: { content?: string | null; refusal?: string | null };
  }>;
};

function parseRecommendation(
  content: string,
  wardrobe: ClothingItem[],
  summary: WardrobeSummaryItem[],
  replacement?: ReplacementRequest,
  replacementCandidates: ClothingItem[] = [],
): OutfitRecommendation {
  const value: unknown = JSON.parse(content);
  if (!value || typeof value !== 'object') throw new Error('Invalid outfit response');
  const result = value as Partial<OutfitRecommendation>;
  const knownIds = new Set(wardrobe.map((item) => item.id));
  if (
    typeof result.mesaj !== 'string' || !result.mesaj.trim()
    || !Array.isArray(result.secilen_idler)
    || result.secilen_idler.length < 2
    || !result.secilen_idler.every((id) => typeof id === 'string' && knownIds.has(id))
    || new Set(result.secilen_idler).size !== result.secilen_idler.length
  ) {
    throw new Error('Invalid outfit response');
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
      throw new Error('Invalid replacement response');
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
    throw new Error('Outfit violates cooldown');
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
  if (!OPENAI_API_KEY) throw new Error('Missing OpenAI API key');
  if (wardrobe.length < 2 || !prompt.trim()) throw new Error('Insufficient outfit input');

  const wardrobeSummary = buildWardrobeSummary(wardrobe, history);
  let replacementCandidates: ClothingItem[] = [];
  if (replacement) {
    if (
      replacement.previousIds.length < 2
      || new Set(replacement.previousIds).size !== replacement.previousIds.length
      || !replacement.previousIds.every((id) => wardrobe.some((item) => item.id === id))
    ) throw new Error('Invalid previous outfit');
    replacementCandidates = getReplacementCandidates(wardrobe, history, replacement);
    if (replacementCandidates.length === 0) throw new Error('No replacement available');
  } else if (!hasAvailableMainPiece(wardrobeSummary)) {
    throw new Error('No main piece available after cooldown');
  }
  const candidateIds = new Set(replacementCandidates.map((item) => item.id));
  const sentSummary = replacement
    ? wardrobeSummary.filter((item) => replacement.previousIds.includes(item.id) || candidateIds.has(item.id))
    : wardrobeSummary;
  const userMessage = replacement
    ? `${prompt.trim()}\nSon kombin ID'leri: ${JSON.stringify(replacement.previousIds)}. Değişecek ID: ${replacement.replaceId}. Aynen korunacak ID'ler: ${JSON.stringify(replacement.previousIds.filter((id) => id !== replacement.replaceId))}.\n${REPLACEMENT_RULE}`
    : prompt.trim();

  const response = await withApiRateLimit(userId, async () => {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      signal,
      body: JSON.stringify({
        model: MODEL,
        max_completion_tokens: 240,
        store: false,
        messages: [
          { role: 'system', content: `${SYSTEM_PROMPT}\nGardırop: ${JSON.stringify(sentSummary)}` },
          { role: 'user', content: userMessage },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'outfit_recommendation',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                mesaj: { type: 'string' },
                secilen_idler: { type: 'array', items: { type: 'string' } },
              },
              required: ['mesaj', 'secilen_idler'],
              additionalProperties: false,
            },
          },
        },
      }),
    });

    if (!response.ok) throw new Error(`OpenAI request failed: ${response.status}`);
    return response;
  });
  const result = (await response.json()) as CompletionResponse;
  const choice = result.choices?.[0];
  if (choice?.finish_reason !== 'stop' || choice.message?.refusal || !choice.message?.content) {
    throw new Error('OpenAI returned no complete outfit');
  }
  return parseRecommendation(choice.message.content, wardrobe, wardrobeSummary, replacement, replacementCandidates);
}
