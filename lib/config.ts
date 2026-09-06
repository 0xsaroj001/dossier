import { z } from "zod";

/**
 * Environment, parsed once. Every spending knob defaults to off, so a deployment that
 * has not been given a budget cannot spend anything.
 */
const HEX64 = /^0x[0-9a-fA-F]{64}$/;

/** MetaMask exports a key as 64 bare hex characters; accept that and the 0x form. */
export function normalizePrivateKey(raw: string | undefined): `0x${string}` | undefined {
  const t = raw?.trim();
  if (!t) return undefined;
  const hex = t.replace(/^0x/i, "");
  return HEX64.test(`0x${hex}`) ? (`0x${hex.toLowerCase()}` as `0x${string}`) : undefined;
}

const flag = z
  .string()
  .default("false")
  .transform((v) => v === "true" || v === "1");

const schema = z.object({
  PAYER_PRIVATE_KEY: z.string().regex(HEX64).optional(),
  DAILY_CALL_BUDGET: z.coerce.number().int().min(0).default(0),
  VISITOR_DAILY_CALLS: z.coerce.number().int().min(0).default(64),
  MAX_CALL_PRICE_USDC: z.coerce.number().min(0).default(0.02),
  /** Comma-separated miner slugs the app must never call, whatever their rank. */
  MINER_BLOCKLIST: z
    .string()
    .default("")
    .transform((v) => v.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)),
  PAUSED: flag,
  VISITOR_SALT: z.string().min(1).default("dossier-dev-salt"),
  UPSTASH_REDIS_REST_URL: z.string().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
  KV_REST_API_URL: z.string().optional(),
  KV_REST_API_TOKEN: z.string().optional(),
  TELEGRAPH_NODE: z.string().default("https://devnode.telegraphprotocol.com"),
  PUBLIC_URL: z.string().optional(),
  ROUTER_TIMEOUT_MS: z.coerce.number().int().min(1000).default(25_000),
  CALL_TIMEOUT_MS: z.coerce.number().int().min(1000).default(45_000),
});

export type Config = z.infer<typeof schema>;

let cached: Config | null = null;
let problems: string[] = [];

export function config(): Config {
  if (cached) return cached;
  const env: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && v !== "") env[k] = v;
  const found: string[] = [];
  if (env["PAYER_PRIVATE_KEY"] !== undefined) {
    const key = normalizePrivateKey(String(env["PAYER_PRIVATE_KEY"]));
    if (key) env["PAYER_PRIVATE_KEY"] = key;
    else {
      delete env["PAYER_PRIVATE_KEY"];
      found.push("PAYER_PRIVATE_KEY is set but is not 64 hex characters; paid work stays off until it is fixed");
    }
  }
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`invalid environment: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  cached = parsed.data;
  problems = found;
  return cached;
}

/** Non-fatal environment problems, shown by /api/health. */
export function configProblems(): string[] {
  config();
  return problems;
}

export function resetConfigForTests(): void {
  cached = null;
  problems = [];
}

export function redisCredentials(c: Config = config()): { url: string; token: string } | null {
  const url = c.UPSTASH_REDIS_REST_URL ?? c.KV_REST_API_URL;
  const token = c.UPSTASH_REDIS_REST_TOKEN ?? c.KV_REST_API_TOKEN;
  return url && token ? { url, token } : null;
}

/** True when a paid call is possible at all: key present, budget above zero, not paused. */
export function paidWorkEnabled(c: Config = config()): boolean {
  return Boolean(c.PAYER_PRIVATE_KEY) && c.DAILY_CALL_BUDGET > 0 && !c.PAUSED;
}

export function utcDay(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}
