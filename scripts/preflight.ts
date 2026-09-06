import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { adapterFor, type StepInput } from "../lib/adapters";
import { config, configProblems, paidWorkEnabled } from "../lib/config";
import { RESEARCH_STEPS, NEWS_STEPS } from "../lib/pipeline";
import { BASE_SEPOLIA, fetchChallenge, payerAddress, payerUsdcBalance, rankedFor, TELEGRAPH_COLLECTOR, USDC_BASE_SEPOLIA } from "../lib/telegraph";

/**
 * Free checks before the first paid call: environment, node reachability, the 402 challenge
 * against the constants the client signs for, and which miner would serve each step today.
 * Spends nothing and engages no miner.
 */
const SAMPLE: Record<string, StepInput> = {
  CONTENT_EXTRACTION: { url: "https://arxiv.org/abs/1706.03762", question: "Extract the title" },
  AI_TEXT_DETECTION: { text: "word ".repeat(60) },
  FRAUD_DETECTION: { question: "Is there any documented fraud associated with the paper X?" },
  FACT_CHECK: { claim: "The Transformer is based solely on attention mechanisms." },
  ACADEMIC_SEARCH: { topic: "attention mechanisms" },
  LANGUAGE_TRANSLATION: { text: "Good morning", language: { name: "Hindi", code: "hi" } },
  NEWS_HEADLINES: { topic: "technology", category: "technology", region: "India" },
  NEWS_SEARCH: { topic: "AI regulation", region: "India" },
  CHAT_COMPLETION: { messages: [{ role: "user", content: "Say hello" }] },
};

async function main() {
  let failures = 0;
  const c = config();
  const payer = payerAddress();
  console.log("== environment");
  console.log(`node             ${c.TELEGRAPH_NODE}`);
  console.log(`payer            ${payer ?? "(not configured)"}`);
  console.log(`daily budget     ${c.DAILY_CALL_BUDGET} calls, per visitor ${c.VISITOR_DAILY_CALLS}, price cap $${c.MAX_CALL_PRICE_USDC}`);
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

  console.log("\n== who would serve each step today (leaderboard, price cap, adapter fit)");
  const seen = new Set<string>();
  for (const s of [...RESEARCH_STEPS, ...NEWS_STEPS]) {
    const intent = s.route === "engine" ? (s.fallbackIntent ?? s.intent) : s.intent;
    if (seen.has(`${s.id}`)) continue;
    seen.add(s.id);
    try {
      const ranked = await rankedFor(intent);
      const fit = ranked.filter((r) => adapterFor(intent, r.miner).build(SAMPLE[intent] ?? {}, r.miner) !== null).slice(0, 3);
      const line = fit.map((r) => `${r.miner.slug}#${r.rank ?? "?"}`).join(", ");
      console.log(`${s.id.padEnd(11)} ${intent.padEnd(21)} ${s.route === "engine" ? "router first, then " : ""}${line || "NO CANDIDATE"} (${ranked.length} listed)`);
      if (!fit.length) failures += 1;
    } catch (e) {
      console.log(`${s.id.padEnd(11)} ${intent.padEnd(21)} catalogue error: ${(e as Error).message}`);
      failures += 1;
    }
  }
  console.log(`\n${failures === 0 ? "preflight clean" : `${failures} problem(s)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
