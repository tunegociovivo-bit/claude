/**
 * POST /api/v1/admin/secrets/reveal
 * Body: { id: string, password: string }
 *
 * Revela el valor EN CLARO de un secreto. Requiere:
 *   - ser ADMIN del workspace
 *   - re-autenticación: la contraseña del propio usuario (bcrypt)
 *
 * Cada revelación se registra en el audit log (quién, qué secreto,
 * cuándo) — es una acción sensible.
 */
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { revealSecret } from "@/lib/admin/secrets-vault";
import { auditFromReq } from "@/lib/audit/log";

export const dynamic = "force-dynamic";

export const POST = withApi({ scope: "admin", rate: "destructive" }, async (req, { api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");

  const me = await prisma.membership.findFirst({
    where: { workspaceId: api.workspaceId, userId: api.userId }
  });
  if (!me || me.role !== "ADMIN") {
    throw new ApiError(403, "forbidden", "Solo admins");
  }

  const body = await req.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!id || !password) {
    throw new ApiError(400, "validation_error", "id y password requeridos");
  }

  // Re-autenticación: verificar la contraseña del usuario.
  const user = await prisma.user.findUnique({
    where: { id: api.userId },
    select: { passwordHash: true }
  });
  if (!user?.passwordHash) {
    throw new ApiError(400, "no_password", "Tu cuenta no tiene contraseña configurada para re-autenticar.");
  }
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    throw new ApiError(401, "bad_password", "Contraseña incorrecta.");
  }

  const value = await revealSecret(api.workspaceId, id);
  if (value === null) {
    throw new ApiError(404, "not_found", "Secreto no encontrado o no se pudo descifrar.");
  }

  // Audit: registrar la revelación (sin guardar el valor en el log).
  auditFromReq(req, api, {
    action: "secret.reveal",
    targetType: "WORKSPACE",
    targetId: api.workspaceId,
    meta: { secretId: id }
  });

  return NextResponse.json({ id, value });
});
