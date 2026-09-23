import { OPENAI_API_KEY } from '../config/env';
import type { ClothingTags } from '../data/wardrobe';
import { withApiRateLimit } from './rateLimiter';

const ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const MODEL = 'gpt-5.6-luna';
const PROMPT = 'Sen bir moda asistanısın. Gönderilen görseli analiz et ve bana sadece geçerli bir JSON objesi dön. JSON formatı şu şekilde olmalı: { "tur": "[üst, alt, dış giyim, ayakkabı, aksesuar içinden biri]", "renk": "[hakim renk]", "desen": "[düz, çizgili, çiçekli, vb.]" }. Asla markdown veya ekstra metin ekleme, sadece JSON dön.';
const CLOTHING_TYPES = ['üst', 'alt', 'dış giyim', 'ayakkabı', 'aksesuar'];

type CompletionResponse = {
  choices?: Array<{
    finish_reason?: string;
    message?: { content?: string | null; refusal?: string | null };
  }>;
};

function parseTags(content: string): ClothingTags {
  const value: unknown = JSON.parse(content);
  if (!value || typeof value !== 'object') throw new Error('Invalid tag response');
  const tags = value as Partial<ClothingTags>;
  if (
    typeof tags.tur !== 'string' || !CLOTHING_TYPES.includes(tags.tur)
    || typeof tags.renk !== 'string' || !tags.renk.trim()
    || typeof tags.desen !== 'string' || !tags.desen.trim()
  ) {
    throw new Error('Invalid tag response');
  }
  return { tur: tags.tur, renk: tags.renk.trim(), desen: tags.desen.trim() };
}

export async function analyzeClothing(userId: string, base64Jpeg: string, signal?: AbortSignal): Promise<ClothingTags> {
  if (!OPENAI_API_KEY) throw new Error('Missing OpenAI API key');
  if (!base64Jpeg) throw new Error('Missing image data');

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
        max_completion_tokens: 160,
        store: false,
        messages: [
          { role: 'system', content: PROMPT },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Fotoğraftaki kıyafeti analiz et.' },
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Jpeg}` } },
            ],
          },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'clothing_tags',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                tur: { type: 'string', enum: CLOTHING_TYPES },
                renk: { type: 'string' },
                desen: { type: 'string' },
              },
              required: ['tur', 'renk', 'desen'],
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
    throw new Error('OpenAI returned no complete tags');
  }
  return parseTags(choice.message.content);
}
