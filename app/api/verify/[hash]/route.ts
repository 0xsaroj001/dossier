import { NextResponse } from "next/server";
import { bad } from "@/lib/http";
import { getStore } from "@/lib/store";
import { payerAddress, verifySignal } from "@/lib/telegraph";

export const dynamic = "force-dynamic";

/** Free: the node's own record of a signal, and whether this app's wallet paid for it. */
export async function GET(_req: Request, { params }: { params: Promise<{ hash: string }> }) {
  const { hash } = await params;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) return bad("Not a signal hash.");
  try {
    const [record, known] = await Promise.all([verifySignal(hash), getStore().knownSignal(hash)]);
    const payer = payerAddress();
    const wallet = record.signal?.wallet_address ?? null;
    return NextResponse.json({
      ok: true,
      hash,
      paidByThisApp: Boolean(payer && wallet && wallet.toLowerCase() === payer.toLowerCase()),
      inLedger: known,
      record,
      nodeUrl: `https://devnode.telegraphprotocol.com/engine/v1/signal/${hash}`,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
