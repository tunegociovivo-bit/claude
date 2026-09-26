/**
 * GET   /api/v1/gmb/shield/cases/[id] → caso + pruebas
 * PATCH /api/v1/gmb/shield/cases/[id] → acción de estado (report, reject, appeal, …) o edición de textos
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { GOOGLE_OPTIONS, nextStatus, type CaseAction, type CaseStatus } from "@/lib/gmb/fake-reviews/cases-logic";
import { appealText, legalText } from "@/lib/gmb/fake-reviews/cases";
import { getLearningStats, markProfileConfirmed } from "@/lib/gmb/fake-reviews/shield";
import { reportBrand } from "@/lib/gmb/fake-reviews/brand";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = withApi({ scope: "*" }, async (_req, { params, api }) => {
  const c = await prisma.gmbReviewCase.findFirst({ where: { id: params.id, workspaceId: api.workspaceId } });
  if (!c) throw new ApiError(404, "not_found", "Caso no encontrado");
  const evidence = await prisma.gmbEvidence.findMany({ where: { workspaceId: api.workspaceId, caseId: c.id }, orderBy: { capturedAt: "asc" }, select: { id: true, kind: true, source: true, sha256: true, capturedAt: true } });
  return NextResponse.json({ case: c, evidence });
});

const schema = z.object({
  action: z.enum(["report", "reject", "appeal", "appeal_rejected", "legal", "removed", "dismiss", "reopen"]).optional(),
  googleOption: z.enum(Object.keys(GOOGLE_OPTIONS) as [string, ...string[]]).optional(),
  reportText: z.string().max(5000).optional(),
  appealText: z.string().max(20000).optional(),
  legalText: z.string().max(20000).optional(),
  notes: z.string().max(5000).optional(),
  channel: z.enum(["tool", "maps", "legal"]).optional()
});

export const PATCH = withApi({ scope: "*" }, async (req, { params, api }) => {
  const p = schema.safeParse(await req.json().catch(() => null));
  if (!p.success) throw new ApiError(400, "validation_error", p.error.issues[0]?.message ?? p.error.message);
  const c = await prisma.gmbReviewCase.findFirst({ where: { id: params.id, workspaceId: api.workspaceId } });
  if (!c) throw new ApiError(404, "not_found", "Caso no encontrado");
  const { action, ...fields } = p.data;
  const data: any = { ...fields };
  const now = new Date();
  if (action) {
    const t = nextStatus(c.status as CaseStatus, action as CaseAction);
    if (!t.ok) throw new ApiError(409, "invalid_transition", t.error);
    data.status = t.to;
    if (action === "report") Object.assign(data, { reportedAt: now, nextCheckAt: new Date(now.getTime() + 3 * 86_400_000), checkMisses: 0 });
    if (action === "reject") {
      data.rejectedAt = now;
      data.nextCheckAt = new Date(now.getTime() + 7 * 86_400_000);
      // La apelación queda preparada al momento (IA con toda la evidencia; plantilla si falla).
      if (!c.appealText) {
        const brand = await reportBrand(api.workspaceId, api.userId);
        const signer = `${brand.contact ? `${brand.contact}\n` : ""}${brand.agency}, en nombre del titular de ${c.placeTitle}`;
        data.appealText = await appealText(api.workspaceId, api.userId ?? null, [c], signer, await getLearningStats(api.workspaceId).catch(() => null));
      }
    }
    if (action === "appeal") Object.assign(data, { appealedAt: now, nextCheckAt: new Date(now.getTime() + 3 * 86_400_000), checkMisses: 0 });
    if (action === "appeal_rejected") data.nextCheckAt = new Date(now.getTime() + 14 * 86_400_000);
    if (action === "legal") {
      data.channel = "legal";
      if (!c.legalText) {
        const brand = await reportBrand(api.workspaceId, api.userId);
        data.legalText = legalText(c, `${brand.contact ? `${brand.contact} · ` : ""}${brand.agency}`);
      }
    }
    if (action === "removed") {
      Object.assign(data, { removedAt: now, nextCheckAt: null });
      await markProfileConfirmed(api.workspaceId, c.contributorId).catch(() => undefined);
    }
    if (action === "reopen") Object.assign(data, { removedAt: null, nextCheckAt: new Date(now.getTime() + 3 * 86_400_000) });
  }
  await prisma.gmbReviewCase.updateMany({ where: { id: c.id, workspaceId: api.workspaceId }, data });
  const out = await prisma.gmbReviewCase.findFirst({ where: { id: c.id, workspaceId: api.workspaceId } });
  return NextResponse.json({ case: out });
});
