import { getDB } from '../data/database';

export const API_COOLDOWN_MS = 20_000;
export const API_DAILY_LIMIT = 25;

export type RateLimitReason = 'cooldown' | 'daily';

export class RateLimitError extends Error {
  readonly reason: RateLimitReason;
  readonly waitSeconds: number;

  constructor(reason: RateLimitReason, waitSeconds = 0) {
    super(reason === 'daily'
      ? 'Günlük ilham limitine ulaştın. Kendi yaratıcılığını konuşturma vakti, yarın tekrar görüşürüz!'
      : 'Biraz yavaşlayalım! Stil danışmanın düşünüyor, lütfen birkaç saniye bekle.');
    this.name = 'RateLimitError';
    this.reason = reason;
    this.waitSeconds = waitSeconds;
  }
}

type UsageRow = { request_count: number; last_request_timestamp: number };
const inFlight = new Set<string>();

function localDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Both AI services use this gate. HTTP failures or aborted requests release the slot without a daily charge. */
export async function withApiRateLimit<T>(userId: string, request: () => Promise<T>): Promise<T> {
  if (!userId.trim()) throw new Error('Kullanıcı bulunamadı.');
  if (inFlight.has(userId)) throw new RateLimitError('cooldown');
  inFlight.add(userId);
  try {
    const db = await getDB();
    const startedAt = new Date();
    const day = localDateString(startedAt);
    const today = await db.getFirstAsync<UsageRow>(
      'SELECT request_count, last_request_timestamp FROM api_usage WHERE user_id = ? AND date_string = ?', userId, day,
    );
    if ((today?.request_count ?? 0) >= API_DAILY_LIMIT) throw new RateLimitError('daily');
    const latest = await db.getFirstAsync<{ last_request_timestamp: number }>(
      'SELECT last_request_timestamp FROM api_usage WHERE user_id = ? ORDER BY last_request_timestamp DESC LIMIT 1', userId,
    );
    const remaining = API_COOLDOWN_MS - (startedAt.getTime() - (latest?.last_request_timestamp ?? 0));
    if (remaining > 0) throw new RateLimitError('cooldown', Math.ceil(remaining / 1000));

    const result = await request();
    const completedAt = Date.now();
    await db.runAsync(
      `INSERT INTO api_usage (id, user_id, date_string, request_count, last_request_timestamp)
       VALUES (?, ?, ?, 1, ?)
       ON CONFLICT(user_id, date_string) DO UPDATE SET
         request_count = request_count + 1,
         last_request_timestamp = excluded.last_request_timestamp`,
      `${userId}:${day}`, userId, day, completedAt,
    );
    return result;
  } finally {
    inFlight.delete(userId);
  }
}
