import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { ExactEvmScheme, toClientEvmSigner } from "@x402/evm";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { config } from "./config";

/**
 * The Telegraph node client. Paid calls answer the node's 402 challenge with an EIP-3009
 * USDC authorisation signed by the app's payer key; discovery and verification are free.
 */
export const BASE_SEPOLIA = "eip155:84532" as const;
export const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;
/** The node's fee collector on Base Sepolia (the Telegraph Diamond). */
export const TELEGRAPH_COLLECTOR = "0x5a2324aA18613FAD4e44bDF0d6c73Ec1f6D87ff8" as const;

export type NodeErrorKind = "unpaid" | "timeout" | "node" | "network";

export class NodeError extends Error {
  constructor(
    message: string,
    readonly kind: NodeErrorKind,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "NodeError";
  }
}

export interface Settlement {
  success: boolean;
  txHash: string | null;
  payer: string | null;
  errorReason: string | null;
}

export interface EngineResponse {
  miner_id?: string | number;
  miner_name?: string;
  endpoint?: string;
  result?: unknown;
  cost_usd?: number;
  duration_ms?: number;
  timestamp?: string;
  reasoning?: string;
  intent?: string;
  signal_hash?: string;
  warnings?: string[];
  /** From the payment-response header; the JSON body never carries it. */
  settlement?: Settlement | null;
}

export interface DirectRequest {
  method: "GET" | "POST";
  endpoint: string;
  payload: Record<string, unknown>;
}

function nodeUrl(): string {
  return config().TELEGRAPH_NODE.replace(/\/+$/, "");
}

export function payerAddress(): `0x${string}` | null {
  const pk = config().PAYER_PRIVATE_KEY;
  if (!pk) return null;
  try {
    return privateKeyToAccount(pk as `0x${string}`).address;
  } catch {
    return null;
  }
}

/** The node's payment-response header: base64 JSON, present on success and on refusal. */
export function decodeSettlement(header: string | null): Settlement | null {
  if (!header) return null;
  try {
    const j = JSON.parse(Buffer.from(header, "base64").toString("utf8")) as {
      success?: boolean;
      transaction?: string;
      payer?: string;
      errorReason?: string;
    };
    return {
      success: j.success === true,
      txHash: j.transaction && /^0x[0-9a-fA-F]{64}$/.test(j.transaction) ? j.transaction : null,
      payer: j.payer ?? null,
      errorReason: j.errorReason ?? null,
    };
  } catch {
    return null;
  }
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
let paying: Fetcher | null = null;

function payingFetch(): Fetcher {
  if (paying) return paying;
  const pk = config().PAYER_PRIVATE_KEY;
  if (!pk) throw new NodeError("No payer wallet is configured.", "unpaid");
  const account = privateKeyToAccount(pk as `0x${string}`);
  const signer = toClientEvmSigner(account);
  const client = x402Client.fromConfig({
    schemes: [{ network: BASE_SEPOLIA, client: new ExactEvmScheme(signer) }],
  });
  // Build the Request before the payment wrapper clones it for the paid retry. On a
  // serverless runtime the (url, init) form lost its headers and body on the second
  // attempt, and the node answered the retry with a bare challenge.
  const materialised: typeof globalThis.fetch = (input, init) => globalThis.fetch(new Request(input as RequestInfo, init));
  paying = wrapFetchWithPayment(materialised, client);
  return paying;
}

function snippet(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 240);
}

async function paidPost(path: string, body: unknown, timeoutMs: number): Promise<EngineResponse> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await payingFetch()(`${nodeUrl()}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    const text = await res.text();
    const settlement = decodeSettlement(res.headers.get("payment-response") ?? res.headers.get("x-payment-response"));
    if (res.status === 402) {
      throw new NodeError(
        settlement?.errorReason ? `The node refused the payment: ${settlement.errorReason}` : `Payment was not accepted: ${snippet(text)}`,
        "unpaid",
        402,
      );
    }
    if (res.status === 422) throw new NodeError(`The node predicted this request would fail: ${snippet(text)}`, "node", 422);
    if (!res.ok) throw new NodeError(`The node answered ${res.status}: ${snippet(text)}`, "node", res.status);
    let parsed: EngineResponse;
    try {
      parsed = JSON.parse(text) as EngineResponse;
    } catch {
      throw new NodeError(`The node returned something that is not JSON: ${snippet(text)}`, "node", res.status);
    }
    if (typeof parsed.duration_ms !== "number") parsed.duration_ms = Date.now() - started;
    parsed.settlement = settlement;
    return parsed;
  } catch (e) {
    if (e instanceof NodeError) throw e;
    const err = e as Error;
    if (err.name === "AbortError" || /aborted/i.test(err.message)) {
      throw new NodeError(`No answer within ${Math.round(timeoutMs / 1000)}s.`, "timeout");
    }
    if (/payment|scheme|signer|sign|spend|insufficient|authoriz|facilitator/i.test(err.message)) {
      throw new NodeError(`Could not construct a payment: ${snippet(err.message)}`, "unpaid");
    }
    throw new NodeError(`Could not reach the Telegraph node: ${snippet(err.message)}`, "network");
  } finally {
    clearTimeout(timer);
  }
}

/** Telegraph's own router: an LLM classifies the intent and picks a ranked miner. */
export function askRouted(query: string, timeoutMs = config().ROUTER_TIMEOUT_MS): Promise<EngineResponse> {
  return paidPost("/engine/v1/ask", { query }, timeoutMs);
}

/** Direct dispatch to one miner's endpoint, the way the organisers' reference apps do it. */
export function askDirect(minerId: string, req: DirectRequest, timeoutMs = config().CALL_TIMEOUT_MS): Promise<EngineResponse> {
  return paidPost(`/engine/v1/ask/${encodeURIComponent(minerId)}`, req, timeoutMs);
}

// ---------------------------------------------------------------------------
// Free endpoints: challenge, catalogue, signal record, balance.

export interface Challenge {
  status: number;
  accepts: Array<{ scheme?: string; network?: string; asset?: string; amount?: string; payTo?: string; maxTimeoutSeconds?: number }>;
}

/** Fetch the node's 402 challenge without paying. Costs nothing and engages no miner. */
export async function fetchChallenge(): Promise<Challenge> {
  const res = await fetch(`${nodeUrl()}/engine/v1/ask`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: "ping" }),
    signal: AbortSignal.timeout(20_000),
  });
  const header = res.headers.get("payment-required");
  let accepts: Challenge["accepts"] = [];
  if (header) {
    try {
      accepts = (JSON.parse(Buffer.from(header, "base64").toString("utf8")) as { accepts?: Challenge["accepts"] }).accepts ?? [];
    } catch {
      accepts = [];
    }
  }
  return { status: res.status, accepts };
}

async function freeJson<T>(path: string, timeoutMs = 20_000): Promise<T> {
  const res = await fetch(`${nodeUrl()}${path}`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new NodeError(`${path} returned ${res.status}`, "network", res.status);
  return (await res.json()) as T;
}

export interface SignalMapping {
  confidence_field?: string | null;
  label_field?: string | null;
  reason_field?: string | null;
}

export interface MinerEndpoint {
  path: string;
  method?: string;
  description?: string;
}

export interface MinerScore {
  intent_id: string;
  epoch_id?: number;
  rank: number;
  score: number;
}

export interface Miner {
  id: string;
  slug: string;
  name?: string;
  base_url?: string;
  supported_intents?: string[];
  signal_mapping?: SignalMapping | null;
  scores?: MinerScore[];
  endpoints?: MinerEndpoint[];
  input_schema?: { properties?: Record<string, unknown>; required?: string[] } | null;
  activation_status?: string;
  /** Micro-USDC: 10000 is $0.01. */
  min_price_usdc?: number;
  total_requests_served?: number;
}

const byIntent = new Map<string, { at: number; miners: Miner[] }>();
let everyMiner: { at: number; miners: Miner[] } | null = null;

function normalise(body: unknown): Miner[] {
  const list = (Array.isArray(body) ? body : ((body as { miners?: Miner[] }).miners ?? [])) as Miner[];
  return list.map((m) => ({ ...m, id: String(m.id) }));
}

export async function minersForIntent(intent: string): Promise<Miner[]> {
  const hit = byIntent.get(intent);
  if (hit && Date.now() - hit.at < 120_000) return hit.miners;
  const miners = normalise(await freeJson<unknown>(`/api/miners?intent=${encodeURIComponent(intent)}&status=active&limit=200`, 25_000));
  byIntent.set(intent, { at: Date.now(), miners });
  return miners;
}

export async function allMiners(): Promise<Miner[]> {
  if (everyMiner && Date.now() - everyMiner.at < 300_000) return everyMiner.miners;
  const miners = normalise(await freeJson<unknown>("/api/miners?status=active&limit=500", 30_000));
  everyMiner = { at: Date.now(), miners };
  return miners;
}

export function rankOf(miner: Miner | null, intent: string | null): number | null {
  if (!miner || !intent) return null;
  return miner.scores?.find((s) => s.intent_id === intent)?.rank ?? null;
}

export function priceUsdc(miner: Miner): number {
  return typeof miner.min_price_usdc === "number" ? miner.min_price_usdc / 1e6 : 0.01;
}

export interface Ranked {
  miner: Miner;
  rank: number | null;
  score: number | null;
}

/** Active miners serving `intent`, best rank first, within the price cap. Unscored miners last. */
export async function rankedFor(intent: string, maxPriceUsdc = config().MAX_CALL_PRICE_USDC): Promise<Ranked[]> {
  const miners = await minersForIntent(intent);
  return miners
    .filter((m) => (m.activation_status ?? "active") === "active")
    .filter((m) => (m.supported_intents ?? []).includes(intent))
    .filter((m) => priceUsdc(m) <= maxPriceUsdc)
    .filter((m) => !/^https?:\/\/(127\.|localhost|0\.0\.0\.0)/i.test(m.base_url ?? ""))
    .map((m) => {
      const s = m.scores?.find((x) => x.intent_id === intent);
      return { miner: m, rank: s?.rank ?? null, score: s?.score ?? null };
    })
    .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));
}

/** The router names a miner by display name and catalogue id; resolve by id first. */
export async function resolveMiner(ref: { id?: string | number | null; name?: string | null }): Promise<Miner | null> {
  const miners = await allMiners();
  if (ref.id !== null && ref.id !== undefined) {
    const s = String(ref.id);
    const hit = miners.find((m) => m.id === s);
    if (hit) return hit;
  }
  if (!ref.name) return null;
  return miners.find((m) => m.slug === ref.name) ?? miners.find((m) => m.name === ref.name) ?? null;
}

export interface SignalRecord {
  signal_hash?: string;
  kind?: string;
  signal?: { wallet_address?: string; miner_slug?: string; subnet_id?: string; tx_hash?: string; created_at?: string };
  payload?: unknown;
  result?: unknown;
  verification?: { algorithm?: string; commitment?: string; verified?: boolean };
}

export function verifySignal(hash: string): Promise<SignalRecord> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new NodeError("Not a signal hash.", "node", 400);
  return freeJson<SignalRecord>(`/engine/v1/signal/${hash}`);
}

/** USDC balance of the payer, read from the chain over a public RPC. Free. */
export async function payerUsdcBalance(): Promise<number | null> {
  const addr = payerAddress();
  if (!addr) return null;
  try {
    const client = createPublicClient({ chain: baseSepolia, transport: http() });
    const raw = (await client.readContract({
      address: USDC_BASE_SEPOLIA,
      abi: [
        {
          name: "balanceOf",
          type: "function",
          stateMutability: "view",
          inputs: [{ name: "a", type: "address" }],
          outputs: [{ type: "uint256" }],
        },
      ],
      functionName: "balanceOf",
      args: [addr],
    })) as bigint;
    return Number(raw) / 1e6;
  } catch {
    return null;
  }
}
