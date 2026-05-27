/**
 * GET → resumen de calidad de datos (sin acciones).
 * POST { action: "rescore_all" | "validate_whatsapp" | "find_duplicates" }
 *   ejecuta la acción correspondiente.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import {
  rescoreAll,
  validatePendingWhatsapp,
  findDuplicateGroups
} from "@/lib/leads/data-quality";
import { prisma } from "@/lib/db/prisma";

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  const [pendingWa, totalLeads, withScore] = await Promise.all([
    prisma.lead.count({
      where: { workspaceId: api.workspaceId, whatsappChecked: false }
    }),
    prisma.lead.count({ where: { workspaceId: api.workspaceId } }),
    prisma.lead.count({ where: { workspaceId: api.workspaceId, score: { not: null } } })
  ]);
  return NextResponse.json({
    totalLeads,
    withScore,
    withoutScore: totalLeads - withScore,
    pendingWhatsappCheck: pendingWa
  });
});

const schema = z.object({
  action: z.enum(["rescore_all", "validate_whatsapp", "find_duplicates"]),
  limit: z.number().int().min(1).max(2000).optional()
});

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  try {
    if (parsed.data.action === "rescore_all") {
      const r = await rescoreAll({ workspaceId: api.workspaceId, limit: parsed.data.limit });
      return NextResponse.json(r);
    }
    if (parsed.data.action === "validate_whatsapp") {
      const r = await validatePendingWhatsapp({ workspaceId: api.workspaceId, limit: parsed.data.limit ?? 50 });
      return NextResponse.json(r);
    }
    if (parsed.data.action === "find_duplicates") {
      const r = await findDuplicateGroups({ workspaceId: api.workspaceId, limit: parsed.data.limit ?? 50 });
      return NextResponse.json({ groups: r });
    }
    throw new ApiError(400, "unknown_action", parsed.data.action);
  } catch (e: any) {
    throw new ApiError(500, "dq_error", e?.message ?? "Error en data quality");
  }
});
