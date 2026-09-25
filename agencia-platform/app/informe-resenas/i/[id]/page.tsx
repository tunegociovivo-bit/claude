/** Vista imprimible interna del informe de reseñas sospechosas (requiere sesión + feature gmb). */
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requireFeature } from "@/lib/auth-utils";
import { prisma } from "@/lib/db/prisma";
import FakeReviewReport from "@/components/gmb/FakeReviewReport";
import FakeReviewPrintShell from "@/components/gmb/FakeReviewPrintShell";
import type { AnalysisResults } from "@/lib/gmb/fake-reviews/analyzer";

export const dynamic = "force-dynamic";
export const metadata = { title: "Informe de reseñas" };

export default async function InternalFakeReviewReport({ params }: { params: { id: string } }) {
  const s = await getServerSession(authOptions);
  const workspaceId = (s?.user as any)?.workspaceId as string | undefined;
  if (!s?.user || !workspaceId) redirect(`/login?callbackUrl=/informe-resenas/i/${params.id}`);
  await requireFeature("gmb");
  const row = await prisma.gmbFakeReviewAnalysis.findFirst({ where: { id: params.id, workspaceId }, select: { results: true, status: true } });
  if (!row || row.status !== "done" || !row.results) notFound();
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { name: true, settings: true } });
  const branding = (ws?.settings as any)?.branding ?? {};
  return (
    <FakeReviewPrintShell pdfUrl={`/api/v1/gmb/fake-reviews/${params.id}/pdf?type=cliente`}>
      <FakeReviewReport results={row.results as unknown as AnalysisResults} agencyName={branding.name || ws?.name || "Negocio Vivo"} logoUrl={branding.logoUrl ?? null} />
    </FakeReviewPrintShell>
  );
}
