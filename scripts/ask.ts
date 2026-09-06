import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { askRouted, NodeError } from "../lib/telegraph";

/**
 * PAID, one call. Put one question to the router and print everything it says back: intent,
 * miner, reasoning, warnings, raw result, settlement. For diagnosing routing.
 *
 *   npm run ask -- "Extract the abstract of the research paper at https://arxiv.org/abs/1706.03762."
 *   npm run ask -- "Translate into Hindi: Good morning" '{"text":"Good morning","langpair":"en|hi"}'
 */
async function main() {
  const [query, ctxJson] = process.argv.slice(2);
  if (!query) {
    console.error("usage: npm run ask -- \"question\" ['{\"context\":\"json\"}']");
    process.exit(2);
  }
  const context = ctxJson ? (JSON.parse(ctxJson) as Record<string, unknown>) : undefined;
  const t0 = Date.now();
  try {
    const r = await askRouted(query, context);
    console.log(`intent      ${r.intent ?? "(none)"}`);
    console.log(`miner       ${r.miner_name ?? "?"} (id ${r.miner_id ?? "?"}) endpoint ${r.endpoint ?? "?"}`);
    console.log(`reasoning   ${r.reasoning ?? "(none)"}`);
    console.log(`cost/time   $${r.cost_usd ?? "?"} · ${r.duration_ms} ms (${Date.now() - t0} ms round trip)`);
    console.log(`signal      ${r.signal_hash ?? "(none)"}`);
    console.log(`settlement  ${r.settlement ? `${r.settlement.success ? "settled" : "not settled"} ${r.settlement.txHash ?? ""} ${r.settlement.errorReason ?? ""}` : "(no header)"}`);
    if (r.warnings?.length) console.log(`warnings    ${r.warnings.join(" | ")}`);
    console.log("result");
    console.log(JSON.stringify(r.result, null, 2).slice(0, 3000));
  } catch (e) {
    const err = e instanceof NodeError ? e : null;
    console.log(`FAILED ${err ? `${err.kind} ${err.status ?? ""}` : ""}: ${(e as Error).message}`);
    process.exit(1);
  }
}

main();
