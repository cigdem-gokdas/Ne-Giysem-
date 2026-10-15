import { fetchPlan, type Plan } from './subscriptions';
import { createWardrobe, wardrobeCount } from './wardrobeCreate';
import { HttpError } from './security';
import type { Env } from './index';
const COOLDOWN_MS = 8_000;
const DAILY_LIMIT = 25;
const LEASE_MS = 60_000;
type Usage = { date: string; count: number; lastRequestAt: number; pending?: { id: string; freeTrial?: boolean } };

/** Charge attempts before dispatch. Timeouts and failed completions may still be billed. */
export class RateLimiter {
  constructor(private readonly state: DurableObjectState, private readonly env: Env) {}
  fetch(request: Request): Promise<Response> {
    return this.state.blockConcurrencyWhile(async () => {
      const path = new URL(request.url).pathname;
      const input = await request.json().catch(() => ({})) as { requestId?: string; authTime?: number; bytes?: number; uid?: string; force?: boolean; feature?: string; wardrobe?: unknown };
      if (path === '/apple-status') return new Response(null, { status: await this.state.storage.get('appleRevoked') === input.authTime ? 200 : 404 });
      if (path === '/apple-revoked') { await this.state.storage.put('appleRevoked', input.authTime); return Response.json({ ok: true }); }
      if (path === '/purge-personal') {
        await this.state.storage.delete(['usage', 'uploads', 'freeChatsUsed', 'plan']);
        return Response.json({ ok: true });
      }
      if (path === '/deleting') { await this.state.storage.put('deleting', true); return Response.json({ ok: true }); }
      if (await this.state.storage.get('deleting')) return new Response(null, { status: 403 });
      if (path === '/plan' || path === '/wardrobe-create' || path === '/wardrobe-capacity') {
        if (!input.uid) return new Response(null, { status: 400 });
        try {
          const plan = await this.plan(input.uid, input.force === true);
          if (path === '/wardrobe-create') return Response.json(await createWardrobe(this.env, input.uid, input.wardrobe, plan.pro));
          if (path === '/wardrobe-capacity') {
            const count = await wardrobeCount(this.env, input.uid);
            return Response.json({ canAdd: plan.pro || count < 50, count, limit: plan.pro ? null : 50, pro: plan.pro });
          }
          return Response.json({ ...plan, freeChatsRemaining: Math.max(0, 3 - (await this.state.storage.get<number>('freeChatsUsed') ?? 0)) });
        } catch (error) { return this.failure(error); }
      }
      if (path === '/status') return Response.json({ ok: true });
      const stored = await this.state.storage.get<Usage>('usage');
      const now = Date.now();
      const today = new Date(now).toISOString().slice(0, 10);
      if (path === '/upload') {
        const usage = await this.state.storage.get<{ day: string; count: number; at: number; bytes: number }>('uploads');
        const count = usage?.day === today ? usage.count : 0;
        if (!Number.isSafeInteger(input.bytes) || input.bytes! <= 0 || input.bytes! > 5 * 1024 ** 2) return new Response(null, { status: 400 });
        if (count >= 10 || now - (usage?.at ?? 0) < 3000) return new Response(null, { status: 429 });
        await this.state.storage.put('uploads', { day: today, count: count + 1, at: now, bytes: (usage?.bytes ?? 0) + input.bytes! });
        return Response.json({ ok: true });
      }
      if (path === '/reserve') {
        const count = stored?.date === today ? stored.count : 0;
        if (count >= DAILY_LIMIT) return Response.json({ code: 'daily' }, { status: 429 });
        const remaining = (stored?.pending ? LEASE_MS : COOLDOWN_MS) - (now - (stored?.lastRequestAt ?? 0));
        if (remaining > 0) return Response.json({ code: 'cooldown', waitSeconds: Math.ceil(remaining / 1000) }, { status: 429 });
        let freeTrial = false;
        if (input.feature) {
          if (!input.uid) return new Response(null, { status: 400 });
          let plan: Plan;
          try { plan = await this.plan(input.uid); } catch (error) { return this.failure(error); }
          if (!plan.pro && input.feature === 'analysis') return Response.json({ code: 'pro_required', error: 'Otomatik fotoğraf analizi Ne Giysem Pro ile kullanılabilir.' }, { status: 403 });
          freeTrial = !plan.pro;
          const used = await this.state.storage.get<number>('freeChatsUsed') ?? 0;
          if (freeTrial && used >= 3) return Response.json({ code: 'trial_exhausted', error: 'Üç ücretsiz sohbet hakkın bitti. Devam etmek için Ne Giysem Pro’ya geç.' }, { status: 403 });
          if (freeTrial) await this.state.storage.put('freeChatsUsed', used + 1);
        }
        const id = crypto.randomUUID();
        await this.state.storage.put<Usage>('usage', { date: today, count: count + 1, lastRequestAt: now, pending: { id, freeTrial } });
        return Response.json({ requestId: id });
      }
      if (path !== '/success' && path !== '/failure') return new Response(null, { status: 404 });
      if (!input.requestId || stored?.pending?.id !== input.requestId) return new Response(null, { status: 409 });
      if (path === '/failure' && stored.pending.freeTrial) await this.state.storage.put('freeChatsUsed', Math.max(0, (await this.state.storage.get<number>('freeChatsUsed') ?? 0) - 1));
      await this.state.storage.put<Usage>('usage', { date: stored.date, count: stored.count, lastRequestAt: stored.lastRequestAt });
      return Response.json({ ok: true });
    });
  }
  private failure(error: unknown) {
    return Response.json({ error: error instanceof HttpError ? error.message : 'İşlem doğrulanamadı.', code: error instanceof HttpError ? error.code : undefined }, { status: error instanceof HttpError ? error.status : 503 });
  }
  private async plan(uid: string, force = false): Promise<Plan> {
    const stored = await this.state.storage.get<{ plan: Plan; at: number }>('plan');
    const age = Date.now() - (stored?.at ?? 0);
    if (stored && age < (force ? 5000 : 60000) && (!stored.plan.pro || stored.plan.expiresAt > Date.now())) return stored.plan;
    const plan = await fetchPlan(uid, this.env);
    await this.state.storage.put('plan', { plan, at: Date.now() });
    return plan;
  }
}
export const RATE_LIMIT_CONSTANTS = { COOLDOWN_MS, DAILY_LIMIT, LEASE_MS } as const;
