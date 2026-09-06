import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { config, paidWorkEnabled } from "../lib/config";
import { parseQuery, validateParsed } from "../lib/parse";
import { buildPlan, runStep, summarize, type Context } from "../lib/pipeline";
import { getStore } from "../lib/store";
import { payerAddress } from "../lib/telegraph";
import type { Mode, StepResult } from "../lib/types";

/**
 * PAID. One real dossier from the command line, printing every receipt. Run this once after
 * funding the wallet and before showing anyone the site.
 *
 *   npm run live -- research "https://arxiv.org/abs/1706.03762 in Hindi"
 *   npm run live -- news "AI regulation in India, in Hindi"
 */
async function main() {
  const [modeArg, ...rest] = process.argv.slice(2);
  const mode = (modeArg === "news" ? "news" : "research") as Mode;
  const query = rest.join(" ").trim() || (mode === "news" ? "AI regulation in India, in Hindi" : "https://arxiv.org/abs/1706.03762 in Hindi");
  const c = config();
  if (!paidWorkEnabled(c)) {
    console.error("Paid work is off: set PAYER_PRIVATE_KEY and DAILY_CALL_BUDGET > 0 in .env.local, and PAUSED=false.");
    process.exit(2);
  }
  const parsed = parseQuery(mode, query);
  const problem = validateParsed(parsed);
  if (problem) {
    console.error(problem);
    process.exit(2);
  }
  const plan = buildPlan(parsed);
  console.log(`payer ${payerAddress()} · ${mode} · ${plan.length} steps · "${parsed.query}"`);
  const store = getStore();
  const ctx = { store, visitor: "live-script", mode };
  const context: Context = {};
  const results: StepResult[] = [];
  for (const spec of plan) {
    const t0 = Date.now();
    process.stdout.write(`- ${spec.id.padEnd(11)} ${spec.intent.padEnd(21)} `);
    const r = await runStep(spec, parsed, context, ctx);
    results.push(r);
    if (r.status === "ok") context[spec.id] = r.data;
    const rc = r.receipt;
    const line =
      r.status === "ok" && rc
        ? `ok  ${rc.minerSlug}#${rc.minerRank ?? "?"} routed as ${rc.routerIntent ?? "?"} · conf ${rc.confidence ?? "n/a"} · $${rc.costUsd ?? "?"} · ${rc.durationMs}ms · signal ${rc.signalHash?.slice(0, 12) ?? "none"} · tx ${rc.settlementTx?.slice(0, 12) ?? "none"}`
        : `${r.status.toUpperCase()}  ${r.error}`;
    console.log(`${line}  [${Date.now() - t0}ms, ${r.attempts.length} attempt(s)]`);
    for (const a of r.attempts) if (a.outcome !== "ok") console.log(`    · ${a.minerSlug}: ${a.outcome}${a.note ? ` — ${a.note}` : ""}`);
    if (rc && rc.answer) console.log(`    ${rc.answer.replace(/\s+/g, " ").slice(0, 220)}`);
  }
  const s = summarize(parsed, results);
  console.log(`\n${s.okSteps}/${plan.length} steps answered · ${s.calls} calls · $${s.costUsd.toFixed(2)} · intents: ${s.intents.join(", ")}`);
  for (const l of s.lines) console.log(`  ${l}`);
  process.exit(s.okSteps >= Math.ceil(plan.length / 2) ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
