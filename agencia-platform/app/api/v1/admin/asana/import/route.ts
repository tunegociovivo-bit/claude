import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { startAsanaImport } from "@/lib/asana/importer";
import { readAsanaToken, saveAsanaToken } from "@/lib/asana/token";

// `token` ahora es opcional: si no llega, usamos el de AsanaConnection
// guardado para el user actual.
const schema = z.object({
  token: z.string().min(10).optional(),
  asanaWorkspaceGid: z.string().min(1),
  projectGids: z.array(z.string()).optional(),
  // Opt-in: traer de vuelta tareas que estaban en la papelera. Por defecto NO,
  // para no resucitar lo que el usuario borró a propósito.
  restoreDeleted: z.boolean().optional()
});

export const POST = withApi({ scope: "admin" }, async (req, { api }) => {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  // Si el body trae token, lo trimeamos en sitio — antes pasábamos
  // el string crudo y, si tenía \n o espacios invisibles del copy-paste,
  // se persistía con basura y al usarlo después Asana devolvía 401.
  let token = parsed.data.token ? parsed.data.token.trim() : null;
  if (!token && api.userId) {
    const conn = await prisma.asanaConnection.findFirst({ where: { userId: api.userId }, orderBy: { createdAt: "desc" } });
    token = conn ? readAsanaToken(conn) : null;
  }
  if (!token) throw new ApiError(400, "no_token", "Falta token de Asana");

  // Guardamos el token cifrado en AsanaConnection si llegó nuevo y
  // hay user. saveAsanaToken también limpia internamente — doble red.
  if (parsed.data.token && api.userId) {
    await saveAsanaToken({ userId: api.userId, token });
  }

  const jobId = await startAsanaImport({
    workspaceId: api.workspaceId,
    asanaWorkspaceGid: parsed.data.asanaWorkspaceGid,
    token,
    projectGids: parsed.data.projectGids,
    restoreDeleted: parsed.data.restoreDeleted === true
  });

  return NextResponse.json({ jobId, status: "started" }, { status: 202 });
});
