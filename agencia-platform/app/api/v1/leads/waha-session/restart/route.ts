/**
 * POST /api/v1/leads/waha-session/restart
 *
 * Reconecta la sesión WAHA forzando un QR nuevo. Un simple restart reutiliza
 * las credenciales cacheadas: si están rotas (sesión FAILED tras cerrarla
 * desde el móvil) vuelve a FAILED sin pasar por SCAN_QR_CODE. Por eso:
 *   1. logout  → limpia la autenticación rota
 *   2. start   → arranca de cero ⇒ SCAN_QR_CODE (escanear QR)
 *   3. si start falla ⇒ delete + create(start) para resetear la sesión entera
 *
 * El cliente sondea el estado y muestra el QR. Solo admins.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { getWahaConfig, getWhatsappProvider } from "@/lib/leads/waha";
import { evoConnect } from "@/lib/leads/evolution";

async function requireAdmin(workspaceId: string, userId: string | undefined) {
  if (!userId) throw new ApiError(401, "no_user", "Sesión requerida");
  const me = await prisma.membership.findFirst({ where: { workspaceId, userId } });
  if (!me || me.role !== "ADMIN") throw new ApiError(403, "forbidden", "Solo admins");
}

export const POST = withApi({ scope: "*" }, async (_req, { api }) => {
  await requireAdmin(api.workspaceId, api.userId);

  // Evolution: iniciar/recuperar conexión (genera QR si no está vinculada).
  if ((await getWhatsappProvider(api.workspaceId)) === "evolution") {
    const r = await evoConnect(api.workspaceId);
    if (!r.ok) {
      return NextResponse.json({
        ok: false,
        code: r.error?.includes("no configurad") ? "not_configured" : "unreachable",
        message: r.error ?? "No se pudo iniciar la conexión con Evolution."
      });
    }
    return NextResponse.json({
      ok: true,
      message: "Conexión Evolution iniciada. En unos segundos aparecerá el QR — escanéalo con el teléfono de Sonia."
    });
  }

  let cfg;
  try {
    cfg = await getWahaConfig(api.workspaceId);
  } catch (e: any) {
    return NextResponse.json({ ok: false, code: "not_configured", message: e?.message ?? "WAHA no configurado." });
  }

  const base = cfg.baseUrl;
  const name = cfg.session;
  const s = encodeURIComponent(name);
  const H = { "Content-Type": "application/json", "X-Api-Key": cfg.apiKey };
  const post = (p: string, body?: any) =>
    fetch(`${base}${p}`, { method: "POST", headers: H, body: body ? JSON.stringify(body) : undefined });
  const del = (p: string) => fetch(`${base}${p}`, { method: "DELETE", headers: H });

  let connected = false; // ¿conseguimos hablar con el servidor?
  let badKey = false;
  const note = (r: Response) => {
    connected = true;
    if (r.status === 401 || r.status === 403) badKey = true;
  };

  try {
    // 1) Limpia la autenticación rota (ignora errores si la sesión no la soporta)
    try { note(await post(`/api/sessions/${s}/logout`)); } catch {}

    // 2) Arranca de cero → debería ir a SCAN_QR_CODE
    let started = false;
    try {
      const r = await post(`/api/sessions/${s}/start`);
      note(r);
      started = r.ok;
    } catch {}

    // 3) Si no arrancó, resetea la sesión entera: delete + create(start)
    if (!started && !badKey) {
      try { note(await del(`/api/sessions/${s}`)); } catch {}
      try {
        const r = await post(`/api/sessions`, { name, start: true });
        note(r);
        started = r.ok;
      } catch {}
      // último intento: start clásico tras recrear
      if (!started) {
        try { note(await post(`/api/sessions/${s}/start`)); } catch {}
      }
    }
  } catch (e: any) {
    return NextResponse.json({
      ok: false,
      code: "unreachable",
      message: `No se pudo conectar a ${base} para reconectar. (${e?.message ?? "error de red"})`
    });
  }

  if (!connected) {
    return NextResponse.json({
      ok: false,
      code: "unreachable",
      message: `No se pudo conectar a ${base}. Revisa que el servidor WAHA está encendido.`
    });
  }
  if (badKey) {
    return NextResponse.json({ ok: false, code: "bad_key", message: "El servidor rechazó la API key al reconectar." });
  }

  return NextResponse.json({
    ok: true,
    message: "Sesión reiniciada desde cero. En unos segundos debería aparecer el QR — escanéalo con el teléfono de Sonia."
  });
});
