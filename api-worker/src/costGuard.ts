export interface CostEnv {
  AI_ENABLED?: string;
  AI_MONTHLY_BUDGET_CENTS?: string;
  AI_DAILY_REQUEST_LIMIT?: string;
  AI_MONTHLY_REQUEST_LIMIT?: string;
}
// Conservative reservation, never a statement of actual provider cost.
// Reviewed for gpt-6-luna, bounded inputs, standard tier on 2026-10-03.
// No refunds: a lost response, timeout or invalid JSON can still incur a charge.
export const AI_RESERVATION_CENTS = 5;
export function positiveInt(value: string | undefined, ceiling: number): number {
  if (!value || !/^\d+$/.test(value)) return 0;
  const number = Number(value);
  return Number.isSafeInteger(number) && number <= ceiling ? number : 0;
}
type Counters = { day: string; month: string; dailyAi: number; monthlyAi: number; reservedCents: number; dailyUploads: number; monthlyUploads: number; lifetimeBytes: number; dailyMedia: number; monthlyMedia: number };

/** One stable singleton for the whole deployment, never one budget per user. */
export class CostGuard {
  constructor(private readonly state: DurableObjectState, private readonly env: CostEnv) {}
  fetch(request: Request): Promise<Response> {
    return this.state.blockConcurrencyWhile(async () => {
      const input = await request.json() as { kind?: string; bytes?: number };
      const day = new Date().toISOString().slice(0, 10), month = day.slice(0, 7);
      const previous = await this.state.storage.get<Counters>('budget');
      const current: Counters = { day, month, dailyAi: 0, monthlyAi: 0, reservedCents: 0, dailyUploads: 0, monthlyUploads: 0, lifetimeBytes: 0, dailyMedia: 0, monthlyMedia: 0, ...previous };
      if (current.day !== day) Object.assign(current, { day, dailyAi: 0, dailyUploads: 0, dailyMedia: 0 });
      if (current.month !== month) Object.assign(current, { month, monthlyAi: 0, reservedCents: 0, monthlyUploads: 0, monthlyMedia: 0 });
      const deny = (code: string) => Response.json({ code }, { status: 429 });
      if (input.kind === 'ai') {
        const budget = positiveInt(this.env.AI_MONTHLY_BUDGET_CENTS, 100_000);
        if (this.env.AI_ENABLED !== 'true' || budget === 0) return deny('ai_disabled');
        if (current.dailyAi >= positiveInt(this.env.AI_DAILY_REQUEST_LIMIT, 1000)
          || current.monthlyAi >= positiveInt(this.env.AI_MONTHLY_REQUEST_LIMIT, 10_000)
          || current.reservedCents + AI_RESERVATION_CENTS > budget) return deny('budget');
        current.dailyAi++; current.monthlyAi++; current.reservedCents += AI_RESERVATION_CENTS;
      } else if (input.kind === 'upload') {
        if (!Number.isSafeInteger(input.bytes) || input.bytes! <= 0 || input.bytes! > 5 * 1024 * 1024) return new Response(null, { status: 400 });
        // Lifetime high-water cap also bounds orphaned uploads. Deletions do not refund it.
        if (current.dailyUploads >= 100 || current.monthlyUploads >= 1000 || current.lifetimeBytes + input.bytes! > 5 * 1024 ** 3) return deny('storage');
        current.dailyUploads++; current.monthlyUploads++; current.lifetimeBytes += input.bytes!;
      } else if (input.kind === 'media') {
        if (current.dailyMedia >= 5000 || current.monthlyMedia >= 100_000) return deny('media');
        current.dailyMedia++; current.monthlyMedia++;
      } else return new Response(null, { status: 400 });
      await this.state.storage.put('budget', current);
      return Response.json({ ok: true });
    });
  }
}
