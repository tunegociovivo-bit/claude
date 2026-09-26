/** PATCH /api/v1/gmb/shield/profiles/[id] → estado (sospechoso|confirmado|descartado) y notas. */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

export const dynamic = "force-dynamic";

export const PATCH = withApi({ scope: "*" }, async (req, { params, api }) => {
  const p = z.object({ status: z.enum(["sospechoso", "confirmado", "descartado"]).optional(), notes: z.string().max(4000).optional() }).safeParse(await req.json().catch(() => null));
  if (!p.success) throw new ApiError(400, "validation_error", "Datos no válidos");
  const r = await prisma.gmbReviewerProfile.updateMany({ where: { id: params.id, workspaceId: api.workspaceId }, data: p.data });
  if (!r.count) throw new ApiError(404, "not_found", "Perfil no encontrado");
  return NextResponse.json({ ok: true });
});
