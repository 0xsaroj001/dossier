import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { hashVisitor, isVisitorId, newVisitorId, VISITOR_COOKIE } from "./visitor";
import type { ParsedQuery } from "./types";

export interface Visitor {
  id: string;
  hash: string;
  isNew: boolean;
}

export function visitorFrom(req: NextRequest): Visitor {
  const raw = req.cookies.get(VISITOR_COOKIE)?.value;
  const id = isVisitorId(raw) ? raw : newVisitorId();
  return { id, hash: hashVisitor(id), isNew: !isVisitorId(raw) };
}

export function withVisitor<T>(res: NextResponse<T>, v: Visitor): NextResponse<T> {
  if (v.isNew) {
    res.cookies.set({ name: VISITOR_COOKIE, value: v.id, httpOnly: true, sameSite: "lax", path: "/", maxAge: 400 * 24 * 3600, secure: process.env.NODE_ENV === "production" });
  }
  return res;
}

export const parsedSchema = z.object({
  mode: z.enum(["research", "news", "safety"]),
  query: z.string().min(1).max(2000),
  url: z.string().max(2000).nullable(),
  topic: z.string().max(300).nullable(),
  language: z.object({ name: z.string().max(40), code: z.string().max(8) }).nullable(),
  region: z.string().max(60).nullable(),
  category: z.string().max(40).nullable(),
  address: z.string().max(80).nullable().optional(),
  message: z.string().max(2000).nullable().optional(),
});

export function asParsed(v: unknown): ParsedQuery | null {
  const r = parsedSchema.safeParse(v);
  return r.success ? r.data : null;
}

export function bad(message: string, status = 400): NextResponse {
  return NextResponse.json({ ok: false, error: message }, { status });
}
