/**
 * POST /api/v1/leads/evolution-webhook-setup
 *
 * Configura automáticamente el webhook en Evolution API para que reenvíe los
 * mensajes entrantes a /api/v1/leads/webhook/<token>. Equivalente al de WAHA:
 * sin esto, cuando el proveedor activo es Evolution, la pestaña Inbox no
 * recibe nada (Evolution nunca llamaba a nuestro webhook).
 *
 * Solo admins.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { evoSetWebhook } from "@/lib/leads/evolution";
import { publicBaseUrl } from "@/lib/public-url";

async function requireAdmin(workspaceId: string, userId: string | undefined) {
  if (!userId) throw new ApiError(401, "no_user", "Sesión requerida");
  const me = await prisma.membership.findFirst({ where: { workspaceId, userId } });
  if (!me || me.role !== "ADMIN") throw new ApiError(403, "forbidden", "Solo admins");
}

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  await requireAdmin(api.workspaceId, api.userId);

  const ws = await prisma.workspace.findUnique({ where: { id: api.workspaceId } });
  const s: any = (ws?.settings as any)?.leads ?? {};
  const token: string | undefined = s.webhookToken;
  if (!token) {
    throw new ApiError(400, "no_token", "Falta webhookToken en settings.leads — abre Ajustes una vez para generarlo.");
  }

  const baseUrl = publicBaseUrl(req, s.publicBaseUrl);
  const url = `${baseUrl.replace(/\/+$/, "")}/api/v1/leads/webhook/${token}`;

  let out;
  try {
    out = await evoSetWebhook({ workspaceId: api.workspaceId, url });
  } catch (e: any) {
    throw new ApiError(400, "not_configured", e?.message ?? "Evolution no configurado.");
  }
  if (!out.ok) {
    throw new ApiError(502, "evolution_error", `Evolution rechazó el webhook: ${out.error ?? "error"}`);
  }

  return NextResponse.json({ ok: true, url, instance: out.instance });
});
