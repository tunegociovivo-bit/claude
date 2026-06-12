/**
 * POST /api/v1/leads/waha-webhook-setup
 *
 * Configura automáticamente el webhook en el servidor WAHA para que reenvíe
 * los mensajes entrantes a /api/v1/leads/webhook/<token>. Necesario para que
 * la pestaña Inbox empiece a recibir las respuestas de los leads.
 *
 * WAHA API: PUT /api/sessions/{session} con
 *   { config: { webhooks: [{ url, events: ["message","message.any"] }] } }
 *
 * Solo admins.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { getWahaConfig, type WahaConfig } from "@/lib/leads/waha";
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
  if (!token) throw new ApiError(400, "no_token", "Falta webhookToken en settings.leads — abre Ajustes una vez para generarlo.");

  let cfg: WahaConfig;
  try {
    cfg = await getWahaConfig(api.workspaceId);
  } catch (e: any) {
    throw new ApiError(400, "not_configured", e?.message ?? "WAHA no configurado.");
  }

  // URL PÚBLICA del Hub (detrás del proxy, req.url da el host interno del
  // contenedor y el webhook quedaría inalcanzable). Override por
  // settings.leads.publicBaseUrl si hiciera falta.
  const baseUrl = publicBaseUrl(req, s.publicBaseUrl);
  const url = `${baseUrl.replace(/\/+$/, "")}/api/v1/leads/webhook/${token}`;

  const webhookPayload = {
    url,
    events: ["message", "message.any"],
    hmac: null,
    retries: null,
    customHeaders: null
  };

  // Intentamos primero PUT a /api/sessions/{session} con config completa.
  // Si WAHA rechaza por estar la sesión "WORKING", se hace stop → put → start.
  async function putSession() {
    return fetch(`${cfg.baseUrl}/api/sessions/${encodeURIComponent(cfg.session)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Api-Key": cfg.apiKey },
      body: JSON.stringify({
        name: cfg.session,
        config: { webhooks: [webhookPayload] }
      })
    });
  }

  let resp = await putSession();
  if (!resp.ok && resp.status === 422) {
    // WAHA pide STOPPED para reconfigurar.
    try {
      await fetch(`${cfg.baseUrl}/api/sessions/${encodeURIComponent(cfg.session)}/stop`, {
        method: "POST",
        headers: { "X-Api-Key": cfg.apiKey }
      });
      await new Promise((r) => setTimeout(r, 800));
      resp = await putSession();
      // Vuelve a arrancar (aunque haya fallado el PUT, lo dejamos como estaba).
      await fetch(`${cfg.baseUrl}/api/sessions/${encodeURIComponent(cfg.session)}/start`, {
        method: "POST",
        headers: { "X-Api-Key": cfg.apiKey }
      }).catch(() => {});
    } catch (e: any) {
      throw new ApiError(502, "waha_unreachable", `No se pudo reconfigurar la sesión WAHA: ${e?.message ?? e}`);
    }
  }

  if (!resp.ok) {
    const txt = (await resp.text().catch(() => "")).slice(0, 300);
    throw new ApiError(502, "waha_error", `WAHA ${resp.status}: ${txt}`);
  }

  return NextResponse.json({ ok: true, url, session: cfg.session });
});
