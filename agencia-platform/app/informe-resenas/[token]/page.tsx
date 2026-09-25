/**
 * Informe público de reseñas sospechosas (enlace firmado para el cliente, sin login).
 * Sólo se guarda el hash del token; caduca y se puede revocar desde GMB Hub.
 */
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { hashToken } from "@/lib/gmb/report-share";
import FakeReviewReport from "@/components/gmb/FakeReviewReport";
import FakeReviewPrintShell from "@/components/gmb/FakeReviewPrintShell";
import type { AnalysisResults } from "@/lib/gmb/fake-reviews/analyzer";

export const dynamic = "force-dynamic";
export const metadata = { title: "Informe de reseñas", robots: { index: false, follow: false } };

export default async function PublicFakeReviewReport({ params }: { params: { token: string } }) {
  if (!params.token || params.token.length < 20) notFound();
  const row = await prisma.gmbFakeReviewAnalysis.findUnique({
    where: { shareTokenHash: hashToken(params.token) },
    select: { workspaceId: true, status: true, results: true, shareExpiresAt: true }
  });
  if (!row || row.status !== "done" || !row.results || !row.shareExpiresAt || row.shareExpiresAt < new Date()) notFound();
  const ws = await prisma.workspace.findUnique({ where: { id: row.workspaceId }, select: { name: true, settings: true } });
  const branding = (ws?.settings as any)?.branding ?? {};
  return (
    <FakeReviewPrintShell pdfUrl={`/api/v1/gmb/public/fake-reviews/${params.token}/pdf`}>
      <FakeReviewReport results={row.results as unknown as AnalysisResults} agencyName={branding.name || ws?.name || "Negocio Vivo"} logoUrl={branding.logoUrl ?? null} />
    </FakeReviewPrintShell>
  );
}
