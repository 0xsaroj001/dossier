import { TELEGRAPH_COLLECTOR, USDC_BASE_SEPOLIA } from "./telegraph";

/**
 * The on-chain trail. Every settled call is a USDC transfer from the payer wallet to the
 * Telegraph collector on Base Sepolia, readable from a public explorer without a key.
 * This is the count nobody has to take the app's word for.
 */
export interface Transfer {
  tx: string;
  at: string;
  amountUsdc: number;
}

export interface ChainSummary {
  payer: string;
  transfers: number;
  sampledPages: number;
  complete: boolean;
  latest: Transfer[];
  /** Every settlement hash seen in the sampled pages, for matching against the ledger. */
  hashes: string[];
  explorer: string;
  fetchedAt: string;
}

const EXPLORER = "https://base-sepolia.blockscout.com";
let cache: { at: number; payer: string; value: ChainSummary } | null = null;

export async function payerTransfers(payer: string, maxPages = 6): Promise<ChainSummary> {
  if (cache && cache.payer === payer && Date.now() - cache.at < 60_000) return cache.value;
  const latest: Transfer[] = [];
  const hashes: string[] = [];
  let count = 0;
  let pages = 0;
  let params: Record<string, string> = {};
  let complete = false;
  while (pages < maxPages) {
    const qs = new URLSearchParams({ type: "ERC-20", filter: "from", ...params });
    const res = await fetch(`${EXPLORER}/api/v2/addresses/${payer}/token-transfers?${qs.toString()}`, {
      signal: AbortSignal.timeout(15_000),
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error(`explorer answered ${res.status}`);
    const body = (await res.json()) as {
      items?: Array<{ transaction_hash?: string; timestamp?: string; to?: { hash?: string }; token?: { address?: string; address_hash?: string }; total?: { value?: string; decimals?: string } }>;
      next_page_params?: Record<string, string | number> | null;
    };
    pages += 1;
    for (const it of body.items ?? []) {
      const to = (it.to?.hash ?? "").toLowerCase();
      const token = (it.token?.address_hash ?? it.token?.address ?? "").toLowerCase();
      if (to !== TELEGRAPH_COLLECTOR.toLowerCase() || token !== USDC_BASE_SEPOLIA.toLowerCase()) continue;
      count += 1;
      if (it.transaction_hash) hashes.push(it.transaction_hash);
      if (latest.length < 25 && it.transaction_hash) {
        const dec = Number(it.total?.decimals ?? 6);
        latest.push({ tx: it.transaction_hash, at: it.timestamp ?? "", amountUsdc: Number(it.total?.value ?? 0) / 10 ** dec });
      }
    }
    if (!body.next_page_params) {
      complete = true;
      break;
    }
    params = Object.fromEntries(Object.entries(body.next_page_params).map(([k, v]) => [k, String(v)]));
  }
  const value: ChainSummary = {
    payer,
    transfers: count,
    sampledPages: pages,
    complete,
    latest,
    hashes,
    explorer: `${EXPLORER}/address/${payer}?tab=token_transfers`,
    fetchedAt: new Date().toISOString(),
  };
  cache = { at: Date.now(), payer, value };
  return value;
}
