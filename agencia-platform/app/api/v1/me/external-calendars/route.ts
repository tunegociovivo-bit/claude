/**
 * GET  /api/v1/me/external-calendars         → lista los del usuario
 * POST /api/v1/me/external-calendars         → crea uno nuevo
 *
 * Calendarios vinculados al usuario (Google, Outlook, iCloud) por URL
 * iCal (.ics). Cada uno se renderiza en /calendario junto a los eventos
 * del workspace, con su color propio.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  if (!api.userId) throw new ApiError(401, "unauthorized", "No hay usuario");
  const rows = await prisma.userExternalCalendar.findMany({
    where: { userId: api.userId, workspaceId: api.workspaceId },
    orderBy: { createdAt: "asc" }
  });
  // No devolver la URL completa por defecto (es un secreto) — sólo un
  // preview de los últimos 40 chars (para que el user reconozca cuál es).
  const safe = rows.map((r) => ({
    id: r.id,
    name: r.name,
    color: r.color,
    enabled: r.enabled,
    urlPreview: r.icsUrl.length > 40 ? "…" + r.icsUrl.slice(-40) : r.icsUrl,
    lastSyncedAt: r.lastSyncedAt,
    lastError: r.lastError,
    createdAt: r.createdAt
  }));
  return NextResponse.json({ items: safe });
});

const createSchema = z.object({
  name: z.string().min(1).max(80),
  icsUrl: z.string().url().or(z.string().startsWith("webcal://")),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default("#8b5cf6"),
  enabled: z.boolean().default(true)
});

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  if (!api.userId) throw new ApiError(401, "unauthorized", "No hay usuario");
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const created = await prisma.userExternalCalendar.create({
    data: {
      userId: api.userId,
      workspaceId: api.workspaceId,
      name: parsed.data.name,
      icsUrl: parsed.data.icsUrl,
      color: parsed.data.color,
      enabled: parsed.data.enabled
    }
  });
  return NextResponse.json({ id: created.id }, { status: 201 });
});
