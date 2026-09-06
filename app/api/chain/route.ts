import { NextResponse } from "next/server";
import { payerTransfers } from "@/lib/chain";
import { getStore } from "@/lib/store";
import { payerAddress } from "@/lib/telegraph";

export const dynamic = "force-dynamic";

/**
 * Free: the payer wallet's USDC transfers to the Telegraph collector, read from a public
 * explorer, and how many of the ledger's settlement hashes appear among them.
 */
export async function GET() {
  const payer = payerAddress();
  if (!payer) return NextResponse.json({ ok: false, error: "No payer wallet is configured." }, { status: 200 });
  try {
    const [chain, rows] = await Promise.all([payerTransfers(payer), getStore().rows(2000)]);
    const onChain = new Set(chain.hashes.map((h) => h.toLowerCase()));
    const settled = rows.map((r) => r.settlementTx).filter((h): h is string => Boolean(h));
    const matched = settled.filter((h) => onChain.has(h.toLowerCase())).length;
    return NextResponse.json({ ok: true, chain: { ...chain, hashes: undefined }, ledgerSettlements: settled.length, matched });
  } catch (e) {
    return NextResponse.json({ ok: false, error: `The explorer could not be read: ${(e as Error).message}` });
  }
}
