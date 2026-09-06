import { NextResponse } from "next/server";
import { config, configProblems, paidWorkEnabled, utcDay } from "@/lib/config";
import { getStore } from "@/lib/store";
import { payerAddress, payerUsdcBalance } from "@/lib/telegraph";

export const dynamic = "force-dynamic";

export async function GET() {
  const c = config();
  const store = getStore();
  const day = utcDay();
  const [used, balance] = await Promise.all([store.budgetUsed(day).catch(() => null), payerUsdcBalance()]);
  const payer = payerAddress();
  return NextResponse.json({
    ok: true,
    name: "dossier",
    node: c.TELEGRAPH_NODE,
    store: store.kind,
    payer,
    payerConfigured: Boolean(payer),
    usdcBalance: balance,
    paidWorkEnabled: paidWorkEnabled(c),
    paused: c.PAUSED,
    budget: { limit: c.DAILY_CALL_BUDGET, usedToday: used, day },
    visitorDailyCalls: c.VISITOR_DAILY_CALLS,
    maxCallPriceUsdc: c.MAX_CALL_PRICE_USDC,
    problems: configProblems(),
    now: new Date().toISOString(),
  });
}
