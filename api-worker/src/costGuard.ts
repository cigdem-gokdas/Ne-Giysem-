export interface CostEnv {
  AI_ENABLED?: string;
  AI_MONTHLY_BUDGET_CENTS?: string;
  AI_DAILY_REQUEST_LIMIT?: string;
  AI_MONTHLY_REQUEST_LIMIT?: string;
  /** Cents reserved per AI call (default 1). Conservative reservation, never a statement of actual provider cost. */
  AI_RESERVATION_CENTS?: string;
  AI_USER_DAILY_LIMIT?: string;
  UPLOAD_DAILY_GLOBAL_LIMIT?: string;
  UPLOAD_USER_DAILY_LIMIT?: string;
  STORAGE_MONTHLY_BYTES_LIMIT?: string;
}
// No refunds for AI: a lost response, timeout or invalid JSON can still incur a charge.
export function positiveInt(value: string | undefined, ceiling: number): number {
  if (!value || !/^\d+$/.test(value)) return 0;
  const number = Number(value);
  return Number.isSafeInteger(number) && number <= ceiling ? number : 0;
}
/** Optional numeric variable: missing or invalid values fall back to the default. "0" is a valid (closed) value. */
export function intVar(value: string | undefined, fallback: number, ceiling: number): number {
  if (value === undefined || value === '' || !/^\d+$/.test(value)) return fallback;
  const number = Number(value);
  return Number.isSafeInteger(number) && number <= ceiling ? number : fallback;
}
export const DEFAULT_STORAGE_MONTHLY_BYTES = 5 * 1024 ** 3;
type Counters = { day: string; month: string; dailyAi: number; monthlyAi: number; reservedCents: number; dailyUploads: number; monthlyUploads: number; monthlyBytes: number; dailyMedia: number; monthlyMedia: number; lifetimeBytes?: number };

/** One stable singleton for the whole deployment, never one budget per user. */
export class CostGuard {
  constructor(private readonly state: DurableObjectState, private readonly env: CostEnv) {}
  fetch(request: Request): Promise<Response> {
    // Only storage reads / writes run inside the gate; no network calls.
    return this.state.blockConcurrencyWhile(async () => {
      let input: { kind?: string; bytes?: number; month?: string };
      try {
        const parsed: unknown = await request.json();
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return new Response(null, { status: 400 });
        input = parsed as typeof input;
      } catch { return new Response(null, { status: 400 }); }
      const env = this.env ?? {};
      const day = new Date().toISOString().slice(0, 10), month = day.slice(0, 7);
      const previous = await this.state.storage.get<Counters>('budget');
      const current: Counters = { day, month, dailyAi: 0, monthlyAi: 0, reservedCents: 0, dailyUploads: 0, monthlyUploads: 0, monthlyBytes: 0, dailyMedia: 0, monthlyMedia: 0, ...previous };
      // Migration: the old never-resetting lifetime byte counter is dropped; the monthly counter starts from zero.
      if ('lifetimeBytes' in current) delete current.lifetimeBytes;
      if (current.day !== day) Object.assign(current, { day, dailyAi: 0, dailyUploads: 0, dailyMedia: 0 });
      if (current.month !== month) Object.assign(current, { month, monthlyAi: 0, reservedCents: 0, monthlyUploads: 0, monthlyMedia: 0, monthlyBytes: 0 });
      const deny = (code: string) => Response.json({ code }, { status: 429 });
      if (input.kind === 'ai') {
        const budget = positiveInt(env.AI_MONTHLY_BUDGET_CENTS, 100_000);
        const reservation = Math.max(1, intVar(env.AI_RESERVATION_CENTS, 1, 1000));
        if (env.AI_ENABLED !== 'true' || budget === 0) return deny('ai_disabled');
        if (current.dailyAi >= intVar(env.AI_DAILY_REQUEST_LIMIT, 500, 100_000)
          || current.monthlyAi >= intVar(env.AI_MONTHLY_REQUEST_LIMIT, 1000, 1_000_000)
          || current.reservedCents + reservation > budget) return deny('budget');
        current.dailyAi++; current.monthlyAi++; current.reservedCents += reservation;
      } else if (input.kind === 'upload') {
        if (!Number.isSafeInteger(input.bytes) || input.bytes! <= 0 || input.bytes! > 5 * 1024 * 1024) return new Response(null, { status: 400 });
        const daily = intVar(env.UPLOAD_DAILY_GLOBAL_LIMIT, 1000, 1_000_000);
        // The monthly upload count is derived from the daily limit (30 days) so one variable controls both.
        if (current.dailyUploads >= daily || current.monthlyUploads >= daily * 30
          || current.monthlyBytes + input.bytes! > intVar(env.STORAGE_MONTHLY_BYTES_LIMIT, DEFAULT_STORAGE_MONTHLY_BYTES, 2 ** 50)) return deny('storage');
        current.dailyUploads++; current.monthlyUploads++; current.monthlyBytes += input.bytes!;
      } else if (input.kind === 'refund') {
        // Best-effort refund after a delete. Only bytes uploaded in the current month were counted in it.
        if (!Number.isSafeInteger(input.bytes) || input.bytes! < 0) return new Response(null, { status: 400 });
        if (input.month === month) current.monthlyBytes = Math.max(0, current.monthlyBytes - input.bytes!);
      } else if (input.kind === 'media') {
        if (current.dailyMedia >= 5000 || current.monthlyMedia >= 100_000) return deny('media');
        current.dailyMedia++; current.monthlyMedia++;
      } else return new Response(null, { status: 400 });
      await this.state.storage.put('budget', current);
      return Response.json({ ok: true });
    });
  }
}
