import { NextResponse } from "next/server";
import { bad } from "@/lib/http";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[A-Za-z0-9_-]{4,16}$/.test(id)) return bad("Not a dossier id.");
  const d = await getStore().getDossier(id);
  if (!d) return bad("No such dossier.", 404);
  return NextResponse.json({ ok: true, dossier: d });
}
