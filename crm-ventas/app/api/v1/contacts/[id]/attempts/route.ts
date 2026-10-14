import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { isSameOrigin } from "@/lib/auth";
import { inboxError, requireInboxUser } from "@/lib/inbox/api";
import { getLeadsState } from "@/lib/leads/settings";
import { addAttempt, readAttempts, removeAttempt, validAttemptDate } from "@/lib/leads/config";

export const dynamic = "force-dynamic";

const addSchema = z.object({
  at: z.string().max(40).optional().nullable(), // ISO; vacío = ahora
  note: z.string().max(200).optional().nullable(),
});

// Lectura y escritura en la misma transacción: dos personas apuntando a la vez
// no se pisan.
async function mutate(workspaceId: string, contactId: string, fn: (raw: unknown) => unknown) {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ contactAttempts: unknown }>>`SELECT "contactAttempts" FROM "Contact" WHERE "id" = ${contactId} AND "workspaceId" = ${workspaceId} FOR UPDATE`;
    if (!rows.length) return null;
    const next = fn(rows[0].contactAttempts);
    await tx.contact.update({ where: { id: contactId }, data: { contactAttempts: next as any } });
    return readAttempts(next);
  });
}

async function guard(req: NextRequest) {
  if (!isSameOrigin(req)) return { error: Response.json({ error: "Origen no permitido" }, { status: 403 }) };
  const user = await requireInboxUser();
  const leads = await getLeadsState(user.workspaceId);
  if (!leads.enabled) return { error: Response.json({ error: "El módulo de leads no está activo" }, { status: 403 }) };
  return { user };
}

// POST → apunta un intento de contacto (ahora o a la hora indicada).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const g = await guard(req);
    if ("error" in g) return g.error;
    const parsed = addSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return Response.json({ error: "Datos no válidos" }, { status: 400 });
    const at = validAttemptDate(parsed.data.at);
    if (!at) return Response.json({ error: "La hora no es válida (no puede ser futura)" }, { status: 400 });
    const me = await prisma.user.findUnique({ where: { id: g.user.userId }, select: { name: true, email: true } });
    const attempts = await mutate(g.user.workspaceId, params.id, (raw) =>
      addAttempt(raw, { at, by: g.user.userId, byName: me?.name || me?.email || null, note: parsed.data.note ?? null })
    );
    if (!attempts) return Response.json({ error: "Contacto no encontrado" }, { status: 404 });
    return Response.json({ ok: true, attempts }, { status: 201 });
  } catch (error) {
    return inboxError(error);
  }
}

// DELETE ?attempt=<id> → borra un intento apuntado por error.
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const g = await guard(req);
    if ("error" in g) return g.error;
    const attemptId = (req.nextUrl.searchParams.get("attempt") ?? "").slice(0, 40);
    if (!attemptId) return Response.json({ error: "Falta el intento" }, { status: 400 });
    const attempts = await mutate(g.user.workspaceId, params.id, (raw) => removeAttempt(raw, attemptId));
    if (!attempts) return Response.json({ error: "Contacto no encontrado" }, { status: 404 });
    return Response.json({ ok: true, attempts });
  } catch (error) {
    return inboxError(error);
  }
}
