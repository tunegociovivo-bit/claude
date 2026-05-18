/**
 * POST /api/v1/admin/security/purge-demo-users
 *
 * Purga las cuentas demo creadas por scripts/seed.ts que viven aún
 * en producción. Estas cuentas tienen email matching `*@agencia.local`
 * y password "agencia123" — fuga de seguridad reportada por el user.
 *
 * Idempotente: si no hay cuentas demo, devuelve 0 borrados.
 *
 * Solo ADMIN puede ejecutarlo. Confirma con ?confirm=YES como
 * doble seguro: sin él, devuelve solo el conteo (dry-run).
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { callerIsAdmin } from "@/lib/api/permissions";

export const dynamic = "force-dynamic";

const DEMO_EMAIL_PATTERN = "@agencia.local";

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  if (!(await callerIsAdmin(api))) {
    throw new ApiError(403, "forbidden", "Solo admin");
  }
  const url = new URL(req.url);
  const confirm = url.searchParams.get("confirm");

  // Listamos primero — para devolver info al admin sin tocar nada
  // si no llega confirm=YES.
  const found = await prisma.user.findMany({
    where: { email: { endsWith: DEMO_EMAIL_PATTERN } },
    select: { id: true, email: true, name: true, role: true, createdAt: true }
  });

  if (confirm !== "YES") {
    return NextResponse.json({
      dryRun: true,
      found: found.length,
      users: found,
      hint: "Llama POST con ?confirm=YES para borrarlos."
    });
  }

  if (found.length === 0) {
    return NextResponse.json({ ok: true, deleted: 0, message: "No hay cuentas demo en BD." });
  }

  // SEGURIDAD ADICIONAL: nunca borrar al propio caller, aunque
  // su email coincidiera con el patrón (defensa en profundidad).
  const ids = found.filter((u) => u.id !== api.userId).map((u) => u.id);
  // Borramos. Memberships y demás caen en cascada por las FK del schema.
  const r = await prisma.user.deleteMany({ where: { id: { in: ids } } });

  return NextResponse.json({
    ok: true,
    deleted: r.count,
    skippedSelf: found.length - ids.length,
    emails: found.filter((u) => u.id !== api.userId).map((u) => u.email)
  });
});

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  if (!(await callerIsAdmin(api))) {
    throw new ApiError(403, "forbidden", "Solo admin");
  }
  const found = await prisma.user.findMany({
    where: { email: { endsWith: DEMO_EMAIL_PATTERN } },
    select: { id: true, email: true, name: true, role: true, createdAt: true }
  });
  return NextResponse.json({ found: found.length, users: found });
});
