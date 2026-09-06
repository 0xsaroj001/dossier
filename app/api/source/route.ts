import { NextResponse } from "next/server";
import { z } from "zod";
import { bad } from "@/lib/http";
import { parseQuery, validateParsed } from "@/lib/parse";
import { fetchSource } from "@/lib/source";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const body = z.object({ url: z.string().min(8).max(2000) });

/** Free, not a Telegraph call: the page's own metadata tags, which the paid questions then work on. */
export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const b = body.safeParse(json);
  if (!b.success) return bad("Send { url }.");
  const parsed = parseQuery("research", b.data.url);
  const problem = validateParsed(parsed);
  if (problem || !parsed.url) return bad(problem ?? "Not a link.");
  const source = await fetchSource(parsed.url);
  if ("error" in source) return NextResponse.json({ ok: false, error: source.error });
  return NextResponse.json({ ok: true, source });
}
