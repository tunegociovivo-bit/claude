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
    // "message" → entrantes. "message.any" → TODOS (incluye los fromMe que
    // escribes desde el propio móvil) ; el handler ignora el entrante duplicado
    // de "message.any" y solo usa sus fromMe (respuestas hechas desde el
    // teléfono). "message.ack" → recibos de entrega de los envíos.
    events: ["message", "message.any", "message.ack"],
    hmac: null,
    retries: null,
    customHeaders: null
  };

  // Sesiones a configurar: la principal + TODOS los números extra (multi-número).
  // Antes solo se configuraba la principal, así que las respuestas a los números
  // extra (p. ej. "Sonia2") nunca llegaban al Inbox.
  let sessions: string[] = [cfg.session];
  try {
    const { getLeadChannels } = await import("@/lib/leads/channels");
    const channels = (await getLeadChannels(api.workspaceId)).filter((c) => c.active !== false);
    sessions = Array.from(new Set([cfg.session, ...channels.map((c) => c.name)]));
  } catch {
    sessions = [cfg.session];
  }

  // Intentamos PUT a /api/sessions/{session} con config completa. Si WAHA lo
  // rechaza por estar "WORKING" (422), se hace stop → put → start.
  async function putSession(sessionName: string) {
    return fetch(`${cfg.baseUrl}/api/sessions/${encodeURIComponent(sessionName)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Api-Key": cfg.apiKey },
      body: JSON.stringify({
        name: sessionName,
        config: { webhooks: [webhookPayload] }
      })
    });
  }

  const results: { session: string; ok: boolean; error?: string }[] = [];
  for (const sessionName of sessions) {
    let resp = await putSession(sessionName);
    if (!resp.ok && resp.status === 422) {
      // WAHA pide STOPPED para reconfigurar.
      try {
        await fetch(`${cfg.baseUrl}/api/sessions/${encodeURIComponent(sessionName)}/stop`, {
          method: "POST",
          headers: { "X-Api-Key": cfg.apiKey }
        });
        await new Promise((r) => setTimeout(r, 800));
        resp = await putSession(sessionName);
        await fetch(`${cfg.baseUrl}/api/sessions/${encodeURIComponent(sessionName)}/start`, {
          method: "POST",
          headers: { "X-Api-Key": cfg.apiKey }
        }).catch(() => {});
      } catch (e: any) {
        results.push({ session: sessionName, ok: false, error: `reconfig: ${e?.message ?? e}` });
        continue;
      }
    }
    if (resp.ok) {
      results.push({ session: sessionName, ok: true });
    } else {
      const txt = (await resp.text().catch(() => "")).slice(0, 200);
      results.push({ session: sessionName, ok: false, error: `${resp.status}: ${txt}` });
    }
  }

  const okCount = results.filter((r) => r.ok).length;
  if (okCount === 0) {
    throw new ApiError(502, "waha_error", `No se pudo configurar el webhook: ${results.map((r) => `${r.session} → ${r.error}`).join(" · ")}`);
  }

  return NextResponse.json({ ok: true, url, configured: okCount, sessions: results });
});
