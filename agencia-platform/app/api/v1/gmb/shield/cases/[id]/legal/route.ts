/** POST /api/v1/gmb/shield/cases/[id]/legal → (re)genera el texto para el formulario legal de Google. */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { legalText } from "@/lib/gmb/fake-reviews/cases";
import { reportBrand } from "@/lib/gmb/fake-reviews/brand";

export const dynamic = "force-dynamic";

export const POST = withApi({ scope: "*" }, async (_req, { params, api }) => {
  const c = await prisma.gmbReviewCase.findFirst({ where: { id: params.id, workspaceId: api.workspaceId } });
  if (!c) throw new ApiError(404, "not_found", "Caso no encontrado");
  const brand = await reportBrand(api.workspaceId, api.userId);
  const text = legalText(c, `${brand.contact ? `${brand.contact} · ` : ""}${brand.agency}`);
  await prisma.gmbReviewCase.updateMany({ where: { id: c.id, workspaceId: api.workspaceId }, data: { legalText: text } });
  return NextResponse.json({ text });
});
