import { fetchPlan, type Plan } from './subscriptions';
import { createWardrobe, wardrobeCount } from './wardrobeCreate';
import { HttpError } from './security';
import type { Env } from './index';
const COOLDOWN_MS = 8_000;
const DEFAULT_DAILY_LIMIT = 25;
const LEASE_MS = 60_000;
const FORCE_PLAN_MIN_MS = 5_000;
const CAPACITY_CACHE_MS = 30_000;
const DEFAULT_UPLOAD_USER_DAILY = 10;
const UPLOAD_USER_DAILY_BYTES = 50 * 1024 ** 2;
type Usage = { date: string; count: number; lastRequestAt: number; pending?: { id: string; freeTrial?: boolean } };
type Input = { requestId?: string; authTime?: number; bytes?: number; uid?: string; force?: boolean; feature?: string; wardrobe?: unknown; name?: string; max?: number; windowMs?: number };

function numberVar(value: string | undefined, fallback: number, ceiling: number): number {
  if (value === undefined || value === '' || !/^\d+$/.test(value)) return fallback;
  const number = Number(value);
  return Number.isSafeInteger(number) && number <= ceiling ? number : fallback;
}

/**
 * Charge attempts before dispatch. Timeouts and failed completions may still be billed.
 * Counter / lock state is mutated only inside blockConcurrencyWhile. Network calls (Firebase admin token,
 * RevenueCat, Firestore) run OUTSIDE it, serialised per user by an in-memory promise chain, so a slow upstream can
 * never trigger the Durable Object input-gate timeout / reset.
 */
export class RateLimiter {
  private chain: Promise<unknown> = Promise.resolve();
  constructor(private readonly state: DurableObjectState, private readonly env: Env) {}

  private locked<T>(task: () => Promise<T>): Promise<T> {
    const run = this.chain.then(task, task);
    this.chain = run.catch(() => undefined);
    return run;
  }
  private gate<T>(task: () => Promise<T>): Promise<T> { return this.state.blockConcurrencyWhile(task); }

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    const input = await request.json().catch(() => ({})) as Input;
    if (path === '/plan' || path === '/wardrobe-create' || path === '/wardrobe-capacity') return this.networkPath(path, input);
    if (path === '/reserve') return this.reserve(input);
    return this.gate(() => this.counters(path, input));
  }

  private async networkPath(path: string, input: Input): Promise<Response> {
    if (await this.gate(() => this.state.storage.get('deleting'))) return new Response(null, { status: 403 });
    if (!input.uid) return new Response(null, { status: 400 });
    const uid = input.uid;
    // wardrobe-create is serialised per user so free-tier creations cannot race past the 50-item limit.
    return this.locked(async () => {
      try {
        const plan = await this.plan(uid, input.force === true);
        if (path === '/wardrobe-create') {
          const created = await createWardrobe(this.env, uid, input.wardrobe, plan.pro);
          await this.gate(() => this.state.storage.delete('capacity'));
          return Response.json(created);
        }
        if (path === '/wardrobe-capacity') {
          const cached = await this.gate(() => this.state.storage.get<{ count: number; at: number }>('capacity'));
          let count: number;
          if (cached && Date.now() - cached.at < CAPACITY_CACHE_MS && cached.at <= Date.now()) count = cached.count;
          else {
            count = await wardrobeCount(this.env, uid);
            await this.gate(() => this.state.storage.put('capacity', { count, at: Date.now() }));
          }
          return Response.json({ canAdd: plan.pro || count < 50, count, limit: plan.pro ? null : 50, pro: plan.pro });
        }
        const used = await this.gate(() => this.state.storage.get<number>('freeChatsUsed')) ?? 0;
        return Response.json({ ...plan, freeChatsRemaining: Math.max(0, 3 - used) });
      } catch (error) { return this.failure(error); }
    });
  }

  private async reserve(input: Input): Promise<Response> {
    const dailyLimit = numberVar(this.env?.AI_USER_DAILY_LIMIT, DEFAULT_DAILY_LIMIT, 10_000);
    const precheck = await this.gate(async () => {
      if (await this.state.storage.get('deleting')) return new Response(null, { status: 403 });
      return this.reserveCheck(dailyLimit);
    });
    if (precheck) return precheck;
    // Plan lookup (RevenueCat) happens outside the gate; state is re-validated inside the second gate below.
    let plan: Plan | undefined;
    if (input.feature) {
      if (!input.uid) return new Response(null, { status: 400 });
      try { plan = await this.plan(input.uid); } catch (error) { return this.failure(error); }
    }
    return this.gate(async () => {
      if (await this.state.storage.get('deleting')) return new Response(null, { status: 403 });
      const denied = await this.reserveCheck(dailyLimit);
      if (denied) return denied;
      const stored = await this.state.storage.get<Usage>('usage');
      const now = Date.now();
      const today = new Date(now).toISOString().slice(0, 10);
      const count = stored?.date === today ? stored.count : 0;
      let freeTrial = false;
      if (plan) {
        if (!plan.pro && input.feature === 'analysis') return Response.json({ code: 'pro_required', error: 'Otomatik fotoğraf analizi Ne Giysem Pro ile kullanılabilir.' }, { status: 403 });
        freeTrial = !plan.pro;
        const used = await this.state.storage.get<number>('freeChatsUsed') ?? 0;
        if (freeTrial && used >= 3) return Response.json({ code: 'trial_exhausted', error: 'Üç ücretsiz sohbet hakkın bitti. Devam etmek için Ne Giysem Pro’ya geç.' }, { status: 403 });
        if (freeTrial) await this.state.storage.put('freeChatsUsed', used + 1);
      }
      const id = crypto.randomUUID();
      await this.state.storage.put<Usage>('usage', { date: today, count: count + 1, lastRequestAt: now, pending: { id, freeTrial } });
      return Response.json({ requestId: id });
    });
  }

  /** Daily + cooldown check; returns a denial response or undefined. Storage only. */
  private async reserveCheck(dailyLimit: number): Promise<Response | undefined> {
    const stored = await this.state.storage.get<Usage>('usage');
    const now = Date.now();
    const today = new Date(now).toISOString().slice(0, 10);
    const count = stored?.date === today ? stored.count : 0;
    if (count >= dailyLimit) return Response.json({ code: 'daily' }, { status: 429 });
    const remaining = (stored?.pending ? LEASE_MS : COOLDOWN_MS) - (now - (stored?.lastRequestAt ?? 0));
    if (remaining > 0) return Response.json({ code: 'cooldown', waitSeconds: Math.ceil(remaining / 1000) }, { status: 429 });
    return undefined;
  }

  private async counters(path: string, input: Input): Promise<Response> {
    if (path === '/apple-status') return new Response(null, { status: await this.state.storage.get('appleRevoked') === input.authTime ? 200 : 404 });
    if (path === '/apple-revoked') { await this.state.storage.put('appleRevoked', input.authTime); return Response.json({ ok: true }); }
    if (path === '/purge-personal') {
      await this.state.storage.delete(['usage', 'uploads', 'freeChatsUsed', 'plan', 'capacity', 'limits']);
      return Response.json({ ok: true });
    }
    if (path === '/deleting') { await this.state.storage.put('deleting', true); return Response.json({ ok: true }); }
    if (await this.state.storage.get('deleting')) return new Response(null, { status: 403 });
    if (path === '/status') return Response.json({ ok: true });
    const now = Date.now();
    const today = new Date(now).toISOString().slice(0, 10);
    if (path === '/limit') {
      // Generic fixed-window counter (per user, or per hashed client IP for /media/).
      const max = Number(input.max), windowMs = Number(input.windowMs);
      if (!input.name || !/^[a-z-]{1,32}$/.test(input.name) || !Number.isSafeInteger(max) || max < 1 || !Number.isSafeInteger(windowMs) || windowMs < 1000) return new Response(null, { status: 400 });
      const all = await this.state.storage.get<Record<string, { start: number; count: number }>>('limits') ?? {};
      const entry = all[input.name];
      const fresh = !entry || now - entry.start >= windowMs || entry.start > now;
      const count = fresh ? 0 : entry.count;
      const start = fresh ? now : entry.start;
      if (count >= max) return Response.json({ code: 'cooldown', waitSeconds: Math.max(1, Math.ceil((start + windowMs - now) / 1000)) }, { status: 429 });
      await this.state.storage.put('limits', { ...all, [input.name]: { start, count: count + 1 } });
      return Response.json({ ok: true });
    }
    if (path === '/upload') {
      const usage = await this.state.storage.get<{ day: string; count: number; at: number; bytes: number }>('uploads');
      const count = usage?.day === today ? usage.count : 0;
      const bytes = usage?.day === today ? usage.bytes ?? 0 : 0;
      if (!Number.isSafeInteger(input.bytes) || input.bytes! <= 0 || input.bytes! > 5 * 1024 ** 2) return new Response(null, { status: 400 });
      if (count >= numberVar(this.env?.UPLOAD_USER_DAILY_LIMIT, DEFAULT_UPLOAD_USER_DAILY, 10_000) || bytes + input.bytes! > UPLOAD_USER_DAILY_BYTES || now - (usage?.at ?? 0) < 3000) return new Response(null, { status: 429 });
      await this.state.storage.put('uploads', { day: today, count: count + 1, at: now, bytes: bytes + input.bytes! });
      return Response.json({ ok: true });
    }
    const stored = await this.state.storage.get<Usage>('usage');
    if (path !== '/success' && path !== '/failure') return new Response(null, { status: 404 });
    if (!input.requestId || stored?.pending?.id !== input.requestId) return new Response(null, { status: 409 });
    if (path === '/failure' && stored.pending.freeTrial) await this.state.storage.put('freeChatsUsed', Math.max(0, (await this.state.storage.get<number>('freeChatsUsed') ?? 0) - 1));
    await this.state.storage.put<Usage>('usage', { date: stored.date, count: stored.count, lastRequestAt: stored.lastRequestAt });
    return Response.json({ ok: true });
  }

  private failure(error: unknown) {
    // Only deliberate, user-safe HttpError texts reach the client; anything else is logged and replaced.
    if (error instanceof HttpError && error.status < 500) return Response.json({ error: error.message, code: error.code }, { status: error.status });
    console.error('RateLimiter operation failed', { status: error instanceof HttpError ? error.status : undefined, name: error instanceof Error ? error.name : 'unknown' });
    return Response.json({ error: 'İşlem şu anda doğrulanamadı. Biraz sonra yeniden dene.', code: error instanceof HttpError ? error.code : undefined }, { status: 503 });
  }

  private planInflight?: Promise<Plan>;
  private async plan(uid: string, force = false): Promise<Plan> {
    const stored = await this.gate(() => this.state.storage.get<{ plan: Plan; at: number }>('plan'));
    const age = Date.now() - (stored?.at ?? 0);
    // Forced refresh is honoured at most every 30 s per user; otherwise the 60 s cache is served.
    if (stored && age >= 0 && age < (force ? FORCE_PLAN_MIN_MS : 60000) && (!stored.plan.pro || stored.plan.expiresAt > Date.now())) return stored.plan;
    if (!this.planInflight) {
      this.planInflight = fetchPlan(uid, this.env).then(async (plan) => {
        await this.gate(() => this.state.storage.put('plan', { plan, at: Date.now() }));
        return plan;
      }).finally(() => { this.planInflight = undefined; });
    }
    return this.planInflight;
  }
}
export const RATE_LIMIT_CONSTANTS = { COOLDOWN_MS, DAILY_LIMIT: DEFAULT_DAILY_LIMIT, LEASE_MS } as const;
