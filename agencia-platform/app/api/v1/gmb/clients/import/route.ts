/**
 * POST /api/v1/gmb/clients/import
 * Body: { clients: [{ name, category?, accountId?, locationId?, emails?, tone?, mainKeyword?, description?, frequency? }] }
 * Importa fichas en bloque (p.ej. export del WordPress GMB Hub). Idempotente
 * por nombre dentro del workspace: si ya existe una ficha con ese nombre, la
 * actualiza; si no, la crea.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

export const dynamic = "force-dynamic";

const clientSchema = z.object({
  name: z.string().min(1).max(255),
  category: z.string().optional(),
  description: z.string().optional(),
  tone: z.string().optional(),
  customTone: z.string().optional(),
  accountId: z.string().optional(),
  locationId: z.string().optional(),
  emails: z.string().optional(),
  mainKeyword: z.string().optional(),
  autoReply: z.enum(["manual", "auto"]).optional(),
  frequency: z.coerce.number().int().min(1).max(1440).optional(),
  placeId: z.string().optional(),
  phone: z.string().optional(),
  website: z.string().optional(),
  address: z.string().optional(),
  status: z.enum(["active", "paused"]).optional()
});

const schema = z.object({ clients: z.array(clientSchema).min(1).max(1000) });

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  let created = 0;
  let updated = 0;
  for (const d of parsed.data.clients) {
    const existing = await prisma.gmbClient.findFirst({
      where: { workspaceId: api.workspaceId, name: d.name },
      select: { id: true }
    });
    const data = {
      category: d.category ?? "",
      description: d.description ?? null,
      tone: d.tone ?? "profesional",
      customTone: d.customTone ?? null,
      accountId: d.accountId ?? "",
      locationId: d.locationId ?? "",
      emails: d.emails ?? "",
      mainKeyword: d.mainKeyword ?? "",
      autoReply: d.autoReply ?? "manual",
      frequency: d.frequency ?? 15,
      placeId: d.placeId ?? "",
      phone: d.phone ?? "",
      website: d.website ?? "",
      address: d.address ?? "",
      status: d.status ?? "active"
    };
    if (existing) {
      await prisma.gmbClient.update({ where: { id: existing.id }, data });
      updated++;
    } else {
      await prisma.gmbClient.create({ data: { workspaceId: api.workspaceId, name: d.name, ...data } });
      created++;
    }
  }
  return NextResponse.json({ ok: true, created, updated });
});
