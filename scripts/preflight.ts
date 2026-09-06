import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { config, configProblems, paidWorkEnabled } from "../lib/config";
import { parseQuery } from "../lib/parse";
import { buildPlan, deriveInput, type Context } from "../lib/pipeline";
import { BASE_SEPOLIA, fetchChallenge, leaderboard, payerAddress, payerUsdcBalance, TELEGRAPH_COLLECTOR, USDC_BASE_SEPOLIA } from "../lib/telegraph";

/**
 * Free checks before the first paid call: environment, node reachability, the 402 challenge
 * against the constants the client signs for, the question each step will put to the router,
 * and who leads the leaderboard for the intent it is written for. Spends nothing.
 */
const SAMPLE_CONTEXT: Context = {
  source: { url: "https://arxiv.org/abs/1706.03762", title: "Attention Is All You Need", authors: ["Ashish Vaswani", "Noam Shazeer"], abstract: "We propose a new simple network architecture, the Transformer, based solely on attention mechanisms, dispensing with recurrence and convolutions entirely. ".repeat(3), date: "2017-06-12", year: "2017", site: "arxiv.org" },
  headlines: { items: [{ title: "Sample headline", source: "Sample", url: null, published: null, description: null }] },
  search: { articles: [{ title: "Sample article", source: "Sample", url: null, published: null, description: "d" }], answer: null },
  brief: { text: "Sample briefing text." },
};

async function main() {
  let failures = 0;
  const c = config();
  const payer = payerAddress();
  console.log("== environment");
  console.log(`node             ${c.TELEGRAPH_NODE}`);
  console.log(`payer            ${payer ?? "(not configured)"}`);
  console.log(`daily budget     ${c.DAILY_CALL_BUDGET} calls, per visitor ${c.VISITOR_DAILY_CALLS}, price cap $${c.MAX_CALL_PRICE_USDC}, router timeout ${c.ROUTER_TIMEOUT_MS} ms`);
  console.log(`paid work        ${paidWorkEnabled(c) ? "ENABLED" : "off"}${c.PAUSED ? " (paused)" : ""}`);
  for (const p of configProblems()) {
    console.log(`problem          ${p}`);
    failures += 1;
  }
  if (payer) console.log(`usdc balance     ${(await payerUsdcBalance())?.toFixed(2) ?? "unreadable"}`);

  console.log("\n== 402 challenge (free)");
  try {
    const ch = await fetchChallenge();
    const evm = ch.accepts.find((a) => a.network === BASE_SEPOLIA);
    console.log(`status           ${ch.status}${ch.status === 402 ? "" : " (expected 402)"}`);
    if (!evm) {
      console.log("no Base Sepolia accept in the challenge");
      failures += 1;
    } else {
      const checks: Array<[string, boolean, string]> = [
        ["network", evm.network === BASE_SEPOLIA, `${evm.network}`],
        ["asset", (evm.asset ?? "").toLowerCase() === USDC_BASE_SEPOLIA.toLowerCase(), `${evm.asset}`],
        ["payTo", (evm.payTo ?? "").toLowerCase() === TELEGRAPH_COLLECTOR.toLowerCase(), `${evm.payTo}`],
        ["amount", Number(evm.amount ?? 0) / 1e6 <= c.MAX_CALL_PRICE_USDC, `$${Number(evm.amount ?? 0) / 1e6}`],
      ];
      for (const [k, ok, v] of checks) {
        console.log(`${k.padEnd(16)} ${ok ? "ok" : "MISMATCH"}  ${v}`);
        if (!ok) failures += 1;
      }
    }
  } catch (e) {
    console.log(`challenge failed: ${(e as Error).message}`);
    failures += 1;
  }

  console.log("\n== the questions, and who leads each intent today (the router chooses; this is who it is likely to choose)");
  const plans = [parseQuery("research", "https://arxiv.org/abs/1706.03762 in Hindi"), parseQuery("news", "AI regulation in India, in Hindi")];
  for (const parsed of plans) {
    for (const s of buildPlan(parsed)) {
      const d = deriveInput(s, parsed, SAMPLE_CONTEXT);
      const q = "skip" in d ? `(skipped: ${d.skip})` : d.queries[0].replace(/\s+/g, " ").slice(0, 110) + (d.queries[0].length > 110 ? "…" : "");
      let lead = "";
      try {
        const top = (await leaderboard(s.intent)).slice(0, 3);
        lead = top.map((r) => `${r.miner.slug}#${r.rank ?? "?"}`).join(", ") || "NO ACTIVE MINER";
        if (!top.length) failures += 1;
      } catch (e) {
        lead = `catalogue error: ${(e as Error).message}`;
        failures += 1;
      }
      console.log(`${s.id.padEnd(11)} ${s.intent.padEnd(21)} ${lead}`);
      console.log(`${"".padEnd(11)} accepts ${s.accept.join(", ")}`);
      console.log(`${"".padEnd(11)} asks    ${q}`);
    }
  }
  console.log(`\n${failures === 0 ? "preflight clean" : `${failures} problem(s)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
