import { config, paidWorkEnabled, utcDay, type Config } from "./config";
import type { Store } from "./store";

/**
 * Spending guards. Every paid attempt passes here first, so a public site cannot drain
 * the wallet: a global daily budget, a per-visitor daily allowance, and a pause switch.
 */
export interface Allowance {
  ok: boolean;
  reason: string | null;
  budgetLeft: number;
  visitorLeft: number;
}

export async function checkAllowance(store: Store, visitor: string, cfg: Config = config()): Promise<Allowance> {
  const day = utcDay();
  const [used, mine] = await Promise.all([store.budgetUsed(day), store.visitorCalls(visitor, day)]);
  const budgetLeft = Math.max(0, cfg.DAILY_CALL_BUDGET - used);
  const visitorLeft = Math.max(0, cfg.VISITOR_DAILY_CALLS - mine);
  if (cfg.PAUSED) return { ok: false, reason: "Paused by the operator. Nothing is being asked right now.", budgetLeft, visitorLeft };
  if (!cfg.PAYER_PRIVATE_KEY) return { ok: false, reason: "No payer wallet is configured, so the network cannot be asked yet.", budgetLeft, visitorLeft };
  if (!paidWorkEnabled(cfg) || budgetLeft <= 0) {
    return { ok: false, reason: `Today's call budget (${cfg.DAILY_CALL_BUDGET} calls) is used up. It resets at 00:00 UTC.`, budgetLeft, visitorLeft };
  }
  if (visitorLeft <= 0) {
    return { ok: false, reason: `This browser has used today's allowance of ${cfg.VISITOR_DAILY_CALLS} calls. It resets at 00:00 UTC.`, budgetLeft, visitorLeft };
  }
  return { ok: true, reason: null, budgetLeft, visitorLeft };
}

export async function noteAttempt(store: Store, visitor: string): Promise<void> {
  const day = utcDay();
  await Promise.all([store.incrBudget(day), store.incrVisitor(visitor, day)]);
}
