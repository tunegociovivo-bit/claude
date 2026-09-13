import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { blockLeadCompletely } from "@/lib/leads/optout";
import { normalizePhone } from "@/lib/leads/waha";

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  const items = await prisma.leadOptout.findMany({
    where: { workspaceId: api.workspaceId },
    orderBy: { createdAt: "desc" },
    take: 500
  });
  return NextResponse.json({ items });
});

const createSchema = z.object({
  phone: z.string().min(1),
  reason: z.string().optional(),
  leadId: z.string().optional()
});

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const phone = normalizePhone(parsed.data.phone, "34");
  if (!phone) throw new ApiError(400, "invalid_phone", "El teléfono no es válido");
  if (parsed.data.leadId) {
    const owned = await prisma.lead.findFirst({ where: { id: parsed.data.leadId, workspaceId: api.workspaceId }, select: { id: true } });
    if (!owned) throw new ApiError(404, "lead_not_found", "Lead no encontrado");
  }
  await blockLeadCompletely({
    workspaceId: api.workspaceId,
    phone,
    leadId: parsed.data.leadId,
    reason: parsed.data.reason ?? "Baja manual",
    source: "manual"
  });
  const item = await prisma.leadOptout.findUnique({ where: { workspaceId_phone: { workspaceId: api.workspaceId, phone } } });
  return NextResponse.json(item, { status: 201 });
});
