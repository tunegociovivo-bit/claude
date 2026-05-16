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
 *
 * Si el flow es "useSaved" y Asana devuelve 401 (el token guardado
 * ya no vale: caducó, fue revocado o lo borraron en Asana), eliminamos
 * automáticamente la conexión y respondemos con un error claro para
 * que la UI pida un token nuevo.
 */
export const POST = withApi({ scope: "admin" }, async (req, { api }) => {
  const body = await req.json().catch(() => null);
  let token: string | null = null;
  const fromSaved = !!body?.useSaved;

  if (fromSaved) {
    if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");
    const conn = await prisma.asanaConnection.findFirst({ where: { userId: api.userId } });
    if (!conn) throw new ApiError(404, "no_saved_token", "No hay token guardado");
    token = readAsanaToken(conn);
    if (!token) {
      // Cifrado corrupto / NEXTAUTH_SECRET cambió. Borrar y pedir uno
      // nuevo.
      await prisma.asanaConnection.deleteMany({ where: { userId: api.userId } });
      throw new ApiError(
        500,
        "decrypt_failed",
        "El token guardado no se pudo descifrar (probablemente NEXTAUTH_SECRET cambió). Conexión borrada — pega un token nuevo."
      );
    }
  } else {
    token = typeof body?.token === "string" ? body.token.trim() : null;
    if (!token) throw new ApiError(400, "validation_error", "Falta el campo token");
  }

  try {
    const me = await new AsanaClient(token).me();
    // Si entró por `token` (no por `useSaved`), guarda cifrado para
    // las próximas pasadas. Reemplaza cualquier token previo.
    if (!fromSaved && api.userId) {
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
    const msg = String(e?.message ?? "");
    // Asana respondió 401: el token no vale. Si veníamos del guardado,
    // lo eliminamos automáticamente para que la próxima vez la UI pida
    // uno nuevo en lugar de seguir intentando con el malo.
    if (fromSaved && /Asana 401/i.test(msg) && api.userId) {
      await prisma.asanaConnection.deleteMany({ where: { userId: api.userId } });
      throw new ApiError(
        401,
        "saved_token_invalid",
        "El token guardado ya no es válido en Asana (revocado o caducado). Lo he borrado — pega un token nuevo."
      );
    }
    throw new ApiError(401, "asana_auth_failed", msg || "Token no válido");
  }
});
