/**
 * POST /api/v1/leads/sequences/reactivate
 *
 * Reactivación de leads fríos: enrola en una secuencia (normalmente una de
 * "reactivación") a los leads que se contactaron hace tiempo y no llegaron a
 * cliente. Útil para reaprovechar los "ahora no" de hace meses.
 *
 * Body: { sequenceId, olderThanDays?=60, statuses?=["contacted","responded"], limit?=300 }
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { enrollLeadInSequence } from "@/lib/leads/sequences";

const schema = z.object({
  sequenceId: z.string().min(1),
  olderThanDays: z.number().int().min(1).max(365).optional().default(60),
  statuses: z.array(z.string()).optional().default(["contacted", "responded"]),
  limit: z.number().int().min(1).max(1000).optional().default(300)
});

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const { sequenceId, olderThanDays, statuses, limit } = parsed.data;

  const seq = await prisma.leadSequence.findFirst({
    where: { id: sequenceId, workspaceId: api.workspaceId }
  });
  if (!seq) throw new ApiError(404, "not_found", "Secuencia no encontrada");

  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);

  // Candidatos: contactados hace tiempo, aún no clientes, con teléfono y sin
  // baja. Se ordenan del más antiguo al más reciente (los más fríos primero).
  const candidates = await prisma.lead.findMany({
    where: {
      workspaceId: api.workspaceId,
      contactStatus: { in: statuses },
      convertedClientId: null,
      phone: { not: null },
      updatedAt: { lt: cutoff }
    },
    select: { id: true },
    orderBy: { updatedAt: "asc" },
    take: limit
  });
  if (candidates.length === 0) {
    return NextResponse.json({ ok: true, total: 0, enrolled: 0, failed: 0 });
  }

  // Excluir los que tengan baja registrada (LeadOptout con su leadId).
  const optouts = await prisma.leadOptout.findMany({
    where: { workspaceId: api.workspaceId, leadId: { in: candidates.map((c) => c.id) } },
    select: { leadId: true }
  });
  const optedOut = new Set(optouts.map((o) => o.leadId));
  const targets = candidates.filter((c) => !optedOut.has(c.id));

  let enrolled = 0;
  let failed = 0;
  for (const c of targets) {
    try {
      await enrollLeadInSequence({ workspaceId: api.workspaceId, leadId: c.id, sequenceId });
      enrolled++;
    } catch {
      // Lead excluido/descartado o ya en la secuencia → se ignora.
      failed++;
    }
  }

  return NextResponse.json({ ok: true, total: targets.length, enrolled, failed });
});
