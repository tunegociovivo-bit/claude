import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

const schema = z.object({ decision: z.enum(["approved", "rejected"]) });
export const PATCH = withApi({}, async (req, { api, params }) => {
  const parsed = schema.safeParse(await req.json().catch(() => null)); if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const existing = await prisma.metaOptimizationProposal.findFirst({ where: { id: params.id, workspaceId: api.workspaceId, status: "pending" }, select: { id: true } }); if (!existing) throw new ApiError(404, "not_found", "Propuesta pendiente no encontrada");
  const item = await prisma.metaOptimizationProposal.update({ where: { id: existing.id }, data: { status: parsed.data.decision, approvedById: parsed.data.decision === "approved" ? api.userId : null, approvedAt: parsed.data.decision === "approved" ? new Date() : null } });
  return NextResponse.json({ item, execution: "not_executed", message: parsed.data.decision === "approved" ? "Aprobada y pendiente de ejecución segura" : "Propuesta descartada" });
});
