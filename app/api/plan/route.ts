import { NextResponse } from "next/server";
import { z } from "zod";
import { bad } from "@/lib/http";
import { parseQuery, validateParsed } from "@/lib/parse";
import { buildPlan } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

const body = z.object({
  mode: z.enum(["research", "news"]),
  query: z.string().min(1).max(1000),
  language: z.string().max(40).nullable().optional(),
});

/** Free: turns a query into the steps that will run. Nothing is asked of the network. */
export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const b = body.safeParse(json);
  if (!b.success) return bad("Send { mode, query, language? }.");
  const parsed = parseQuery(b.data.mode, b.data.query, b.data.language ?? null);
  const problem = validateParsed(parsed);
  if (problem) return bad(problem);
  const steps = buildPlan(parsed).map((s) => ({ id: s.id, title: s.title, intent: s.intent, accept: s.accept, blurb: s.blurb }));
  return NextResponse.json({ ok: true, parsed, steps });
}
