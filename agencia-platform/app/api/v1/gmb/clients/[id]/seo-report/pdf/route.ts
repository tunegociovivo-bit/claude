/** GET /api/v1/gmb/clients/[id]/seo-report/pdf?reportId= — descarga en PDF del informe SEO competitivo. */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { buildSeoReportPdf } from "@/lib/gmb/seo-competitive-pdf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = withApi({ scope: "*" }, async (req, { params, api }) => {
  const client = await prisma.gmbClient.findFirst({ where: { id: params.id, workspaceId: api.workspaceId }, select: { id: true, name: true } });
  if (!client) throw new ApiError(404, "not_found", "Ficha no encontrada");
  const reportId = new URL(req.url).searchParams.get("reportId");
  const row = await prisma.gmbSeoReport.findFirst({
    where: { workspaceId: api.workspaceId, clientId: client.id, ...(reportId ? { id: reportId } : {}) },
    orderBy: { createdAt: "desc" }
  });
  if (!row) throw new ApiError(404, "not_found", "Aún no hay informe SEO para esta ficha");
  const ws = await prisma.workspace.findUnique({ where: { id: api.workspaceId }, select: { name: true, settings: true } });
  const branding: any = (ws?.settings as any)?.branding ?? {};
  const pdf = await buildSeoReportPdf(row.data as any, client.name, { agency: branding.name ?? ws?.name ?? "", color: branding.color ?? null });
  const slug = client.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 50);
  return new NextResponse(pdf as any, {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="informe-seo-${slug}-${row.createdAt.toISOString().slice(0, 10)}.pdf"`, "Cache-Control": "no-store" }
  });
});
