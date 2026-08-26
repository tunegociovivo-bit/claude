/**
 * Módulo Empleos — probar la conexión IMAP de la bandeja de alertas.
 *
 *  POST { user?, password?, host?, port? } → verifica que el buzón conecta y
 *  cuenta los correos no leídos (y cuántos de portales de empleo). Si se pasan
 *  credenciales, prueba esas (antes de guardar); si no, prueba las guardadas.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { testJobsInbox } from "@/lib/leads/sources/jobs-inbox";

export const dynamic = "force-dynamic";

const schema = z.object({
  user: z.string().max(200).optional(),
  password: z.string().max(400).optional(),
  host: z.string().max(120).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  storedImap: z.boolean().optional()
});

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const res = await testJobsInbox(api.workspaceId, {
    user: parsed.data.user,
    pass: parsed.data.password,
    host: parsed.data.host,
    port: parsed.data.port,
    forceStoredImap: parsed.data.storedImap
  });
  return NextResponse.json(res);
});
