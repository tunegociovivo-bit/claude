import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { callerIsAdmin } from "@/lib/api/permissions";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  description: z.string().max(2000).nullable().optional(),
  baseAmountEur: z.number().positive().optional(),
  minAmountEur: z.number().positive().optional(),
  unit: z.enum(["one_time", "monthly", "hourly"]).optional(),
  tradeoffs: z.array(z.string()).max(20).optional(),
  active: z.boolean().optional()
});

export const PATCH = withApi({ scope: "*" }, async (req, { params, api }) => {
  if (!(await callerIsAdmin(api))) throw new ApiError(403, "forbidden", "Solo admin");
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  // Filtra por workspace (evita editar tarifas de otro tenant).
  const res = await prisma.pricingService.updateMany({
    where: { id: params.id, workspaceId: api.workspaceId },
    data: parsed.data as any
  });
  if (res.count === 0) throw new ApiError(404, "not_found", "Servicio no encontrado");
  const updated = await prisma.pricingService.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId }
  });
  return NextResponse.json({ ok: true, item: updated });
});

export const DELETE = withApi({ scope: "*", rate: "destructive" }, async (_req, { params, api }) => {
  if (!(await callerIsAdmin(api))) throw new ApiError(403, "forbidden", "Solo admin");
  await prisma.pricingService.deleteMany({
    where: { id: params.id, workspaceId: api.workspaceId }
  });
  return NextResponse.json({ ok: true });
});
