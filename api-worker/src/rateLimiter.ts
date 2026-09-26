const COOLDOWN_MS = 8_000;
const DAILY_LIMIT = 25;

type Usage = { date: string; count: number; lastRequestAt: number; pending?: Pending };
type Pending = { id: string; previousDate: string; previousCount: number; previousLastRequestAt: number };

function utcDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export class RateLimiter {
  constructor(private readonly state: DurableObjectState) {}

  fetch(request: Request): Promise<Response> {
    return this.state.blockConcurrencyWhile(async () => {
      const url = new URL(request.url);
      const input = await request.json().catch(() => ({})) as { requestId?: string };
      let stored = await this.state.storage.get<Usage>('usage');
      const now = Date.now();
      const today = utcDate(now);

      // Recover a reservation left behind by an interrupted Worker request.
      if (stored?.pending && now - stored.lastRequestAt > 35_000) {
        stored = { date: stored.pending.previousDate, count: stored.pending.previousCount, lastRequestAt: stored.pending.previousLastRequestAt };
        await this.state.storage.put('usage', stored);
      }

      if (url.pathname === '/reserve') {
        const count = stored?.date === today ? stored.count : 0;
        const lastRequestAt = stored?.lastRequestAt ?? 0;
        if (count >= DAILY_LIMIT) return json({ code: 'daily' }, 429);
        if (stored?.pending) return json({ code: 'cooldown', waitSeconds: 1 }, 429);
        const remaining = COOLDOWN_MS - (now - lastRequestAt);
        if (remaining > 0) return json({ code: 'cooldown', waitSeconds: Math.ceil(remaining / 1000) }, 429);
        const id = crypto.randomUUID();
        await this.state.storage.put<Usage>('usage', {
          date: today,
          count,
          lastRequestAt: now,
          pending: { id, previousDate: stored?.date ?? today, previousCount: stored?.count ?? 0, previousLastRequestAt: lastRequestAt },
        });
        return json({ requestId: id });
      }

      if (!input.requestId || stored?.pending?.id !== input.requestId) return json({ error: 'Geçersiz kota rezervasyonu.' }, 409);
      if (url.pathname === '/success') {
        await this.state.storage.put<Usage>('usage', { date: stored.date, count: stored.count + 1, lastRequestAt: stored.lastRequestAt });
        return json({ ok: true });
      }
      if (url.pathname === '/failure') {
        await this.state.storage.put<Usage>('usage', {
          date: stored.pending.previousDate,
          count: stored.pending.previousCount,
          lastRequestAt: stored.pending.previousLastRequestAt,
        });
        return json({ ok: true });
      }
      return json({ error: 'Bulunamadı.' }, 404);
    });
  }
}

export const RATE_LIMIT_CONSTANTS = { COOLDOWN_MS, DAILY_LIMIT } as const;
