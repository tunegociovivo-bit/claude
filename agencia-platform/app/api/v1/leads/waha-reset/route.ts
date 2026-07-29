/**
 * POST /api/v1/leads/waha-reset[?session=<canal>]
 *
 * REINICIO TOTAL de una sesión de WAHA desde el Hub (sin panel de WAHA):
 * logout → DELETE → crear+start. Para desatascar sesiones clavadas en STARTING
 * o FAILED. Tras esto hay que reescanear el QR (el cliente lo pide a /waha-qr).
 * Solo admins.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { getWhatsappProvider, resetSession } from "@/lib/leads/waha";

async function requireAdmin(workspaceId: string, userId: string | undefined) {
  if (!userId) throw new ApiError(401, "no_user", "Sesión requerida");
  const me = await prisma.membership.findFirst({ where: { workspaceId, userId } });
  if (!me || me.role !== "ADMIN") throw new ApiError(403, "forbidden", "Solo admins");
}

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  await requireAdmin(api.workspaceId, api.userId);

  if ((await getWhatsappProvider(api.workspaceId)) !== "waha") {
    throw new ApiError(400, "not_waha", "El reinicio total solo aplica a WAHA (Evolution se reconecta desde su propio flujo).");
  }

  const requested = new URL(req.url).searchParams.get("session")?.trim() || null;

  // Un canal concreto debe estar dado de alta en Ajustes.
  if (requested) {
    const { getLeadChannels } = await import("@/lib/leads/channels");
    const channels = await getLeadChannels(api.workspaceId);
    if (!channels.some((c) => c.name === requested)) {
      throw new ApiError(400, "unknown_channel", `El número "${requested}" no está en Ajustes.`);
    }
  }

  try {
    const { status } = await resetSession({ workspaceId: api.workspaceId, session: requested ?? undefined });
    return NextResponse.json({
      ok: true,
      status,
      message:
        status === "SCAN_QR_CODE"
          ? "Sesión reiniciada. Escanea el QR para vincular."
          : status === "STARTING"
            ? "Sesión reiniciada y arrancando. En unos segundos aparecerá el QR."
            : status === "WORKING"
              ? "Sesión reiniciada y ya conectada."
              : "Sesión reiniciada. Pulsa 'Actualizar QR' en unos segundos."
    });
  } catch (e: any) {
    throw new ApiError(502, "waha_reset_failed", e?.message ?? "No se pudo reiniciar la sesión en WAHA.");
  }
});
