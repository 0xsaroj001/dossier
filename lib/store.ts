import { Redis } from "@upstash/redis";
import { redisCredentials, utcDay } from "./config";
import type { Dossier, LedgerRow, Stats } from "./types";

/**
 * Everything the app remembers: the public ledger of calls, dossiers for sharing, spend
 * counters and distinct-visitor sets. Redis when configured, memory otherwise.
 */
export interface Store {
  kind: "memory" | "redis";
  addRow(row: LedgerRow): Promise<void>;
  rows(limit: number): Promise<LedgerRow[]>;
  stats(): Promise<Stats>;
  visitorCalls(hash: string, day: string): Promise<number>;
  incrVisitor(hash: string, day: string): Promise<number>;
  budgetUsed(day: string): Promise<number>;
  incrBudget(day: string): Promise<number>;
  saveDossier(d: Dossier): Promise<void>;
  getDossier(id: string): Promise<Dossier | null>;
  recentDossiers(limit: number): Promise<Dossier[]>;
  knownSignal(hash: string): Promise<boolean>;
}

const LEDGER_CAP = 2000;

class MemoryStore implements Store {
  kind = "memory" as const;
  private ledger: LedgerRow[] = [];
  private counters = new Map<string, number>();
  private sets = new Map<string, Set<string>>();
  private dossiers = new Map<string, Dossier>();
  private order: string[] = [];

  private bump(key: string, by = 1): number {
    const v = (this.counters.get(key) ?? 0) + by;
    this.counters.set(key, v);
    return v;
  }

  private add(key: string, member: string): void {
    const s = this.sets.get(key) ?? new Set<string>();
    s.add(member);
    this.sets.set(key, s);
  }

  async addRow(row: LedgerRow): Promise<void> {
    this.ledger.unshift(row);
    if (this.ledger.length > LEDGER_CAP) this.ledger.length = LEDGER_CAP;
    this.bump("calls");
    this.bump(`calls:${row.day}`);
    if (row.status === "ok") this.bump("calls:ok");
    if (row.costUsd) this.bump("cost", row.costUsd);
    this.bump(`intent:${row.intent}`);
    this.add("users:all", row.visitor);
    this.add(`users:${row.day}`, row.visitor);
    if (row.signalHash) this.add("signals", row.signalHash);
  }

  async rows(limit: number): Promise<LedgerRow[]> {
    return this.ledger.slice(0, limit);
  }

  async stats(): Promise<Stats> {
    const day = utcDay();
    const intents: Record<string, number> = {};
    for (const [k, v] of this.counters) if (k.startsWith("intent:")) intents[k.slice(7)] = v;
    return {
      calls: this.counters.get("calls") ?? 0,
      okCalls: this.counters.get("calls:ok") ?? 0,
      callsToday: this.counters.get(`calls:${day}`) ?? 0,
      costUsd: Number((this.counters.get("cost") ?? 0).toFixed(4)),
      usersAll: this.sets.get("users:all")?.size ?? 0,
      usersToday: this.sets.get(`users:${day}`)?.size ?? 0,
      intents,
      dossiers: this.dossiers.size,
    };
  }

  async visitorCalls(hash: string, day: string): Promise<number> {
    return this.counters.get(`visitor:${hash}:${day}`) ?? 0;
  }

  async incrVisitor(hash: string, day: string): Promise<number> {
    return this.bump(`visitor:${hash}:${day}`);
  }

  async budgetUsed(day: string): Promise<number> {
    return this.counters.get(`budget:${day}`) ?? 0;
  }

  async incrBudget(day: string): Promise<number> {
    return this.bump(`budget:${day}`);
  }

  async saveDossier(d: Dossier): Promise<void> {
    this.dossiers.set(d.id, d);
    this.order.unshift(d.id);
    if (this.order.length > 500) {
      const dropped = this.order.splice(500);
      for (const id of dropped) this.dossiers.delete(id);
    }
  }

  async getDossier(id: string): Promise<Dossier | null> {
    return this.dossiers.get(id) ?? null;
  }

  async recentDossiers(limit: number): Promise<Dossier[]> {
    return this.order.slice(0, limit).map((id) => this.dossiers.get(id)).filter((d): d is Dossier => Boolean(d));
  }

  async knownSignal(hash: string): Promise<boolean> {
    return this.sets.get("signals")?.has(hash) ?? false;
  }
}

const K = (s: string) => `dz:${s}`;
const DAY_TTL = 3 * 24 * 3600;
const DOSSIER_TTL = 90 * 24 * 3600;

class RedisStore implements Store {
  kind = "redis" as const;
  constructor(private readonly r: Redis) {}

  async addRow(row: LedgerRow): Promise<void> {
    const p = this.r.pipeline();
    p.lpush(K("ledger"), JSON.stringify(row));
    p.ltrim(K("ledger"), 0, LEDGER_CAP - 1);
    p.incr(K("calls"));
    p.incr(K(`calls:${row.day}`));
    p.expire(K(`calls:${row.day}`), DAY_TTL);
    if (row.status === "ok") p.incr(K("calls:ok"));
    if (row.costUsd) p.incrbyfloat(K("cost"), row.costUsd);
    p.hincrby(K("intents"), row.intent, 1);
    p.sadd(K("users:all"), row.visitor);
    p.sadd(K(`users:${row.day}`), row.visitor);
    p.expire(K(`users:${row.day}`), DAY_TTL);
    if (row.signalHash) p.sadd(K("signals"), row.signalHash);
    await p.exec();
  }

  async rows(limit: number): Promise<LedgerRow[]> {
    const raw = await this.r.lrange<string | LedgerRow>(K("ledger"), 0, Math.max(0, limit - 1));
    return raw.map((x) => (typeof x === "string" ? (JSON.parse(x) as LedgerRow) : x));
  }

  async stats(): Promise<Stats> {
    const day = utcDay();
    const [calls, ok, today, cost, usersAll, usersToday, intents, dossiers] = await Promise.all([
      this.r.get<number>(K("calls")),
      this.r.get<number>(K("calls:ok")),
      this.r.get<number>(K(`calls:${day}`)),
      this.r.get<string | number>(K("cost")),
      this.r.scard(K("users:all")),
      this.r.scard(K(`users:${day}`)),
      this.r.hgetall<Record<string, number>>(K("intents")),
      this.r.llen(K("dossiers")),
    ]);
    return {
      calls: Number(calls ?? 0),
      okCalls: Number(ok ?? 0),
      callsToday: Number(today ?? 0),
      costUsd: Number(Number(cost ?? 0).toFixed(4)),
      usersAll: Number(usersAll ?? 0),
      usersToday: Number(usersToday ?? 0),
      intents: Object.fromEntries(Object.entries(intents ?? {}).map(([k, v]) => [k, Number(v)])),
      dossiers: Number(dossiers ?? 0),
    };
  }

  async visitorCalls(hash: string, day: string): Promise<number> {
    return Number((await this.r.get<number>(K(`visitor:${hash}:${day}`))) ?? 0);
  }

  async incrVisitor(hash: string, day: string): Promise<number> {
    const key = K(`visitor:${hash}:${day}`);
    const v = await this.r.incr(key);
    if (v === 1) await this.r.expire(key, DAY_TTL);
    return v;
  }

  async budgetUsed(day: string): Promise<number> {
    return Number((await this.r.get<number>(K(`budget:${day}`))) ?? 0);
  }

  async incrBudget(day: string): Promise<number> {
    const key = K(`budget:${day}`);
    const v = await this.r.incr(key);
    if (v === 1) await this.r.expire(key, DAY_TTL);
    return v;
  }

  async saveDossier(d: Dossier): Promise<void> {
    const p = this.r.pipeline();
    p.set(K(`dossier:${d.id}`), JSON.stringify(d), { ex: DOSSIER_TTL });
    p.lpush(K("dossiers"), d.id);
    p.ltrim(K("dossiers"), 0, 499);
    await p.exec();
  }

  async getDossier(id: string): Promise<Dossier | null> {
    const raw = await this.r.get<string | Dossier>(K(`dossier:${id}`));
    if (!raw) return null;
    return typeof raw === "string" ? (JSON.parse(raw) as Dossier) : raw;
  }

  async recentDossiers(limit: number): Promise<Dossier[]> {
    const ids = await this.r.lrange<string>(K("dossiers"), 0, Math.max(0, limit - 1));
    const out: Dossier[] = [];
    for (const id of ids) {
      const d = await this.getDossier(id);
      if (d) out.push(d);
    }
    return out;
  }

  async knownSignal(hash: string): Promise<boolean> {
    return Boolean(await this.r.sismember(K("signals"), hash));
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __dossierStore: Store | undefined;
}

export function getStore(): Store {
  if (globalThis.__dossierStore) return globalThis.__dossierStore;
  const creds = redisCredentials();
  const store: Store = creds ? new RedisStore(new Redis({ url: creds.url, token: creds.token })) : new MemoryStore();
  globalThis.__dossierStore = store;
  return store;
}

export function resetStoreForTests(): void {
  globalThis.__dossierStore = undefined;
}
