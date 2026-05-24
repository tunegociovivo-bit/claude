/**
 * GET /api/v1/leads/waha-test
 *
 * Prueba en vivo las credenciales WAHA guardadas (settings.leads.waha* o el
 * fallback integrations.evolution). Llama a WAHA `/api/sessions/{session}` y
 * devuelve si el servidor responde, el estado de la sesión y qué teléfono
 * está vinculado — sin enviar ningún mensaje. Solo admins.
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

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  await requireAdmin(api.workspaceId, api.userId);

  let cfg;
  try {
    cfg = await getWahaConfig(api.workspaceId);
  } catch (e: any) {
    return NextResponse.json({
      ok: false,
      code: "not_configured",
      message: e?.message ?? "WAHA no configurado. Guarda URL + API key en Ajustes."
    });
  }

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  let resp: Response;
  try {
    resp = await fetch(`${cfg.baseUrl}/api/sessions/${encodeURIComponent(cfg.session)}`, {
      headers: { "X-Api-Key": cfg.apiKey, Accept: "application/json" },
      signal: ctrl.signal
    });
  } catch (e: any) {
    clearTimeout(t);
    return NextResponse.json({
      ok: false,
      code: "unreachable",
      url: cfg.baseUrl,
      session: cfg.session,
      message:
        e?.name === "AbortError"
          ? `El servidor WAHA (${cfg.baseUrl}) no respondió en 8s. Comprueba que la URL es correcta y que el servidor está encendido.`
          : `No se pudo conectar a ${cfg.baseUrl}. Revisa la URL del servidor WAHA. (${e?.message ?? "error de red"})`
    });
  }
  clearTimeout(t);

  if (resp.status === 401 || resp.status === 403) {
    return NextResponse.json({
      ok: false,
      code: "bad_key",
      url: cfg.baseUrl,
      session: cfg.session,
      message: "El servidor respondió pero rechazó la API key. Revisa la WAHA API key."
    });
  }
  if (resp.status === 404) {
    return NextResponse.json({
      ok: false,
      code: "session_not_found",
      url: cfg.baseUrl,
      session: cfg.session,
      message: `El servidor responde pero no existe la sesión "${cfg.session}". Revisa el "Nombre sesión" en Ajustes (o el servidor podría ser Evolution API, no WAHA).`
    });
  }
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    return NextResponse.json({
      ok: false,
      code: "http_error",
      url: cfg.baseUrl,
      session: cfg.session,
      message: `WAHA respondió ${resp.status}. ${txt.slice(0, 160)}`
    });
  }

  const data: any = await resp.json().catch(() => null);
  if (!data || typeof data.status !== "string") {
    return NextResponse.json({
      ok: false,
      code: "unexpected_response",
      url: cfg.baseUrl,
      session: cfg.session,
      message:
        "El servidor respondió pero no con el formato de WAHA. Es probable que sea Evolution API (endpoints distintos), no WAHA. Avísame y añado el conector de Evolution."
    });
  }

  const status: string = data.status; // STARTING | SCAN_QR_CODE | WORKING | FAILED | STOPPED
  const working = status === "WORKING";
  return NextResponse.json({
    ok: working,
    code: working ? "ok" : "not_linked",
    url: cfg.baseUrl,
    session: cfg.session,
    status,
    meId: data?.me?.id ?? null,
    mePushName: data?.me?.pushName ?? null,
    engine: data?.engine?.engine ?? null,
    message: working
      ? `Conectado. Sesión "${cfg.session}" vinculada${data?.me?.id ? ` al número ${String(data.me.id).replace(/@.*$/, "")}` : ""}.`
      : `El servidor responde y la API key es válida, pero la sesión "${cfg.session}" está en estado ${status} (no vinculada). Escanea el QR en tu servidor WAHA o arranca la sesión.`
  });
});
