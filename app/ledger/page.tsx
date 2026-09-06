import Link from "next/link";
import { payerTransfers, type ChainSummary } from "@/lib/chain";
import { config } from "@/lib/config";
import { getStore } from "@/lib/store";
import { payerAddress } from "@/lib/telegraph";
import type { LedgerRow } from "@/lib/types";

export const dynamic = "force-dynamic";

function short(h: string): string {
  return `${h.slice(0, 8)}…${h.slice(-4)}`;
}

function when(iso: string): string {
  return iso.slice(5, 16).replace("T", " ");
}

export default async function LedgerPage() {
  const store = getStore();
  const [rows, stats, dossiers] = await Promise.all([store.rows(200), store.stats(), store.recentDossiers(12)]);
  const payer = payerAddress();
  let chain: ChainSummary | null = null;
  let chainError: string | null = null;
  if (payer) {
    try {
      chain = await payerTransfers(payer);
    } catch (e) {
      chainError = (e as Error).message;
    }
  }
  const onChain = new Set((chain?.hashes ?? []).map((h) => h.toLowerCase()));
  const settled = rows.map((r) => r.settlementTx).filter((h): h is string => Boolean(h));
  const matched = settled.filter((h) => onChain.has(h.toLowerCase())).length;
  const c = config();
  return (
    <>
      <h1>Ledger</h1>
      <p className="lede">Every call this app has made to the Telegraph network, newest first, and the same calls counted again from the chain.</p>
      <div className="stat-grid">
        <div className="stat">
          <div className="k">Calls, all time</div>
          <div className="v">{stats.calls}</div>
        </div>
        <div className="stat">
          <div className="k">Answered</div>
          <div className="v">{stats.okCalls}</div>
        </div>
        <div className="stat">
          <div className="k">Calls today (UTC)</div>
          <div className="v">{stats.callsToday}</div>
        </div>
        <div className="stat">
          <div className="k">Distinct visitors</div>
          <div className="v">{stats.usersAll}</div>
        </div>
        <div className="stat">
          <div className="k">Visitors today</div>
          <div className="v">{stats.usersToday}</div>
        </div>
        <div className="stat">
          <div className="k">USDC paid</div>
          <div className="v">${stats.costUsd.toFixed(2)}</div>
        </div>
        <div className="stat">
          <div className="k">Dossiers saved</div>
          <div className="v">{stats.dossiers}</div>
        </div>
      </div>
      <p className="note">
        A visitor is a browser: a random cookie, stored only as a salted hash. One person on two devices counts twice; the method is published so the number can be read for what it is. Store: {store.kind}
        {store.kind === "memory" ? " (resets on every cold start; set Upstash Redis to keep history)" : ""}. Daily budget {c.DAILY_CALL_BUDGET} calls
        {c.PAUSED ? ", paused" : ""}.
      </p>

      <h2>On the chain</h2>
      {!payer && <p className="note">No payer wallet is configured, so there is no on-chain trail yet.</p>}
      {chainError && <p className="error">The explorer could not be read: {chainError}</p>}
      {chain && (
        <>
          <p>
            Payer wallet <code>{chain.payer}</code> has made <b>{chain.transfers}</b> USDC transfers to the Telegraph collector
            {chain.complete ? "" : ` in the ${chain.sampledPages} newest explorer pages sampled`}, read from{" "}
            <a href={chain.explorer} rel="noreferrer" target="_blank">
              Blockscout
            </a>{" "}
            at {chain.fetchedAt.slice(11, 19)} UTC. Of the {settled.length} settlement hashes on this ledger page, {matched} appear among them
            {settled.length > matched ? "; the rest are older than the sampled pages or not yet indexed" : ""}.
          </p>
          {chain.latest.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>When (UTC)</th>
                    <th>USDC</th>
                    <th>Transaction</th>
                  </tr>
                </thead>
                <tbody>
                  {chain.latest.slice(0, 10).map((t) => (
                    <tr key={t.tx}>
                      <td>{t.at.slice(0, 19).replace("T", " ")}</td>
                      <td>{t.amountUsdc.toFixed(3)}</td>
                      <td>
                        <a href={`https://sepolia.basescan.org/tx/${t.tx}`} rel="noreferrer" target="_blank">
                          {short(t.tx)}
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <h2>Intents served</h2>
      <div className="chips">
        {Object.entries(stats.intents)
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => (
            <span className="chip intent" key={k}>
              {k} · {v}
            </span>
          ))}
        {Object.keys(stats.intents).length === 0 && <span className="note">No calls yet.</span>}
      </div>

      {dossiers.length > 0 && (
        <>
          <h2>Recent dossiers</h2>
          <ul className="plain">
            {dossiers.map((d) => (
              <li key={d.id}>
                <Link href={`/d/${d.id}`}>{d.query}</Link>
                <div className="src">
                  {d.mode} · {d.createdAt.slice(0, 16).replace("T", " ")} UTC · {d.summary.calls} calls · {d.summary.okSteps} steps answered
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <h2>Calls</h2>
      {rows.length === 0 ? (
        <p className="note">Nothing yet. The first dossier will appear here.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>When (UTC)</th>
                <th>Mode · step</th>
                <th>Step intent</th>
                <th>Miner (rank)</th>
                <th>Routed as</th>
                <th>Conf.</th>
                <th>Cost</th>
                <th>ms</th>
                <th>Status</th>
                <th>Signal</th>
                <th>Settlement</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: LedgerRow) => (
                <tr key={r.id}>
                  <td>{when(r.at)}</td>
                  <td>
                    {r.mode} · {r.step}
                  </td>
                  <td className="mono">{r.intent}</td>
                  <td>
                    {r.minerSlug ?? "—"}
                    {r.minerRank ? ` (#${r.minerRank})` : ""}
                  </td>
                  <td className="mono">{r.routerIntent ?? "—"}</td>
                  <td>{typeof r.confidence === "number" ? `${Math.round(r.confidence * 100)}%` : "—"}</td>
                  <td>{typeof r.costUsd === "number" ? `$${r.costUsd.toFixed(3)}` : "—"}</td>
                  <td>{r.durationMs ?? "—"}</td>
                  <td>{r.status}</td>
                  <td>{r.signalHash ? <Link href={`/verify/${r.signalHash}`}>{short(r.signalHash)}</Link> : "—"}</td>
                  <td>
                    {r.settlementTx ? (
                      <a href={`https://sepolia.basescan.org/tx/${r.settlementTx}`} rel="noreferrer" target="_blank">
                        {short(r.settlementTx)}
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="note" style={{ marginTop: 10 }}>
        Every row is one question to Telegraph&apos;s router. Status <i>unusable</i> means the miner the router chose answered (and was paid) but the answer could not serve the step, so the question was asked once more in different words. <i>error</i>, <i>unpaid</i> and <i>timeout</i> rows were not charged, except that a timed-out call can settle late; the chain count above would show it.
      </p>
    </>
  );
}
