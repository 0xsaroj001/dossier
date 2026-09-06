import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { utcDay } from "@/lib/config";
import { bad, visitorFrom, withVisitor } from "@/lib/http";
import { parseQuery, validateParsed } from "@/lib/parse";
import { fetchSource } from "@/lib/source";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const body = z.object({ url: z.string().min(8).max(2000) });
const PER_BROWSER_PER_DAY = 40;

/** Free, not a Telegraph call: the page's own metadata tags, which the paid questions then work on. */
export async function POST(req: NextRequest) {
  const json = await req.json().catch(() => null);
  const b = body.safeParse(json);
  if (!b.success) return bad("Send { url }.");
  const parsed = parseQuery("research", b.data.url);
  const problem = validateParsed(parsed);
  if (problem || !parsed.url) return bad(problem ?? "Not a link.");
  const visitor = visitorFrom(req);
  const n = await getStore().bump(`source:${visitor.hash}`, utcDay());
  if (n > PER_BROWSER_PER_DAY) return withVisitor(NextResponse.json({ ok: false, error: "This browser has read enough pages for today; it resets at 00:00 UTC." }, { status: 429 }), visitor);
  const source = await fetchSource(parsed.url);
  if ("error" in source) return withVisitor(NextResponse.json({ ok: false, error: source.error }), visitor);
  return withVisitor(NextResponse.json({ ok: true, source }), visitor);
}
