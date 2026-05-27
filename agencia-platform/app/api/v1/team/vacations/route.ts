import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

// GET /api/v1/team/vacations?from=YYYY-MM-DD&to=YYYY-MM-DD
// Lista vacaciones del workspace en ese rango. Si no se pasa rango,
// devuelve desde el primer día del mes actual hasta +6 meses.
export const GET = withApi({ scope: "*" }, async (req, { api }) => {
  const url = new URL(req.url);
  const fromStr = url.searchParams.get("from");
  const toStr = url.searchParams.get("to");
  const now = new Date();
  const from = fromStr ? new Date(fromStr) : new Date(now.getFullYear(), now.getMonth(), 1);
  const to = toStr ? new Date(toStr) : new Date(now.getFullYear(), now.getMonth() + 6, 0);

  const rows = await (prisma as any).vacationDay.findMany({
    where: { workspaceId: api.workspaceId, date: { gte: from, lte: to } },
    include: { user: { select: { id: true, name: true, email: true, image: true } } },
    orderBy: { date: "asc" }
  });

  // Sellado oportunista: cualquier vacación de fecha pasada que aún no
  // tenga lockedAt, la marcamos como bloqueada para que la UI sepa que
  // ya no se puede editar. Más limpio que un cron aparte.
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const toLock = rows.filter((r: any) => !r.lockedAt && r.date < startOfToday).map((r: any) => r.id);
  if (toLock.length > 0) {
    await (prisma as any).vacationDay.updateMany({
      where: { id: { in: toLock } },
      data: { lockedAt: new Date() }
    });
  }

  const items = rows.map((r: any) => ({
    id: r.id,
    userId: r.userId,
    user: r.user,
    date: r.date.toISOString().slice(0, 10),
    note: r.note,
    locked: !!r.lockedAt || r.date < startOfToday
  }));

  return NextResponse.json({ items });
});

const createSchema = z.object({
  dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1),
  note: z.string().optional()
});

// POST /api/v1/team/vacations  { dates: ["YYYY-MM-DD", ...], note? }
// Marca esos días como vacaciones del usuario logueado. Idempotente:
// si ya estaba marcado se ignora (la unique key (workspace,user,date)
// nos protege).
export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  // Filtra fechas pasadas — no se pueden marcar retroactivamente.
  const dates = parsed.data.dates
    .map((d) => new Date(d + "T00:00:00"))
    .filter((d) => d >= startOfToday);

  if (dates.length === 0) throw new ApiError(400, "no_valid_dates", "Sólo puedes marcar días futuros.");

  await (prisma as any).vacationDay.createMany({
    data: dates.map((date) => ({
      workspaceId: api.workspaceId,
      userId: api.userId!,
      date,
      note: parsed.data.note ?? null
    })),
    skipDuplicates: true
  });
  return NextResponse.json({ ok: true, created: dates.length }, { status: 201 });
});

// DELETE /api/v1/team/vacations?date=YYYY-MM-DD
// Borra el marcado del usuario logueado para esa fecha. Sólo si la
// fecha no está pasada (las pasadas quedan bloqueadas permanentemente).
export const DELETE = withApi({ scope: "*" }, async (req, { api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");
  const url = new URL(req.url);
  const dateStr = url.searchParams.get("date");
  if (!dateStr) throw new ApiError(400, "missing_date", "Falta date");
  const date = new Date(dateStr + "T00:00:00");
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  if (date < startOfToday) throw new ApiError(400, "locked", "Esta fecha ya pasó y queda bloqueada.");

  await (prisma as any).vacationDay.deleteMany({
    where: { workspaceId: api.workspaceId, userId: api.userId, date }
  });
  return NextResponse.json({ ok: true });
});
