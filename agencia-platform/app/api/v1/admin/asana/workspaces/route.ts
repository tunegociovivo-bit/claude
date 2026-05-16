import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { AsanaClient } from "@/lib/asana/client";
import { readAsanaToken, saveAsanaToken } from "@/lib/asana/token";

/**
 * Acepta dos formas:
 *   { token: "1/12..." } → valida ese token (típico al conectarse
 *     por primera vez).
 *   { useSaved: true } → lee el token cifrado de AsanaConnection
 *     del user logueado y lo valida (sin tener que volver a pegarlo).
 *
 * Si el flow es "token", al éxito se guarda cifrado para que la
 * próxima vez baste con useSaved.
 */
export const POST = withApi({ scope: "admin" }, async (req, { api }) => {
  const body = await req.json().catch(() => null);
  let token: string | null = null;

  if (body?.useSaved) {
    if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");
    const conn = await prisma.asanaConnection.findFirst({ where: { userId: api.userId } });
    if (!conn) throw new ApiError(404, "no_saved_token", "No hay token guardado");
    token = readAsanaToken(conn);
    if (!token) throw new ApiError(500, "decrypt_failed", "No se pudo descifrar el token guardado");
  } else {
    token = typeof body?.token === "string" ? body.token : null;
    if (!token) throw new ApiError(400, "validation_error", "Falta el campo token");
  }

  try {
    const me = await new AsanaClient(token).me();
    // Si entró por `token` (no por `useSaved`), guarda cifrado para
    // las próximas pasadas. Idempotente.
    if (!body?.useSaved && api.userId) {
      await saveAsanaToken({
        userId: api.userId,
        token,
        asanaUserId: me.data.gid
      });
    }
    return NextResponse.json({
      user: { name: me.data.name, email: me.data.email },
      workspaces: me.data.workspaces
    });
  } catch (e: any) {
    throw new ApiError(401, "asana_auth_failed", e?.message ?? "Token no válido");
  }
});
