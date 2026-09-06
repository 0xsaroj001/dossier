import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { config } from "@/lib/config";
import { asParsed, bad, visitorFrom, withVisitor } from "@/lib/http";
import { specsFor, summarize } from "@/lib/pipeline";
import { getStore } from "@/lib/store";
import type { Dossier, StepResult } from "@/lib/types";

export const dynamic = "force-dynamic";

const body = z.object({
  parsed: z.unknown(),
  source: z
    .object({
      url: z.string().max(2000),
      title: z.string().max(500).nullable(),
      authors: z.array(z.string().max(120)).max(20),
      abstract: z.string().max(6000).nullable(),
      date: z.string().max(60).nullable(),
      year: z.string().max(8).nullable(),
      site: z.string().max(120).nullable(),
    })
    .nullable()
    .optional(),
  steps: z.array(z.unknown()).max(12),
});

function publicUrl(req: NextRequest): string {
  const c = config().PUBLIC_URL;
  if (c) return c.replace(/\/+$/, "");
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "localhost:3000";
  return `${proto}://${host}`;
}

/**
 * Saves a finished dossier for sharing. Only steps whose receipt carries a signal hash this
 * app itself recorded are kept, so a shared page cannot show a receipt the app never got.
 */
export async function POST(req: NextRequest) {
  const json = await req.json().catch(() => null);
  const b = body.safeParse(json);
  if (!b.success) return bad("Send { parsed, steps }.");
  const parsed = asParsed(b.data.parsed);
  if (!parsed) return bad("The parsed query is malformed.");
  const store = getStore();
  const known = new Map(specsFor(parsed.mode).map((s) => [s.id, s]));
  const steps: StepResult[] = [];
  for (const raw of b.data.steps) {
    const s = raw as StepResult;
    const spec = s && typeof s === "object" ? known.get(s.id) : undefined;
    if (!spec) continue;
    const hash = s.receipt?.signalHash ?? null;
    const okReceipt = s.status === "ok" && s.receipt && hash && (await store.knownSignal(hash));
    if (s.status === "ok" && !okReceipt) continue;
    steps.push({
      id: spec.id,
      title: spec.title,
      intent: spec.intent,
      status: s.status === "ok" ? "ok" : s.status === "skipped" ? "skipped" : "error",
      receipt: okReceipt ? s.receipt : null,
      data: okReceipt ? s.data : null,
      error: typeof s.error === "string" ? s.error.slice(0, 500) : null,
      attempts: Array.isArray(s.attempts) ? s.attempts.slice(0, 8) : [],
    });
  }
  if (steps.length === 0) return bad("Nothing to save.");
  const id = randomBytes(6).toString("base64url");
  const source = parsed.mode === "research" ? (b.data.source ?? null) : null;
  const dossier: Dossier = { id, mode: parsed.mode, query: parsed.query, parsed, createdAt: new Date().toISOString(), source, steps, summary: summarize(parsed, steps, source) };
  await store.saveDossier(dossier);
  const visitor = visitorFrom(req);
  return withVisitor(NextResponse.json({ ok: true, id, url: `${publicUrl(req)}/d/${id}` }), visitor);
}
