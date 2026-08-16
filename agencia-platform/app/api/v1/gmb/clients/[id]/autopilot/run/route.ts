/**
 * POST /api/v1/gmb/clients/[id]/autopilot/run — ejecuta el piloto AHORA para la ficha (respeta la
 * política: modo, kill switch, quiet hours, límite diario, confianza mínima). Genera oportunidades y
 * auto-avanza solo efectos internos seguros; las externas quedan en needs_approval. Tenant-scoped.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { ensureGmbClient } from "@/lib/gmb/server";
import { runAutopilotForClient } from "@/lib/gmb/autopilot-scheduler";

export const dynamic = "force-dynamic";

export const POST = withApi({ scope: "*" }, async (_req, { params, api }) => {
  const client = await ensureGmbClient(prisma, api.workspaceId, params.id);
  if (!client) throw new ApiError(404, "not_found", "Ficha no encontrada");
  const result = await runAutopilotForClient(prisma, api.workspaceId, client.id, { generate: true });
  const note = !result.active
    ? result.reason === "kill_switch" ? "Piloto detenido (kill switch activo)."
      : result.reason === "suggest_only" ? "Modo sólo-sugerir: no se auto-ejecuta nada."
      : result.reason === "quiet_hours" ? "En horas de silencio: no se actúa ahora."
      : result.reason === "sin_politica" ? "Configura la política del piloto primero."
      : "Piloto inactivo."
    : `Piloto ejecutado: ${result.generated} generadas, ${result.executed} ejecutadas, ${result.advanced} avanzadas.`;
  return NextResponse.json({ ok: true, ...result, note });
});
