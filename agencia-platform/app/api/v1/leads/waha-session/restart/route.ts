/**
 * POST /api/v1/leads/waha-session/restart
 *
 * Reinicia la sesión WAHA cuando está FAILED/STOPPED para volver a
 * vincularla. Usa la API nueva (POST /api/sessions/{name}/restart) y, si el
 * servidor no la soporta (404), cae a stop + start. Tras reiniciar, la sesión
 * pasa a STARTING → SCAN_QR_CODE (escanear QR) o WORKING (si las credenciales
 * seguían en el servidor). Solo admins.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { getWahaConfig } from "@/lib/leads/waha";

async function requireAdmin(workspaceId: string, userId: string | undefined) {
  if (!userId) throw new ApiError(401, "no_user", "Sesión requerida");
  const me = await prisma.membership.findFirst({ where: { workspaceId, userId } });
  if (!me || me.role !== "ADMIN") throw new ApiError(403, "forbidden", "Solo admins");
}

export const POST = withApi({ scope: "*" }, async (_req, { api }) => {
  await requireAdmin(api.workspaceId, api.userId);

  let cfg;
  try {
    cfg = await getWahaConfig(api.workspaceId);
  } catch (e: any) {
    return NextResponse.json({ ok: false, code: "not_configured", message: e?.message ?? "WAHA no configurado." });
  }

  const headers = { "Content-Type": "application/json", "X-Api-Key": cfg.apiKey };
  const s = encodeURIComponent(cfg.session);

  async function call(url: string, body?: any) {
    return fetch(url, { method: "POST", headers, body: body ? JSON.stringify(body) : undefined });
  }

  try {
    let resp = await call(`${cfg.baseUrl}/api/sessions/${s}/restart`);
    if (resp.status === 404 || resp.status === 405) {
      // API antigua: stop + start con el nombre en el body
      await call(`${cfg.baseUrl}/api/sessions/stop`, { name: cfg.session }).catch(() => null);
      resp = await call(`${cfg.baseUrl}/api/sessions/start`, { name: cfg.session });
    }
    if (resp.status === 401 || resp.status === 403) {
      return NextResponse.json({ ok: false, code: "bad_key", message: "El servidor rechazó la API key al reiniciar." });
    }
    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      return NextResponse.json({ ok: false, code: "http_error", message: `WAHA respondió ${resp.status} al reiniciar. ${txt.slice(0, 160)}` });
    }
    const data: any = await resp.json().catch(() => ({}));
    return NextResponse.json({
      ok: true,
      status: data?.status ?? "STARTING",
      message: "Sesión reiniciada. Espera unos segundos y, si pide QR, escanéalo con el teléfono de Sonia."
    });
  } catch (e: any) {
    return NextResponse.json({
      ok: false,
      code: "unreachable",
      message: `No se pudo conectar a ${cfg.baseUrl} para reiniciar. (${e?.message ?? "error de red"})`
    });
  }
});
