import Link from "next/link";
import { notFound } from "next/navigation";
import DossierView from "@/components/DossierView";
import { config } from "@/lib/config";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function SharedDossier({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[A-Za-z0-9_-]{4,16}$/.test(id)) notFound();
  const d = await getStore().getDossier(id);
  if (!d) notFound();
  const base = config().PUBLIC_URL?.replace(/\/+$/, "");
  return (
    <>
      <p className="note">
        A saved dossier. <Link href="/">Build your own →</Link>
      </p>
      <DossierView mode={d.mode} parsed={d.parsed} steps={d.steps} summary={d.summary} createdAt={d.createdAt} shareUrl={base ? `${base}/d/${d.id}` : null} done />
    </>
  );
}
