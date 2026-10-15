import { requireAiConsent } from './aiConsent';
import { FIT_TYPES, SUBTYPES, type ClothingFormality, type ClothingTags } from '../data/wardrobe';
import { workerPost } from './workerApi';

const CLOTHING_TYPES = ['üst', 'alt', 'dış giyim', 'ayakkabı', 'aksesuar'];

function parseTags(value: unknown): ClothingTags {
  if (!value || typeof value !== 'object') throw new Error('Invalid tag response');
  const tags = value as Partial<ClothingTags>;
  if (
    typeof tags.tur !== 'string' || !CLOTHING_TYPES.includes(tags.tur)
    || typeof tags.renk !== 'string' || !tags.renk.trim()
    || typeof tags.desen !== 'string' || !tags.desen.trim()
  ) {
    throw new Error('Invalid tag response');
  }
  const shortList = (input: unknown, maxItems: number) => Array.isArray(input)
    ? input.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, maxItems).map(item => item.trim().slice(0, 40))
    : [];
  const formalities: ClothingFormality[] = ['günlük', 'smart casual', 'resmi', 'bilinmiyor'];
  return {
    tur: tags.tur, renk: tags.renk.trim(), desen: tags.desen.trim(),
    kesim: FIT_TYPES.includes(tags.kesim as typeof FIT_TYPES[number]) ? tags.kesim : 'bilinmiyor',
    altTur: SUBTYPES.includes(tags.altTur as typeof SUBTYPES[number]) ? tags.altTur : 'diğer',
    kemerUygun: typeof tags.kemerUygun === 'boolean' ? tags.kemerUygun : false,
    secondaryColors: shortList(tags.secondaryColors, 4),
    season: shortList(tags.season, 4),
    styleTags: shortList(tags.styleTags, 8),
    formality: formalities.includes(tags.formality as ClothingFormality) ? tags.formality : 'bilinmiyor',
    materialGuess: typeof tags.materialGuess === 'string' && tags.materialGuess.trim() ? tags.materialGuess.trim().slice(0, 80) : 'bilinmiyor',
  };
}

export async function analyzeClothing(userId: string, base64Jpeg: string, signal?: AbortSignal): Promise<ClothingTags> {
  if (!base64Jpeg) throw new Error('Fotoğraf verisi okunamadı. Lütfen başka bir fotoğraf seç.');
  await requireAiConsent(userId);
  const result = await workerPost<{ tags: unknown }>(userId, '/analyze-clothing', { aiConsent: true, imageBase64: base64Jpeg, mimeType: 'image/jpeg' }, signal);
  return parseTags(result.tags);
}
