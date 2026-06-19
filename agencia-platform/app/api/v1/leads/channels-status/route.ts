/**
 * GET /api/v1/leads/channels-status
 *
 * Estado de CONEXIÓN en vivo de cada número de WhatsApp (sesión WAHA): WORKING
 * (conectado), SCAN_QR_CODE (falta escanear), STARTING, STOPPED, FAILED, o
 * "missing"/"unknown". Sirve para el indicador 🟢/🔴 en Ajustes → Multi-número.
 */
import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { getWhatsappProvider, getWahaConfig, getSession } from "@/lib/leads/waha";
import { getLeadChannels } from "@/lib/leads/channels";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  const provider = await getWhatsappProvider(api.workspaceId);
  if (provider !== "waha") {
    // Evolution: el estado fino se gestiona aparte; devolvemos vacío.
    return NextResponse.json({ provider, statuses: {} });
  }

  let mainSession = "";
  try {
    mainSession = (await getWahaConfig(api.workspaceId)).session;
  } catch {
    return NextResponse.json({ provider, statuses: {}, error: "WAHA no configurado" });
  }

  const names = Array.from(
    new Set([mainSession, ...(await getLeadChannels(api.workspaceId)).map((c) => c.name).filter(Boolean)])
  );

  const statuses: Record<string, string> = {};
  await Promise.all(
    names.map(async (name) => {
      try {
        const s = await getSession({ workspaceId: api.workspaceId, session: name });
        const st = String((s as any)?.status ?? "").toUpperCase();
        statuses[name] = st || "UNKNOWN";
      } catch {
        // 404 → la sesión aún no existe en WAHA.
        statuses[name] = "MISSING";
      }
    })
  );

  return NextResponse.json({ provider, mainSession, statuses });
});
