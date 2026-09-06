import Link from "next/link";
import { notFound } from "next/navigation";
import { getStore } from "@/lib/store";
import { payerAddress, verifySignal, type SignalRecord } from "@/lib/telegraph";

export const dynamic = "force-dynamic";

export default async function VerifyPage({ params }: { params: Promise<{ hash: string }> }) {
  const { hash } = await params;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) notFound();
  let record: SignalRecord | null = null;
  let error: string | null = null;
  try {
    record = await verifySignal(hash);
  } catch (e) {
    error = (e as Error).message;
  }
  const known = await getStore().knownSignal(hash);
  const payer = payerAddress();
  const wallet = record?.signal?.wallet_address ?? null;
  const ours = Boolean(payer && wallet && wallet.toLowerCase() === payer.toLowerCase());
  const nodeUrl = `https://devnode.telegraphprotocol.com/engine/v1/signal/${hash}`;
  return (
    <>
      <p className="note">
        <Link href="/ledger">← Ledger</Link>
      </p>
      <h1>Signal</h1>
      <p className="mono" style={{ wordBreak: "break-all" }}>
        {hash}
      </p>
      {error && <p className="error">The node could not be read: {error}</p>}
      {record && (
        <div className="receipt" style={{ marginTop: 12 }}>
          <div>
            <div className="k">Kind</div>
            <div className="v">{record.kind ?? "?"}</div>
          </div>
          <div>
            <div className="k">Miner</div>
            <div className="v">
              {record.signal?.miner_slug ?? "?"} {record.signal?.subnet_id ? `(id ${record.signal.subnet_id})` : ""}
            </div>
          </div>
          <div>
            <div className="k">Created</div>
            <div className="v">{record.signal?.created_at ?? "?"}</div>
          </div>
          <div>
            <div className="k">Payer wallet</div>
            <div className="v">
              {wallet ?? "not recorded"} {ours ? <span className="stamp ok">this app</span> : wallet ? <span className="stamp muted">another payer</span> : null}
            </div>
          </div>
          <div>
            <div className="k">In this app&apos;s ledger</div>
            <div className="v">{known ? "yes" : "no"}</div>
          </div>
          <div>
            <div className="k">Node attestation</div>
            <div className="v">
              {record.verification ? `${record.verification.algorithm ?? "?"} over ${record.verification.commitment ?? "?"}: ${record.verification.verified ? "verified" : "not verified"}` : "none reported"}
            </div>
          </div>
          <div>
            <div className="k">Settlement on record</div>
            <div className="v">
              {record.signal?.tx_hash ? (
                <a href={`https://sepolia.basescan.org/tx/${record.signal.tx_hash}`} rel="noreferrer" target="_blank">
                  {record.signal.tx_hash.slice(0, 12)}…
                </a>
              ) : (
                "not on the signal record (the node reports it in the payment header instead)"
              )}
            </div>
          </div>
        </div>
      )}
      <p className="note">
        Read it yourself on the node:{" "}
        <a href={nodeUrl} rel="noreferrer" target="_blank">
          {nodeUrl}
        </a>
      </p>
      {record && (
        <details>
          <summary>Raw record</summary>
          <pre>{JSON.stringify(record, null, 2)}</pre>
        </details>
      )}
    </>
  );
}
