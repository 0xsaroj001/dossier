import { NextResponse, type NextRequest } from "next/server";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Free and public: every call the app has made, newest first, with the running totals. */
export async function GET(req: NextRequest) {
  const limit = Math.min(500, Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? 100) || 100));
  const store = getStore();
  const [rows, stats] = await Promise.all([store.rows(limit), store.stats()]);
  return NextResponse.json({ ok: true, store: store.kind, stats, rows });
}
