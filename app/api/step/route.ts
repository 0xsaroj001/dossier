import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { checkAllowance } from "@/lib/guard";
import { asParsed, bad, visitorFrom, withVisitor } from "@/lib/http";
import { validateParsed } from "@/lib/parse";
import { runStep, specsFor, type Context } from "@/lib/pipeline";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const body = z.object({
  mode: z.enum(["research", "news"]),
  stepId: z.string().max(20),
  parsed: z.unknown(),
  context: z.record(z.string(), z.unknown()).optional(),
});

/** Paid: runs one step of the plan against the network and returns its receipt. */
export async function POST(req: NextRequest) {
  const json = await req.json().catch(() => null);
  const b = body.safeParse(json);
  if (!b.success) return bad("Send { mode, stepId, parsed, context }.");
  const parsed = asParsed(b.data.parsed);
  if (!parsed || parsed.mode !== b.data.mode) return bad("The parsed query is malformed.");
  const problem = validateParsed(parsed);
  if (problem) return bad(problem);
  const spec = specsFor(parsed.mode).find((s) => s.id === b.data.stepId);
  if (!spec) return bad("Unknown step.");
  const visitor = visitorFrom(req);
  const store = getStore();
  const result = await runStep(spec, parsed, (b.data.context ?? {}) as Context, { store, visitor: visitor.hash, mode: parsed.mode });
  const allowance = await checkAllowance(store, visitor.hash);
  return withVisitor(NextResponse.json({ ok: true, result, allowance: { budgetLeft: allowance.budgetLeft, visitorLeft: allowance.visitorLeft } }), visitor);
}
