import type { EngineResponse, Miner, SignalMapping } from "./telegraph";
import type { Receipt } from "./types";

/**
 * Miners do not share a result schema. Confidence, label and answer text are read from the
 * paths each miner declares in its signal_mapping, with fallbacks for the shapes seen live.
 */
export function getPath(obj: unknown, path: string | null | undefined): unknown {
  if (!path || obj === null || obj === undefined) return undefined;
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** Field names that mean "how bad", not "how sure". */
const RISK_FIELD = /(^|[._])(risk|danger|threat|severity|exploit_probability)/i;

export function isRiskField(field: string | null | undefined): boolean {
  return Boolean(field && RISK_FIELD.test(field));
}

/** Normalises 0-1, 0-100 and numeric strings; anything else is "not reported". */
export function toConfidence(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  if (!Number.isFinite(n)) return null;
  if (n >= 0 && n <= 1) return Number(n.toFixed(4));
  if (n > 1 && n <= 100) return Number((n / 100).toFixed(4));
  return null;
}

const TEXT_KEYS = [
  "answer",
  "summary",
  "reason",
  "reasoning",
  "explanation",
  "signal",
  "translation",
  "translated_text",
  "output",
  "text",
  "message",
  "content",
  "response",
  "result",
  "verdict",
  "description",
];

/** Best-effort answer text. Never empty. */
export function extractAnswer(result: unknown, mapping?: SignalMapping | null): string {
  if (result === null || result === undefined) return "The miner returned an empty result.";
  if (typeof result === "string") return result.trim() || "The miner returned an empty result.";
  if (typeof result !== "object") return String(result);
  const r = result as Record<string, unknown>;
  const mapped = getPath(r, mapping?.reason_field);
  if (typeof mapped === "string" && mapped.trim()) return mapped.trim();
  const choice = getPath(r, "choices.0.message.content");
  if (typeof choice === "string" && choice.trim()) return choice.trim();
  for (const key of TEXT_KEYS) {
    const v = r[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  for (const outer of ["data", "result", "output", "responseData"]) {
    const inner = r[outer];
    if (inner && typeof inner === "object") {
      for (const key of [...TEXT_KEYS, "translatedText", "title"]) {
        const v = (inner as Record<string, unknown>)[key];
        if (typeof v === "string" && v.trim()) return v.trim();
      }
    }
  }
  const json = JSON.stringify(result);
  return json.length > 700 ? `${json.slice(0, 700)}…` : json;
}

export interface ReceiptContext {
  intent: string;
  miner: Miner | null;
  rank: number | null;
  routerIntent?: string | null;
  reasoning?: string | null;
  endpoint?: string | null;
  payer: string | null;
}

export function buildReceipt(resp: EngineResponse, ctx: ReceiptContext): Receipt {
  const mapping = ctx.miner?.signal_mapping ?? null;
  const r = resp.result;
  const mapped = toConfidence(getPath(r, mapping?.confidence_field));
  const risk = mapped !== null && isRiskField(mapping?.confidence_field);
  const confidence =
    mapped ?? toConfidence(getPath(r, "confidence")) ?? toConfidence(getPath(r, "confidence_score")) ?? toConfidence(getPath(r, "score"));
  const labelRaw = getPath(r, mapping?.label_field) ?? getPath(r, "verdict") ?? getPath(r, "label");
  const label = typeof labelRaw === "string" || typeof labelRaw === "number" ? String(labelRaw).replace(/\s+/g, " ").slice(0, 160) : null;
  return {
    intent: ctx.intent,
    minerSlug: ctx.miner?.slug ?? resp.miner_name ?? null,
    minerName: ctx.miner?.name ?? resp.miner_name ?? null,
    minerId: resp.miner_id !== undefined ? String(resp.miner_id) : (ctx.miner?.id ?? null),
    minerRank: ctx.rank,
    routerIntent: ctx.routerIntent ?? null,
    routerReasoning: ctx.reasoning ?? resp.reasoning ?? null,
    endpoint: ctx.endpoint ?? resp.endpoint ?? null,
    confidence,
    confidenceNote: risk ? "This miner reports a risk score, not certainty." : null,
    label,
    answer: extractAnswer(r, mapping),
    costUsd: typeof resp.cost_usd === "number" ? resp.cost_usd : null,
    durationMs: typeof resp.duration_ms === "number" ? Math.round(resp.duration_ms) : null,
    signalHash: resp.signal_hash ?? null,
    settlementTx: resp.settlement?.txHash ?? null,
    payer: resp.settlement?.payer ?? ctx.payer,
    warnings: Array.isArray(resp.warnings) ? resp.warnings.filter((w): w is string => typeof w === "string") : [],
  };
}
